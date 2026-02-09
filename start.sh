#!/bin/bash
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"

# Start NanoClaw service
launchctl load ~/Library/LaunchAgents/com.nanoclaw.plist 2>/dev/null
echo "NanoClaw started"

# Start dashboard in background
PORT=${PORT:-3000}
if lsof -Pi :$PORT -sTCP:LISTEN -t >/dev/null 2>&1; then
    PORT=3001
fi
PORT=$PORT nohup node "$SCRIPT_DIR/dashboard-server.cjs" > /dev/null 2>&1 &
echo "Dashboard: http://localhost:$PORT"
