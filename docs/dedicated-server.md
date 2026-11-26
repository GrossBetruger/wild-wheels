# Dedicated Rust server

The service uses Tokio’s current-thread async runtime and Axum for HTTP/WebSockets. Native Rust runs the existing authoritative arena simulation. Browsers receive the same HTML, JavaScript and Wasm prediction/rendering client. The executable embeds all public assets; it works from any directory and needs neither Node nor source files at runtime.

## Build and run

On a GCP VM, choose **Ubuntu 24.04 LTS** explicitly (the boot image is selectable), clone this repository, and install dependencies as your normal SSH user:

```sh
./install_ubuntu.sh
```

The installer also supports Debian. It installs build tools, Node.js, FFmpeg and a pinned Rust toolchain for x86_64 or arm64. Run it without `sudo`; it uses sudo only for system packages and installs Rust for your user. It verifies the official Rust installer’s SHA-256 before execution. On an existing Linux deployment, make sure `node` and `ffmpeg` are installed before the first web update that builds Bevy.

Build and run from the repository root (the launcher finds Rust even before you open a new SSH shell):

```sh
./run_server.sh
```

On a cache miss the launcher checks the Git LFS release in `releases/bevy-web/`. It verifies the build fingerprint and both file checksums before unpacking the browser WASM and its JavaScript loader. A stale or unavailable release falls back to a source build. Existing Ubuntu hosts can install `git-lfs` with `sudo apt-get install git-lfs`. To publish a changed renderer, run `npm run release:wasm` locally and commit the resulting release directory with the source change.

Use `PORT=5174 ./run_server.sh` to choose another port. The launcher bundles the default Bevy arena renderer. Choose **Classic Graphics** to switch back. Existing `/experimental/` links still work. Its first build installs the pinned Bevy Rust toolchain and matching `wasm-bindgen` CLI as needed. Cargo uses the available logical CPU count for both the WASM and server builds. Set `CARGO_BUILD_JOBS=2` to limit parallelism on a small VM. It returns after starting the server detached, so closing SSH keeps the game running. Logs append to `.wild-wheels/server.log`. It prevents duplicate managed starts.

```sh
./kill_server.sh
./update_server.sh
```

The update command pulls `main` with fast-forward only, builds the server and Bevy bundle, then restarts the managed server. The running version keeps serving while the build runs and stays online if the pull or build fails. Pass custom environment settings such as `PORT=5174` to terminal updates as well. These commands manage servers started by the launcher; stop a previously foreground server with Ctrl+C once before switching.

The shared-room panel includes **Check for updates**. Connected players can check GitHub; when a newer server commit exists, **Update server** runs the same update script between matches. The checkout must be clean and on `main`. The requesting browser waits for the new build and reloads automatically, restoring its saved session. Update output is in `.wild-wheels/update.log` (or the configured launcher state directory). Install this version once using `./update_server.sh` over SSH to make the buttons available on an existing server.

To build manually with Rust 1.90 or newer, first run `source "$HOME/.cargo/env"`, then:

```sh
cargo build --release --locked --manifest-path dedicated-server/Cargo.toml
```

Run alongside the development server:

```sh
PORT=5174 ./dedicated-server/target/release/wild-wheels-server
```

Visit `http://localhost:5174`. On GCP, allow inbound TCP to the chosen game port in the VM’s VPC firewall (the console’s “Allow HTTP traffic” checkbox only opens port 80). Direct HTTP works with public hostnames such as DuckDNS without configuring a domain. To encrypt traffic and give browsers a secure context for microphone voice chat, put an HTTPS reverse proxy (such as Caddy with Let’s Encrypt) on loopback in front of the game port. Forward WebSocket upgrades, preserve `Host`, and overwrite `X-Forwarded-Proto`.

On an Ubuntu/Debian VM (with TCP ports 80 and 443 open in the firewall), you can set up Caddy automatically:

```sh
./scripts/server/setup-https-caddy.sh wildwheels.duckdns.org
```

The script installs Caddy, proxies `https://<domain>` to `127.0.0.1:5173`, writes `TRUST_PROXY=1` to `.wild-wheels/server.env` (loaded automatically by `./run_server.sh` and `./update_server.sh`), and restarts the managed server so `https://<domain>/?room=00` works directly without an invite fragment. For invite-gated private hosting, also set `PUBLIC_ORIGIN=https://your-game.example`, `BIND=127.0.0.1`, and a random `INVITE_SECRET` of at least 32 characters, then share `https://your-game.example/?room=00#invite=YOUR_RANDOM_SECRET`. See [security configuration and tests](security.md). The built-in Node ngrok control is not part of this service.

Configuration is through environment variables:

| Variable | Default | Meaning |
| --- | --- | --- |
| `BIND` | `0.0.0.0` | Listening IP; use `127.0.0.1` behind a local proxy |
| `PORT` | `5173` | HTTP/WebSocket port |
| `PUBLIC_ORIGIN` | unset | Optional exact HTTP(S) origin; otherwise inferred from the request Host |
| `TRUST_PROXY` | unset | Set to `1` to trust HTTPS forwarding from a loopback proxy |
| `INVITE_SECRET` | unset | Random invitation credential, at least 32 characters; required with a public HTTPS origin |
| `ARENA` | `0` | Initial arena index (0 = Scrapyard, 1 = Crossfire Court, 2 = Octagon, 3 = Maze, or custom index) |
| `WILD_WHEELS_ARENAS_FILE` | unset | Optional JSON file of server-defined arena layouts (`ArenaDef[]`) overriding `dedicated-server/src/arenas.rs`, published via `/api/info` and packets so native and browser clients pick up new maps without rebuilding |
| `BOTS` | `1` | Initial bots, 0–7; humans replace bot slots |
| `WILD_WHEELS_SESSION_FILE` | `.wild-wheels/sessions.json` | Private saved sessions; the launcher puts it in its state directory |

`/healthz` reports occupancy, ticks, recent simulation tick p99 and missed tick deadlines. `/build.json` identifies embedded assets and native source. Rebuild the server after changing assets. When changing core code, first rebuild browser Wasm with `npm run build:core`.

## Save text over HTTP

Both servers accept anonymous `POST /api/text` requests over HTTP or HTTPS, according to the server's hosting configuration. The body is the text to save. Use synthetic values when testing over plain HTTP.

```sh
printf '%s' "$TEXT_TO_SAVE" | curl --fail-with-body --header 'Content-Type: text/plain' --data-binary @- http://127.0.0.1:5173/api/text
```

Each successful request returns HTTP 201 and a JSON object with the generated `filename`. The server saves the exact UTF-8 bytes in private files under `.wild-wheels/text/` (or `$WILD_WHEELS_RUN_DIR/text/` when configured). Limits are 64 KiB per request, ten attempts per minute per client address, 30 attempts per minute per server process, and 256 numbered files. A full directory returns HTTP 507 until a numbered file is moved or deleted by the server operator.

## Arena and connection lifecycle

One shared arena uses invitation `?room=00`, with eight combined human/bot slots. The page displays a connection screen until the first shared-arena frame is ready, with a retry action if joining fails. There is no host or captain: every active player has the same room controls, and no browser drives the simulation. Refresh preserves your identity, character, scores and acknowledged movement while rotating your session token. Places expire after 15 minutes without API/socket activity, even if the socket never closed. An actively polling AFK player retains their place.

Session cookies and their saved server records last 60 days from the player's last join or return: each one issues a new token and cookie with the full 60 days, so a player who keeps coming back keeps their session. Changing a name, racer or color does not extend it. Sessions use random tokens, independently of player names. The server saves identity, name, character and driver/bomber role in a private file with atomic replacement before issuing a new cookie. Disk writes run outside the simulation thread. Restarting or updating the server keeps those saved sessions; returning players reclaim an available slot with their saved choices. Saved sessions do not reserve the eight active slots. Current matches, scores and inventory remain in memory and start fresh after a restart or released slot. Keep the session file on persistent storage when using a container; deleting it or clearing browser cookies loses the saved association.

Any active player can choose the arena, bots and special abilities between matches, or start the normal three-second countdown directly. There are no play requests, vetoes, host tie advantages, or controls that reset a running match. AFK preserves the player’s place while the match continues; returning resumes the same identity. The arena code stays the same across matches.

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

`test:dedicated` starts an isolated native process from a directory without the repository, checks the embedded asset allowlist and API permissions, then drives eight real Wasm prediction clients over WebSockets. It verifies a ninth player is rejected, equal room controls, direct starts without requests or vetoes, movement/fire acknowledgements, session refresh and match persistence after disconnects. For each player: at least 25 snapshots/second, p99 snapshot gap under 100 ms and sustained acknowledged movement. These are loopback service checks, not internet latency guarantees.

`benchmark:dedicated` compares three trials of the native core against the existing Node/Wasm bridge using the same eight-player inputs. Each trial simulates 3,600 ticks, warms up for 600 and encodes eight snapshots every other tick. It checks gameplay/position parity and equivalent packet volume. Native p99 for a tick including all eight encodes must stay below 2 ms, within the 16.67 ms simulation budget. This measures CPU work; it does not measure a player’s GPU or claim an equivalent FPS increase.

`test:dedicated-browser` runs two isolated Chrome players against the actual native server with eight active actors. It checks automatic joining, guest start, keyboard movement, shooting, refresh, rendered WebGL frames and lobby control transfer.

To validate installation and launching on clean Ubuntu without Node:

```sh
docker run --rm --mount type=bind,source="$PWD",target=/game,readonly --workdir /game ubuntu:24.04 bash scripts/checks/check-ubuntu-install.sh
```

The existing Chrome netcode suite continues to protect prediction and feedback under host, guest, latency and jitter profiles. See [testing](testing.md) for the broader suites.
