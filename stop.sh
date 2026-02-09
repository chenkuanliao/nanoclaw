#!/bin/bash
OS="$(uname -s)"

# Stop NanoClaw service
if [ "$OS" = "Darwin" ]; then
    launchctl unload ~/Library/LaunchAgents/com.nanoclaw.plist 2>/dev/null
elif [ "$OS" = "Linux" ]; then
    systemctl --user stop nanoclaw 2>/dev/null
fi
echo "NanoClaw stopped"

# Stop dashboard server
pkill -f "dashboard-server.cjs" 2>/dev/null && echo "Dashboard stopped" || true
