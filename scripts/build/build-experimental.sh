#!/usr/bin/env bash
# Build the browser bindings and asset packs without building the native client.
# Uses per-stage SHA-256 input hashes so unchanged WASM, graphics, or sound
# packs are reused immediately instead of rebuilt on every server restart.
set -euo pipefail
project_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)
cd -- "$project_dir"
output=${1:?Pass an output directory for the Bevy WASM files}
target_dir=${2:-$project_dir/wasm/target}
toolchain=1.97.1
target=wasm32-unknown-unknown
export PATH="$PATH:${CARGO_HOME:-$HOME/.cargo}/bin"

# shellcheck source=scripts/build/build-status.sh
source "$project_dir/scripts/build/build-status.sh"

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

build_status checking-assets
cache_started=$SECONDS
keys=$(node --no-warnings --experimental-vm-modules scripts/build/experimental-cache-keys.mjs "$toolchain" "$target")
{ read -r wasm_hash; read -r graphics_hash; read -r sounds_hash; read -r ui_hash; } <<< "$keys"
printf 'Checked asset cache in %ss.\n' "$((SECONDS-cache_started))"

need_wasm=1
need_graphics=1
need_sounds=1
need_ui=1

if cache_hit "$output/.wasm.sha256" "$wasm_hash" \
  "$output/pkg/wild_wheels_wasm.js" \
  "$output/pkg/wild_wheels_wasm.js.gz" \
  "$output/pkg/wild_wheels_wasm_bg.wasm" \
  "$output/pkg/wild_wheels_wasm_bg.wasm.gz"; then
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

if cache_hit "$output/.ui.sha256" "$ui_hash" \
  "$output/ui.wwup" \
  "$output/ui.wwup.gz"; then
  need_ui=0
fi

if (( need_wasm == 0 && need_graphics == 0 && need_sounds == 0 && need_ui == 0 )); then
  printf 'Experimental client assets up to date (WASM, graphics, sounds, and UI cached).\n'
  exit 0
fi

if (( need_graphics || need_sounds || need_ui )); then
  command -v node >/dev/null || { printf '%s\n' 'Node.js is required to build the experimental client. On Ubuntu/Debian, run ./install_ubuntu.sh.' >&2; exit 1; }
fi
if (( need_sounds )) && [[ $(uname -s) != Darwin ]]; then
  command -v ffmpeg >/dev/null || { printf '%s\n' 'FFmpeg is required to build the experimental sound pack. On Ubuntu/Debian, run ./install_ubuntu.sh.' >&2; exit 1; }
fi

staging=$(mktemp -d "$output/.build.XXXXXXXX")
trap 'rm -rf -- "$staging"' EXIT

if (( need_wasm )); then
  build_status checking-wasm-release
  if node scripts/build/wasm-release.mjs restore "$output" "$wasm_hash" "$staging"; then need_wasm=0; fi
fi

if (( need_wasm )); then
  build_status preparing-wasm
  command -v rustup >/dev/null || { printf '%s\n' 'rustup is required to build the experimental client.' >&2; exit 1; }
  if ! rustup run "$toolchain" rustc --version >/dev/null 2>&1; then
    rustup toolchain install "$toolchain" --profile minimal
  fi
  if ! rustup target list --installed --toolchain "$toolchain" | grep -qx "$target"; then
    rustup target add --toolchain "$toolchain" "$target"
  fi

  bindgen_version=$(awk '/^name = "wasm-bindgen"$/ { getline; gsub(/"/, "", $3); print $3; exit }' wasm/Cargo.lock)
  [[ $bindgen_version =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || { printf '%s\n' 'Could not determine the wasm-bindgen version from wasm/Cargo.lock.' >&2; exit 1; }
  bindgen=$(command -v wasm-bindgen || true)
  if [[ -z $bindgen || $("$bindgen" --version) != "wasm-bindgen $bindgen_version" ]]; then
    bindgen_root="$target_dir/tools/$bindgen_version"
    bindgen="$bindgen_root/bin/wasm-bindgen"
    if [[ ! -x $bindgen ]]; then
      rustup run "$toolchain" cargo install --locked --root "$bindgen_root" --version "$bindgen_version" wasm-bindgen-cli
    fi
  fi

  run_cargo_build wasm rustup run "$toolchain" cargo build --locked --release --manifest-path wasm/Cargo.toml --target "$target" --target-dir "$target_dir"
  build_status packaging-wasm
  stage_started=$SECONDS
  "$bindgen" --target web --no-typescript --remove-name-section --out-dir "$staging" "$target_dir/$target/release/wild_wheels_wasm.wasm"
  for artifact in wild_wheels_wasm.js wild_wheels_wasm_bg.wasm; do
    gzip -n -c -- "$staging/$artifact" > "$staging/$artifact.gz"
  done
  mv -f -- "$staging/wild_wheels_wasm.js" "$staging/wild_wheels_wasm.js.gz" "$staging/wild_wheels_wasm_bg.wasm" "$staging/wild_wheels_wasm_bg.wasm.gz" "$output/pkg/"
  printf '%s\n' "$wasm_hash" > "$output/.wasm.sha256"
  printf 'WASM bindings and compression took %ss.\n' "$((SECONDS-stage_started))"
else
  printf 'WASM ready; skipping source compilation.\n'
fi

if (( need_graphics )); then
  build_status packing-graphics
  printf 'Building graphics pack (graphics.wwgp)…\n'
  stage_started=$SECONDS
  node scripts/build/port-graphics.mjs --web "$staging/graphics.wwgp"
  printf 'Compressing graphics pack…\n'
  gzip -n -c -- "$staging/graphics.wwgp" > "$staging/graphics.wwgp.gz"
  mv -f -- "$staging/graphics.wwgp" "$staging/graphics.wwgp.gz" "$output/"
  printf '%s\n' "$graphics_hash" > "$output/.graphics.sha256"
  printf 'Graphics pack took %ss.\n' "$((SECONDS-stage_started))"
else
  printf 'Skipping graphics.wwgp rebuild (unchanged).\n'
fi

if (( need_sounds )); then
  build_status packing-sounds
  printf 'Building sound pack (sounds.wwsp)…\n'
  stage_started=$SECONDS
  node scripts/build/port-sounds.mjs "$staging/sounds.wwsp"
  mv -f -- "$staging/sounds.wwsp" "$output/"
  printf '%s\n' "$sounds_hash" > "$output/.sounds.sha256"
  printf 'Sound pack took %ss.\n' "$((SECONDS-stage_started))"
else
  printf 'Skipping sounds.wwsp rebuild (unchanged).\n'
fi

if (( need_ui )); then
  build_status packing-ui
  printf 'Building UI pack (ui.wwup)…\n'
  stage_started=$SECONDS
  node scripts/build/port-ui.mjs --optional "$staging/ui.wwup"
  gzip -n -c -- "$staging/ui.wwup" > "$staging/ui.wwup.gz"
  mv -f -- "$staging/ui.wwup" "$staging/ui.wwup.gz" "$output/"
  printf '%s\n' "$ui_hash" > "$output/.ui.sha256"
  printf 'UI pack took %ss.\n' "$((SECONDS-stage_started))"
else
  printf 'Skipping ui.wwup rebuild (unchanged).\n'
fi
