# Reports / Exports Verification Checkpoint

Date: 2026-08-30

## Status

**IMPLEMENTATION VERIFIED — formal project-record closure pending documentation-head CI.**

Implementation verification head:

`23d6d589df21311b29e1e9738198f1521092ee70`

Implementation CI run:

`33328815790`

The implementation run passed deterministic lockfile validation, frozen dependency install, TypeScript typecheck, unit tests, production builds, clean local D1 reset through all **19 immutable migrations**, deterministic seed/invariant verification, Worker readiness/API smoke, frontend smoke, **24/24 real-D1 Playwright runtime tests**, and **46/46 visual tests**.

No production deployment was performed.

## Scope and source-audit boundary

This checkpoint owns **Reports / Exports**.

It preserves the source Reports surface as five report views:

- Financial
- Meals
- Purchases
- Outstanding
- Residents

The rewrite rule is that Reports is a read/export layer over canonical owning D1 domains. It does not create a second accounting ledger, materialized financial truth, or mutable resident balance.

The separate **Products / Purchases** domain remains out of scope and AUDITED. Because no canonical purchase owner exists yet, the Purchases report returns a truthful empty result instead of fabricating purchase rows or quietly relabeling Expenses.

## Canonical report authorities

Financial and resident reporting consumes already-verified canonical evidence:

- Bills
- Payments
- Refunds
- Expenses
- existing additive correction evidence where applicable

Money remains stored in the owning tables as integer minor units. Reports converts only at the response/export boundary; it does not persist alternate major-unit balances.

Meal reporting consumes canonical:

- meal configurations
- meal entries
- guest meals
- meal overrides

Resident balances and dues are derived rather than stored in a new report-account table.

## Period and timezone semantics

Month/year input is validated before report queries run.

Period boundaries are derived using the institution timezone, so a calendar report month does not rely on Worker-host UTC midnight when the institution operates in another timezone.

Invalid periods fail with `400`.

## Authorization

Migration `0019_reports_exports.sql` adds exactly two permissions:

- `reports.read`
- `reports.export`

Role coverage:

- Admin: 2
- Super Admin: 2
- Manager: 0
- Resident/User: 0

The verified global RBAC baseline is:

- **74 permissions**
- **182 deterministic grants**

`roles_bootstrap_reports_admin` applies the same least-privilege baseline to future Admin/Super Admin roles.

Every Reports API endpoint is explicitly mapped at the fail-closed RBAC boundary.

## Deterministic clean-D1 verification

`scripts/verify-reports-local.mjs` is part of `db:reset:local`.

It owns:

- 74 permissions
- 182 grants
- 2 Reports permissions
- Admin Reports grants: 2
- Super Admin Reports grants: 2
- Manager Reports grants: 0
- Resident Reports grants: 0
- 1 Reports future-role bootstrap trigger
- August approved expenses: `450000` minor units = ₹4,500
- August approved resident deposits: `500000` minor units = ₹5,000
- 3 active meal configurations
- 4 confirmed May resident meals

## Real-runtime proof

The dedicated real-D1 test `Reports derive canonical D1 analytics, exports, and admin-only access` proves the complete source contract.

Financial August 2026:

- total expenses ₹4,500
- total deposits ₹5,000
- one approved deposit
- purchases ₹0 / zero purchase rows
- net position ₹500
- exact GROCERY ₹3,000 + UTILITIES ₹1,500 breakdown

Meals May 2026:

- 4 confirmed resident meals
- 3 active meal configurations
- 0 holidays in the currently owned data
- three meal breakdown rows

Purchases:

- spend/count/item/average all zero
- no top products/categories/vendors
- this is intentional until Products/Purchases has a canonical owner

Outstanding July:

- Arjun Rao
- bill `bill_arjun_2026_07_local`
- ₹13,500 current due

Residents:

- deterministic Riya row is present
- derived available balances and dues are non-negative

Exports:

- deterministic Expenses CSV filename `expenses-August-2026.csv`
- expected CSV header
- seeded Grocery and Electricity rows
- July Bill export contains the canonical Arjun bill

Validation/RBAC:

- invalid month is rejected with 400
- invalid export type is rejected with 400
- Resident receives permission-specific 403 for `reports.read`
- Resident receives permission-specific 403 for `reports.export`

Authenticated-shell proof navigates Dashboard → More navigation → Reports and renders the real D1-backed ₹4,500 Financial surface.

CI `33328815790` completed **24/24 runtime tests green**.

## Visual and lazy-route proof

Reports is registered as a canonical `/reports` route and dynamically imported through `VIEW_COMPONENT_LOADERS`.

It is intentionally absent from administrator priority preloads. The Report chunk is therefore fetched when Reports is requested instead of becoming part of routine authenticated first-paint warming.

Dedicated visual coverage proves:

- Reports & Analytics heading and description
- all five report tabs
- Financial KPIs
- CSV affordances
- Meals surface
- truthful empty Purchases surface
- Outstanding surface
- Residents surface
- phone/tablet/desktop layout safety

The full route/theme matrix also includes `/reports`.

CI `33328815790` completed **46/46 visual tests green**.

## Routing defect exposed during verification

The first dedicated visual candidate exposed a real frontend integration omission.

The `/reports` path, navigation metadata and chunk loader existed, but `LazyViewRouter` did not declare the Reports lazy component or handle `case "reports"`. As a result, the shell title could say Reports while the content switch silently fell through to Dashboard.

The final implementation added:

- `const ReportsView = lazy(VIEW_COMPONENT_LOADERS.reports)`
- the admin-only `case "reports"` route

This was a router integration correction. No report calculation, accounting authority, permission, or export rule was weakened.

## Performance boundary

This checkpoint intentionally avoids speculative background report generation.

Reports:

- has no materialized report/accounting store
- queries canonical authorities on demand
- is code-split
- is excluded from priority view preloads

Future genuinely expensive report generation can use the platform background-task owner when requirements justify it; this checkpoint does not add unnecessary background infrastructure for deterministic current reports.

## Closure condition

Reports / Exports implementation is **VERIFIED** at implementation head `23d6d589df21311b29e1e9738198f1521092ee70` with CI run `33328815790` fully green.

Formal project-record closure requires the documentation head containing this verification record, the feature-parity update, and the changelog entry to pass the same complete CI gate.

Products / Purchases remains **AUDITED** and is not claimed by this checkpoint.

No production deployment was performed, and the golden repository remained read-only.
