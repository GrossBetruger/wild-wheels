# Wild Wheels — Bevy WASM PoC

Isolated proof-of-concept compiling the native Bevy 0.20 3D renderer (`scene.rs`, `ported.rs`, `arena_mesh.rs`, `plumage`, `sprite`, `xray`) to `wasm32-unknown-unknown` (WebGL2) behind an HTML menu, fetching `graphics.wwgp` over HTTP instead of embedding it into `.wasm`.

## Build and run locally

From the repository root, `./run_server.sh` builds the client and serves it at `/experimental/` on the main server, with online arena support. To build and run a standalone solo server from the same directory:

```bash
bash scripts/build/build-experimental.sh wasm-poc
uv run --no-project python wasm-poc/serve.py
```

Open [http://127.0.0.1:8088/](http://127.0.0.1:8088/).
