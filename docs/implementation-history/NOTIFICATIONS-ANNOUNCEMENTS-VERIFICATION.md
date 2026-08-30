# Notifications / Announcements Verification Checkpoint

Date: 2026-08-30

## Status

**IMPLEMENTATION VERIFIED — formal project-record closure pending documentation-head CI.**

Implementation verification head:

`18495eaf7139dc468effffd8386b07b7e5226692`

Implementation CI run:

`33325585962`

That implementation run passed deterministic lockfile validation, frozen dependency install, TypeScript typecheck, unit tests, production builds, a clean local D1 reset through all **18 immutable migrations**, deterministic seed/invariant verification, Worker readiness/API smoke, frontend smoke, **23/23 real-D1 Playwright runtime tests**, and **42/42 visual regression tests**.

No production deployment was performed.

## Scope and source-audit boundary

This checkpoint owns **Notifications / Announcements**.

The golden-master communication UX is preserved: personal notifications remain a self-scoped inbox with unread state and filters, while institution announcements retain audience, priority, pinning, expiry, and administrator publishing/archive controls.

The correction owned by this checkpoint is delivery reliability. Notification evidence must be durable and recipient-scoped, announcement publication must be replay-safe, and canonical domain-state changes that produce notifications must not rely on a second best-effort application write that can diverge from the owning D1 transaction.

## Durable communication model

Migration `0017_notifications_announcements.sql` adds two institution-scoped tables:

- `announcements`
- `notifications`

`announcements` preserves the source-facing communication fields while making published delivery evidence durable. Published `title`, `body`, `type`, `priority`, `target_audience`, and the original `published_at` timestamp become immutable. Published corrections therefore use archive + a new announcement rather than silently rewriting content that recipients already received.

Announcements cannot be physically deleted through normal D1 writes. Archive is the durable lifecycle operation.

`notifications` is the durable per-user inbox. Each row contains institution/user scope, content, severity/priority, optional route, read timestamp, source identity, and a stable delivery key.

After delivery, notification content/source identity is immutable and hard deletion is blocked. The only supported inbox mutation is `read_at`.

## Idempotent announcement fan-out

The authoritative replay boundary is:

`UNIQUE (institution_id, user_id, delivery_key)`

A published announcement fans out one delivery per eligible recipient using a stable delivery key. Re-running publication fan-out for the same announcement and recipient cannot create a second inbox row.

Audience filtering remains explicit:

- `ALL`
- `RESIDENTS`
- `ADMINS`

The runtime lifecycle deliberately replays fan-out after an already-published announcement receives a harmless pin-state update and proves the resident still has exactly one delivered notification.

Published delivery-bearing content cannot be edited. The runtime suite proves such a mutation returns `422`, preserving the already-delivered historical meaning.

## Transactional canonical domain-event delivery

Migration `0018_notification_event_delivery.sql` adds notification delivery directly at the D1 boundary for canonical domain transitions whose owning state is already stored in D1.

The transition and its inbox evidence therefore participate in the same SQLite transaction. Delivery uses stable event keys plus `INSERT OR IGNORE`, with the `0017` unique constraint as the replay/concurrency boundary.

The verifier owns exactly **11 event-delivery triggers**:

1. `notifications_leave_submitted`
2. `notifications_leave_decision`
3. `notifications_payment_submitted`
4. `notifications_payment_status`
5. `notifications_meal_override`
6. `notifications_refund_created`
7. `notifications_refund_transaction`
8. `notifications_refund_cancelled`
9. `notifications_registration_review`
10. `notifications_user_status`
11. `notifications_user_role`

This migration adds no new permissions and does not replace or weaken the already-verified Leave, Payment, meal, Refund, registration, user-status, or role state machines. It observes successful canonical state transitions and creates recipient inbox evidence atomically with them.

## Authorization baseline

The verified current RBAC baseline after this checkpoint is:

- **72 permissions**
- **178 deterministic role-permission grants**

The complete communication permission set is six permissions:

- `notifications.read_self`
- `notifications.mark_read_self`
- `announcements.read`
- `announcements.create`
- `announcements.update`
- `announcements.archive`

Role coverage is exactly:

- Admin: **6**
- Super Admin: **6**
- Manager: **3**
- Resident/User: **3**

Manager and Resident/User receive only the self-service/read communication surface and no announcement administration. Future-institution role bootstrap installs the same least-privilege baseline.

Every communication API operation is explicitly mapped at the fail-closed RBAC middleware boundary.

## Deterministic clean-D1 verification

`scripts/verify-notifications-local.mjs` is part of the mandatory clean `db:reset:local` verification chain.

The verifier owns the exact current communication baseline:

- 2 communication tables
- 7 communication durability/bootstrap guards
- 11 transactional event-delivery triggers
- 6 communication permissions
- Admin communication permissions: 6
- Super Admin communication permissions: 6
- Manager communication permissions: 3
- Resident communication permissions: 3
- 1 seeded announcement
- 1 seeded published announcement
- 4 deterministic notification rows
- 2 deterministic announcement deliveries
- 2 historical event deliveries
- both historical event deliveries marked read
- exactly 1 unread resident notice
- exactly 1 unread Admin notice
- 0 ineligible seeded deliveries

The verifier also actively proves enforcement rather than only checking schema names:

- duplicate recipient delivery keys are rejected
- delivered notification content cannot be rewritten
- notifications cannot be hard-deleted
- published announcement delivery content cannot be rewritten
- published timestamps cannot be replaced
- announcements cannot be hard-deleted
- `read_at` can change and the deterministic fixture can be restored afterward

## Deterministic communication fixture

The deterministic published fixture is `BoardOps local notice`.

It is a pinned `ALL`-audience announcement published at the fixed local timestamp `2026-08-30T12:00:00.000Z`. The seed provides one unread announcement delivery to the deterministic Admin and one to the active resident Riya.

Historical Leave and Payment submission notifications generated by the `0018` triggers are retained as durable evidence but marked read by the communication seed so unrelated shell/browser assertions retain a stable unread-count contract.

Inactive/deleted/ineligible identities receive no deterministic announcement delivery.

## Real-runtime lifecycle proof

The dedicated real-D1 runtime test uses actual cookie-backed Admin and Resident sessions and proves:

1. the resident begins with the deterministic `BoardOps local notice`
2. a newly created DRAFT announcement produces no resident delivery
3. DRAFT → PUBLISHED creates exactly one resident notification
4. replaying published fan-out through a harmless pin-state update still leaves exactly one notification
5. editing published delivery content is rejected with `422`
6. the resident can read the targeted published announcement
7. the resident receives permission-specific `403` denial for announcement create/update/archive
8. a real resident Leave submission creates an Admin `New leave application` notification
9. the Admin rejects the Leave and the resident receives exactly one `Leave rejected` notification
10. retrying the already-decided Leave returns `409` and does not redeliver
11. marking one notification read twice remains idempotent and decreases unread count exactly once
12. announcement archive is durable and replay-safe
13. archived announcements disappear from the resident feed while remaining queryable by Admin history
14. the real authenticated shell renders the same D1-backed Personal and Announcements surfaces

The resident proof reuses the deterministic active resident and has the Admin set a local-only test password. This avoids consuming another shared-IP email-verification challenge and keeps the serial runtime suite independent from unrelated registration rate limits.

## Browser harness hardening

The first dedicated runtime candidate authenticated the Admin through Playwright `BrowserContext.request` and later assumed that API request-context session would bootstrap a Vite browser page.

That assumption was not an application contract. Existing authenticated-shell coverage already established the supported browser path: sign in through the UI, allow `/api/auth/me` to validate the HttpOnly cookie, then navigate the mounted shell.

The final runtime test uses that proven UI sign-in flow. No communication, authorization, delivery, accounting, or domain-transition rule was weakened to make the test pass.

## Runtime and visual results

CI `33325585962` completed **23/23 real-D1 runtime tests green**. The new dedicated test is:

- `Notifications and Announcements use durable self-scoped idempotent delivery`

The same run completed **42/42 visual tests green**. Dedicated communication visual coverage verifies:

- authenticated live-shell navigation to Notifications
- Personal and Announcements tab semantics
- mark-all-read and inbox filter controls
- deterministic notification content
- announcement KPI surface
- New Announcement dialog
- title/message/type/priority/target/expiry/pinning controls
- Publish/Cancel affordances
- dialog dismissal
- no horizontal layout overflow

The full Phase 02 route/responsive/theme matrix also includes `/notifications`.

## Regression proof

Before the dedicated communication runtime/visual tests were added, CI `33325006713` at `c358ad37cadf0dd14042ccdbb3cc5c9bd298d14f` passed the complete pre-existing suite, including **22/22 real-D1 runtime tests** and the visual gate with `0018` active.

This separately proves the transactional notification triggers did not regress already-verified accounting, Formula, Monthly Closing, meals/kitchen, registration, session, user, or shell behavior.

## Closure condition

Notifications / Announcements implementation is **VERIFIED** at implementation head `18495eaf7139dc468effffd8386b07b7e5226692` with CI run `33325585962` fully green.

Formal project-record closure requires the documentation head containing this verification record, the feature-parity update, and the changelog entry to pass the same complete CI gate.

No production deployment was performed, and the golden repository remained read-only.
