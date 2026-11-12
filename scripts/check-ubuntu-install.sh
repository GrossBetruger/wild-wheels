#!/usr/bin/env bash
# Run inside a disposable clean Ubuntu container, with this repo mounted read-only.
set -euo pipefail
./install_ubuntu.sh
apt-get install -y --no-install-recommends shellcheck
shellcheck install_ubuntu.sh run_server.sh kill_server.sh update_server.sh scripts/server-process.sh scripts/check-ubuntu-install.sh
export CARGO_TARGET_DIR=/tmp/wild-wheels-ubuntu-build
export WILD_WHEELS_RUN_DIR=/tmp/wild-wheels-ubuntu-run
PORT=5174 ./run_server.sh
trap './kill_server.sh' EXIT
for ((attempt=0;attempt<300;attempt++)); do
  if curl --fail --silent http://127.0.0.1:5174/healthz > /tmp/wild-wheels-health.json; then cat /tmp/wild-wheels-health.json; printf '\n'; exit 0; fi
  sleep 1
done
cat "$WILD_WHEELS_RUN_DIR/server.log"
printf '%s\n' 'Ubuntu server did not start within 300 seconds.' >&2
exit 1
