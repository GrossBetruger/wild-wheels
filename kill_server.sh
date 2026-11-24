#!/usr/bin/env bash
set -euo pipefail
project_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
# shellcheck source=scripts/server/server-process.sh
source "$project_dir/scripts/server/server-process.sh"
server_lock
server_stop
