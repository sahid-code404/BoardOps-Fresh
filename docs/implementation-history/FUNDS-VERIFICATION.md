# Funds Verification Checkpoint

Date: 2026-08-30

## Status

Funds is **VERIFIED** at implementation verification head:

`0114cdd8420cc1972b50e6806fa459246d63176a`

Implementation CI run:

`33309874914`

All required gates passed:

- deterministic lockfile validation
- frozen dependency install
- TypeScript typecheck
- unit tests
- production builds
- clean local D1 reset, migration, deterministic seed and invariant verification
- Worker health/readiness/auth/dashboard/profile smoke
- frontend smoke
- real-D1 Playwright runtime suite
- complete Phase 02 visual regression suite

No production deployment was performed.

## Accounting authority

Funds is a **derived read model**, not a second mutable financial ledger.

The canonical inputs remain:

- approved payment evidence from Payments
- approved expense evidence from Expenses
- canonical Bills state
- institution-scoped Users/resident state

`GET /api/funds` derives the requested period totals and resident breakdown from those canonical sources. There is no independently writable fund-balance table that can drift from the underlying accounting evidence.

For the deterministic August 2026 local fixture, clean D1 verifies:

- approved deposits: ₹5,000
- approved expenses: ₹4,500
- refunded amount: ₹0
- remaining fund: ₹500
- active residents: 1
- active resident: Riya Sen (`usr_resident_riya_local`, Room B-204)
- August bills: 0
- Riya Sen derived deficit: ₹4,500

The read model preserves integer minor-unit accounting internally and converts to the golden frontend's major-unit response contract only at the API boundary.

## Authorization

Migration `0012_funds_read_model.sql` adds the explicit fail-closed permission:

`funds.read`

Only `ADMIN` and `SUPER_ADMIN` receive this permission. `MANAGER` and `USER` do not.

The verified baseline after `0012` is:

- permissions: 50
- deterministic role-permission grants: 128
- Admin `funds.read`: granted
- Super Admin `funds.read`: granted
- Manager `funds.read`: denied
- Resident/User `funds.read`: denied

The future-institution RBAC bootstrap remains aligned with that same least-privilege policy.

## Frontend and visual contract

The existing golden Funds experience remains recognizable and is wired to the canonical Worker response rather than a production fixture. The page exposes the expected period summary, resident row/breakdown, deficit state, search, and status filtering.

A dedicated visual Funds fixture mirrors the composite API contract in visual-test mode so generic fallback fixture behavior cannot hide frontend/backend contract drift.

Visual coverage verifies the summary cards, Riya Sen/Room B-204 row, Deficit state, deficit filtering, resident search, and the empty-search result.

## Runtime verification

Real-D1 browser coverage verifies:

- administrator login and authenticated shell restoration
- real `/funds` rendering
- canonical August totals from `/api/funds?month=7&year=2026`
- exact clean-fixture accounting of ₹5,000 deposits, ₹4,500 expenses, ₹500 remaining and ₹4,500 resident deficit
- no failed Funds 5xx responses
- a real approved resident cannot read `/api/funds`
- the denied response is `403` with `requiredPermission: "funds.read"`

## Cross-domain test isolation correction

The first combined runtime attempt exposed a shared-D1 test contamination issue rather than a Funds accounting defect.

The preceding Expenses lifecycle test intentionally created a ₹123.45 expense, replaced it with ₹222.22, soft-deleted the replacement, restored it, and then left that restored replacement in `APPROVED` state. Funds correctly included that still-approved ₹222.22 evidence, producing ₹4,722.22 expenses and ₹277.78 remaining instead of the deterministic seed baseline.

The Expenses runtime test now still proves the complete restore lifecycle, then soft-deletes its temporary replacement again during cleanup. The immutable reversed original remains historical evidence, while downstream finance tests receive the deterministic approved-expense baseline.

This preserves both accounting correctness and cross-test isolation; Funds itself was not changed to ignore legitimate approved expense evidence.

## Closure

Funds implementation is VERIFIED. Formal project-record closure is contingent on the CI run for the latest documentation head remaining fully green.

The next audited finance domain is **Refunds/adjustments**. That work must preserve immutable/reversal-based financial semantics and must not weaken the canonical Payments/Bills/Funds accounting authority established by the verified finance modules.
