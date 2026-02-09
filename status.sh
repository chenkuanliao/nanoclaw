#!/bin/bash
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
