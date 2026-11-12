#!/usr/bin/env bash
set -euo pipefail
project_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
cd -- "$project_dir"
./kill_server.sh
if git pull --ff-only origin main; then
  git --no-pager log -1 --format='Installing %h — %s'
  exec ./run_server.sh
fi
printf '%s\n' 'Update failed; attempting to restart the existing version.' >&2
./run_server.sh || true
exit 1
