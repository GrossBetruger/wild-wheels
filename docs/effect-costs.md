# Visual effect costs

Measured 2026-11-15T23:21:51.082Z on Apple M4 Pro; ANGLE (Apple, ANGLE Metal Renderer: Apple M4 Pro, Unspecified Version).

Browser renderer only; single subject or the explicitly named multiplicity, Scrapyard, Balanced 1280 × 800. Each effect follows a same-driver baseline. Animation ages are sampled from representative portions, not every possible state or worst-case overlap. CPU and GPU overlap; never add them. Negative deltas are retained as noise or changes in visible scene. Native playback and gameplay simulation are not timed.

209 scenarios; 30 measured frames and 12 warm-up frames each for baseline and effect. GPU timer support: true. Raw results retain baseline and effect means, p95, sample counts and disjoint events. CPU timers include geometry construction, instrumentation and WebGL submission. GPU timers use asynchronous disjoint queries without gl.finish.

## Highest measured CPU additions

The first optimization candidates are:

1. **Dark Humor's fog and X-ray**, the largest GPU addition: about **1.30–1.47 ms/frame**.
2. **Fire Ring**, about **3.69–3.93 ms/frame of added CPU**, with 5,760 extra
   triangles, 432 point sprites and about 619 KiB uploaded per frame.
3. **Celebrations, especially Houston's**, up to **4.07 ms/frame of added CPU**.
   The generic racer path rebuilds geometry while celebrating instead of using
   its normal cached model, explaining the upload increase without more triangles.
4. **Jumping locust swarms**, about **3.72 ms/frame of added CPU** for 14 locusts.
5. **Ashes and animated model transitions**, which should be checked for repeated
   geometry generation and phase-specific model-cache misses.

Nightmare Fuel's full plume adds about **0.74 ms CPU** and **0.062 ms GPU** in
its measured scene. Its half-length ending adds about **0.55 ms CPU** and
**0.014 ms GPU**; shrinking the plume does not reduce its geometry/particle counts.

These are prioritization clues from one pass, not precise rankings of close
results. Some p95 values include animation-phase model creation that the short
warm-up did not encounter. Caching or instancing may preserve an effect's look
while reducing its cost; a cheaper visual variant is another option.

Reproduce with `npm run profile:effects`. See [methodology and limits](effect-profiling.md)
and [raw measurements](../diagnostics/effect-costs.json). Renderer revision:
`dbce289`. All 12,540 CPU and 12,540 GPU samples were collected with zero GPU
disjoint events and zero browser runtime errors. The fog-victim and gravity-tether
rows were remeasured with matched supporting-object baselines.

| Effect | CPU Δ ms | Total CPU p95 ms | GPU Δ ms | Draw calls Δ | Triangles Δ | Particles Δ | Upload Δ KiB |
|---|---:|---:|---:|---:|---:|---:|---:|
| Houston the RTPL / celebrate | 4.070 | 4.500 | 0.005 | -1.0 | 0 | 3 | 474.7 |
| Fire ring / radius 40 / #4abaff | 3.927 | 4.400 | 0.095 | 0.0 | 5760 | 432 | 619.3 |
| Fire ring / radius 10 / #4abaff | 3.923 | 4.500 | 0.191 | 0.0 | 5760 | 432 | 619.3 |
| Fire ring / radius 20 / #ff631c | 3.863 | 4.400 | 0.020 | 0.0 | 5760 | 432 | 619.3 |
| Fire ring / radius 10 / #ff631c | 3.863 | 4.400 | 0.195 | 0.0 | 5760 | 432 | 619.3 |
| KnowItOwl / boost | 3.843 | 17.000 | 0.093 | 0.0 | 298 | 0 | 664.2 |
| Fire ring / radius 40 / #ff631c | 3.783 | 4.200 | 0.054 | 0.0 | 5760 | 432 | 619.3 |
| Locust swarm / 14 / jumping | 3.717 | 4.300 | 0.099 | 1.0 | 5264 | 14 | 555.6 |
| Tammy the Cricket / celebrate | 3.710 | 4.200 | 0.036 | 0.0 | 0 | 3 | 415.6 |
| Fire ring / radius 20 / #4abaff | 3.690 | 4.200 | 0.042 | 0.0 | 5760 | 432 | 619.3 |

## Highest measured GPU additions

| Effect | CPU addition ms/frame | GPU addition ms/frame |
|---|---:|---:|
| Dark Humor / caster X-ray | 0.403 | 1.466 |
| KnowItOwl / special | 2.823 | 1.452 |
| Dark Humor / victim fog | 0.537 | 1.296 |
| reverseShockwave | 0.393 | 0.362 |
| Fire ring / radius 10 / #ff631c | 3.863 | 0.195 |

## All effects

| Effect | CPU Δ ms | Total CPU p95 ms | GPU Δ ms | Draw calls Δ | Triangles Δ | Particles Δ | Upload Δ KiB |
|---|---:|---:|---:|---:|---:|---:|---:|
| Houston the RTPL / celebrate | 4.070 | 4.500 | 0.005 | -1.0 | 0 | 3 | 474.7 |
| Fire ring / radius 40 / #4abaff | 3.927 | 4.400 | 0.095 | 0.0 | 5760 | 432 | 619.3 |
| Fire ring / radius 10 / #4abaff | 3.923 | 4.500 | 0.191 | 0.0 | 5760 | 432 | 619.3 |
| Fire ring / radius 20 / #ff631c | 3.863 | 4.400 | 0.020 | 0.0 | 5760 | 432 | 619.3 |
| Fire ring / radius 10 / #ff631c | 3.863 | 4.400 | 0.195 | 0.0 | 5760 | 432 | 619.3 |
| KnowItOwl / boost | 3.843 | 17.000 | 0.093 | 0.0 | 298 | 0 | 664.2 |
| Fire ring / radius 40 / #ff631c | 3.783 | 4.200 | 0.054 | 0.0 | 5760 | 432 | 619.3 |
| Locust swarm / 14 / jumping | 3.717 | 4.300 | 0.099 | 1.0 | 5264 | 14 | 555.6 |
| Tammy the Cricket / celebrate | 3.710 | 4.200 | 0.036 | 0.0 | 0 | 3 | 415.6 |
| Fire ring / radius 20 / #4abaff | 3.690 | 4.200 | 0.042 | 0.0 | 5760 | 432 | 619.3 |
| Locust swarm / 14 / running | 3.673 | 4.200 | 0.072 | 1.0 | 5264 | 14 | 555.6 |
| Elon Musk / celebrate | 3.447 | 3.900 | -0.033 | 0.0 | 0 | 3 | 422.0 |
| Pearococo / ashes | 3.427 | 4.200 | -0.138 | -13.0 | -24464 | 16 | 471.3 |
| Houston the RTPL / ashes | 3.423 | 4.200 | 0.008 | -1.0 | 72 | 10 | 482.5 |
| R-yeah / special | 3.410 | 26.600 | 0.120 | 3.0 | 29744 | 98 | 432.7 |
| Avita-Jas / ashes | 3.393 | 4.000 | -0.040 | -2.0 | -2332 | 16 | 497.8 |
| missile / 20 projectiles + trails | 3.367 | 4.100 | 0.018 | 20.0 | 10000 | 0 | 489.4 |
| R-yeah / ashes | 3.267 | 4.000 | -0.076 | -3.0 | -13128 | 16 | 464.9 |
| Fourmidable / celebrate | 3.143 | 25.200 | 0.013 | 0.0 | -352 | 0 | 408.8 |
| Rocco the Raccoon / ashes | 3.137 | 3.700 | -0.021 | 0.0 | 1340 | 16 | 449.7 |
| Felix the Fox / ashes | 3.127 | 3.700 | 0.050 | 0.0 | 1892 | 16 | 442.1 |
| Ellie the Elephant / ashes | 3.070 | 3.600 | 0.055 | 0.0 | 982 | 16 | 454.8 |
| Ellie the Elephant / celebrate | 3.027 | 3.500 | 0.018 | 0.0 | 0 | 3 | 350.9 |
| Master-Yuda / ashes | 2.997 | 3.700 | -0.108 | -2.0 | -11016 | 0 | 387.3 |
| Elon Musk / ashes | 2.900 | 3.500 | 0.001 | 0.0 | -16 | 16 | 420.6 |
| Catheterpillar / ashes | 2.893 | 3.900 | -0.028 | -2.0 | -7318 | 16 | 414.3 |
| Pip the Panda / celebrate | 2.870 | 3.400 | 0.024 | 0.0 | 64 | 3 | 276.8 |
| KnowItOwl / celebrate | 2.867 | 21.800 | -0.023 | 2.0 | -429 | 1 | 291.9 |
| KnowItOwl / special | 2.823 | 21.600 | 1.452 | 8.0 | 35139 | 1 | 322.0 |
| KnowItOwl / ashes | 2.810 | 3.600 | -0.095 | -1.0 | -30755 | 16 | 331.0 |
| Benny the Bear / celebrate | 2.800 | 3.100 | -0.014 | 0.0 | 64 | 3 | 251.5 |
| Felix the Fox / celebrate | 2.713 | 3.400 | -0.018 | 0.0 | 64 | 3 | 249.0 |
| Tammy the Cricket / ashes | 2.697 | 3.200 | 0.085 | 0.0 | 308 | 16 | 448.5 |
| Benny the Bear / ashes | 2.537 | 3.200 | 0.002 | 0.0 | 1952 | 16 | 451.0 |
| hedgehog / 20 projectiles + trails | 2.383 | 2.900 | -0.016 | 20.0 | 6560 | 0 | 253.1 |
| Rocco the Raccoon / celebrate | 2.377 | 3.000 | 0.022 | 0.0 | 64 | 3 | 314.8 |
| Pip the Panda / ashes | 2.360 | 3.100 | 0.049 | 0.0 | 1328 | 16 | 410.5 |
| taxAudit | 2.350 | 3.600 | -0.020 | 0.0 | 1512 | 0 | 159.5 |
| Fourmidable / somersault | 2.283 | 2.900 | 0.048 | 0.0 | 1178 | 0 | 124.3 |
| Rocco the Raccoon / somersault | 2.010 | 2.500 | 0.097 | 1.0 | 1748 | 54 | 185.8 |
| Fourmidable / ashes | 1.947 | 2.800 | -0.139 | -1.0 | -29514 | 16 | 199.4 |
| Ellie the Elephant / somersault | 1.913 | 2.900 | -0.039 | 1.0 | 1748 | 54 | 185.8 |
| Pip the Panda / somersault | 1.857 | 2.700 | 0.005 | 1.0 | 1748 | 54 | 185.8 |
| Benny the Bear / boost | 1.833 | 2.600 | -0.015 | 1.0 | 1748 | 54 | 185.8 |
| Catheterpillar / somersault | 1.767 | 2.100 | 0.021 | 1.0 | 1748 | 54 | 185.8 |
| Felix the Fox / somersault | 1.700 | 2.400 | -0.014 | 1.0 | 1748 | 54 | 185.8 |
| Houston the RTPL / somersault | 1.627 | 2.500 | 0.029 | 1.0 | 1344 | 158 | 146.1 |
| Benny the Bear / somersault | 1.617 | 2.300 | 0.027 | 1.0 | 1748 | 54 | 185.8 |
| Ellie the Elephant / boost | 1.543 | 2.300 | -0.026 | 1.0 | 1748 | 54 | 185.8 |
| Rocco the Raccoon / boost | 1.517 | 2.600 | 0.002 | 1.0 | 1748 | 54 | 185.8 |
| Felix the Fox / boost | 1.517 | 2.200 | 0.014 | 1.0 | 1748 | 54 | 185.8 |
| explosion | 1.500 | 2.700 | 0.015 | 0.0 | 1376 | 0 | 145.1 |
| Avita-Jas / special | 1.427 | 1.900 | 0.017 | 1.0 | 1344 | 80 | 143.9 |
| Houston the RTPL / boost | 1.403 | 2.200 | -0.011 | 1.0 | 1344 | 126 | 145.2 |
| Pip the Panda / boost | 1.193 | 1.800 | 0.091 | 1.0 | 1748 | 54 | 185.8 |
| abomb | 1.150 | 1.600 | 0.020 | 2.0 | 1056 | 6 | 111.5 |
| Houston the RTPL / special | 1.113 | 1.600 | -0.060 | 0.0 | 1040 | 60 | 111.3 |
| Catheterpillar / boost | 0.990 | 6.000 | -0.013 | 1.0 | 1748 | 54 | 79.5 |
| Chaff cloud | 0.963 | 1.500 | 0.020 | 2.0 | 1152 | 97 | 124.2 |
| fashionSnap | 0.860 | 1.600 | 0.003 | 1.0 | 544 | 45 | 58.6 |
| Reverse Psychology / puppet | 0.760 | 1.400 | -0.009 | 1.0 | 572 | 2 | 60.4 |
| Gravity well / six pickup tethers | 0.757 | 1.500 | 0.090 | 0.0 | 1040 | 108 | 112.6 |
| Nightmare Fuel / full plume | 0.743 | 1.500 | 0.062 | 1.0 | 560 | 321 | 67.8 |
| R-yeah / celebrate | 0.700 | 7.300 | 0.005 | 0.0 | 12 | 0 | 42.4 |
| Nightmare Fuel / half-length ending | 0.547 | 1.200 | 0.014 | 1.0 | 560 | 321 | 67.8 |
| Dark Humor / victim fog | 0.537 | 28.200 | 1.296 | 3.0 | -78 | 1 | 22.4 |
| R-yeah / vulcan | 0.530 | 4.600 | 0.041 | 2.0 | 3618 | 10 | 49.2 |
| Master-Yuda / boost | 0.487 | 7.400 | 0.146 | 2.0 | 614 | 57 | 42.8 |
| Xylophone-Attack / victim view | 0.443 | 4.700 | 0.023 | 1.0 | 2248 | 0 | 31.6 |
| teleportOut | 0.423 | 1.100 | 0.024 | 2.0 | 288 | 69 | 32.3 |
| pickup | 0.413 | 1.000 | -0.034 | 0.0 | 300 | 0 | 31.6 |
| Catheterpillar / celebrate | 0.410 | 5.000 | -0.045 | 0.0 | 0 | 0 | 39.5 |
| missile / 1 projectiles + trails | 0.410 | 1.200 | 0.017 | 1.0 | 500 | 0 | 24.5 |
| teleportIn | 0.407 | 1.000 | 0.016 | 2.0 | 288 | 69 | 32.3 |
| Dark Humor / caster X-ray | 0.403 | 1.100 | 1.466 | 8.0 | 35178 | 1 | 27.0 |
| reverseShockwave | 0.393 | 1.100 | 0.362 | 2.0 | 256 | 320 | 35.8 |
| Falling bomb | 0.343 | 1.100 | 0.013 | 1.0 | 328 | 1 | 34.6 |
| heartbeat | 0.343 | 1.000 | 0.023 | 1.0 | 252 | 1 | 26.6 |
| R-yeah / boost | 0.323 | 4.900 | -0.031 | 2.0 | 576 | 56 | 33.5 |
| radiation | 0.317 | 1.000 | 0.017 | 6.0 | 464 | 24 | 15.8 |
| Rocco the Raccoon / dizzy | 0.287 | 0.800 | -0.001 | 1.0 | 144 | 6 | 15.4 |
| KnowItOwl / dizzy | 0.263 | 0.800 | 0.012 | 1.0 | 294 | 6 | 15.4 |
| Catheterpillar / vulcan | 0.263 | 0.700 | -0.138 | 1.0 | 136 | 10 | 14.6 |
| R-yeah / dizzy | 0.253 | 0.800 | 0.047 | 1.0 | 144 | 6 | 15.4 |
| Master-Yuda / dizzy | 0.250 | 0.800 | 0.052 | 0.0 | 144 | 6 | 15.4 |
| Pip the Panda / dizzy | 0.243 | 0.900 | -0.003 | 1.0 | 144 | 6 | 15.4 |
| Fourmidable / dizzy | 0.237 | 0.700 | 0.015 | 1.0 | 144 | 6 | 15.4 |
| Fourmidable / vulcan | 0.210 | 0.700 | 0.032 | 1.0 | 136 | 10 | 14.6 |
| Tammy the Cricket / dizzy | 0.210 | 0.700 | 0.012 | 1.0 | 144 | 6 | 15.4 |
| Catheterpillar / dizzy | 0.207 | 0.800 | 0.036 | 1.0 | 144 | 6 | 15.4 |
| Avita-Jas / hedgeShield | 0.207 | 0.700 | 0.005 | 7.0 | 264 | 12 | 10.5 |
| Felix the Fox / vulcan | 0.207 | 0.800 | -0.028 | 1.0 | 136 | 10 | 14.6 |
| R-yeah / hedgeShield | 0.203 | 0.800 | -0.028 | 7.0 | 264 | 12 | 10.5 |
| Falling stink | 0.200 | 0.800 | 0.009 | 0.0 | 128 | 0 | 13.5 |
| Pearococo / vulcan | 0.183 | 0.800 | 0.003 | 1.0 | 136 | 10 | 14.6 |
| Rocco the Raccoon / vulcan | 0.180 | 0.800 | -0.004 | 1.0 | 136 | 10 | 14.6 |
| KnowItOwl / hedgeShield | 0.180 | 0.700 | -0.035 | 7.0 | 458 | 12 | 10.5 |
| Pip the Panda / vulcan | 0.177 | 0.700 | -0.007 | 1.0 | 136 | 10 | 14.6 |
| Rocco the Raccoon / hedgeShield | 0.177 | 0.600 | 0.028 | 7.0 | 264 | 12 | 10.5 |
| Benny the Bear / hedgeShield | 0.170 | 0.700 | -0.011 | 7.0 | 264 | 12 | 10.5 |
| Elon Musk / hedgeShield | 0.170 | 0.600 | -0.003 | 7.0 | 1020 | 12 | 10.5 |
| Felix the Fox / dizzy | 0.167 | 0.700 | -0.015 | 1.0 | 144 | 6 | 15.4 |
| Fourmidable / hedgeShield | 0.167 | 0.700 | -0.009 | 7.0 | 264 | 12 | 10.5 |
| hedgehog / 1 projectiles + trails | 0.167 | 0.400 | -0.002 | 1.0 | 328 | 0 | 12.7 |
| Elon Musk / vulcan | 0.167 | 0.700 | -0.001 | 1.0 | 136 | 10 | 14.6 |
| Benny the Bear / dizzy | 0.163 | 0.800 | 0.003 | 1.0 | 144 | 6 | 15.4 |
| Avita-Jas / vulcan | 0.160 | 0.600 | 0.003 | 1.0 | 136 | 10 | 14.6 |
| Houston the RTPL / dizzy | 0.157 | 0.700 | -0.009 | 0.0 | 144 | 6 | 15.4 |
| R-yeah / rapid-fire projectile + 12-point trail | 0.150 | 0.600 | -0.054 | 2.0 | 208 | 4 | 0.1 |
| Elon Musk / dizzy | 0.147 | 0.600 | -0.031 | 1.0 | 144 | 6 | 15.4 |
| Catheterpillar / hedgeShield | 0.133 | 0.800 | -0.052 | 7.0 | 264 | 12 | 10.5 |
| Drift spark 1 / 32 particles | 0.127 | 0.700 | 0.001 | 1.0 | 0 | 64 | 1.8 |
| Tammy the Cricket / vulcan | 0.123 | 0.600 | 0.002 | 1.0 | 136 | 10 | 14.6 |
| Houston the RTPL / vulcan | 0.123 | 0.800 | -0.026 | 0.0 | -484 | 10 | 14.6 |
| Master-Yuda / shield | 0.123 | 0.600 | 0.105 | 6.0 | 660 | 52 | 1.4 |
| Benny the Bear / rapid-fire projectile + 12-point trail | 0.117 | 0.500 | 0.054 | 2.0 | 208 | 4 | 0.1 |
| Houston the RTPL / hedgeShield | 0.117 | 0.700 | -0.006 | 6.0 | 264 | 12 | 10.5 |
| Ellie the Elephant / dizzy | 0.117 | 0.400 | -0.005 | 1.0 | 144 | 6 | 15.4 |
| Pickup / hedgeproof | 0.117 | 0.600 | 0.009 | 2.0 | 42 | 1 | 1.5 |
| Master-Yuda / drifting sparks and exhaust | 0.113 | 0.800 | -0.047 | 0.0 | 96 | 354 | 9.7 |
| Pickup / bicycle | 0.113 | 0.600 | 0.038 | 2.0 | 12444 | 10 | 7.0 |
| Avita-Jas / dizzy | 0.110 | 0.600 | 0.021 | 1.0 | 144 | 6 | 15.4 |
| Benny the Bear / vulcan | 0.110 | 0.700 | 0.014 | 1.0 | 136 | 10 | 14.6 |
| Felix the Fox / hedgeShield | 0.107 | 0.600 | 0.005 | 7.0 | 264 | 12 | 10.5 |
| Felix the Fox / shield | 0.103 | 0.500 | 0.017 | 1.0 | 0 | 18 | 0.5 |
| Master-Yuda / vulcan | 0.103 | 0.800 | -0.031 | 1.0 | 857 | 2 | 16.1 |
| Pip the Panda / tehilim | 0.103 | 0.600 | 0.037 | 7.0 | 4392 | 24 | 0.7 |
| Benny the Bear / shield | 0.100 | 0.500 | -0.001 | 1.0 | 0 | 18 | 0.5 |
| Tammy the Cricket / hedgeShield | 0.100 | 0.800 | 0.020 | 7.0 | 6096 | 12 | 10.5 |
| Fairy chaff cloud | 0.100 | 0.700 | 0.016 | 14.0 | 192 | 97 | 2.7 |
| Drift spark 2 / 32 particles | 0.097 | 0.500 | 0.018 | 1.0 | 0 | 64 | 1.8 |
| Pickup / hedgehog | 0.093 | 0.600 | 0.002 | 1.0 | 222 | 0 | 1.5 |
| Ellie the Elephant / vulcan | 0.090 | 0.600 | -0.041 | 1.0 | 136 | 10 | 14.6 |
| Tammy the Cricket / somersault | 0.087 | 0.500 | 0.022 | 2.0 | 0 | 46 | 1.3 |
| Stink cloud | 0.083 | 0.600 | 0.048 | 2.0 | 0 | 30 | 0.8 |
| Skid marks / 32 segments | 0.083 | 0.600 | 0.001 | 0.0 | 64 | 0 | 6.8 |
| Pearococo / somersault | 0.080 | 0.600 | 0.019 | 2.0 | 0 | 156 | 4.3 |
| locustBurst | 0.080 | 0.600 | 0.011 | 2.0 | 0 | 32 | 0.9 |
| R-yeah / somersault | 0.080 | 0.600 | -0.015 | 2.0 | 0 | 56 | 1.5 |
| Pearococo / dizzy | 0.077 | 0.500 | -0.022 | 1.0 | 144 | 6 | 15.4 |
| Catheterpillar / rapid-fire projectile + 12-point trail | 0.077 | 0.500 | -0.050 | 2.0 | 208 | 4 | 0.1 |
| Avita-Jas / rapid-fire projectile + 12-point trail | 0.070 | 0.500 | -0.020 | 2.0 | 102 | 6 | 0.2 |
| Pip the Panda / rapid-fire projectile + 12-point trail | 0.067 | 0.400 | 0.050 | 2.0 | 208 | 4 | 0.1 |
| Houston the RTPL / rapid-fire projectile + 12-point trail | 0.063 | 0.600 | -0.002 | 1.0 | 208 | 4 | 0.1 |
| Pearococo / hedgeShield | 0.063 | 0.500 | 0.033 | 7.0 | 96 | 42 | 1.1 |
| Tammy the Cricket / tehilim | 0.060 | 0.400 | 0.012 | 7.0 | 4392 | 24 | 0.7 |
| Elon Musk / somersault | 0.060 | 0.600 | -0.041 | 2.0 | 0 | 96 | 2.6 |
| Master-Yuda / somersault | 0.060 | 0.600 | 0.099 | 1.0 | 96 | 57 | 1.6 |
| Master-Yuda / rapid-fire projectile + 12-point trail | 0.060 | 0.700 | 0.013 | 1.0 | 160 | 9 | 8.7 |
| Avita-Jas / tehilim | 0.050 | 0.400 | 0.049 | 7.0 | 4392 | 24 | 0.7 |
| Pip the Panda / hedgeShield | 0.050 | 0.400 | -0.001 | 7.0 | 264 | 12 | 10.5 |
| Fourmidable / shield | 0.047 | 0.400 | -0.004 | 1.0 | 0 | 18 | 0.5 |
| Felix the Fox / rapid-fire projectile + 12-point trail | 0.047 | 0.400 | -0.001 | 2.0 | 208 | 4 | 0.1 |
| Master-Yuda / celebrate | 0.047 | 0.500 | -0.047 | 0.0 | -96 | 0 | 0.0 |
| Ellie the Elephant / rapid-fire projectile + 12-point trail | 0.047 | 0.500 | 0.052 | 2.0 | 208 | 4 | 0.1 |
| Elon Musk / boost | 0.040 | 0.500 | 0.039 | 2.0 | 0 | 72 | 2.0 |
| Pearococo / shield | 0.040 | 0.600 | 0.046 | 7.0 | 96 | 42 | 1.1 |
| Houston the RTPL / tehilim | 0.037 | 0.500 | -0.004 | 6.0 | 4392 | 24 | 0.7 |
| Felix the Fox / tehilim | 0.037 | 0.500 | 0.015 | 7.0 | 4392 | 24 | 0.7 |
| Catheterpillar / shield | 0.037 | 0.600 | -0.013 | 1.0 | 0 | 18 | 0.5 |
| Ellie the Elephant / hedgeShield | 0.037 | 0.300 | -0.023 | 7.0 | 264 | 12 | 10.5 |
| Pearococo / celebrate | 0.037 | 0.800 | 0.008 | 0.0 | 0 | 0 | 6.8 |
| Avita-Jas / somersault | 0.033 | 0.500 | 0.006 | 2.0 | 0 | 96 | 2.6 |
| Avita-Jas / celebrate | 0.033 | 0.500 | -0.010 | 0.0 | 0 | 0 | 0.0 |
| Tammy the Cricket / shield | 0.030 | 0.500 | -0.076 | 1.0 | 0 | 18 | 0.5 |
| Drift spark 0 / 32 particles | 0.030 | 0.600 | -0.006 | 1.0 | 0 | 64 | 1.8 |
| Rocco the Raccoon / shield | 0.030 | 0.200 | -0.047 | 1.0 | 0 | 18 | 0.5 |
| R-yeah / tehilim | 0.030 | 0.500 | 0.071 | 7.0 | 4390 | 24 | 0.7 |
| Ellie the Elephant / shield | 0.027 | 0.200 | 0.064 | 1.0 | 0 | 18 | 0.5 |
| Pickup / boost | 0.027 | 0.600 | 0.003 | 0.0 | 26 | 0 | 2.7 |
| KnowItOwl / rapid-fire projectile + 12-point trail | 0.023 | 0.500 | -0.007 | 2.0 | 141 | 4 | 0.1 |
| Catheterpillar / tehilim | 0.023 | 0.600 | -0.011 | 7.0 | 4392 | 24 | 0.7 |
| Avita-Jas / shield | 0.020 | 0.500 | 0.004 | 1.0 | 0 | 18 | 0.5 |
| Pearococo / boost | 0.017 | 0.600 | 0.018 | 2.0 | 0 | 156 | 4.3 |
| Tammy the Cricket / boost | 0.017 | 0.500 | -0.002 | 2.0 | 0 | 46 | 1.3 |
| Master-Yuda / hedgeShield | 0.013 | 0.600 | 0.002 | 6.0 | 660 | 52 | 1.4 |
| Pickup / tehilim | 0.013 | 0.600 | 0.009 | 2.0 | 746 | 1 | 1.5 |
| Pickup / health | 0.013 | 0.600 | -0.001 | 0.0 | 38 | 0 | 4.0 |
| Ellie the Elephant / tehilim | 0.007 | 0.200 | 0.018 | 7.0 | 4392 | 24 | 0.7 |
| Fourmidable / tehilim | 0.003 | 0.400 | 0.081 | 7.0 | 4392 | 24 | 0.7 |
| Benny the Bear / tehilim | 0.000 | 0.400 | 0.024 | 7.0 | 4392 | 24 | 0.7 |
| Pearococo / rapid-fire projectile + 12-point trail | -0.000 | 0.300 | -0.007 | 3.0 | 604 | 6 | 0.2 |
| Elon Musk / rapid-fire projectile + 12-point trail | -0.000 | 0.500 | 0.062 | 2.0 | 154 | 4 | 0.1 |
| Tammy the Cricket / rapid-fire projectile + 12-point trail | -0.000 | 0.600 | -0.009 | 2.0 | 1000 | 4 | 0.1 |
| Pearococo / tehilim | -0.007 | 0.500 | 0.096 | 7.0 | 4392 | 24 | 0.7 |
| R-yeah / shield | -0.013 | 0.600 | 0.014 | 1.0 | 2 | 18 | 0.5 |
| Rocco the Raccoon / rapid-fire projectile + 12-point trail | -0.013 | 0.500 | -0.004 | 2.0 | 208 | 4 | 0.1 |
| Rocco the Raccoon / tehilim | -0.013 | 0.400 | 0.049 | 7.0 | 4392 | 24 | 0.7 |
| Houston the RTPL / shield | -0.027 | 0.500 | -0.010 | 0.0 | 0 | 18 | 0.5 |
| Catheterpillar / special | -0.027 | 0.400 | 0.022 | 0.0 | 0 | 0 | 0.0 |
| KnowItOwl / tehilim | -0.027 | 0.500 | 0.026 | 7.0 | 4006 | 24 | 0.7 |
| Tammy the Cricket / special | -0.030 | 0.400 | -0.033 | 0.0 | 0 | 0 | 0.0 |
| Pickup / missile | -0.030 | 0.500 | 0.015 | 1.0 | 282 | 0 | 1.5 |
| fireRingOut | -0.033 | 0.600 | 0.025 | 2.0 | 0 | 231 | 6.3 |
| Elon Musk / tehilim | -0.040 | 0.500 | 0.045 | 7.0 | 4392 | 24 | 0.7 |
| Fourmidable / rapid-fire projectile + 12-point trail | -0.043 | 0.300 | -0.034 | 2.0 | 208 | 4 | 0.1 |
| KnowItOwl / somersault | -0.047 | 0.400 | 0.018 | 0.0 | -318 | 0 | 0.0 |
| Fourmidable / special | -0.050 | 0.400 | -0.013 | 0.0 | 0 | 0 | 0.0 |
| Pearococo / special | -0.057 | 0.400 | 0.037 | 0.0 | 0 | 0 | 0.0 |
| Drift smoke 0 / 32 particles | -0.060 | 0.500 | 0.048 | 1.0 | 0 | 32 | 0.9 |
| locustSpawn | -0.060 | 0.500 | -0.025 | 2.0 | 0 | 32 | 0.9 |
| Elon Musk / shield | -0.073 | 0.400 | -0.033 | 1.0 | 0 | 18 | 0.5 |
| Master-Yuda / tehilim | -0.073 | 0.500 | -0.034 | 6.0 | 4392 | 24 | 0.7 |
| Pip the Panda / shield | -0.090 | 0.200 | 0.007 | 1.0 | 0 | 18 | 0.5 |
| yudaSmoke | -0.140 | 0.400 | -0.007 | 0.0 | 0 | 0 | 0.0 |
| Fourmidable / boost | -0.410 | 2.900 | -0.011 | 0.0 | 1178 | 0 | -289.5 |
| Avita-Jas / boost | -0.790 | 0.300 | 0.033 | 2.0 | 0 | 96 | -73.3 |
| KnowItOwl / vulcan | -1.933 | 4.000 | 0.089 | 1.1 | 1367 | 1 | -306.5 |
| KnowItOwl / shield | -3.000 | 0.500 | 0.030 | 1.0 | -54 | 18 | -358.9 |

## Interpretation

Prioritize repeatable large CPU additions and geometry/upload growth. Small differences are noisy at browser timer precision. These are single-machine samples, not proof of mobile performance, and not safe to sum across simultaneous effects. Some gameplay effects have no separate visible rendering: locustSpawn, locustBurst and yudaSmoke are deliberately skipped by the renderer; their corresponding swarm or exhaust is measured separately. Some racer special states also have no persistent visual; their world effects appear separately. The 12-frame warm-up does not cover every animation phase; p95 may include phase-specific cache misses. Results do not measure activation spikes, native clip memory, audio, network, simulation, or all lifetime peaks.
