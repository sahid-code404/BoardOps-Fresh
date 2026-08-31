# Kitchen / Counts Verification

Date: 2026-08-31

## Status

**VERIFIED** at implementation head `92b044325da1e1eeb5df2644959064d47448558d`.

Implementation CI `33382466173` completed with every required gate green. Formal project-record closure remains contingent on the CI run for this documentation head also remaining fully green. No production deployment was performed.

## Checkpoint scope

This checkpoint verifies the canonical Kitchen/Counts workflow on the real Cloudflare Worker + D1 runtime without changing the accounting meaning inherited from the audited golden implementation.

The implementation preserves the intended Kitchen rule:

- only persisted, confirmed resident meal evidence contributes to aggregate Kitchen counts
- an ON/LOCKED resident meal counts when it is locked/past cutoff or explicitly overridden
- a normal OFF resident meal counts when it is locked and not overridden
- guest counts come from canonical `guest_meals` rows
- missing resident entries may be represented from configuration defaults in per-resident status, but are not silently materialized or counted by the Kitchen read path
- month totals use the same persisted confirmed-evidence semantics

No duplicate Kitchen ledger, guest store, meal-entry store, or accounting table was introduced.

## Hardening completed

The existing D1 source locks already prevented `meal_entries` and `guest_meals` mutations while an accounting period is `CLOSING` or `CLOSED`. This checkpoint keeps those database guards authoritative and improves the API boundary so source-lock violations are returned as deliberate `409 Conflict` responses rather than generic internal-server errors.

The global Worker error boundary now maps:

- `guest meal source period is closing or closed` to a clear guest-meal `409`
- `meal source period is closing or closed` to a clear meal-entry `409`
- the existing meals-disabled Holiday guard remains a `409`

The underlying D1 triggers remain unchanged and fail closed.

## Implementation verification

CI run `33382466173` completed successfully at `92b044325da1e1eeb5df2644959064d47448558d`.

Green gates:

- deterministic lockfile validation
- frozen dependency install
- TypeScript typecheck
- unit tests
- production builds
- all **25 immutable migrations**
- clean local D1 reset, seed, and every database verifier
- Worker health/readiness/auth/dashboard/profile smoke
- frontend smoke
- **32/32 real-D1 Playwright runtime tests**
- **56/56 visual tests**

`bootstrap-lockfile` was skipped as expected because the deterministic lockfile was already valid.

## Canonical D1 and RBAC proof

The clean-D1 run retains the canonical authorization totals:

- **98 permissions**
- **242 role grants**
- 4 canonical roles

The new `scripts/verify-kitchen-local.mjs` is now part of `pnpm db:verify:local`. Its exact invariants passed in CI:

- `kitchen_permissions: 3`
- `admin_kitchen_permissions: 3`
- `super_admin_kitchen_permissions: 3`
- `manager_kitchen_permissions: 1`
- `resident_kitchen_permissions: 0`
- `administrator_override_grants: 2`
- `non_admin_privileged_kitchen_grants: 0`
- `guest_period_lock_triggers: 3`
- `meal_period_lock_triggers: 3`
- `guest_holiday_guard_triggers: 2`
- `guest_service_indexes: 1`
- `meal_service_indexes: 1`
- `active_meal_configurations: 3`
- `active_residents: 1`
- `seeded_guest_meals: 1`

This proves Kitchen access remains least-privilege: Manager is read-only, Admin/Super Admin own guest mutation, and Resident/User has no institution-wide Kitchen permission.

## Runtime proof

`tests/runtime-e2e/kitchen-operations.spec.ts` passed against the real local Worker and D1 runtime as part of the **32/32** green runtime suite.

The scenario proves that:

1. Admin can read the real institution-scoped Kitchen counts and active resident list.
2. The selected date exposes the canonical Breakfast, Lunch, and Dinner configurations.
3. A malformed date is rejected with `400`.
4. A valid guest meal is created in D1 and immediately changes the relevant guest count.
5. The created guest meal can be deleted through the real API.
6. Guest counts outside the allowed `1..100` range are rejected with `400`.
7. A guest-meal creation attempt inside the seeded CLOSED July accounting period is rejected with the new explicit `409` conflict contract.
8. An administrator meal override changes the selected resident meal state while preserving its original baseline.
9. LOCK and UNLOCK preserve the overridden state and original baseline correctly.
10. Aggregate Lunch ON/OFF counts reflect the confirmed override semantics.
11. The pending resident leave can be approved through the real leave API.
12. Approved leave produces OFF + locked future Kitchen resident status for all affected meals.

The test continues to use the real authenticated browser session and real local D1 rather than mock API responses.

## Counting and enrollment semantics

The Kitchen implementation intentionally does not synthesize aggregate counts from configuration defaults. This matches the audited golden behavior and prevents a read request from manufacturing accounting evidence.

Per-resident rows still expose a useful effective status for missing entries, including pre-registration OFF behavior and cutoff-derived locking, but aggregate and month-to-date counts stay tied to canonical persisted meal evidence.

## Source-lock and Holiday safety

Kitchen guest mutations are protected at D1 by three accounting-period source-lock triggers covering insert, update, and delete. Resident meal evidence has the equivalent three triggers. Guest creation/update is also protected by two meals-disabled Holiday guards.

Because the protection lives at D1, current and future API paths cannot bypass the closed-period or Holiday boundaries simply by omitting an application-level check.

## UI regression safety

This checkpoint does not alter the Kitchen visual composition or any shared visual component. The complete visual regression job remained green at **56/56**, preserving the already-verified notification navigation, Reports centering, and broader golden UI contracts.

## Closure statement

Kitchen / Counts implementation is **VERIFIED** at `92b044325da1e1eeb5df2644959064d47448558d` with implementation CI `33382466173` fully green, including **32/32 real-runtime tests** and **56/56 visual tests**.

No production deployment was performed. Formal project-record closure requires the subsequent documentation-head CI run to remain fully green.