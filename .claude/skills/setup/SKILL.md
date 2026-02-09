---
name: setup
description: Run initial NanoClaw setup. Use when user wants to install dependencies, set up Signal, register their main channel, or start the background services. Triggers on "setup", "install", "configure nanoclaw", or first-time setup requests.
---

# NanoClaw Setup

Run all commands automatically. Only pause when user action is required (Signal registration).

**UX Note:** When asking the user questions, prefer using the `AskUserQuestion` tool instead of just outputting text. This integrates with Claude's built-in question/answer system for a better experience.

## 1. Install Dependencies

```bash
npm install
```

## 2. Install Docker

Check if Docker is installed and running:

```bash
docker info >/dev/null 2>&1 && echo "Docker: installed and running" || echo "Docker: not installed or not running"
```

**If Docker is running:** Continue to Section 3.

**If Docker is NOT installed or not running:**

Tell the user:
> NanoClaw uses Docker to run agents in isolated containers.
>
> 1. Install [Docker Desktop](https://www.docker.com/products/docker-desktop/) for your platform
> 2. Start Docker Desktop
> 3. Let me know when it's running

Wait for user confirmation, then verify:

```bash
docker info >/dev/null 2>&1 && echo "Docker is ready" || echo "Docker is still not running"
```

## 3. Configure Claude Authentication

Ask the user:
> Do you want to use your **Claude subscription** (Pro/Max) or an **Anthropic API key**?

### Option 1: Claude Subscription (Recommended)

Tell the user:
> Open another terminal window and run:
> ```
> claude setup-token
> ```
> A browser window will open for you to log in. Once authenticated, the token will be displayed in your terminal. Either:
> 1. Paste it here and I'll add it to `.env` for you, or
> 2. Add it to `.env` yourself as `CLAUDE_CODE_OAUTH_TOKEN=<your-token>`

If they give you the token, add it to `.env`:

```bash
echo "CLAUDE_CODE_OAUTH_TOKEN=<token>" > .env
```

### Option 2: API Key

Ask if they have an existing key to copy or need to create one.

**Copy existing:**
```bash
grep "^ANTHROPIC_API_KEY=" /path/to/source/.env > .env
```

**Create new:**
```bash
echo 'ANTHROPIC_API_KEY=' > .env
```

Tell the user to add their key from https://console.anthropic.com/

**Verify:**
```bash
KEY=$(grep "^ANTHROPIC_API_KEY=" .env | cut -d= -f2)
[ -n "$KEY" ] && echo "API key configured: ${KEY:0:10}...${KEY: -4}" || echo "Missing"
```

## 4. Build Container Image

Build the NanoClaw agent container:

```bash
./container/build.sh
```

This creates the `nanoclaw-agent:latest` image with Node.js, Chromium, Claude Code CLI, and agent-browser.

Verify the build succeeded:

```bash
echo '{}' | docker run -i --entrypoint /bin/echo nanoclaw-agent:latest "Container OK" || echo "Container build failed"
```

## 5. Signal Setup

**USER ACTION REQUIRED**

### 5a. Start Signal API container

```bash
docker run -d --name nanoclaw-signal-api --restart=unless-stopped \
  -p 8080:8080 \
  -v $(pwd)/store/signal-cli:/home/.local/share/signal-cli \
  -e MODE=native \
  bbernhard/signal-cli-rest-api:latest
```

Wait a few seconds for it to start:
```bash
sleep 5
docker logs nanoclaw-signal-api 2>&1 | tail -5
```

### 5b. Register Signal number

Tell the user:
> You need a phone number for your Signal bot. This can be:
> - A Google Voice number
> - A spare SIM
> - Any number that can receive SMS for verification
>
> **Important:** This number should NOT be your personal Signal number (that will be used as your main channel).

Run the interactive Signal setup:

```bash
npm run signal-setup
```

This will prompt for the phone number and verification code. Use a Bash tool timeout of 120000ms so the user has time to complete verification.

### 5c. Write Signal config to .env

Append Signal configuration to `.env`:

```bash
echo "" >> .env
echo "# Signal Configuration" >> .env
echo "SIGNAL_ENABLED=true" >> .env
echo "SIGNAL_NUMBER=+THEIR_NUMBER_HERE" >> .env
echo "SIGNAL_API_URL=http://localhost:8080" >> .env
```

Replace `+THEIR_NUMBER_HERE` with the actual number they registered.

## 6. Configure Assistant Name and Main Channel

This step configures three things at once: the trigger word, the main channel type, and the main channel selection.

### 6a. Ask for trigger word

Ask the user:
> What trigger word do you want to use? (default: `Kevin`)
>
> In group chats, messages starting with `@TriggerWord` will be sent to Claude.
> In your main channel (and optionally solo chats), no prefix is needed — all messages are processed.

Store their choice for use in the steps below.

### 6b. Explain security model and ask about main channel type

**Use the AskUserQuestion tool** to present this:

> **Important: Your "main" channel is your admin control portal.**
>
> The main channel has elevated privileges:
> - Can see messages from ALL other registered groups
> - Can manage and delete tasks across all groups
> - Can write to global memory that all groups can read
> - Has read-write access to the entire NanoClaw project
>
> **Recommendation:** Use a direct message to the bot's Signal number as your main channel. This ensures only you have admin control.
>
> **Question:** Which setup will you use for your main channel?
>
> Options:
> 1. Direct message to bot (Recommended) - Your personal Signal messages to the bot
> 2. Signal group (just me and the bot)
> 3. Signal group with other people (I understand the security implications)

If they choose option 3, ask a follow-up:

> You've chosen a group with other people. This means everyone in that group will have admin privileges over NanoClaw.
>
> Are you sure you want to proceed? The other members will be able to:
> - Read messages from your other registered chats
> - Schedule and manage tasks
> - Access any directories you've mounted
>
> Options:
> 1. Yes, I understand and want to proceed
> 2. No, let me use a direct message or solo group instead

### 6c. Register the main channel

First build:
```bash
npm run build
```

**For direct message** (they chose option 1):

Ask the user for their personal phone number (with country code, including +, e.g. `+14155551234`). The Signal JID format is the number itself (e.g., `signal:+14155551234`).

**For Signal group** (they chose option 2 or 3):

Signal groups require the group ID. Start the app briefly (set Bash tool timeout to 15000ms) so it can sync Signal groups:

```bash
npm run dev
```

Then check the database for Signal groups:
```bash
sqlite3 store/messages.db "SELECT jid, name FROM chats WHERE jid LIKE 'signal_group:%' ORDER BY last_message_time DESC LIMIT 20"
```

Show the group names and ask the user to pick one.

### 6d. Write the configuration

Once you have the JID, configure it. Use the assistant name from step 6a.

For direct messages (solo, no prefix needed), set `requiresTrigger` to `false`:

```json
{
  "JID_HERE": {
    "name": "main",
    "folder": "main",
    "trigger": "@ASSISTANT_NAME",
    "added_at": "CURRENT_ISO_TIMESTAMP",
    "requiresTrigger": false
  }
}
```

For groups, keep `requiresTrigger` as `true` (default).

Write to the database directly by creating a temporary registration script, or write `data/registered_groups.json` which will be auto-migrated on first run:

```bash
mkdir -p data
```

Then write `data/registered_groups.json` with the correct JID, trigger, and timestamp.

If the user chose a name other than `Kevin`, also update:
1. `groups/global/CLAUDE.md` - Change "# Kevin" and "You are Kevin" to the new name
2. `groups/main/CLAUDE.md` - Same changes at the top

Ensure the groups folder exists:
```bash
mkdir -p groups/main/logs
```

## 7. Configure External Directory Access (Mount Allowlist)

Ask the user:
> Do you want the agent to be able to access any directories **outside** the NanoClaw project?
>
> Examples: Git repositories, project folders, documents you want Claude to work on.
>
> **Note:** This is optional. Without configuration, agents can only access their own group folders.

If **no**, create an empty allowlist to make this explicit:

```bash
mkdir -p ~/.config/nanoclaw
cat > ~/.config/nanoclaw/mount-allowlist.json << 'EOF'
{
  "allowedRoots": [],
  "blockedPatterns": [],
  "nonMainReadOnly": true
}
EOF
echo "Mount allowlist created - no external directories allowed"
```

Skip to the next step.

If **yes**, ask follow-up questions:

### 7a. Collect Directory Paths

Ask the user:
> Which directories do you want to allow access to?
>
> You can specify:
> - A parent folder like `~/projects` (allows access to anything inside)
> - Specific paths like `~/repos/my-app`
>
> List them one per line, or give me a comma-separated list.

For each directory they provide, ask:
> Should `[directory]` be **read-write** (agents can modify files) or **read-only**?
>
> Read-write is needed for: code changes, creating files, git commits
> Read-only is safer for: reference docs, config examples, templates

### 7b. Configure Non-Main Group Access

Ask the user:
> Should **non-main groups** (other Signal chats you add later) be restricted to **read-only** access even if read-write is allowed for the directory?
>
> Recommended: **Yes** - this prevents other groups from modifying files even if you grant them access to a directory.

### 7c. Create the Allowlist

Create the allowlist file based on their answers:

```bash
mkdir -p ~/.config/nanoclaw
```

Then write the JSON file. Example for a user who wants `~/projects` (read-write) and `~/docs` (read-only) with non-main read-only:

```bash
cat > ~/.config/nanoclaw/mount-allowlist.json << 'EOF'
{
  "allowedRoots": [
    {
      "path": "~/projects",
      "allowReadWrite": true,
      "description": "Development projects"
    },
    {
      "path": "~/docs",
      "allowReadWrite": false,
      "description": "Reference documents"
    }
  ],
  "blockedPatterns": [],
  "nonMainReadOnly": true
}
EOF
```

Verify the file:

```bash
cat ~/.config/nanoclaw/mount-allowlist.json
```

Tell the user:
> Mount allowlist configured. The following directories are now accessible:
> - `~/projects` (read-write)
> - `~/docs` (read-only)
>
> **Security notes:**
> - Sensitive paths (`.ssh`, `.gnupg`, `.aws`, credentials) are always blocked
> - This config file is stored outside the project, so agents cannot modify it
> - Changes require restarting the NanoClaw service
>
> To grant a group access to a directory, add it to their config in `data/registered_groups.json`:
> ```json
> "containerConfig": {
>   "additionalMounts": [
>     { "hostPath": "~/projects/my-app", "containerPath": "my-app", "readonly": false }
>   ]
> }
> ```

## 8. Configure launchd Service and Dashboard

Generate the plist file with correct paths automatically:

```bash
NODE_PATH=$(which node)
PROJECT_PATH=$(pwd)
HOME_PATH=$HOME

cat > ~/Library/LaunchAgents/com.nanoclaw.plist << EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.nanoclaw</string>
    <key>ProgramArguments</key>
    <array>
        <string>${NODE_PATH}</string>
        <string>${PROJECT_PATH}/dist/index.js</string>
    </array>
    <key>WorkingDirectory</key>
    <string>${PROJECT_PATH}</string>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>EnvironmentVariables</key>
    <dict>
        <key>PATH</key>
        <string>/usr/local/bin:/usr/bin:/bin:${HOME_PATH}/.local/bin</string>
        <key>HOME</key>
        <string>${HOME_PATH}</string>
    </dict>
    <key>StandardOutPath</key>
    <string>${PROJECT_PATH}/logs/nanoclaw.log</string>
    <key>StandardErrorPath</key>
    <string>${PROJECT_PATH}/logs/nanoclaw.error.log</string>
</dict>
</plist>
EOF

echo "Created launchd plist with:"
echo "  Node: ${NODE_PATH}"
echo "  Project: ${PROJECT_PATH}"
```

Build and start:

```bash
npm run build
mkdir -p logs
chmod +x start.sh stop.sh
./start.sh
```

`start.sh` starts both the NanoClaw service and the dashboard.

Verify it's running:
```bash
launchctl list | grep nanoclaw
```

Tell the user:
> NanoClaw is running! The dashboard is available at http://localhost:3000 (or 3001 if 3000 is busy).
>
> To manage the service:
> - Start: `./start.sh`
> - Stop: `./stop.sh`

## 9. Test

Tell the user (using the assistant name they configured):
> Send a message to your bot via Signal. In your main channel (direct message), you don't need the `@` prefix — just send `hello` and the agent will respond.
>
> In group chats, start messages with `@ASSISTANT_NAME`.

Check the logs:
```bash
tail -f logs/nanoclaw.log
```

The user should receive a response in Signal.

## Troubleshooting

**Service not starting**: Check `logs/nanoclaw.error.log`

**Container agent fails with "Claude Code process exited with code 1"**:
- Ensure Docker is running: `docker info`
- Check container logs: `cat groups/main/logs/container-*.log | tail -50`

**No response to messages**:
- Verify the trigger pattern matches (e.g., `@AssistantName` at start of message)
- Main channel doesn't require a prefix — all messages are processed
- Personal/solo chats with `requiresTrigger: false` also don't need a prefix
- Check that the chat JID is in the database: `sqlite3 store/messages.db "SELECT * FROM registered_groups"`
- Check `logs/nanoclaw.log` for errors

**Signal issues**:
- Check Signal API container: `docker logs nanoclaw-signal-api`
- Restart Signal API: `docker restart nanoclaw-signal-api`
- Re-register: `npm run signal-setup`

**Unload service**:
```bash
./stop.sh
```
