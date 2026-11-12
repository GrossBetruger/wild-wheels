#!/usr/bin/env bash
# Build dependencies only. The finished dedicated server needs no Node.js.
set -euo pipefail
case "${1:-}" in
  --help|-h) printf '%s\n' 'Usage: ./install_ubuntu.sh' 'Run as your normal Ubuntu/Debian user; sudo is used only for apt.' 'Installs build tools, Rust 1.90.0 and the browser Wasm target.'; exit 0 ;;
  '') ;;
  *) printf '%s\n' 'Unknown option. Use --help.' >&2; exit 2 ;;
esac
if [[ ! -r /etc/os-release ]]; then printf '%s\n' 'This installer requires Ubuntu or Debian.' >&2; exit 1; fi
# This file is owned by the operating system, not downloaded input.
. /etc/os-release
case "${ID:-}" in ubuntu|debian) ;; *) printf '%s\n' 'This installer requires Ubuntu or Debian.' >&2; exit 1 ;; esac
case "$(uname -m)" in x86_64) rust_host=x86_64-unknown-linux-gnu ;; aarch64|arm64) rust_host=aarch64-unknown-linux-gnu ;; *) printf '%s\n' 'Supported CPU architectures: x86_64 and arm64.' >&2; exit 1 ;; esac
if [[ $EUID -eq 0 && -n ${SUDO_USER:-} && ${SUDO_USER} != root ]]; then printf '%s\n' 'Run ./install_ubuntu.sh without sudo; Rust belongs to your user.' >&2; exit 1; fi
apt_cmd=(apt-get)
if [[ $EUID -ne 0 ]]; then command -v sudo >/dev/null || { printf '%s\n' 'sudo is required to install system packages.' >&2; exit 1; }; apt_cmd=(sudo apt-get); fi
printf '%s\n' '1/3 Installing system build tools…'
"${apt_cmd[@]}" update
"${apt_cmd[@]}" install -y --no-install-recommends build-essential ca-certificates curl git
cargo_bin_dir="${CARGO_HOME:-$HOME/.cargo}/bin"
export PATH="$cargo_bin_dir:$PATH"
printf '%s\n' '2/3 Installing the pinned Rust toolchain…'
if ! command -v rustup >/dev/null; then
  installer_dir=$(mktemp -d)
  trap 'rm -rf -- "$installer_dir"' EXIT
  # Official HTTPS distribution, downloaded to disk and checksum-verified before execution.
  rustup_url="https://static.rust-lang.org/rustup/archive/1.29.0/$rust_host/rustup-init"
  curl --proto '=https' --tlsv1.2 --fail --show-error --silent --location --retry 3 --connect-timeout 15 --max-time 180 "$rustup_url" --output "$installer_dir/rustup-init"
  curl --proto '=https' --tlsv1.2 --fail --show-error --silent --location --retry 3 --connect-timeout 15 --max-time 60 "$rustup_url.sha256" --output "$installer_dir/rustup-init.sha256"
  expected_sha=$(cut -d ' ' -f 1 "$installer_dir/rustup-init.sha256")
  if [[ ! $expected_sha =~ ^[[:xdigit:]]{64}$ ]]; then printf '%s\n' 'Invalid Rust installer checksum.' >&2; exit 1; fi
  printf '%s  %s\n' "$expected_sha" "$installer_dir/rustup-init" | sha256sum --check --status
  chmod 700 "$installer_dir/rustup-init"
  "$installer_dir/rustup-init" -y --no-modify-path --profile minimal --default-toolchain none
fi
rustup toolchain install 1.90.0 --profile minimal
if ! rustup show active-toolchain >/dev/null 2>&1; then rustup default 1.90.0; fi
printf '%s\n' '3/3 Installing the browser Wasm build target…'
rustup target add --toolchain 1.90.0 wasm32-unknown-unknown
printf '%s\n' 'Ready. From the cloned repository, build and start:' 'cargo +1.90.0 build --release --locked --manifest-path dedicated-server/Cargo.toml' 'PORT=5173 ./dedicated-server/target/release/wild-wheels-server' "If cargo is not in this shell’s PATH, run: source \"$cargo_bin_dir/../env\""
