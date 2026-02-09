#!/bin/bash
OS="$(uname -s)"

if [ "$OS" = "Darwin" ]; then
  result=$(launchctl list 2>/dev/null | grep com.nanoclaw)
  if [ -z "$result" ]; then
    echo "NanoClaw is NOT running"
  else
    pid=$(echo "$result" | awk '{print $1}')
    if [ "$pid" = "-" ]; then
      echo "NanoClaw is STOPPED (loaded but not running)"
    else
      echo "NanoClaw is RUNNING (PID: $pid)"
    fi
  fi
elif [ "$OS" = "Linux" ]; then
  if systemctl --user is-active nanoclaw >/dev/null 2>&1; then
    pid=$(systemctl --user show nanoclaw --property=MainPID --value 2>/dev/null)
    echo "NanoClaw is RUNNING (PID: $pid)"
  else
    echo "NanoClaw is NOT running"
  fi
else
  echo "Unsupported platform: $OS"
fi
