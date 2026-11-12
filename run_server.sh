#!/usr/bin/env bash
set -euo pipefail
project_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
cd -- "$project_dir"
# shellcheck source=scripts/server-process.sh
source "$project_dir/scripts/server-process.sh"
server_log_file="$server_state_dir/server.log"
server_lock
if server_running; then printf 'Server already running (PID %s). Log: %s\n' "$server_pid" "$server_log_file"; exit 0; fi
cargo_bin=$(command -v cargo || true)
if [[ -z $cargo_bin && -x ${CARGO_HOME:-$HOME/.cargo}/bin/cargo ]]; then cargo_bin="${CARGO_HOME:-$HOME/.cargo}/bin/cargo"; fi
if [[ -z $cargo_bin ]]; then printf '%s\n' 'Rust is missing. On Ubuntu/Debian, run ./install_ubuntu.sh first.' >&2; exit 1; fi
server_target_dir="${CARGO_TARGET_DIR:-$project_dir/dedicated-server/target}"
"$cargo_bin" build --release --locked --jobs "${CARGO_BUILD_JOBS:-1}" --manifest-path "$project_dir/dedicated-server/Cargo.toml" --target-dir "$server_target_dir"
server_target_dir=$(cd -- "$server_target_dir" && pwd)
server_executable="$server_target_dir/release/wild-wheels-server"
nohup "$server_executable" >> "$server_log_file" 2>&1 < /dev/null &
server_pid=$!
printf '%s\n%s\n' "$server_pid" "$server_executable" > "$server_pid_file"
disown "$server_pid" 2>/dev/null || true
sleep 0.3
if ! server_running; then rm -f -- "$server_pid_file"; printf 'Server failed to start. See %s\n' "$server_log_file" >&2; tail -n 12 "$server_log_file" >&2; exit 1; fi
printf 'Server detached (PID %s), port %s. You can close SSH.\nLog: %s\nStop: ./kill_server.sh\n' "$server_pid" "${PORT:-5173}" "$server_log_file"
