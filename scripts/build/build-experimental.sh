#!/usr/bin/env bash
# Build the browser bindings and asset packs without building the native client.
# Uses per-stage SHA-256 input hashes so unchanged WASM, graphics, or sound
# packs are reused immediately instead of rebuilt on every server restart.
set -euo pipefail
project_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)
cd -- "$project_dir"
output=${1:?Pass an output directory for the Bevy WASM files}
target_dir=${2:-$project_dir/wasm-poc/target}
jobs=${CARGO_BUILD_JOBS:-1}
toolchain=1.97.1
target=wasm32-unknown-unknown
export PATH="$PATH:${CARGO_HOME:-$HOME/.cargo}/bin"

hash_stream() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum | awk '{print $1}'
  else
    shasum -a 256 | awk '{print $1}'
  fi
}

hash_inputs() {
  local files
  files=$(find "$@" -type f 2>/dev/null | LC_ALL=C sort)
  {
    printf '%s\n' "$files"
    while IFS= read -r f; do
      [[ -n $f ]] || continue
      printf '=== %s ===\n' "$f"
      cat -- "$f"
    done <<< "$files"
  } | hash_stream
}

cache_hit() {
  local stamp=$1 expected=$2
  shift 2
  [[ -f $stamp && $(cat -- "$stamp" 2>/dev/null) == "$expected" ]] || return 1
  for f in "$@"; do
    [[ -f $f ]] || return 1
  done
  return 0
}

mkdir -p -- "$output/pkg"

wasm_hash=$(hash_inputs \
  scripts/build/build-experimental.sh \
  wasm-poc/Cargo.toml \
  wasm-poc/Cargo.lock \
  wasm-poc/src \
  rust-core/Cargo.toml \
  rust-core/src)
graphics_hash=$(hash_inputs \
  scripts/build/port-graphics.mjs \
  scripts/build/graphics-port.mjs \
  client/renderer.js \
  client/characters.js \
  characters \
  gameplay \
  ui/ability-announcements.js)
sounds_hash=$(hash_inputs \
  scripts/build/port-sounds.mjs \
  scripts/build/sound-port.mjs \
  audio \
  gameplay)

need_wasm=1
need_graphics=1
need_sounds=1

if cache_hit "$output/.wasm.sha256" "$wasm_hash" \
  "$output/pkg/wild_wheels_wasm_poc.js" \
  "$output/pkg/wild_wheels_wasm_poc.js.gz" \
  "$output/pkg/wild_wheels_wasm_poc_bg.wasm" \
  "$output/pkg/wild_wheels_wasm_poc_bg.wasm.gz"; then
  need_wasm=0
fi

if cache_hit "$output/.graphics.sha256" "$graphics_hash" \
  "$output/graphics.wwgp" \
  "$output/graphics.wwgp.gz"; then
  need_graphics=0
fi

if cache_hit "$output/.sounds.sha256" "$sounds_hash" \
  "$output/sounds.wwsp"; then
  need_sounds=0
fi

if (( need_wasm == 0 && need_graphics == 0 && need_sounds == 0 )); then
  printf 'Experimental client assets up to date (WASM, graphics, and sounds cached).\n'
  exit 0
fi

if (( need_graphics || need_sounds )); then
  command -v node >/dev/null || { printf '%s\n' 'Node.js is required to build the experimental client. On Ubuntu/Debian, run ./install_ubuntu.sh.' >&2; exit 1; }
fi
if (( need_sounds )) && [[ $(uname -s) != Darwin ]]; then
  command -v ffmpeg >/dev/null || { printf '%s\n' 'FFmpeg is required to build the experimental sound pack. On Ubuntu/Debian, run ./install_ubuntu.sh.' >&2; exit 1; }
fi

staging=$(mktemp -d "$output/.build.XXXXXXXX")
trap 'rm -rf -- "$staging"' EXIT

if (( need_wasm )); then
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
  "$bindgen" --target web --no-typescript --out-dir "$staging" "$target_dir/$target/release/wild_wheels_wasm_poc.wasm"
  for artifact in wild_wheels_wasm_poc.js wild_wheels_wasm_poc_bg.wasm; do
    gzip -n -c -- "$staging/$artifact" > "$staging/$artifact.gz"
  done
  mv -f -- "$staging/wild_wheels_wasm_poc.js" "$staging/wild_wheels_wasm_poc.js.gz" "$staging/wild_wheels_wasm_poc_bg.wasm" "$staging/wild_wheels_wasm_poc_bg.wasm.gz" "$output/pkg/"
  printf '%s\n' "$wasm_hash" > "$output/.wasm.sha256"
else
  printf 'Skipping WASM rebuild (unchanged).\n'
fi

if (( need_graphics )); then
  node scripts/build/port-graphics.mjs --web "$staging/graphics.wwgp"
  gzip -n -c -- "$staging/graphics.wwgp" > "$staging/graphics.wwgp.gz"
  mv -f -- "$staging/graphics.wwgp" "$staging/graphics.wwgp.gz" "$output/"
  printf '%s\n' "$graphics_hash" > "$output/.graphics.sha256"
else
  printf 'Skipping graphics.wwgp rebuild (unchanged).\n'
fi

if (( need_sounds )); then
  node scripts/build/port-sounds.mjs "$staging/sounds.wwsp"
  mv -f -- "$staging/sounds.wwsp" "$output/"
  printf '%s\n' "$sounds_hash" > "$output/.sounds.sha256"
else
  printf 'Skipping sounds.wwsp rebuild (unchanged).\n'
fi
