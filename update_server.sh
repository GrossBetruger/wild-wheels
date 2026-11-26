#!/usr/bin/env bash
set -euo pipefail
project_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
cd -- "$project_dir"
# Allow the HTTP response to reach the browser before the updater begins.
if [[ ${1:-} == --from-web ]]; then sleep 1; fi
if [[ $(git branch --show-current) != main || -n $(git status --porcelain) ]]; then printf '%s\n' 'Update requires a clean checkout of main.' >&2; exit 1; fi
# Let the launcher fetch release objects after it checks its local cache.
if GIT_LFS_SKIP_SMUDGE=1 git pull --ff-only origin main; then
  git --no-pager log -1 --format='Installing %h — %s'
  exec ./run_server.sh --restart
fi
printf '%s\n' 'Update failed while pulling main.' >&2
exit 1
