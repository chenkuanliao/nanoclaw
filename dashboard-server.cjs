#!/usr/bin/env node

const http = require('http');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const Database = require('better-sqlite3');

const PORT = process.env.PORT || 3000;
const PROJECT_ROOT = __dirname;
const DB_PATH = path.join(PROJECT_ROOT, 'store', 'messages.db');
const HTML_PATH = path.join(PROJECT_ROOT, 'dashboard.html');
const GROUPS_DIR = path.join(PROJECT_ROOT, 'groups');

let db;
try {
  db = new Database(DB_PATH, { readonly: true });
} catch (err) {
  console.error(`Failed to open database at ${DB_PATH}:`, err.message);
  process.exit(1);
}

const apiHandlers = {
  '/api/status': () => {
    const groups = db.prepare('SELECT COUNT(*) as count FROM registered_groups').get();
    const activeTasks = db.prepare("SELECT COUNT(*) as count FROM scheduled_tasks WHERE status = 'active'").get();
    const totalTasks = db.prepare('SELECT COUNT(*) as count FROM scheduled_tasks').get();
    const totalRuns = db.prepare('SELECT COUNT(*) as count FROM task_run_logs').get();
    const lastRun = db.prepare('SELECT run_at FROM task_run_logs ORDER BY run_at DESC LIMIT 1').get();
    const sessions = db.prepare('SELECT COUNT(*) as count FROM sessions').get();
    const recentErrors = db.prepare("SELECT COUNT(*) as count FROM task_run_logs WHERE status = 'error' AND run_at > datetime('now', '-24 hours')").get();
    const lastMessage = db.prepare('SELECT timestamp FROM messages ORDER BY timestamp DESC LIMIT 1').get();

    return {
      registeredGroups: groups.count,
      activeTasks: activeTasks.count,
      totalTasks: totalTasks.count,
      totalRuns: totalRuns.count,
      activeSessions: sessions.count,
      recentErrors: recentErrors.count,
      lastTaskRun: lastRun ? lastRun.run_at : null,
      lastMessage: lastMessage ? lastMessage.timestamp : null,
    };
  },

  '/api/service-status': () => {
    let running = false;
    let details = '';
    try {
      const output = execSync('launchctl list com.nanoclaw 2>&1', { encoding: 'utf8', timeout: 5000 });
      // If launchctl list succeeds and shows PID, it's running
      running = !output.includes('Could not find service');
      if (running) {
        // Extract PID from output
        const pidMatch = output.match(/"PID"\s*=\s*(\d+)/);
        details = pidMatch ? `PID ${pidMatch[1]}` : 'running';
      }
    } catch {
      // launchctl list returns non-zero if service not found
      running = false;
    }

    // Get process uptime if running
    let uptime = null;
    if (running) {
      try {
        const pidMatch = execSync('launchctl list com.nanoclaw 2>&1', { encoding: 'utf8', timeout: 5000 })
          .match(/"PID"\s*=\s*(\d+)/);
        if (pidMatch) {
          const psOutput = execSync(`ps -p ${pidMatch[1]} -o etime=`, { encoding: 'utf8', timeout: 5000 }).trim();
          uptime = psOutput;
        }
      } catch { /* ignore */ }
    }

    return { running, details, uptime };
  },

  '/api/containers': () => {
    try {
      const output = execSync(
        'docker ps --filter "name=nanoclaw-" --format "{{json .}}"',
        { encoding: 'utf8', timeout: 5000 }
      ).trim();

      if (!output) return [];

      return output.split('\n').filter(Boolean).map(line => {
        const c = JSON.parse(line);
        return {
          name: c.Names,
          status: c.Status,
          runningFor: c.RunningFor,
          image: c.Image,
          createdAt: c.CreatedAt,
        };
      }).filter(c => /nanoclaw-.+-\d+$/.test(c.name));
    } catch {
      return [];
    }
  },

  '/api/memories': () => {
    const memories = [];
    try {
      const dirs = fs.readdirSync(GROUPS_DIR, { withFileTypes: true });
      for (const dir of dirs) {
        if (!dir.isDirectory()) continue;
        const claudePath = path.join(GROUPS_DIR, dir.name, 'CLAUDE.md');
        if (fs.existsSync(claudePath)) {
          const content = fs.readFileSync(claudePath, 'utf8');
          memories.push({
            group: dir.name,
            content,
            size: content.length,
            lines: content.split('\n').length,
          });
        }
      }
    } catch { /* ignore */ }
    return memories;
  },

  '/api/logs/recent': () => {
    const logs = [];
    try {
      const dirs = fs.readdirSync(GROUPS_DIR, { withFileTypes: true });
      for (const dir of dirs) {
        if (!dir.isDirectory()) continue;
        const logsDir = path.join(GROUPS_DIR, dir.name, 'logs');
        if (!fs.existsSync(logsDir)) continue;

        const logFiles = fs.readdirSync(logsDir)
          .filter(f => f.startsWith('container-') && f.endsWith('.log'))
          .sort()
          .reverse()
          .slice(0, 10); // last 10 per group

        for (const logFile of logFiles) {
          try {
            const content = fs.readFileSync(path.join(logsDir, logFile), 'utf8');
            const header = content.split('\n').slice(0, 10).join('\n');

            const timestampMatch = header.match(/Timestamp:\s*(.+)/);
            const groupMatch = header.match(/Group:\s*(.+)/);
            const durationMatch = header.match(/Duration:\s*(\d+)ms/);
            const exitCodeMatch = header.match(/Exit Code:\s*(\d+)/);
            const isTimeout = header.includes('(TIMEOUT)');

            logs.push({
              file: logFile,
              groupFolder: dir.name,
              groupName: groupMatch ? groupMatch[1].trim() : dir.name,
              timestamp: timestampMatch ? timestampMatch[1].trim() : null,
              durationMs: durationMatch ? parseInt(durationMatch[1]) : null,
              exitCode: exitCodeMatch ? parseInt(exitCodeMatch[1]) : null,
              isTimeout,
              status: isTimeout ? 'timeout' : (exitCodeMatch && exitCodeMatch[1] !== '0' ? 'error' : 'success'),
            });
          } catch { /* skip unreadable log */ }
        }
      }
    } catch { /* ignore */ }

    // Sort all logs by timestamp descending, limit to 30
    logs.sort((a, b) => (b.timestamp || '').localeCompare(a.timestamp || ''));
    return logs.slice(0, 30);
  },

  '/api/tasks': () => {
    return db.prepare("SELECT * FROM scheduled_tasks WHERE status != 'completed' ORDER BY created_at DESC").all();
  },

  '/api/groups': () => {
    const groups = db.prepare('SELECT * FROM registered_groups ORDER BY added_at DESC').all();
    const stmt = db.prepare('SELECT COUNT(*) as count FROM messages WHERE chat_jid = ?');
    const lastMsg = db.prepare('SELECT timestamp FROM messages WHERE chat_jid = ? ORDER BY timestamp DESC LIMIT 1');
    return groups.map(g => ({
      ...g,
      messageCount: stmt.get(g.jid).count,
      lastActivity: (lastMsg.get(g.jid) || {}).timestamp || null,
    }));
  },

  '/api/logs': () => {
    return db.prepare(`
      SELECT l.*, t.group_folder, t.prompt, t.schedule_type, t.schedule_value
      FROM task_run_logs l
      JOIN scheduled_tasks t ON l.task_id = t.id
      ORDER BY l.run_at DESC
      LIMIT 50
    `).all();
  },

  '/api/messages/recent': () => {
    return db.prepare(`
      SELECT m.chat_jid, m.sender_name, m.content, m.timestamp, m.is_from_me,
             c.name as chat_name
      FROM messages m
      LEFT JOIN chats c ON m.chat_jid = c.jid
      ORDER BY m.timestamp DESC
      LIMIT 30
    `).all();
  },
};

const server = http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(200);
    res.end();
    return;
  }

  if (req.url.startsWith('/api/')) {
    const handler = apiHandlers[req.url];
    if (handler) {
      try {
        const data = handler();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(data, null, 2));
      } catch (error) {
        console.error('API error:', error);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: error.message }));
      }
    } else {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Not found' }));
    }
    return;
  }

  if (req.url === '/' || req.url === '/index.html') {
    try {
      const html = fs.readFileSync(HTML_PATH, 'utf8');
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(html);
    } catch (error) {
      res.writeHead(500, { 'Content-Type': 'text/plain' });
      res.end('Error loading dashboard: ' + error.message);
    }
    return;
  }

  res.writeHead(404, { 'Content-Type': 'text/plain' });
  res.end('Not found');
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`Nanoclaw Dashboard: http://localhost:${PORT}`);
});

process.on('SIGINT', () => {
  db.close();
  server.close(() => process.exit(0));
});

process.on('SIGTERM', () => {
  db.close();
  server.close(() => process.exit(0));
});
