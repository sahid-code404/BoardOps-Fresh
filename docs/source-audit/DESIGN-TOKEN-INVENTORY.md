# Design token inventory

The source `src/app/globals.css` is an authoritative visual asset for Phase 02.

Confirmed tokens include background/foreground, card/popover, primary/secondary/muted/accent/destructive, success/warning/info, borders/input/ring, chart colors, sidebar tokens, radius scale, `glass-bg`, `glass-border`, `glass-shadow`, `glass-highlight`, and `mesh-1..4`.

The source uses OKLCH values, a 1.25rem base radius, light and dark theme token sets, glass strong/soft modes, user-selectable blur intensity and transparency levels, glow utilities, gradient text, safe-area helpers and responsive auto-fit grids.

Do not normalize these into a generic palette. Migrate the actual tokens first, then optimize their implementation while preserving appearance.
