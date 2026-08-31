# Residents / Users Verification Checkpoint

Date: 2026-08-31

## Closure rule

This verification record is intentionally included in the same acceptance candidate as the implementation, migration and tests so Residents / Users needs only one final full CI pass. The checkpoint is formally **CLOSED + VERIFIED only when CI for the exact candidate head succeeds** across prepare, verify, visual-smoke and runtime-smoke. The resulting run ID is reported in the final closure response rather than requiring a second documentation-only commit.

No production deployment is part of this checkpoint.

## Scope completed

Residents / Users now covers the complete current golden management surface:

- institution-scoped user listing and registration review
- approve / request changes / reject workflows
- status changes and role assignment through canonical permission RBAC
- administrator profile edits with durable user notification delivery
- seven-day deletion recovery semantics
- immediate session revocation when deletion is scheduled
- restore without reviving revoked sessions
- last-active-administrator protection
- User 360 composite resident view

The existing shared password-mutation middleware remains the one password-policy authority. User routes do not duplicate it.

## Authorization

The current canonical global RBAC baseline remains:

- permissions: **98**
- role-permission grants: **242**
- Residents / Users permissions: **9**
- Admin Residents / Users permissions: **9**
- Super Admin Residents / Users permissions: **9**
- Manager Residents / Users permissions: **0**
- Resident/User administrative Residents / Users permissions: **0**

The nine permissions are:

- `users.read`
- `users.approve`
- `users.request_changes`
- `users.reject`
- `users.status_change`
- `users.role_assign`
- `users.update`
- `users.delete`
- `users.restore`

`GET /api/users/:id/360` is protected by `users.read`, so the composite resident view does not create a side channel around the existing user-administration boundary.

## User lifecycle hardening

The verified candidate preserves the intended seven-day recovery workflow.

Scheduling deletion:

- records a recovery deadline seven days in the future
- does not allow a duplicate delete request to reset that window
- revokes the resident's current sessions immediately
- leaves durable resident/accounting history intact

Restoring the user clears the scheduled-deletion state but does not resurrect revoked sessions. The resident must authenticate again.

A full-form administrator edit that resubmits the unchanged email address keeps `email_verified` intact. An actual email-address change remains fail-closed and requires verification again.

Lifecycle/review notifications produced by existing D1 triggers remain authoritative. The route adds explicit notification delivery only for administrator profile edits, which have no lifecycle trigger.

## Canonical Resident 360 read model

The former Phase-05 placeholder returned real profile/login data but falsely reported Funds, Bills, Payments, Refunds, Ledger, Meals and Restrictions as unavailable. That placeholder has been replaced with a tenant-scoped composite D1 read model.

The endpoint now reads or derives:

- profile and recent sign-ins
- resident fund summary
- recent bills
- recent payments
- recent refund obligations
- resident ledger history
- current-month meal activity
- restriction evaluation and active restriction evidence

No duplicate mutable financial balance is introduced. The fund summary and resident ledger are derived from the already-verified canonical Bills, Payments and Refund evidence, consistent with the Funds architecture.

The ledger is a read model over canonical events:

- approved Payment → `DEPOSIT`
- refund payout Payment → `REFUND`
- generated/non-void Bill → `BILL_SETTLEMENT`

Running balances are calculated in the query using SQLite window aggregation; there is no new mutable ledger table.

## Restriction parity

Migration `0026_resident_restrictions.sql` adds the previously missing durable restriction evidence table with institution/user scope, financial/administrative type, automatic/manual source, lifecycle status, application/expiry metadata and lift metadata.

The User 360 restriction evaluation preserves the golden low-balance policy contract:

- default required balance: **₹1,000**
- default grace period: **2 days**
- optional overrides can come from the existing Variables domain using:
  - `policy.lowBalance.enabled`
  - `policy.lowBalance.graceDays`
  - `policy.lowBalance.requiredBalance`
- active financial or administrative restriction evidence is surfaced in User 360
- manual financial exemption evidence is recognized
- a low-balance resident with outstanding due and no active restriction receives the grace-state evaluation

No unused mutation API was invented: the frozen source exposes the evaluation inside Resident 360, while its restriction mutation helpers are not connected to a separate route. The Fresh checkpoint therefore adds the durable model and the source-visible evaluation surface without broadening the public API.

## D1 invariant verification

`scripts/verify-users-local.mjs` remains part of `db:verify:local` and now additionally proves:

- canonical User 360 source tables exist: Bills, Payments, Refunds, Meal Entries and Restrictions
- the complete restriction evidence shape exists
- both restriction indexes exist
- deterministic Riya meal evidence is available
- deterministic Arjun Bill + Payment finance evidence is available
- no fake active restriction row is required to make the default evaluation pass

This checkpoint adds migration **0026**, taking the immutable migration chain from 25 to **26 migrations**.

## Runtime verification

`tests/runtime-e2e/residents-users.spec.ts` proves the real user-management lifecycle, including registration, verification, approval, password-policy enforcement, administrator edit, durable notification delivery, seven-day deletion, session revocation, restore and cleanup.

`tests/runtime-e2e/user-360.spec.ts` now proves the composite contract against real D1 data rather than placeholders:

- Riya Sen has real profile, meal, fund and restriction evaluation data
- Riya's empty finance histories render as valid empty canonical domains, not "schema unavailable"
- Arjun Rao's deterministic historical Bill and Payments hydrate real finance values
- Arjun's derived fund state is overdue while the restriction engine correctly reports the two-day low-balance grace state
- the derived ledger contains the canonical deposit and bill-settlement events
- every User 360 request remains successful and institution scoped

## Visual verification

The User 360 visual fixture now mirrors the hydrated contract rather than the retired Phase-05 placeholder. Visual coverage traverses:

- Resident Fund Account
- meal activity
- meal-booking restriction state
- Bills
- Payments and Refunds
- Ledger
- Restrictions

The existing Residents / Users visual test also retains the golden Request Changes and seven-day Deletion Queue workflows.

## Acceptance expectation

The exact final candidate must pass the repository's complete gate:

- deterministic lockfile validation
- frozen install
- TypeScript typecheck
- unit tests
- production build
- clean local D1 reset
- all **26 migrations**
- complete D1 verifier chain
- Worker/API smoke
- frontend smoke
- complete real-D1 Playwright runtime suite
- complete visual regression suite

Only after those jobs are green is the Residents / Users row formally closed and the complete feature parity matrix considered verified.
