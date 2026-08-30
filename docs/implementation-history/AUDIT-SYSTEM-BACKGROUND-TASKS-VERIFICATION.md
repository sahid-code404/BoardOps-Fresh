# Audit / System / Background Tasks Verification

Verified: 2026-08-31  
Status: implementation VERIFIED at `56e7faeebe22df01cdbb786b9cc0f8dfd85adb59`; formal project-record closure pending documentation-head CI

## Scope verified

- The existing append-only `audit_events` table remains the single canonical audit authority. No second audit ledger was introduced.
- Immutable D1 `background_tasks` history records Workers-native asynchronous operations with guarded lifecycle transitions and no hard delete.
- Five fail-closed permissions are owned by this checkpoint: `tasks.read`, `tasks.create`, `tasks.cancel`, `tasks.cleanup`, and `system.backup`. Only Admin and Super Admin receive them, including future-role bootstrap.
- `/api/audit-logs`, `/api/tasks`, task reads/cancellation, cleanup, and `/api/system/backup` are institution-scoped and permission-protected.
- Worker execution is asynchronous through `executionCtx.waitUntil(...)`; request completion does not become a second synchronous job engine.
- Session cleanup is institution-scoped and removes only expired/revoked session evidence eligible for cleanup.
- System backup creates a private R2 logical D1 snapshot using an explicit application-owned table manifest and removes authentication secret material before storage.
- Generic System task dispatch does not duplicate Monthly Closing, Billing, Reports, or other canonical domain execution paths. The generic endpoint currently dispatches only `SESSION_CLEANUP` and `SYSTEM_BACKUP`.
- The System UI preserves the audited Audit Log / Background Tasks / Data Export surface while using queued cleanup and Workers-native backup operations.
- Deterministic seed/verification and real-D1 browser coverage exercise the D1, RBAC, task, backup, and System UI contracts.

## Evidence

- Implementation verification head: `56e7faeebe22df01cdbb786b9cc0f8dfd85adb59`.
- CI run `33338230610` passed deterministic lockfile validation, frozen dependency installation, TypeScript, unit tests, production builds, clean local D1 reset/migration/seed/invariant verification through all 21 migrations, Worker/API readiness smoke, frontend smoke, runtime smoke, and visual smoke.
- Clean-D1 verification owns the current **90 permissions / 222 role grants** baseline and proves:
  - 1 `background_tasks` table,
  - 3 task lifecycle/history guards,
  - 2 existing audit immutability guards,
  - 1 audit action index,
  - 1 future-role bootstrap trigger,
  - exactly 5 Audit/System task permissions,
  - Admin 5 / Super Admin 5 / non-admin 0 task permissions,
  - Admin/Super Admin `audit.read` and non-admin 0 `audit.read`,
  - 2 deterministic task fixtures, including completed cleanup and queued backup evidence,
  - deterministic System audit evidence.
- Real-D1 Playwright runtime: **27/27 passed**. The Audit/System scenario proves filtered/searchable audit reads, task listing/filter/get, queued task cancellation, asynchronous cleanup completion, generic rejection of `MONTHLY_CLOSING`, asynchronous backup completion, backup evidence, Resident least privilege, and authenticated System UI rendering.
- Backup runtime proof requires a non-empty private R2 object key, positive byte/row/table counts, SHA-256 evidence, and `redacted: true`.
- Visual Playwright: **54/54 passed**, including the `/system` internal-tab contract and the complete phone/tablet/desktop/theme route matrix.

## Constraints and implications

- `audit_events` remains the canonical append-only audit authority. `background_tasks` is operational task history/state, not an audit replacement.
- Terminal task rows are immutable and task history cannot be hard-deleted.
- Only `SESSION_CLEANUP` and `SYSTEM_BACKUP` are dispatchable through the generic System task endpoint. Domain-owned workflows must continue to use their canonical owning modules.
- The logical-backup table manifest is intentionally application-owned. A migration that adds institution-owned persistent data must update the backup manifest in the same owning change when that data belongs in System backup.
- The global `permissions` catalog is not copied as institution-owned backup data; role grants are institution-scoped through roles.
- Backup redaction removes `users.password_hash`, `user_sessions.token_digest`, `auth_challenges.secret_hash`, and `idempotency_keys.request_hash`.
- Backup objects are private R2 JSON objects; this checkpoint does not introduce public backup URLs or expose authentication secret material.

## Source behavior re-opened before implementation

The golden System surface already contained Audit Log, Background Tasks, and Data Export concepts, but its operational backend behavior could not be copied blindly. The implementation therefore preserved the recognizable UI/workflow contract while replacing unsafe or platform-inappropriate internals with D1/R2/Workers-native boundaries.

## What changed

1. Added immutable migration `0021_audit_system_background_tasks.sql` for durable task history, task guards, task permissions, and future-role bootstrap.
2. Added Worker-owned Audit/System routes and task engine execution.
3. Added institution-scoped session cleanup and private R2 logical D1 backup execution.
4. Updated System UI actions to queue cleanup and backup work rather than pretending long-running work completed synchronously.
5. Added deterministic Audit/System seed and D1 verifier coverage.
6. Added real-D1 Playwright coverage for RBAC, task lifecycle, cleanup, backup evidence, canonical-domain task rejection, and System UI rendering.

## What was deliberately not changed

- No production deployment was performed.
- The golden repository remained read-only.
- Existing `audit_events` authority was not replaced or duplicated.
- Monthly Closing, Billing, Reports, Notifications, or other verified domain execution paths were not moved into the generic task engine.
- No public backup delivery surface or raw authentication-secret export was added.

## Hardening during verification

1. The initial implementation exposed one TypeScript `exactOptionalPropertyTypes` mismatch. Commit `039c623cab037fd48939d322bfe9f3db1ebca543` corrected the payload typing without changing behavior.
2. Real-runtime testing exposed session-test isolation leakage; the cleanup proof was made institution/session isolated without weakening session revocation or cleanup semantics.
3. Commit `c7e8c22945aeffcde8e117f3863eca02d9def15a` made the runtime harness surface a background task's stored `errorMessage` immediately rather than hiding executor failures behind a timeout.
4. Commit `08a6febee62e472a085b386890480b9d7123ecde` hardened the R2 boundary to write the JSON string directly and require R2 write confirmation, avoiding local Miniflare/workerd `ArrayBufferView` transport differences while preserving exact UTF-8 size/hash evidence.
5. The next runtime run exposed a real D1 Worker compatibility defect: backup schema discovery through `sqlite_master` / `PRAGMA table_info` failed with `SQLITE_AUTH`. Commit `c3836d3426671b2063b41fbb1381ac7adb277479` removed schema introspection and replaced it with the explicit institution-owned backup manifest.
6. With backup execution then succeeding, the final failing assertion was harness-only: the UI decorates the `SYSTEM_CHECKPOINT` action badge, so an exact-text selector could not match it. Commit `56e7faeebe22df01cdbb786b9cc0f8dfd85adb59` changed only that selector to match the action inside the decorated badge.
7. No authorization, audit immutability, accounting, backup redaction, or domain-ownership rule was weakened to make CI pass.

## Verification summary

- Implementation CI: `33338230610`
- Implementation head: `56e7faeebe22df01cdbb786b9cc0f8dfd85adb59`
- Migrations: 21
- RBAC baseline: **90 permissions / 222 grants**
- Runtime: **27/27 passed**
- Visual: **54/54 passed**
- Result: **VERIFIED**

## Current ownership state

Audit / System / Background Tasks now owns durable task history, System task dispatch for cleanup/backup, private logical backup generation, and the existing audit read surface while `audit_events` remains canonical audit evidence.

## Formal checkpoint closure

Implementation verification is complete. Formal project-record closure requires the final documentation-head CI run to remain fully green after this verification record, the feature-parity matrix, and the changelog are updated.

## Deployment state

No production deployment was performed. The golden repository was not modified.