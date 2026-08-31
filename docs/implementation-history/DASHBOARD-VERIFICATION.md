# Dashboard Verification

**Status:** implementation VERIFIED; formal project-record closure is contingent on the documentation-head CI run remaining fully green.

## Scope

This checkpoint closes the audited Dashboard parity boundary without redesigning the golden Dashboard UI or creating a second Dashboard data store.

The fixed read-only golden source is:

- Repository: `sahid-code404/BoardOpsv2rewrite`
- Source head: `77f3dec3b264c42904207f27c5f008b33c03b868`
- Golden Dashboard API: `src/app/api/dashboard/route.ts`

The verified BoardOps-Fresh implementation is:

- Implementation head: `2078b2a2ad2961f072ea9bdf5c05ecf4ab8342d8`
- CI run: `33349718965`
- Runtime: **31/31 passed**
- Visual: **56/56 passed**
- Local D1 migrations: **23**
- RBAC baseline: **96 permissions / 234 role grants**

## Ownership and preserved behavior

Phase 02 already verified the recognizable golden Dashboard composition and responsive shell. Phase 05 already made `dashboard.read` the fail-closed authorization boundary and kept administrator behavior permission-derived rather than role-string hard-coded.

This checkpoint therefore did not create another Dashboard UI, permission system, migration, ledger, or materialized read store. It closed the remaining live-data gap in the Worker Dashboard API.

The golden visual composition remains greeting → KPI cards → Dashboard analytics/recent activity, and the existing Phase 02 visual matrix continues to prove it across the supported responsive/theme surfaces.

## Canonical read model

The previous compatibility response returned placeholder zeroes/empty arrays for major Dashboard fields. The verified Dashboard route now derives them from the already-owned canonical D1 authorities:

- active meal configuration: `meal_configurations`
- resident meal evidence: `meal_entries`
- guest meal evidence: `guest_meals`
- current meal rates: active `meal.rate.*` Variables
- approved expenses: `expenses`
- outstanding bills: `bills`
- self notification state: `notifications`
- recent administrator activity: immutable `audit_events`
- institution-local date boundaries: `institutions.timezone`

No Dashboard-specific mutable state was introduced.

## Meal semantics

Dashboard uses the same confirmed-meal semantics as the verified Kitchen route instead of inventing another counting rule:

- confirmed ON includes locked/past/explicitly overridden ON evidence;
- confirmed OFF uses the same lock/original-state rules;
- resident monthly meal totals exclude guest meals;
- the 7-day trend is calculated from the same resident meal evidence.

Today and month boundaries are resolved in the institution timezone, not the runner/server timezone.

## Financial semantics

Dashboard monthly expenses are derived only from canonical approved, non-purged Expense rows and remain integer minor units until the response formatting boundary.

Current meal charge follows the source workflow intent while using the verified current architecture:

`max(0, approved monthly expenses - guest meal revenue) / confirmed resident meals`

Guest meal revenue is derived from canonical guest counts multiplied by active per-meal `meal.rate.*` Variables. The Dashboard does not duplicate Expense accounting, bill state, or Formula ownership.

## Query-efficiency correction

The golden source performed separate day-by-day Dashboard trend reads. BoardOps-Fresh keeps the same seven-day behavior but reads the bounded seven-day interval once and derives the daily buckets in memory.

The current-month resident meal interval and approved Expense interval are likewise bounded and institution-scoped.

## Authorization

The Worker remains authoritative:

- `/api/dashboard` requires `dashboard.read` through fail-closed RBAC.
- recent audit activity is returned only when the principal has `audit.read`.
- compatibility `isAdmin` remains permission-derived from `users.read`.
- the exact Worker-resolved permission list is returned for browser navigation/gating convenience; UI visibility is not the security boundary.

## Runtime proof

`tests/runtime-e2e/dashboard.spec.ts` intentionally avoids hard-coded fixture KPI values. It signs in through the real UI and cross-checks the Dashboard response against canonical APIs for the same institution/date:

- `/api/kitchen?date=<institution-local today>` for confirmed ON/OFF and month meal totals;
- `/api/expenses?limit=500` for approved monthly Expense totals and category aggregation.

The test proves:

- active today meal cards are present with valid cutoff timestamps;
- Dashboard today ON/OFF equals Kitchen canonical counts;
- Dashboard monthly resident meals equals Kitchen meals less guests;
- Dashboard monthly Expense total/category breakdown equals canonical Expenses;
- seven-day trend is complete and its final bucket matches today’s Kitchen counts;
- current meal charge is finite/non-negative;
- `dashboard.read` is present and administrator compatibility remains permission-derived;
- recent activity is available to the administrator;
- the live Dashboard renders its golden KPI/recent-activity surface without a data-unavailable state.

CI run `33349718965` executed this test as test 5 of 31 and finished **31 passed (2.3m)**.

## Visual proof

The same implementation head completed **56/56 visual tests**, including:

- `dashboard preserves golden-master composition`;
- healthy `/dashboard` persistent UI;
- the full phone/tablet/desktop/theme route matrix.

No Dashboard visual regression was introduced by replacing the placeholder backend read model.

## Clean-D1 evidence

The implementation CI independently reset and reapplied all **23 immutable migrations** and re-ran the complete deterministic verifier chain.

Current baseline remained:

- permissions: **96**
- role permissions: **234**
- canonical roles: **4**
- meal configurations: **3**
- meal entries: **7**
- guest meals: **1**
- `resident_dashboard_read`: **1**
- `resident_users_read`: **0**

No Dashboard migration was required.

## Boundaries

- No production deployment was performed.
- The golden repository remained read-only.
- No already-verified accounting, meal, notification, audit, RBAC, or billing ownership was duplicated or weakened.
- Formal closure requires the latest documentation head to reproduce the full CI gate.