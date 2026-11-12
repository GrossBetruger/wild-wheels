#!/usr/bin/env bash
set -euo pipefail
project_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
# shellcheck source=scripts/server-process.sh
source "$project_dir/scripts/server-process.sh"
server_lock
if ! server_running; then rm -f -- "$server_pid_file"; printf '%s\n' 'No managed server is running.'; exit 0; fi
kill -TERM "$server_pid"
for ((attempt=0;attempt<100;attempt++)); do
  if ! server_running; then rm -f -- "$server_pid_file"; printf '%s\n' 'Server stopped.'; exit 0; fi
  sleep 0.1
done
# Recheck process identity before escalation; never signal a reused PID.
if server_running; then kill -KILL "$server_pid"; fi
rm -f -- "$server_pid_file"
printf '%s\n' 'Server stopped after shutdown timeout.'
