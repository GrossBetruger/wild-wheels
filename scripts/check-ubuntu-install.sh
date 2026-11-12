#!/usr/bin/env bash
# Run inside a disposable clean Ubuntu container, with this repo mounted read-only.
set -euo pipefail
./install_ubuntu.sh
apt-get install -y --no-install-recommends shellcheck
shellcheck install_ubuntu.sh run_server.sh scripts/check-ubuntu-install.sh
export CARGO_TARGET_DIR=/tmp/wild-wheels-ubuntu-build
PORT=5174 ./run_server.sh > /tmp/wild-wheels-server.log 2>&1 &
game_pid=$!
trap 'kill "$game_pid" 2>/dev/null || true' EXIT
for ((attempt=0;attempt<300;attempt++)); do
  if curl --fail --silent http://127.0.0.1:5174/healthz > /tmp/wild-wheels-health.json; then cat /tmp/wild-wheels-health.json; printf '\n'; exit 0; fi
  if ! kill -0 "$game_pid" 2>/dev/null; then cat /tmp/wild-wheels-server.log; exit 1; fi
  sleep 1
done
cat /tmp/wild-wheels-server.log
printf '%s\n' 'Ubuntu server did not start within 300 seconds.' >&2
exit 1
