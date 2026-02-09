#!/bin/bash
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
OS="$(uname -s)"

# Start NanoClaw service
if [ "$OS" = "Darwin" ]; then
    launchctl load ~/Library/LaunchAgents/com.nanoclaw.plist 2>/dev/null
elif [ "$OS" = "Linux" ]; then
    systemctl --user start nanoclaw 2>/dev/null
fi
echo "NanoClaw started"

# Start dashboard in background
PORT=${PORT:-3000}
if [ "$OS" = "Darwin" ]; then
    if lsof -Pi :$PORT -sTCP:LISTEN -t >/dev/null 2>&1; then
        PORT=3001
    fi
else
    if ss -tlnp "sport = :$PORT" 2>/dev/null | grep -q LISTEN; then
        PORT=3001
    fi
fi
PORT=$PORT nohup node "$SCRIPT_DIR/dashboard-server.cjs" > /dev/null 2>&1 &
echo "Dashboard: http://localhost:$PORT"
