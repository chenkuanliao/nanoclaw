#!/bin/bash
set -e
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
PORT=${PORT:-3000}

if lsof -Pi :$PORT -sTCP:LISTEN -t >/dev/null 2>&1; then
    echo "Port $PORT in use, trying 3001..."
    PORT=3001
fi

echo "Starting NanoClaw Dashboard on http://localhost:$PORT"
PORT=$PORT node "$SCRIPT_DIR/dashboard-server.cjs"
