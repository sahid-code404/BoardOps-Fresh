# Animation inventory

The golden master combines Motion/Framer Motion interaction animation and CSS ambient animation. Preserve the character of page transitions, spring/tap/hover feedback, menus, sidebar, theme icon, bottom-nav state, badges, card entrance/stagger, counters, dialog/dropdown motion, shimmer and mesh ambience.

Confirmed global CSS animation/effect primitives include `shimmer`, mesh radial gradients, `blob-pulse-1`, `blob-pulse-2`, glow utilities and reduced-motion overrides.

Performance rule for the rewrite: prefer transform/opacity and CSS for continuous ambience, limit repaint regions, and pause/reduce ambient work when hidden. Optimization must not silently delete motion.
