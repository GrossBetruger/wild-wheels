#!/usr/bin/env bash
set -euo pipefail
project_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
cd -- "$project_dir"
cargo_bin=$(command -v cargo || true)
if [[ -z $cargo_bin && -x ${CARGO_HOME:-$HOME/.cargo}/bin/cargo ]]; then cargo_bin="${CARGO_HOME:-$HOME/.cargo}/bin/cargo"; fi
if [[ -z $cargo_bin ]]; then printf '%s\n' 'Rust is missing. On Ubuntu/Debian, run ./install_ubuntu.sh first.' >&2; exit 1; fi
server_target_dir="${CARGO_TARGET_DIR:-$project_dir/dedicated-server/target}"
# One compiler job keeps the build usable on small cloud VMs.
"$cargo_bin" build --release --locked --jobs "${CARGO_BUILD_JOBS:-1}" --manifest-path "$project_dir/dedicated-server/Cargo.toml" --target-dir "$server_target_dir"
exec "$server_target_dir/release/wild-wheels-server"
