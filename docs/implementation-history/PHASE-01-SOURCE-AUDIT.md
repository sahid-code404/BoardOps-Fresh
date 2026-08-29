# PHASE 01 — Complete Source-Audit Baseline

## Objective
Audit the read-only BoardOps golden master before any product frontend migration and record a preservation/correction map for later phases.

## Source behavior inspected
Golden master: `sahid-code404/BoardOpsv2rewrite`, audited main tree `77f3dec3b264c42904207f27c5f008b33c03b868`.

Reviewed areas include the repository tree, package/runtime architecture, `src/app`, API route families, layout/navigation, view routing, Zustand UI state, global CSS/design tokens, major feature component tree, Prisma schema, session/auth helpers, formula engine and monthly-closing implementation.

## Frontend behavior preserved
The source is established as the visual/interaction compatibility specification. The audit records its OKLCH theme tokens, light/dark behavior, glass variants, blur/transparency controls, mesh gradients, glow/shimmer effects, responsive helpers, Lucide navigation, page/view structure and motion character. No target product UI was implemented in Phase 01.

## Features preserved
Authentication/registration/OTP/recovery, dashboard, residents/users, meals/leave/guest/kitchen, products/purchases, expenses, payments/refunds/adjustments, resident funds, variables/formulas, billing cycles/snapshots/bills, monthly closing, notifications/announcements, reports/exports, settings/policies/calendar, profile/personalization, audit/system/background tasks and roles/permissions are all represented in `FEATURE-PARITY.md`.

## Problems found
1. Authoritative source money paths use Prisma `Float` / JavaScript `number`.
2. Monthly closing contains an explicit legacy `rate × count` fallback when the canonical formula is missing/invalid.
3. Authorization is broadly based on coarse `ADMIN`/`USER`/`SUPER_ADMIN` role strings.
4. Session records store/query the raw opaque bearer token and retain a Bearer-header compatibility path.
5. The source repository contains implementation/runtime baggage including real-env patterns, SQLite DB/backup artifacts, logs and agent/tool output.
6. Several feature views are monolithic (~40–65 KB source files), increasing maintenance and rerender/bundle risk.

## Bugs fixed
No source business bug was modified in Phase 01 because the golden master is read only. Corrections are recorded in `BUG-CORRECTIONS.md` and must be implemented in the owning later phase. Phase 00 CI/foundation defects discovered during this work were fixed separately.

## Architecture changes
No product-domain architecture was implemented. The migration map assigns source Next/Prisma/SQLite responsibilities to React/Vite, Hono Workers, D1 SQL, R2, permission-based authorization, integer-money accounting, an immutable ledger, immutable monthly snapshots and durable workflow processing.

## Files added / modified / removed
Added the full `docs/source-audit/` inventory set, `docs/visual-parity/README.md`, performance budgets, ADRs and implementation-history records. No file in `BoardOpsv2rewrite` was changed or deleted.

## Database migrations
None for product domains. Phase 01 documents the source model families and the required D1 conversion strategy.

## API changes
None for product APIs. API route families and migration rules are inventoried for later `/api/v1/*` implementation.

## Accounting changes
Target invariants are recorded: integer minor units, append-only ledger events, financial immutability, idempotency, snapshot-only historical billing, one canonical formula engine and a blocking invalid-formula close rule.

## Security changes
Findings are recorded for raw token persistence, coarse role checks, repository secrets/data artifacts and bearer-token surface. Secure session/digest/RBAC changes are deferred to authentication/permissions phases.

## Performance / memory changes
Risks are recorded for large feature files, broad mounting/refetch patterns, heavy report/export modules and expensive blur/mesh regions. Optimization policy preserves visual richness and instead targets code splitting, query/render efficiency, repaint containment and bounded state.

## UI refinement / animation changes
None. Refinement requires a documented defect and material visual change requires deliberate approval. Existing motion/glass/blur/mesh/icon language is protected by the golden-master ADR.

## Tests added
No feature tests are appropriate before product porting. Phase 01 defines the future visual-regression, accounting, API, security and E2E test obligations.

## Visual regression results
Not run yet. Phase 02 must first capture source screenshots at the specified mobile/tablet/desktop viewports and both themes where applicable, then port against those references.

## Local verification
Phase 00 technical foundation smoke is green. Phase 01 itself is a documentation/audit gate and does not present placeholder product UI for user testing.

## CI verification
The audited target documentation and Phase 00 runtime foundation were present when CI run `33259453876` passed at commit `a67715dd4bb4b1898c5e5bd794e53861e5079f53`.

## Known limitations / deferred work
This is the Phase 01 architecture/inventory baseline, not a claim that every future route implementation has already been line-by-line ported or tested. Each owning phase must re-open the mapped source files and verify detailed behavior before changing that domain. Visual baseline capture and the actual frontend port are Phase 02 work and have not started.

## Exit criteria
Golden-master identity is fixed, meaningful feature domains are inventoried, design/navigation/animation constraints are documented, persistence/API/domain mappings exist, high-risk accounting/security/performance findings are logged and Phase 02 has not started early.

## Status
AUDITED — STOP GATE BEFORE PHASE 02.

`NOT READY — CONTINUE FIXING` for the user-facing BoardOps product, because the exact golden-master frontend port has intentionally not started.
