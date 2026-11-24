#!/usr/bin/env bash
# Build the browser bindings and asset packs without building the native client.
set -euo pipefail
project_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)
cd -- "$project_dir"
output=${1:?Pass an output directory for the Bevy WASM files}
target_dir=${2:-$project_dir/wasm-poc/target}
jobs=${CARGO_BUILD_JOBS:-1}
toolchain=1.97.1
target=wasm32-unknown-unknown
export PATH="$PATH:${CARGO_HOME:-$HOME/.cargo}/bin"
command -v node >/dev/null || { printf '%s\n' 'Node.js is required to build the experimental client. On Ubuntu/Debian, run ./install_ubuntu.sh.' >&2; exit 1; }
if [[ $(uname -s) != Darwin ]]; then
  command -v ffmpeg >/dev/null || { printf '%s\n' 'FFmpeg is required to build the experimental sound pack. On Ubuntu/Debian, run ./install_ubuntu.sh.' >&2; exit 1; }
fi
command -v rustup >/dev/null || { printf '%s\n' 'rustup is required to build the experimental client.' >&2; exit 1; }
if ! rustup run "$toolchain" rustc --version >/dev/null 2>&1; then
  rustup toolchain install "$toolchain" --profile minimal
fi
if ! rustup target list --installed --toolchain "$toolchain" | grep -qx "$target"; then
  rustup target add --toolchain "$toolchain" "$target"
fi

bindgen_version=$(awk '/^name = "wasm-bindgen"$/ { getline; gsub(/"/, "", $3); print $3; exit }' wasm-poc/Cargo.lock)
[[ $bindgen_version =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || { printf '%s\n' 'Could not determine the wasm-bindgen version from wasm-poc/Cargo.lock.' >&2; exit 1; }
bindgen=$(command -v wasm-bindgen || true)
if [[ -z $bindgen || $("$bindgen" --version) != "wasm-bindgen $bindgen_version" ]]; then
  bindgen_root="$target_dir/tools/$bindgen_version"
  bindgen="$bindgen_root/bin/wasm-bindgen"
  if [[ ! -x $bindgen ]]; then
    rustup run "$toolchain" cargo install --locked --jobs "$jobs" --root "$bindgen_root" --version "$bindgen_version" wasm-bindgen-cli
  fi
fi

rustup run "$toolchain" cargo build --locked --release --jobs "$jobs" --manifest-path wasm-poc/Cargo.toml --target "$target" --target-dir "$target_dir"
mkdir -p -- "$output/pkg"
staging=$(mktemp -d "$output/.build.XXXXXXXX")
trap 'rm -rf -- "$staging"' EXIT
"$bindgen" --target web --no-typescript --out-dir "$staging" "$target_dir/$target/release/wild_wheels_wasm_poc.wasm"
node scripts/build/port-graphics.mjs --web "$staging/graphics.wwgp"
node scripts/build/port-sounds.mjs "$staging/sounds.wwsp"
for artifact in wild_wheels_wasm_poc.js wild_wheels_wasm_poc_bg.wasm graphics.wwgp; do
  gzip -n -c -- "$staging/$artifact" > "$staging/$artifact.gz"
done
mv -f -- "$staging/wild_wheels_wasm_poc.js" "$staging/wild_wheels_wasm_poc.js.gz" "$staging/wild_wheels_wasm_poc_bg.wasm" "$staging/wild_wheels_wasm_poc_bg.wasm.gz" "$output/pkg/"
mv -f -- "$staging/graphics.wwgp" "$staging/graphics.wwgp.gz" "$staging/sounds.wwsp" "$output/"
