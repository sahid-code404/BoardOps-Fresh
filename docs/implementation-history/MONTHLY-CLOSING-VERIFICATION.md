# Monthly Closing Verification Checkpoint

Date: 2026-08-30

## Status

**IMPLEMENTATION VERIFIED — formal project-record closure pending documentation-head CI.**

Implementation verification head:

`3df1640438c6b3dffb6d2f90c99c07aae794b379`

Implementation CI run:

`33321712238`

That implementation run passed deterministic lockfile validation, frozen dependency install, TypeScript typecheck, unit tests, production builds, a clean local D1 reset through all 16 immutable migrations, deterministic seed/invariant verification, Worker readiness/API smoke, frontend smoke, **22/22 real-D1 Playwright runtime tests**, and **41/41 visual regression tests**.

No production deployment was performed.

## Scope and source-audit defect

This checkpoint owns **Monthly Closing**.

The source audit required closing to validate residents, meals, expenses, Variables, canonical Formula status/dependencies, and unresolved payments; freeze reproducible source data; run through a resumable durable state machine; and preserve enough immutable evidence to reproduce the resulting bills.

Most critically, audit defect `ACC-001` prohibited the old behavior where a missing or invalid canonical Formula could silently fall back to legacy arithmetic such as `rate × count`.

That fallback does not survive this implementation. Monthly Closing now blocks publication when the canonical Formula Engine or any required dependency is invalid or unresolved.

## Durable resumable state machine

Migration `0015_monthly_closing.sql` adds institution-scoped `billing_cycles` and append-only `billing_cycle_events`.

The durable lifecycle is:

`OPEN → PREPARING → SNAPSHOT_CREATED → BILLS_GENERATED → SETTLED → CLOSED`

with `FAILED` representing a resumable failure state.

The cycle stores workflow state, attempt count, due date, totals, failure information, and a pre-publication frozen draft. `billing_cycle_events` records immutable transition history.

D1 guards enforce:

- integer minor-unit Monthly Closing money fields
- CLOSED-cycle immutability
- durable cycle history with no hard delete
- immutable cycle-event history

A CLOSED cycle is historical accounting evidence. Later corrections use the already-verified refund/adjustment mechanisms rather than reopening or repricing the month.

## Rollbackable draft versus published financial authority

The existing `billing_snapshots` table is intentionally immutable and unique per institution/month. The golden Monthly Closing workflow also requires rollback before bill publication.

To preserve both rules, the cycle owns a **pre-publication draft snapshot** while it is preparing. That draft is mutable workflow state and can be rolled back before publication.

The published financial authority remains only:

- immutable `billing_snapshots`
- canonical `bills`
- existing canonical Payments/Refunds/Adjustments evidence

Once publication happens, rollback is forbidden and retries resume from the immutable published snapshot instead of reading/recalculating live source data.

## Canonical Formula Engine authority — no fallback

Monthly Closing consumes the verified Worker-owned BigInt fixed-point Formula Engine.

Readiness requires active, compatible current versions of:

- `formula.mealCharges`
- `formula.totalBill`

It resolves and freezes the exact Formula version IDs, expressions, return types, referenced runtime contexts, and all required active Variable version IDs/values.

The canonical meal Formula is evaluated per resident from actual meal-type runtime counts such as:

- `breakfast_count`
- `lunch_count`
- `dinner_count`

The total-bill Formula then composes the meal result with the frozen persisted Variables used by that Formula, including the deterministic local room-rent and cleaning Variables.

Readiness fails closed when:

- a required Formula is missing or inactive
- Formula dependency metadata is malformed
- a referenced persisted Variable is missing or archived
- a required runtime context cannot be mapped to an active meal type
- strict Formula evaluation reports a syntax/dependency/error condition

The real-runtime suite deliberately mutates `formula.mealCharges` to add an unsupported runtime identifier. Formula Engine itself accepts the Formula as syntactically valid, but Monthly Closing cannot resolve that runtime dependency, so readiness becomes false and close returns `422`. The test proves no May cycle or bill is published under that invalid Formula. The canonical Formula is then restored and the normal close succeeds.

There is no legacy arithmetic fallback.

## Frozen reproducible snapshot

Before publication, Monthly Closing freezes the accounting inputs required to reproduce the result:

- period identity and boundaries
- exact Formula IDs and immutable Formula-version IDs
- Formula expressions and return types
- exact Variable IDs, immutable Variable-version IDs, values, types, and units
- resident meal-type counts used as runtime Formula context
- per-resident meal-charge result
- per-resident non-meal charge result
- per-resident total bill
- approved expense total
- guest meal counts/revenue where applicable
- period aggregate totals
- freeze timestamp

After the immutable snapshot is published, retries never re-price from current Variables, current Formulas, or mutable operational source data.

## Atomic publication boundary

Publication is one D1 batch containing:

1. the immutable `billing_snapshots` row
2. every generated resident `bills` row
3. the `billing_cycles` transition to `BILLS_GENERATED`
4. the corresponding immutable cycle event

A failed publication therefore cannot intentionally leave a month with only part of its resident bills published by the Monthly Closing route.

After publication, settlement derives outstanding due/refund totals from canonical Bills and Refunds. Monthly Closing does **not** create another mutable resident balance ledger; the previously verified Funds model remains derived from canonical accounting evidence.

The final transition closes both the accounting period and billing cycle and records audit history.

## Accounting-period source freeze

During PREPARING, the owning accounting period moves to `CLOSING` before the frozen draft is built.

A route-only status flag was not sufficient because concurrent Meal/Guest/Expense requests could otherwise mutate source rows between draft creation and publication. Migration `0016_monthly_closing_source_locks.sql` therefore makes the period lock authoritative at D1.

Nine database triggers block insert/update/delete of closing/closed-period source data for:

- `meal_entries`
- `guest_meals`
- `expenses`

Update guards inspect both OLD and NEW period keys, so a row cannot be moved into or out of a locked month to evade the freeze.

`scripts/verify-monthly-closing-local.mjs` actively proves these are enforcement guards rather than schema decoration: it temporarily marks deterministic August `CLOSING`, attempts otherwise-valid Meal, Guest Meal, and Expense inserts, requires the specific D1 lock errors, then restores August to `OPEN` and verifies the restoration.

Leave approval is also covered indirectly because its operational effect writes `meal_entries`; the same D1 meal-entry guard prevents leave processing from altering frozen closing/closed-month meal source data. Its D1 batch therefore cannot silently bypass the accounting-period lock.

## Legacy meal-lock ambiguity hardened

The previous meal override path could store `status='LOCKED'`, conflating the lock flag with the actual ON/OFF meal state.

The current path preserves ON/OFF in `status` and uses the dedicated `locked` field for lock state. Legacy `LOCKED` sentinel rows recover from their stored original state where possible.

Monthly Closing additionally blocks periods that still contain ambiguous legacy `status='LOCKED'` rows rather than guessing whether those meals were financially ON or OFF.

## Readiness contract

For a new unpublished close, readiness verifies at least:

- the requested month is a completed past month
- a canonical accounting period exists and is in a compatible OPEN/CLOSING state
- no conflicting immutable snapshot already exists outside the owning cycle
- resident billing scope is non-empty
- active meal configuration exists
- no ambiguous legacy LOCKED meal source exists
- approved expenses can be frozen
- no unresolved PENDING payment is assigned to the target billing period
- both canonical required Formulas are active and compatible
- required persisted Variable versions exist and are active
- Formula runtime contexts can be resolved by Monthly Closing

A readiness error blocks new draft/publication work.

Immediately before publication, target-period pending payments are checked again. If one appears after the initial readiness pass, the cycle remains unpublished/rollbackable and moves to FAILED rather than publishing against stale payment state.

## Authorization baseline

The verified current RBAC baseline after Monthly Closing is:

- **67 permissions**
- **164 deterministic role-permission grants**

Monthly Closing adds exactly three fail-closed permissions:

- `billing_cycles.read`
- `billing_cycles.close`
- `billing_cycles.rollback`

Admin and Super Admin receive all three. Manager and Resident/User receive none. Future-role bootstrap installs the same administrator-only grants for institutions created after the migration.

Every Monthly Closing API endpoint is mapped explicitly at the fail-closed RBAC middleware boundary.

The runtime suite proves the Resident receives permission-specific `403` denial for cycle list/readiness, close, and rollback, including rollback against a nonexistent ID so authorization is proven to execute before resource disclosure.

## Deterministic clean-D1 verification

`scripts/verify-monthly-closing-local.mjs` is part of the mandatory `db:reset:local` verification chain.

The clean verifier owns the exact current Monthly Closing/RBAC baseline:

- 67 permissions
- 164 role-permission grants
- 2 Monthly Closing tables
- 7 cycle/event durability guards
- 9 closing-period source-lock guards
- 3 Monthly Closing permissions
- Admin Monthly Closing permissions: 3
- Super Admin Monthly Closing permissions: 3
- Manager/User Monthly Closing permissions: 0
- 1 deterministic unpublished FAILED rollback cycle
- 1 immutable seeded failure event
- required canonical Formulas present: 2
- matching current immutable Formula versions present: 2

The existing Formula/Billing/Payments/Expenses/Funds/Refund verifiers remain green at this expanded permission baseline and retain ownership of their domain-specific invariants.

## Real-runtime canonical May close

The deterministic May fixture uses one active resident and four resident meal entries:

- breakfast ×2 @ ₹40 = ₹80
- lunch ×1 @ ₹60 = ₹60
- dinner ×1 @ ₹70 = ₹70

Canonical `formula.mealCharges` therefore produces **₹210**.

Canonical `formula.totalBill` composes:

- meal charges: ₹210
- monthly room rent: ₹4,500
- cleaning charge: ₹150

for exactly **₹4,860**.

The runtime lifecycle verifies:

1. real authenticated-shell navigation to Monthly Closing
2. May readiness is green before mutation
3. an incompatible canonical runtime dependency makes readiness fail closed
4. close under that incompatible Formula returns `422`
5. no May cycle/bill is published through the rejected close
6. restoring the canonical Formula makes readiness valid again
7. close publishes exactly one immutable snapshot-derived bill
8. the bill contains ₹210 meal charges, ₹4,650 other charges, and ₹4,860 total/due
9. the accounting period and billing cycle become CLOSED
10. Billing Core correctly presents the historical bill as `OVERDUE` because its June 10 due date is in the past
11. retrying close is idempotent and does not create a second bill or replace the original due date
12. post-publication rollback is rejected
13. closed-period readiness no longer offers a new close

## Pre-publication rollback proof

A deterministic April fixture represents a FAILED close with no published snapshot or bill and one immutable PREPARING → FAILED event.

The dedicated runtime test proves:

1. the FAILED cycle is visible as durable history
2. administrator rollback succeeds
3. the cycle returns to OPEN
4. the accounting period returns from CLOSING to OPEN
5. the existing cycle remains durable rather than being deleted
6. a second rollback from OPEN is rejected

This proves rollback is a constrained workflow transition, not a destructive history reset.

## Runtime and visual results

CI `33321712238` completed **22/22 real-D1 runtime tests green**. The three Monthly Closing runtime tests are:

- unpublished FAILED rollback/reopen lifecycle
- canonical Formula fail-closed → successful May publication/idempotent retry lifecycle
- Resident Monthly Closing RBAC denial

The same run completed **41/41 visual tests green**. Dedicated Monthly Closing visual coverage verifies real navigation, readiness presentation, close affordance, immutable-snapshot warning/dialog content, due-date control, and the final Execute Closing/Cancel actions without mutating visual fixture state.

The full Phase 02 route/responsive/theme matrix also includes `/monthly-closing`.

## Closure condition

Monthly Closing implementation is **VERIFIED** at implementation head `3df1640438c6b3dffb6d2f90c99c07aae794b379` with CI run `33321712238` fully green.

Formal project-record closure requires the documentation head containing this verification record, the feature-parity update, and the changelog entry to pass the same complete CI gate.

No production deployment was performed, and the golden repository remained read-only.
