#!/bin/bash
set -e
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
OS="$(uname -s)"
PORT=${PORT:-3000}

if [ "$OS" = "Darwin" ]; then
    if lsof -Pi :$PORT -sTCP:LISTEN -t >/dev/null 2>&1; then
        echo "Port $PORT in use, trying 3001..."
        PORT=3001
    fi
else
    if ss -tlnp "sport = :$PORT" 2>/dev/null | grep -q LISTEN; then
        echo "Port $PORT in use, trying 3001..."
        PORT=3001
    fi
fi

echo "Starting NanoClaw Dashboard on http://localhost:$PORT"
PORT=$PORT node "$SCRIPT_DIR/dashboard-server.cjs"
