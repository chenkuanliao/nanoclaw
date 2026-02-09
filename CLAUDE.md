# NanoClaw

Personal Claude assistant. See [README.md](README.md) for philosophy and setup. See [docs/REQUIREMENTS.md](docs/REQUIREMENTS.md) for architecture decisions.

## Quick Context

Single Node.js process that connects to Signal (and optionally WhatsApp), routes messages to Claude Agent SDK running in Docker containers. Each group has isolated filesystem and memory. Includes a web dashboard for monitoring.

## Key Files

| File | Purpose |
|------|---------|
| `src/index.ts` | Main app: Signal/WhatsApp connection, message routing, IPC |
| `src/config.ts` | Trigger pattern, paths, intervals |
| `src/container-runner.ts` | Spawns agent containers with mounts |
| `src/task-scheduler.ts` | Runs scheduled tasks |
| `src/db.ts` | SQLite operations |
| `src/signal-client.ts` | Signal API client |
| `src/signal-handler.ts` | Signal message handling |
| `src/signal-container.ts` | Signal API container management |
| `groups/{name}/CLAUDE.md` | Per-group memory (isolated) |
| `container/skills/agent-browser.md` | Browser automation tool (available to all agents via Bash) |
| `dashboard-server.cjs` | Web dashboard server |
| `dashboard.html` | Dashboard frontend |

## Skills

| Skill | When to Use |
|-------|-------------|
| `/setup` | First-time installation, Signal registration, Docker setup, service configuration |
| `/customize` | Adding channels (WhatsApp, etc.), integrations, changing behavior |
| `/debug` | Container issues, logs, troubleshooting |

## Development

Run commands directly—don't tell the user to run them.

```bash
npm run dev          # Run with hot reload
npm run build        # Compile TypeScript
./container/build.sh # Rebuild agent container
```

Service management:
```bash
./start.sh   # Start service + dashboard
./stop.sh    # Stop service + dashboard
```
