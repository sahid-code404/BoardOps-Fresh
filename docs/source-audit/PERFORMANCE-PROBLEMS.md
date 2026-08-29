# Performance / memory audit

Confirmed risks:

- Multiple monolithic feature views in the ~40–65 KB source range increase parse/maintenance and can encourage broad rerenders.
- The source already contains a lazy view router; preserve route/view laziness rather than regressing to an all-mounted shell.
- Glass/mesh/blur are visually intentional. Source CSS already moved common `.glass` to a stable solid composited surface and reserves backdrop blur for stronger variants; preserve that direction.
- Large blur/mesh areas, charts, export libraries, reports, formula tools and system/admin modules must be lazy-loaded.
- Audit server-state duplication, polling/refetch cadence and whole-dataset refetches when each feature is ported.

Measure bundle size, initial requests, D1 query count/latency, navigation latency, long tasks, memory after navigation loops, layout shift and animation frame stability.
