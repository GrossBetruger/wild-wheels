# Dedicated Rust server

The service uses Tokio’s current-thread async runtime and Axum for HTTP/WebSockets. Native Rust runs the existing authoritative arena simulation. Browsers receive the same HTML, JavaScript and Wasm prediction/rendering client. The executable embeds all public assets; it works from any directory and needs neither Node nor source files at runtime.

## Build and run

On a GCP VM, choose **Ubuntu 24.04 LTS** explicitly (the boot image is selectable), clone this repository, and install dependencies as your normal SSH user:

```sh
./install_ubuntu.sh
```

The installer also supports Debian. It installs build tools and a pinned Rust toolchain for x86_64 or arm64. Run it without `sudo`; it uses sudo only for system packages and installs Rust for your user. It verifies the official Rust installer’s SHA-256 before execution.

Build and run from the repository root (the launcher finds Rust even before you open a new SSH shell):

```sh
./run_server.sh
```

Use `PORT=5174 ./run_server.sh` to choose another port. It rebuilds changed code/assets before starting and uses one compiler job by default for small VMs. It returns after starting the server detached, so closing SSH keeps the game running. Logs append to `.wild-wheels/server.log`. It prevents duplicate managed starts.

```sh
./kill_server.sh
./update_server.sh
```

The update command stops the managed server, pulls `main` with fast-forward only, then builds and starts it again. If the pull fails, it tries to restart the existing version. Custom environment settings such as `PORT=5174` should also be passed to the update command. These commands manage servers started by the launcher; stop a previously foreground server with Ctrl+C once before switching.

To build manually with Rust 1.90 or newer, first run `source "$HOME/.cargo/env"`, then:

```sh
cargo build --release --locked --manifest-path dedicated-server/Cargo.toml
```

Run alongside the development server:

```sh
PORT=5174 ./dedicated-server/target/release/wild-wheels-server
```

Visit `http://localhost:5174`. On GCP, allow inbound TCP to the chosen game port in the VM’s VPC firewall (the console’s “Allow HTTP traffic” checkbox only opens port 80). Use the VM’s external IP to connect directly, or an HTTPS proxy for a domain. For internet play, run the binary on a reachable machine and put an HTTPS reverse proxy in front of its port, or run `ngrok http 5174` locally. Forward WebSocket upgrades. Set `PUBLIC_ORIGIN=https://your-game.example` to put the public address in invitations and issue Secure session cookies. The built-in Node ngrok control is not part of this service.

Configuration is through environment variables:

| Variable | Default | Meaning |
| --- | --- | --- |
| `BIND` | `0.0.0.0` | Listening IP; use `127.0.0.1` behind a local proxy |
| `PORT` | `5173` | HTTP/WebSocket port |
| `PUBLIC_ORIGIN` | unset | Public HTTP(S) origin, without a path |
| `ARENA` | `0` | Initial arena, 0 or 1 |
| `BOTS` | `1` | Initial bots, 0–7; humans replace bot slots |

`/healthz` reports occupancy, ticks, recent simulation tick p99 and missed tick deadlines. `/build.json` identifies embedded assets and native source. Rebuild the server after changing assets. When changing core code, first rebuild browser Wasm with `npm run build:core`.

## Arena and connection lifecycle

One shared arena uses invitation `?room=00`, with eight combined human/bot slots. The first player is the lobby host. Leaving, disconnecting or going AFK transfers lobby controls to an active player; no browser drives the server simulation. Refresh preserves your identity, character, scores and acknowledged movement while rotating your session token. Disconnected places expire after 15 minutes. A connected AFK player retains their place. Room state is in memory and ends when the process stops.

Guest play requests retain the three-second auto-start/refusal flow. The host can reset, start, choose the map/bots and toggle special abilities. The arena code stays the same across matches.

## Timing and bounded work

Simulation ticks at 60 Hz; snapshots publish at 30 Hz. Socket writers encode the latest world when ready, with one notification and at most 64 pending sound events/16 voice cues per player. There is no unbounded snapshot queue. Sends time out after two seconds. Slow clients cannot hold the arena lock across an await.

Movement uses the existing acknowledged command protocol, bounded receive queues and movement credits; client prediction, immediate shot/item/drift feedback and remote interpolation remain intact. Missed timer intervals are skipped instead of building an unlimited catch-up backlog. Eight players is the supported capacity; real network latency and browser GPU performance still affect the experience.

The HTTP API accepts bounded JSON objects, same-origin requests and authenticated sessions. WebSockets require same-origin upgrades and authentication within three seconds. Control payloads, action types, coordinates, rates and queues are bounded. Static files use an explicit shared allowlist; source, configuration and credentials are not served. Only trust proxy configuration you operate; the service does not use forwarded client IP headers for rate limits.

## Permanent verification

Lightweight checks before pushing:

```sh
npm test
cargo test --locked --manifest-path dedicated-server/Cargo.toml
```

After pushing to main, build the release binary and run:

```sh
npm run test:dedicated -- --seconds 20
npm run benchmark:dedicated
npm run test:dedicated-browser
npm run test:browser-netcode
```

`test:dedicated` starts an isolated native process from a directory without the repository, checks the embedded asset allowlist and API permissions, then drives eight real Wasm prediction clients over WebSockets. It verifies a ninth player is rejected, guest auto-start/refusal, movement/fire acknowledgements, session refresh and host disconnect persistence. For each player: at least 25 snapshots/second, p99 snapshot gap under 100 ms and sustained acknowledged movement. These are loopback service checks, not internet latency guarantees.

`benchmark:dedicated` compares three trials of the native core against the existing Node/Wasm bridge using the same eight-player inputs. Each trial simulates 3,600 ticks, warms up for 600 and encodes eight snapshots every other tick. It checks gameplay/position parity and equivalent packet volume. Native p99 for a tick including all eight encodes must stay below 2 ms, within the 16.67 ms simulation budget. This measures CPU work; it does not measure a player’s GPU or claim an equivalent FPS increase.

`test:dedicated-browser` runs two isolated Chrome players against the actual native server with eight active actors. It checks automatic joining, guest start, keyboard movement, shooting, refresh, rendered WebGL frames and lobby control transfer.

To validate installation and launching on clean Ubuntu without Node:

```sh
docker run --rm --mount type=bind,source="$PWD",target=/game,readonly --workdir /game ubuntu:24.04 bash scripts/check-ubuntu-install.sh
```

The existing Chrome netcode suite continues to protect prediction and feedback under host, guest, latency and jitter profiles. See [testing](testing.md) for the broader suites.
