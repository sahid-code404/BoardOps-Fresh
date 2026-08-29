# PHASE 02 — Exact Frontend Golden-Master Port

## Objective
Port the audited BoardOps client UI from `sahid-code404/BoardOpsv2rewrite` commit `77f3dec3b264c42904207f27c5f008b33c03b868` into the React/Vite target without redesigning it.

## Current status
IN PROGRESS — EXPANDED VISUAL/PERSISTENT-UI GATES ACTIVE.

The port workflow checks out the golden master read-only at the audited commit, copies the client component/store/provider/hook tree, preserves the original global CSS/design tokens and public assets, resolves the client-side `@/lib/*` dependency closure, and provides only minimal compatibility adapters for browser-facing Next helpers (`next/link`, `next/navigation`, `next/image`, `next/dynamic`).

The generated frontend port is committed in the target. The target remains React/Vite. Next.js, Prisma and the source backend are not migrated into the target.

The imported client passes strict TypeScript, unit tests and production Vite bundling. The Framer Motion 12.23 runtime family is pinned to prevent an incompatible newer `motion-dom` resolution. Server-only Prisma helpers accidentally pulled into the browser dependency closure were removed from the Vite client; their persistence behavior remains assigned to the Cloudflare Worker/domain phases.

A dedicated `visual` Vite mode supplies deterministic browser-only fixtures without enabling them in production. This makes the golden-master shell and frontend states directly testable while later backend domains are still being migrated.

## Golden-master composition correction
A temporary runtime-only "Signed in administrator" card had been added to Dashboard while debugging missing identity data. That card is not present in the audited golden-master Dashboard and duplicated information already available through the persistent profile affordance and Profile screen. It has been removed. Dashboard is again composed as the golden master: greeting, KPI area and recent activity.

The real-runtime Dashboard still retains explicit loading/error handling so backend failures cannot create an endless anonymous skeleton state, but those safeguards do not add a new visual section.

## Automated frontend glitch audit
The Phase 02 browser gate now audits every canonical admin route rather than depending on screenshot-by-screenshot manual discovery.

For every route it checks:

- page-error-free rendering
- no content-bearing persistent Motion wrapper stranded at `opacity: 0`
- no full-document horizontal overflow
- non-empty header, main and fixed primary-navigation geometry
- sufficient bottom padding for the fixed bottom navigation
- no persistent route-level lazy skeleton after settling
- a rendered mesh background with non-zero geometry
- visible, painted persistent top-bar glyphs (menu, search where applicable, theme, notifications)
- visible profile affordance content
- meaningful mounted page content

A viewport/theme matrix additionally walks all canonical admin routes at:

- 390 × 844 dark
- 768 × 1024 dark
- 1440 × 900 dark
- 1440 × 900 light

Profile retains dedicated assertions for its avatar and identity wrappers because ordinary Playwright visibility checks can report an `opacity: 0` element as visible when it still occupies layout space.

The real-D1 browser smoke also verifies the production-mode authenticated shell, background/glass prerequisites, top-bar glyph paint, layout overflow/clearance, golden Dashboard composition, and complete administrator identity on the Profile screen.

## Verified fixture states

- Admin dashboard and responsive shell
- Meal Configuration
- Resident Meals schedule
- User Management
- Notifications
- Profile
- all canonical admin route shells
- phone/tablet/desktop dark layout matrix
- desktop light layout matrix

## Remaining Phase 02 work

Phase 02 remains open until the expanded matrix is green on the latest implementation head and any failures it exposes are corrected. Later backend-domain phases can still cause data-level empty/error states in normal runtime for domains that have not yet been migrated; those are not to be hidden with invented production data.

`FRONTEND GLITCH AUDIT IN PROGRESS`
