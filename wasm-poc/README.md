# Wild Wheels — Bevy WASM PoC

The Bevy WASM renderer runs inside the regular browser client at `/experimental/`. It renders the same predicted arena frames the regular HUD uses. The regular client handles the lobby, input, simulation, and audio. The Bevy route uses the regular renderer for Grand Prix and the bomber camera.

On phones and other coarse-pointer touch devices, Bevy uses a smaller backing canvas, targets 30 FPS, and limits blast particles and dynamic lights. Touch driving uses the regular page's on-screen buttons.

The server sends the WASM, bindings and graphics pack as precompressed gzip when the browser accepts it. The browser decompresses them as part of the download.

## Build and run locally

From the repository root, `./run_server.sh` builds the client. Choose **3D BEVY (BETA)** on the main page. Choose **REGULAR CLIENT** to switch back, or **SOLO VS BOTS** to practice on the Bevy page. To build and run the original standalone renderer test page:

```bash
bash scripts/build/build-experimental.sh wasm-poc
uv run --no-project python wasm-poc/serve.py
```

Open [http://127.0.0.1:8088/](http://127.0.0.1:8088/).
