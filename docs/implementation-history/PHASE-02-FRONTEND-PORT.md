# PHASE 02 — Exact Frontend Golden-Master Port

## Objective
Port the audited BoardOps client UI from `sahid-code404/BoardOpsv2rewrite` commit `77f3dec3b264c42904207f27c5f008b33c03b868` into the React/Vite target without redesigning it.

## Current status
IN PROGRESS — EXPANDED VISUAL/PERSISTENT-UI GATES ACTIVE.

The port workflow checks out the golden master read-only at the audited commit, copies the client component/store/provider/hook tree, preserves the original global CSS/design tokens and public assets, resolves the client-side `@/lib/*` dependency closure, and provides only minimal compatibility adapters for browser-facing Next helpers (`next/link`, `next/navigation`, `next/image`, `next/dynamic`).

The generated frontend port is committed in the target. The target remains React/Vite. Next.js, Prisma and the source backend are not migrated into the target.

The imported client passes strict TypeScript, unit tests and production Vite bundling. Server-only Prisma helpers accidentally pulled into the browser dependency closure were removed from the Vite client; their persistence behavior remains assigned to the Cloudflare Worker/domain phases.

A dedicated `visual` Vite mode supplies deterministic browser-only fixtures without enabling them in production. This makes the golden-master shell and frontend states directly testable while later backend domains are still being migrated.

## Golden-master composition correction
A temporary runtime-only "Signed in administrator" card had been added to Dashboard while debugging missing identity data. That card is not present in the audited golden-master Dashboard and duplicated information already available through the persistent profile affordance and Profile screen. It has been removed. Dashboard is again composed as the golden master: greeting, KPI area and recent activity.

The real-runtime Dashboard still retains explicit loading/error handling so backend failures cannot create an endless anonymous skeleton state, but those safeguards do not add a new visual section.

## Route and loading hardening
Navigation now uses canonical browser paths rather than state-only pseudo-routes. `/` canonicalizes to `/dashboard`, each top-level view has a stable URL, and browser Back/Forward synchronizes the visible BoardOps view.

Feature code splitting is retained for the performance budget, but routine user navigation no longer swaps to a full-page lazy skeleton. `setView` warms the destination chunk before committing the view/URL, likely next routes are warmed after authentication, and the remaining route modules are filled during browser idle time.

The navigation boundary now rejects malformed runtime route values before they can index the loader map. The loader itself also fails with an explicit rejected promise for an unknown view instead of throwing `loader is not a function`. This protects notification/activity routes that originate as server strings while Phase 02 still contains some legacy casts from the golden client.

## Persistent-shell and interaction hardening
Critical shell state must never depend on an animation completing. The page container and route transitions use transform-only entrance motion, the mobile drawer position is state-driven CSS, and the selected bottom-navigation background is now deterministic rather than starting at `opacity: 0`.

The closed mobile drawer is `inert`, so keyboard focus cannot enter off-canvas controls. Escape closes an open drawer. The notification bell now actually opens its implemented recent-notification panel, supports outside click/Escape, and retains the View-all route.

The golden top bar intentionally hides Search below the `sm` breakpoint and documents the hamburger drawer as the mobile command-palette entry point. The source/initial port did not provide that drawer control, which made Search unreachable for touch-only phone users. The target now exposes a compact `Search BoardOps` action inside the drawer while keeping the compact top-bar composition unchanged.

Authentication cleanup was moved out of React render into an effect. Sign-out clears local UI immediately while sending a keepalive POST to revoke the HttpOnly server session, reducing the chance that navigation/tab-close cancels revocation.

## Automated frontend glitch audit
The Phase 02 browser gate audits every canonical admin route rather than depending on screenshot-by-screenshot manual discovery.

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

A separate compact-phone interaction gate uses 320 × 568 to catch horizontal shell overflow and verifies that a touch-only user can open the command palette from the drawer and navigate through it.

Profile retains dedicated assertions for its avatar and identity wrappers because ordinary Playwright visibility checks can report an `opacity: 0` element as visible when it still occupies layout space.

The real-D1 browser smoke verifies the production-mode authenticated shell, background/glass prerequisites, top-bar glyph paint, layout overflow/clearance, golden Dashboard composition, notification-panel interaction, complete administrator identity on Profile, runtime-derived active-session presentation, password-dialog behavior and real server-session logout.

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
- command-palette navigation
- resident-only command-palette filtering
- drawer keyboard behavior
- theme switching

## Remaining Phase 02 work

Phase 02 remains open until the expanded matrix is green on the latest implementation head and any failures it exposes are corrected. Later backend-domain phases can still cause data-level empty/error states in normal runtime for domains that have not yet been migrated; those are not to be hidden with invented production data.

The Profile avatar upload path still needs a small credential-cleanup pass: it works same-origin because the HttpOnly cookie is sent automatically, but the port still attaches the old client token hint as a bearer header. That should be removed without changing the golden Profile UI.

`FRONTEND GLITCH AUDIT IN PROGRESS`
