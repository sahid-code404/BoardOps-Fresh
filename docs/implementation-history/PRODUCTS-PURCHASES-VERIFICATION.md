# Products / Purchases Verification

Verified: 2026-08-31  
Status: implementation VERIFIED at `46ac0357a9af26909e47084153466acd5cb1e7b3`; formal project-record closure pending documentation-head CI

## Scope verified

- Products / Purchases now has one canonical institution-scoped procurement model in D1: `units`, `products`, `purchases`, and `purchase_items`.
- Each approved Purchase owns exactly one linked canonical Expense. The Expense row remains the lifecycle/accounting authority, so Procurement does not create a second mutable expense ledger.
- Purchase creation is idempotency-key protected, validates an OPEN accounting period, computes totals server-side, stores integer minor-unit money and scaled integer quantities, and creates the linked Expense, Purchase, Purchase Items, and audit evidence in one D1 batch.
- Purchase and item financial evidence is immutable and cannot be hard-deleted. Operational delete/restore uses the linked Expense recovery lifecycle rather than rewriting historical purchase facts.
- Product/unit catalogs are institution-scoped; products are archived rather than deleted and units are deactivated rather than deleted.
- Six fail-closed Procurement permissions are owned by this checkpoint: `products.read`, `products.write`, `purchases.read`, `purchases.create`, `purchases.delete`, and `purchases.restore`.
- Admin and Super Admin receive all six Procurement permissions, including future-role bootstrap. Manager and Resident/User receive none.
- The `/expenses` surface remains the recognizable source-compatible hub while exposing permission-aware Expenses, Purchases, and Products tabs. Worker-resolved permissions decide whether Procurement tabs are available; UI visibility is not the authorization boundary.
- Reports and deterministic CSV export consume canonical Purchase evidence. Purchases remain an analytical subset of canonical Expenses and are not added a second time to accounting totals.
- Deterministic clean-D1 verification, real-runtime Playwright, and visual Playwright coverage exercise schema integrity, idempotency, linked accounting, lifecycle, reports/export integration, least privilege, and the Procurement UI contract.

## Evidence

- Implementation verification head: `46ac0357a9af26909e47084153466acd5cb1e7b3`.
- CI run `33345403685` completed successfully and passed deterministic lockfile validation, frozen dependency installation, TypeScript, unit tests, production builds, clean local D1 reset/migration/seed/invariant verification through all 23 migrations, Worker/API readiness smoke, frontend smoke, runtime smoke, and visual smoke.
- Clean-D1 Products / Purchases verification owns the current **96 permissions / 234 role grants** baseline and proves:
  - 4 Procurement tables,
  - 12 Procurement guards,
  - 1 future-role bootstrap trigger,
  - exactly 6 Procurement permissions,
  - Admin 6 / Super Admin 6 / non-admin 0 Procurement permissions,
  - 4 deterministic units,
  - 3 deterministic products,
  - 0 seeded purchases so runtime creation remains real evidence rather than a pre-baked accounting fixture.
- Real-D1 Playwright runtime: **29/29 passed**. The dedicated Procurement scenario proves catalog reads, creation of a ₹600 two-item Purchase, idempotent replay to the same Purchase/Expense linkage, purchase listing/stats, Purchase and Financial reports, deterministic CSV evidence, linked Expense integrity, delete/restore lifecycle, live authenticated Procurement tabs, Resident permission-specific denial, and self-contained fixture cleanup.
- The runtime purchase uses `Runtime Procurement Market`, 5 kg Rice at ₹60 and 2 litres Cooking Oil at ₹150, producing exactly ₹600. The linked Expense is `Purchase · Runtime Procurement Market`, category `PURCHASE`, amount ₹600, and status `APPROVED`.
- Runtime statistics prove one ₹600 purchase and Rice spend of ₹300; the Purchase report proves one purchase, two items, ₹600 total spend, and the same vendor/product evidence. The Financial report separately exposes ₹600 of purchase analytics without creating another accounting ledger.
- Visual Playwright: **55/55 passed**, including the dedicated three-tab Procurement hub scenario and the Reports purchase-evidence fixture, plus the complete phone/tablet/desktop/theme route matrix.

## Accounting and authorization invariants

- Canonical financial authority remains `expenses`; `purchases` adds immutable procurement detail linked one-to-one to the approved Expense.
- A Purchase cannot be inserted unless its linked Expense is institution-matched, `APPROVED`, category `PURCHASE`, unpurged, same currency, same vendor/payee, and exactly the same integer minor-unit amount.
- The declared item count is bounded and guarded; inserted item totals must equal the Purchase total when the declared item set is complete.
- Purchase and Purchase Item monetary/scaled quantity fields must be stored as integers; floating or fractional storage cannot bypass the D1 guards.
- Purchase content and item history cannot be updated or hard-deleted after creation.
- Product references and Purchase Item rows must remain inside the same institution boundary.
- Product hard delete and Unit hard delete are blocked; catalog retirement uses archive/deactivation semantics.
- The Worker remains authoritative for all six Procurement permissions. Resident/User direct API requests fail closed with permission-specific `403` responses.
- Reports derive from canonical Purchase/Expense evidence; a Purchase is not added again to canonical Expense totals.

## Source behavior re-opened before implementation

The golden product contained recognizable Products/Purchases behavior inside its billing/expense experience, but its persistence and accounting assumptions could not be copied as a second mutable financial source. The rebuilt implementation preserves the recognizable Procurement workflow while making D1-linked Expense evidence, immutable Purchase detail, idempotency, integer money, institution scope, and explicit RBAC authoritative.

## What changed

1. Added immutable migration `0023_products_purchases.sql` with `units`, `products`, `purchases`, `purchase_items`, indexes, integrity guards, six Procurement permissions, Admin/Super Admin grants, and future-role bootstrap.
2. Added Worker-owned Product, Unit, and Purchase APIs with server-side validation, idempotent Purchase creation, linked canonical Expense creation, and recoverable delete/restore behavior.
3. Integrated canonical Purchase evidence into Purchase reports, Financial report purchase analytics, and deterministic CSV export without double-counting Expenses.
4. Expanded the existing `/expenses` surface into a permission-aware three-tab Procurement hub while preserving the recognizable Expenses/Purchases/Products workflow.
5. Added deterministic Procurement seed/verifier coverage, real-D1 runtime coverage, and a dedicated Procurement visual scenario.
6. Updated visual Reports fixtures/assertions so the UI reflects the real ₹600 Procurement fixture instead of claiming zero purchases while Procurement evidence exists.

## What was deliberately not changed

- No production deployment was performed.
- The golden repository remained read-only.
- No second mutable expense, balance, or procurement accounting ledger was introduced.
- Existing canonical Expense, Payment, Bill, Refund, Adjustment, Monthly Closing, or Report ownership was not replaced.
- Manager or Resident/User was not granted Procurement administration or read access merely to satisfy UI parity.
- No permission, accounting-period, idempotency, integer-money, institution-scope, immutability, or recovery rule was weakened to make CI pass.

## Hardening during verification

1. The first local Procurement verifier attempted explicit `BEGIN TRANSACTION`. Wrangler local D1 rejects explicit transaction statements, so the verifier was made side-effect free while the real create/idempotency/lifecycle proof remains in the runtime suite. Production Purchase creation continues to use one atomic D1 batch.
2. The initial hub treated access to Expenses as sufficient to expose Products and Purchases. The tabs were changed to consume the Worker-resolved permission set so each Procurement capability fails closed independently.
3. The Reports visual fixture still described zero purchases while the Procurement fixture contained a real ₹600 purchase. The fixture and assertions were aligned so visual CI cannot mask a Reports/Procurement contract mismatch.
4. A dedicated Procurement visual test was added, increasing visual coverage from 54 to **55 tests** and directly exercising Expenses, Purchases, and Products tabs.
5. Runtime UI assertions were aligned to the actual accessible contract: ARIA `tab` controls plus the headings `Purchases & Shopping` and `Product Catalog`.
6. CI run `33344797092` at `a4755783d82dcc6ff089c730999c32475df46243` passed verify and **55/55 visual**; **28/29 runtime** passed. Every Procurement API/accounting assertion succeeded, but the UI assertion exposed a harness-only assumption that an APIRequestContext login automatically bootstraps frontend browser session state.
7. Final commit `46ac0357a9af26909e47084153466acd5cb1e7b3` changed only the runtime browser setup to sign in through the real UI before checking Procurement tabs. The resulting CI run `33345403685` passed **29/29 runtime** and **55/55 visual**.
8. No production accounting, RBAC, session, idempotency, report, or immutability rule was relaxed during verification.

## Verification summary

- Implementation CI: `33345403685`
- Implementation head: `46ac0357a9af26909e47084153466acd5cb1e7b3`
- Migrations: 23
- RBAC baseline: **96 permissions / 234 grants**
- Procurement tables: 4
- Procurement guards: 12
- Procurement bootstrap triggers: 1
- Owned Procurement permissions: 6
- Admin / Super Admin / non-admin Procurement grants: **6 / 6 / 0**
- Runtime: **29/29 passed**
- Visual: **55/55 passed**
- Result: **VERIFIED**

## Current ownership state

Products / Purchases now owns the institution-scoped Product/Unit catalog, immutable Purchase and Purchase Item detail, idempotent linked-Expense Purchase creation, recoverable Purchase lifecycle, Procurement analytics/export evidence, and the permission-aware Procurement hub. Canonical accounting authority remains with Expenses and the already-verified financial domains.

## Formal checkpoint closure

Implementation verification is complete. Formal project-record closure requires the final documentation-head CI run to remain fully green after this verification record, the feature-parity matrix, and the changelog are updated.

## Deployment state

No production deployment was performed. The golden repository was not modified.