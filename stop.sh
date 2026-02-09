#!/bin/bash

# Stop NanoClaw service
launchctl unload ~/Library/LaunchAgents/com.nanoclaw.plist 2>/dev/null
echo "NanoClaw stopped"

# Stop dashboard server
pkill -f "dashboard-server.cjs" 2>/dev/null && echo "Dashboard stopped" || true
