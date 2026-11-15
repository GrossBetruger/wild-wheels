# Ideas that require strong AI

1. **Create low-performance-cost versions of the most graphics-demanding effects.**
   Preserve each effect's identity and gameplay readability while reducing geometry,
   particles, transparency overdraw, shader work, and allocations. Use measured
   effect costs to prioritize the work, and keep browser and native visuals in sync
   through the existing graphics port. Compare the original and cheaper versions
   visually and on slower hardware before choosing quality thresholds.
   Use the [visual effect cost report](effect-costs.md) as the initial prioritization
   baseline; its browser timings need separate validation on native and slower GPUs.
