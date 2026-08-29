# PHASE 02 — Exact Frontend Golden-Master Port

## Objective
Port the audited BoardOps client UI from `sahid-code404/BoardOpsv2rewrite` commit `77f3dec3b264c42904207f27c5f008b33c03b868` into the React/Vite target without redesigning it.

## Current status
IN PROGRESS — CORE VISUAL CHECKPOINT IS TEST-READY.

The port workflow checks out the golden master read-only at the audited commit, copies the client component/store/provider/hook tree, preserves the original global CSS/design tokens and public assets, resolves the client-side `@/lib/*` dependency closure, and provides only minimal compatibility adapters for browser-facing Next helpers (`next/link`, `next/navigation`, `next/image`, `next/dynamic`).

The generated frontend port is committed in the target. The target remains React/Vite. Next.js, Prisma and the source backend are not migrated into the target.

The imported client passes strict TypeScript, unit tests and production Vite bundling. The Framer Motion 12.23 runtime family is pinned to prevent an incompatible newer `motion-dom` resolution. Server-only Prisma helpers accidentally pulled into the browser dependency closure were removed from the Vite client; their persistence behavior remains assigned to the Cloudflare Worker/domain phases.

A dedicated `visual` Vite mode now supplies deterministic browser-only fixtures without enabling them in production. This makes the golden-master shell and the currently verified frontend states directly testable before the real Phase 03+ backend domains are migrated.

Verified fixture states:

- Admin dashboard and responsive shell
- Meal Configuration
- Resident Meals schedule
- User Management
- Notifications
- Profile
- 390 × 844 mobile dashboard shell

CI run `33260727773` on commit `c74f007f043d7b2f431b848a7ac37afc0c619e6b` passed frozen install, TypeScript, unit tests, production build, local D1 migration/seed, Worker health/readiness, frontend startup, Playwright Chromium installation and all Phase 02 visual-fixture smoke tests.

## Remaining Phase 02 work

The complete viewport/theme screenshot matrix and the remaining feature surfaces still need parity coverage before Phase 02 itself can be declared complete. The visual fixture mode is a test harness only; it does not claim that real authentication, billing, accounting or other Phase 03+ backend behavior is implemented.

`TEST READY — CORE VISUAL CHECKPOINT`
