#!/usr/bin/env bash
set -euo pipefail
case ${1:-} in
  ''|--preview) mode=preview ;;
  --apply) mode=apply ;;
  *) printf 'Usage: %s [--preview | --apply]\n' "$0" >&2; exit 2 ;;
esac
[[ $# -le 1 ]] || { printf 'Expected at most one option.\n' >&2; exit 2; }

cd -- "$(dirname -- "$0")"
project=${WILD_WHEELS_GCP_PROJECT:-$(git config --local --get wildwheels.gcpProject || true)}
zone=${WILD_WHEELS_GCP_ZONE:-$(git config --local --get wildwheels.gcpZone || true)}
instance=${WILD_WHEELS_GCP_INSTANCE:-$(git config --local --get wildwheels.gcpInstance || true)}
if [[ -z $project || -z $zone || ! $instance =~ ^[a-z]([a-z0-9-]*[a-z0-9])?$ ]]; then
  echo 'Set WILD_WHEELS_GCP_PROJECT, WILD_WHEELS_GCP_ZONE and WILD_WHEELS_GCP_INSTANCE or configure wildwheels.gcpProject, wildwheels.gcpZone and wildwheels.gcpInstance with git config --local.' >&2
  exit 2
fi
# Only the two literal modes above can reach the remote shell.
gcloud compute ssh "$instance" --project="$project" --zone="$zone" --command="bash -s -- $mode" <<'REMOTE'
set -euo pipefail
mode=$1
cd -- "$HOME/wild-wheels"
project_dir=$(pwd -P)
[[ $(git rev-parse --show-toplevel) == "$project_dir" && -f dedicated-server/Cargo.toml && -f run_server.sh ]] || { echo 'Game checkout not found.' >&2; exit 1; }

df -h .
printf '\nLargest game directories (some totals overlap)\n'
du -xh --max-depth=2 . | sort -hr | sed -n '1,20p'

if [[ $mode == apply ]]; then
  source scripts/server/server-process.sh
  server_lock
fi

candidates=()
for target in wasm-poc/target dedicated-server/target/bevy-wasm; do
  for profile in "$target"/{debug,release,wasm32-unknown-unknown/release}; do
    [[ -d $profile && $(realpath -- "$profile") == "$project_dir/$profile" ]] || continue
    # Hold Cargo's profile lock through deletion, keeping the lock file intact.
    if [[ $mode == apply && -f $profile/.cargo-lock ]]; then
      exec {lock_fd}<"$profile/.cargo-lock"
      flock -n "$lock_fd" || { printf 'Cargo is using %s. Retry after the build.\n' "$profile" >&2; exit 1; }
    fi
    for part in incremental deps build .fingerprint; do
      path="$profile/$part"
      [[ -d $path && ! -L $path ]] || continue
      tracked=$(git ls-files -- "$path")
      [[ -z $tracked ]] || { printf 'Tracked files in %s. Stopping.\n' "$path" >&2; exit 1; }
      candidates+=("$path")
    done
  done
done
if (( ${#candidates[@]} == 0 )); then echo 'No eligible build caches found.'; exit 0; fi
printf '\nRebuildable Cargo caches selected\n'
du -xshc -- "${candidates[@]}"
if [[ $mode == preview ]]; then echo 'Preview complete. Run ./cleanup_gcp.sh --apply to remove these caches.'; exit 0; fi
rm -rf --one-file-system -- "${candidates[@]}"
printf '\nCleanup complete. Current disk usage\n'
df -h .
REMOTE
