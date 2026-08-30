# Refunds & Adjustments Verification Checkpoint

Date: 2026-08-30

## Status

Refunds/adjustments is **VERIFIED** at implementation verification head:

`8c13b08c2f2087e8cbc4035a53ec4de8ce9825b6`

Implementation CI run:

`33312728702`

All required implementation gates passed:

- deterministic lockfile validation
- frozen dependency install
- TypeScript typecheck
- unit tests
- production builds
- clean local D1 reset, all 13 immutable migrations, deterministic seed and invariant verification
- Worker health/readiness/auth/dashboard/profile smoke
- frontend smoke
- all 17 real-D1 Playwright runtime tests
- complete Phase 02 visual regression suite

No production deployment was performed.

## Durable refund accounting authority

Migration `0013_refunds_adjustments.sql` upgrades refunds from the earlier minimal payment-era skeleton into durable resident refund obligations.

A refund obligation has an immutable original amount and one of four explicit lifecycle states:

- `PENDING`
- `PARTIALLY_PAID`
- `COMPLETED`
- `CANCELLED`

The accounting invariant is enforced in integer minor units:

`amount_minor = paid_amount_minor + remaining_amount_minor`

Outstanding `PENDING` and `PARTIALLY_PAID` obligations reserve refundable resident credit. Available credit is resident-scoped and is derived from canonical approved Payments less active Bills, already-refunded Payment evidence, and outstanding refund reservations. This prevents the same resident credit from being promised or paid twice.

Refund payouts do not create a second mutable ledger. Every payout creates immutable `refund_transactions` evidence and a canonical `REFUNDED` Payment row. Bills, Payments, Refunds and Funds therefore continue to share the same accounting authority.

Refund obligation identity and original amount cannot be rewritten, refund history cannot be hard-deleted, and payout transaction rows cannot be updated or deleted.

## Immutable additive adjustments

Adjustments are correction evidence, not in-place edits of existing financial history.

Each adjustment:

- stores a signed, non-zero integer minor-unit amount
- targets a canonical `Payment`, `Refund`, `Bill` or `Expense`
- requires a reason and idempotency key
- receives an institution-scoped durable adjustment number
- cannot be updated after creation
- cannot be hard-deleted

Runtime verification creates a `-₹25` adjustment against the seeded approved ₹3,000 Expense and then proves the original Expense remains `APPROVED` at exactly ₹3,000. The correction is additive evidence rather than a silent rewrite.

## Idempotency and reference allocation

Refund-obligation creation, refund payouts and adjustment creation are idempotency-key protected.

The verified runtime flow proves:

- replaying refund creation returns the same obligation instead of reserving credit twice
- replaying a partial payout does not create a second transaction or Payment row
- replaying an adjustment returns the original adjustment rather than creating different correction evidence

`financial_reference_sequences` allocates institution-scoped `REF-YYYY-NNNN` and `ADJ-YYYY-NNNN` references without relying on mutable client-side counters.

## Authorization

The verified current RBAC baseline after migration `0013` is:

- permissions: 55
- deterministic role-permission grants: 138
- Admin refund/adjustment permissions: 6
- Super Admin refund/adjustment permissions: 6
- Manager refund/adjustment permissions: 0
- Resident/User refund/adjustment permissions: 0

The six current permissions exercised by this domain are:

- `refunds.read`
- `refunds.create`
- `refunds.pay`
- `refunds.cancel`
- `adjustments.read`
- `adjustments.create`

A future-institution bootstrap trigger attaches the permissions introduced by `0013` only to `ADMIN` and `SUPER_ADMIN`, preserving the existing least-privilege model.

Real-runtime coverage uses a real approved resident session to verify permission-specific `403` denial for all six privileged refund/adjustment operations.

## Clean-D1 invariant verification

`scripts/verify-refunds-adjustments-local.mjs` is part of the mandatory `db:verify:local` chain and owns the exact current 55-permission / 138-grant checkpoint.

The clean verifier proves:

- refund/refund-transaction/adjustment/reference-sequence schema availability
- ten financial guard triggers
- integer-money enforcement
- immutable adjustment evidence
- least-privilege role grants
- future-institution refund/adjustment RBAC bootstrap presence

Wrangler local D1 does not accept an explicit SQL `BEGIN` in this verification path. The immutability probe therefore uses one atomic multi-row UPSERT statement whose conflicting row reaches the adjustment UPDATE trigger. SQLite rolls the whole statement back when the trigger aborts, proving the database rule without leaving probe data behind.

Older Payments/Expenses/Funds verifiers retain their exact domain assertions but treat their historical global RBAC counts as checkpoint minimums. The current Refunds/adjustments verifier owns the exact present-day global baseline so legitimate later permission growth does not falsely invalidate previously verified finance domains.

## Runtime lifecycle verification

The dedicated real-D1 test is deliberately named `zz-refunds-adjustments.spec.ts` so immutable refund payout evidence is created after earlier shared-D1 finance tests have completed.

The test is self-contained. It:

1. registers a dedicated resident through the real public registration flow
2. verifies the resident's email and receives administrator approval
3. logs in as that resident
4. creates a real unlinked ₹5,000 resident Payment
5. has an administrator approve that Payment
6. creates a ₹3,000 durable refund obligation
7. proves a further ₹2,500 reservation is rejected because only ₹2,000 is unreserved
8. pays ₹1,000, verifies `PARTIALLY_PAID`, and proves payout idempotency
9. proves a partially paid obligation cannot be cancelled
10. pays the remaining ₹2,000 and verifies `COMPLETED`
11. verifies two canonical `REFUNDED` Payment rows totaling ₹3,000
12. creates and cancels a fresh ₹500 obligation
13. then successfully reserves the full remaining ₹2,000, proving cancellation released the reservation
14. creates and replays the immutable `-₹25` Expense adjustment
15. proves the seeded approved Expense was not rewritten
16. proves resident denial for all six refund/adjustment permissions

## Test-isolation corrections discovered by the gate

Two failed runtime attempts exposed test assumptions rather than production accounting defects.

First, the test initially assumed Riya Sen owned the deterministic ₹5,000 approved credit. Clean D1 correctly showed that canonical historical payment belongs to Arjun Rao, and resident-scoped `availableCredit()` correctly refused a Riya refund. The test was rewritten to create and approve its own dedicated resident credit instead of weakening the backend calculation.

Second, that dedicated resident initially reused phone `+919876540620`, already owned by the Expenses runtime resident. Registration correctly rejected the duplicate. The refund lifecycle test now uses its own unique phone `+919876540631`.

Both corrections strengthened test isolation. No production accounting rule was relaxed to make the suite pass.

## Frontend and visual regression

The existing golden-master finance UI remains visually preserved. This domain primarily completes the accounting/API contracts underneath the imported UI while the complete Phase 02 visual regression suite continues to pass.

No fake production balance or refund fixture was introduced to satisfy runtime behavior.

## Closure

Refunds/adjustments implementation is VERIFIED at `8c13b08c2f2087e8cbc4035a53ec4de8ce9825b6` with implementation CI run `33312728702` fully green.

Formal project-record closure is contingent on the CI run for the latest documentation head remaining fully green. The next domain must be selected from the audited project plan/source inventory rather than inferred from UI order alone.
