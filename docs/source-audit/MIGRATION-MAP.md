# Migration map

| Source | Target | Strategy |
|---|---|---|
| Next `src/app/page.tsx` shell | `apps/web/src/app` | port behavior to React/Vite routing/shell without redesign |
| `src/app/globals.css` | `apps/web/src/styles` | migrate actual design tokens/glass/mesh/animation CSS |
| `src/components/layout/*` | `apps/web/src/components/layout` | preserve AppShell/TopBar/sidebars/bottom nav/command interactions |
| `src/components/features/*` | `apps/web/src/features/*` | port feature-by-feature, split oversized files by responsibility |
| Zustand UI store | `apps/web/src/stores` | keep only small UI state; move shareable filters/navigation to URL where appropriate |
| Next API routes | `services/api/src/routes` | Hono `/api/v1/*`, validation + permissions + request IDs |
| Prisma/SQLite | D1 SQL migrations/repositories | explicit SQL, constraints/indexes, prepared queries |
| Prisma financial Floats | integer `*_minor` columns | conversion + invariant tests |
| local/public operational files | R2 + D1 metadata | no filesystem production storage |
| synchronous/background helpers | Queues/Workflows | idempotent jobs; monthly close durable workflow |
| source roles | permission service | preserve equivalent UI access, replace coarse authorization internals |
| agent/tool/backups/log/db clutter | nothing | intentionally excluded from target |
