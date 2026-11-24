# Wild Wheels — Bevy WASM PoC

Isolated proof-of-concept compiling the native Bevy 0.20 3D renderer (`scene.rs`, `ported.rs`, `arena_mesh.rs`, `plumage`, `sprite`, `xray`) to `wasm32-unknown-unknown` (WebGL2) behind an HTML menu, fetching `graphics.wwgp` over HTTP instead of embedding it into `.wasm`.

## Build & Run Locally

```bash
# 1. Ensure wasm32 target and matching wasm-bindgen-cli are installed
rustup +1.97.1 target add wasm32-unknown-unknown

# 2. Link the built graphics.wwgp pack from native-client
ln -sf "$(ls -t ../native-client/target/debug/build/wild-wheels-native-*/out/graphics.wwgp | head -n 1)" graphics.wwgp

# 3. Build WASM + JS bindings
cargo +1.97.1 build --release --target wasm32-unknown-unknown
wasm-bindgen --target web --no-typescript --out-dir pkg target/wasm32-unknown-unknown/release/wild_wheels_wasm_poc.wasm

# 4. Serve locally and open http://127.0.0.1:8088/
python3 -m http.server 8088 --bind 127.0.0.1
```
