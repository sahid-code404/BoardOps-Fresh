# Resident Meals / Leave / Guest Verification

Date: 2026-08-31

## Status

**VERIFIED** at implementation head `8763a1d1960028674e0419f2c8f3e2d4e413cca2`.

Implementation CI `33379976564` completed with every required gate green. Formal project-record closure remains contingent on the CI run for this documentation head also remaining fully green. No production deployment was performed.

## Checkpoint scope

This checkpoint establishes resident-facing meal self-service and leave behavior on the real Cloudflare Worker + D1 runtime without weakening the existing institution/admin meal-operation authority.

The implementation includes:

- real resident `GET /meals/entries`
- real resident `POST /meals/toggle`
- self-scoped meal RBAC
- overlap-safe leave applications
- closed-accounting-period approval protection
- leave approval that turns affected meals off while preserving each resident entry's original baseline
- approved-leave locking of affected meal entries
- self-scoped resident leave reads
- dedicated resident-meals D1 integrity verification
- real-runtime Playwright coverage against local D1

Guest-meal evidence remains part of the canonical meal-operations model and is exercised by the full runtime suite together with meal entries, overrides, and leave decisions; this checkpoint does not create a duplicate guest-meal store.

## Implementation verification

CI run `33379976564` completed successfully at `8763a1d1960028674e0419f2c8f3e2d4e413cca2`.

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

## Canonical D1 and RBAC proof

The clean-D1 run reports the canonical authorization totals as:

- **98 permissions**
- **242 role grants**
- 4 canonical roles

`scripts/verify-resident-meals-local.mjs` completed successfully and reported:

- `resident_meal_self_permissions: 2`
- `bootstrap_triggers: 1`
- `meal_entry_state_columns: 3`
- `seeded_meal_entries: 3`
- `seeded_leave_applications: 1`
- `admin_self_permissions: 2`
- `super_admin_self_permissions: 2`
- `manager_self_permissions: 2`
- `resident_self_permissions: 2`
- `resident_privileged_meal_permissions: 0`

The owning immutable migration is `0025_resident_meals_integrity.sql`.

This proves the self-service permissions are explicitly catalogued and granted without giving residents privileged institution-wide meal-operation capabilities.

## Resident meal and leave runtime proof

`tests/runtime-e2e/resident-meals-leave.spec.ts` passed against the real local Worker and D1 runtime as part of the **32/32** green runtime suite.

The scenario proves that:

1. A temporary approved resident receives the intended self-meal permissions.
2. `/meals/entries` returns that resident's real D1 meal state.
3. The resident can toggle their own eligible meal entry.
4. The resident cannot mutate another resident's meal entry.
5. A leave application can be submitted through the real API.
6. Overlapping leave is rejected.
7. Leave approval turns affected meals OFF while preserving the resident's original `ON` baseline for later restoration semantics.
8. Approved leave locks the affected meal entries from ordinary resident toggles.
9. Resident leave reads remain self-scoped.
10. Approval is rejected when the affected accounting period is closed.
11. Temporary runtime fixture data is cleaned up after the scenario.

The runtime matcher deliberately accepts enriched resident user payloads while still requiring the correct resident identity, avoiding a false failure when the API returns additional profile fields.

## Guest and kitchen integration proof

The same real-runtime suite also passed the Kitchen/Counts scenario:

`tests/runtime-e2e/kitchen-operations.spec.ts` — **Counts uses real D1 meal entries, guests, overrides and leave decisions**.

The clean seeded D1 baseline includes canonical `guest_meals` evidence, and no duplicate guest or leave storage was introduced by this checkpoint.

## Accounting-period safety

Leave approval is fail-closed with respect to accounting periods. The runtime scenario explicitly verifies that a leave crossing a seeded CLOSED period cannot be approved. This prevents a later leave decision from silently rewriting meal evidence belonging to an already closed accounting period.

## Baseline preservation

Leave processing does not overwrite the resident's original meal intent. The entry stores the baseline separately from the leave-driven effective state, allowing approved leave to force an effective OFF state while retaining the prior resident choice.

This is the required behavior for safe restoration after leave and prevents leave approval from becoming destructive meal-history mutation.

## Companion UI regression closure

The final implementation head also contains the UI fixes discovered while this checkpoint was being verified:

- the notification bell routes directly to `/notifications`; the obsolete recent-notification dialog is not the navigation path
- Reports uses the reusable `GlassNav` design language
- Reports month controls and section navigation are centered
- the Reports heading is intrinsically centered against the same page-content axis as the section navigation

The full visual gate completed **56/56 passed**, including the Reports centering contract.

## Closure statement

Resident meals / leave / guest implementation is **VERIFIED** at `8763a1d1960028674e0419f2c8f3e2d4e413cca2` with implementation CI `33379976564` fully green, including **32/32 real-runtime tests** and **56/56 visual tests**.

No production deployment was performed. Formal project-record closure requires the subsequent documentation-head CI run to remain fully green.