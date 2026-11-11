# JSON, JavaScript binary, and Rust/Wasm comparison

Production integration: WebSocket snapshots now use the JavaScript codec in binary-wire.js. It packs cosmetics directly, preserves gameplay precision, checks packet sizes and effect counts, and returns independently owned packets for asynchronous socket writes. WebSocket inputs/pongs and HTTP requests remain JSON. The lab codecs below remain isolated comparison implementations; their staging overhead differs from the production encoder.

Measured November 11, 2026 on an Apple M4 Pro, Node 22.19.0, Rust 1.90.0, and Chrome 157. Experimental codecs are isolated from production gameplay.

## Result

The binary format delivers most of the improvement. Rust/Wasm improves Node encoding further, but its full path is slower than JavaScript binary encoding/decoding in Chrome. Prefer JavaScript binary on the client; consider Rust on the server only if the incremental saving justifies the added build/runtime complexity. Native Rust was not benchmarked.

Six-player drifting/Vulcan workload, mean milliseconds per recipient packet:

| Implementation | Node encode | Node decode | Node encode + decode | Chrome encode | Chrome decode | Chrome encode + decode |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Current JSON | 0.294 | 0.227 | 0.521 | 0.156 | 0.126 | 0.278 |
| JavaScript binary | 0.106 | 0.069 | 0.175 | 0.059 | 0.038 | 0.096 |
| Rust/Wasm binary | 0.092 | 0.071 | 0.163 | 0.065 | 0.043 | 0.107 |

Chrome columns average three independent page runs. Encode, decode, and combined Chrome operations are timed in separate batches, so combined timings need not equal the sum of the separate columns. These are CPU processing costs, not network round-trip latency.

Rust reduces Node encoding time by approximately 13% versus JavaScript binary, and combined encoding/decoding by 7%. In Chrome, Rust's combined path is approximately 11% slower than JavaScript binary. Both binary paths are about three times faster than the current JSON path in this busy scene. Current JSON remains competitive for light scenes.

Average compressed payload bytes per recipient, level-1 DEFLATE with the same no-context-takeover settings as the network payload estimator:

| Scenario | Current JSON | Both binary implementations | Change |
| --- | ---: | ---: | ---: |
| Driving | 1,891 | 1,939 | 2.6% larger |
| Drifting | 6,558 | 6,079 | 7.3% smaller |
| Six-player Vulcan | 14,215 | 13,314 | 6.3% smaller |

The busy-scene raw packet shrinks from 46,460 to 37,959 bytes, but compression narrows that gain. Reducing the amount of cosmetic state transmitted could yield a larger bandwidth improvement than changing the encoder language alone.

## What was compared

- Current encodeSnapshot/decodeSnapshot, including UTF-8 conversion to and from packet bytes.
- A reusable-buffer binary prototype: cosmetic numbers use signed 32-bit integers at the existing coordinate/time precision. Metadata and authoritative gameplay fields retain JSON precision.
- The identical binary format with numeric packing/unpacking done by an optimized Rust/Wasm kernel. Full timings include JavaScript object traversal, flattening, scale generation, metadata serialization/parsing, copying into/out of Wasm memory, packet assembly, and rebuilding game objects. Memory views and buffers are reused. Kernel-only timers run separately from end-to-end timings.

The Rust prototype accelerates the numeric section; it is not an all-Rust serializer for the whole object graph. Some metadata still uses JavaScript JSON in both binary implementations. A larger Rust-owned simulation/state layout could have different results and migration costs.

## Correctness and method

The corpus contains 60 snapshots per scenario from deterministic simulated matches, sampled from seconds 5–30, all during active racing. It includes Unicode player names. All 180 snapshots decode identically to the current codec, and both binary encoders produce identical bytes. Each binary decoder also reads the other encoder's packets. This comparison changes no gameplay precision or match outcomes.

Node warms each codec before collecting 600 samples per implementation/scenario, rotating execution order. Chrome warms each codec, then collects 180 batches of ten operations per implementation/scenario, across three fresh page runs. Batching reduces browser timer quantization. Browser and transport error lists are empty. The isolated benchmark page permits Wasm compilation via wasm-unsafe-eval; the game's CSP is unchanged.

The benchmark excludes initial module compilation, network transmission, GPU work, and DEFLATE CPU time. Compressed packet sizes are measured separately in Node. Small differences remain sensitive to JIT, GC, browser version, and hardware. The decoders and format are experimental, not production network parsers.

Raw results: [Node](../diagnostics/encoding-node.json), [Chrome](../diagnostics/encoding-browser.json). The separate [CPU/GPU profile](performance.md) measures a different protected workload across all recipients; its per-room timings should not be compared directly with this per-packet table.

## Reproduce

Run lightweight checks first and push before the Chrome benchmark, following [the development workflow](../AGENTS.md). The Rust kernel uses no external crates or wasm-pack.

```sh
rustup target add wasm32-unknown-unknown
rustc scripts/encoding-lab/kernel.rs --edition=2021 --crate-type=cdylib --target wasm32-unknown-unknown -C opt-level=3 -C panic=abort -C target-feature=+simd128 -o /private/tmp/wild-wheels-encoding-kernel.wasm
node scripts/compare-encoding.mjs /private/tmp/wild-wheels-encoding-kernel.wasm /private/tmp/wild-wheels-encoding-comparison.json
npm run test:browser-netcode -- --encoding --repeat 3 --wasm /private/tmp/wild-wheels-encoding-kernel.wasm --corpus /private/tmp/wild-wheels-encoding-comparison.json.corpus.json --output /private/tmp/wild-wheels-encoding-browser.json
```

The Node command generates the exact corpus used by Chrome and fails on semantic or binary-byte differences. Set CHROME_PATH if Chrome is not installed at the harness's default macOS path. The Wasm module requires SIMD support. Benchmark output buffers are reused; retain a copy if keeping a packet beyond the next encode call.
