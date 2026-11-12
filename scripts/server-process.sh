#!/usr/bin/env bash
# Shared by the root server commands; source after setting project_dir.
: "${project_dir:?Source this file after setting project_dir}"
umask 077
server_state_dir="${WILD_WHEELS_RUN_DIR:-$project_dir/.wild-wheels}"
server_pid_file="$server_state_dir/server.pid"
mkdir -p -- "$server_state_dir"
server_lock(){
  if ! mkdir -- "$server_state_dir/lock" 2>/dev/null; then printf '%s\n' 'Another server command is running.' >&2; return 1; fi
  trap 'rmdir -- "$server_state_dir/lock" 2>/dev/null || true' EXIT
}
server_running(){
  [[ -f $server_pid_file ]] || return 1
  { IFS= read -r server_pid; IFS= read -r server_executable; } < "$server_pid_file" || return 1
  [[ $server_pid =~ ^[1-9][0-9]{0,9}$ && -n $server_executable ]] || return 1
  local actual status
  actual=$(ps -ww -p "$server_pid" -o args= 2>/dev/null) || return 1
  status=$(ps -p "$server_pid" -o stat= 2>/dev/null) || return 1
  [[ $actual == "$server_executable" && $status != *Z* ]]
}
