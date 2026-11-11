# Development checks

For CPU/GPU profiling and recorded results, see [Performance measurements](performance.md).

Run lightweight checks before pushing:

```sh
npm test
```

Push completed changes to main before heavy browser checks. Revert and push if they find a regression caused by the change. See [the development workflow](../AGENTS.md).

## Browser regressions

```sh
npm run test:regression
```

This runs automated tests and five browser groups: movement, projectile/pickup feedback, drift visuals, lobby/item controls, and mobile bombing. Each covers host, guest, 160 ms latency, and jitter profiles, repeated three times (60 scenarios). Results and traces go to the directory printed by the runner. For a shorter check:

```sh
npm run test:regression -- --repeat 1
```

Chrome must be installed. Set CHROME_PATH if it is outside the default macOS location. The harness runs the real WebSocket server and WebGL renderer locally. Mobile checks emulate touch in Chrome; they do not establish physical iOS or Android support.

Local checks enforce frame time ≤20 ms at the 95th percentile, with guests within 2 ms of the host. Movement checks require position error ≤0.15 units at the 95th percentile (0.5 maximum), camera error ≤1° at the 95th percentile (3° maximum), and no unexplained frozen or backward frames. Action feedback must appear within one rendered frame without duplicate projectiles or pickup cues.

GitHub Actions runs all five groups with --functional --repeat 1 on pushes and pull requests, retaining traces for 30 days. Functional checks enforce behavior and record frame times without enforcing hardware-dependent FPS thresholds.

## Targeted checks

```sh
npm run test:netcode
npm run test:browser-netcode -- --repeat 3
npm run test:browser-netcode -- --feedback --repeat 3
npm run test:browser-netcode -- --drift --repeat 3
npm run test:browser-netcode -- --controls
npm run test:browser-netcode -- --mobile
npm run profile:network
```

Recorded comparisons and traces are under [diagnostics](../diagnostics/): [movement](../diagnostics/netcode-report.html), [action feedback](../diagnostics/feedback-report.html), and [drift](../diagnostics/drift-report.html).
