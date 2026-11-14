#!/usr/bin/env bash
set -euo pipefail
project_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
cargo_bin=$(command -v cargo || true)
if [[ -z $cargo_bin && -x ${CARGO_HOME:-$HOME/.cargo}/bin/cargo ]]; then cargo_bin="${CARGO_HOME:-$HOME/.cargo}/bin/cargo"; fi
if [[ -z $cargo_bin ]]; then printf '%s\n' 'Rust is missing. Install Rust with rustup before running the native client.' >&2; exit 1; fi
# Use the client's pinned toolchain without changing the server's compiler.
cd -- "$project_dir/native-client"
exec "$cargo_bin" run --locked --manifest-path "$project_dir/native-client/Cargo.toml" -- "$@"
