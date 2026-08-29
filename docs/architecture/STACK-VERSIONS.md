# Phase 00 stable stack baseline

Validated during the 2026-08-29 Phase 00 initialization. Versions are pinned in the workspace manifests/lockfile so CI and local development use the same dependency graph.

## Runtime / tooling

- Node.js: >= 22.12.0 (CI uses Node 22)
- pnpm: 11.23.0
- TypeScript: 7.0.2
- Wrangler: 4.127.1
- Playwright: 1.62.1

## Web application

- React / React DOM: 19.2.8
- Vite: 8.2.2
- Tailwind CSS / @tailwindcss/vite: 4.3.3
- @vitejs/plugin-react: 6.1.0
- TanStack Query: 5.102.8
- Zustand: 5.0.15
- Motion: 13.1.1
- Lucide React: 1.34.0
- React Hook Form: 7.86.0
- Zod: 4.4.3
- Sonner: 2.0.8
- Vitest: 4.1.11

Radix primitives are intentionally not bulk-installed in Phase 00. Phase 02 will add only the primitives actually required while porting the golden-master UI.

## Worker API

- Hono: 4.13.5
- @cloudflare/vite-plugin: 1.54.1
- @cloudflare/workers-types: 5.20260827.1
- Wrangler: 4.127.1

The Cloudflare Vite plugin requires Wrangler ^4.127.0; the foundation therefore pins 4.127.1 rather than the earlier 4.126.0 candidate.
