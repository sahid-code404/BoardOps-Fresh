# Changelog

## 2026-08-29 — Phase 04 auth-core / blank-startup fix
- Real local testing exposed a cold-start race: the web Vite server became ready before the Worker, causing immediate `/api/*` proxy requests to fail with `ECONNREFUSED` while stale persisted auth state could still mount the shell.
- Added ordered local startup: root `pnpm dev` now starts the Worker first, waits for `/api/health`, then starts the web app.
- Added immutable `0003_auth_core.sql` for digested server sessions and persisted login history.
- Added PBKDF2-SHA256 password verification compatible with the deterministic local administrator seed.
- Added secure cookie-backed `/api/auth/login`, `/api/auth/me`, `/api/auth/logout`, session listing and session revocation.
- Raw session tokens are never stored in D1 and are never persisted in browser localStorage; the client stores only the non-secret `cookie-session` hint.
- Strengthened the frontend auth gate so stale persisted users cannot mount the authenticated shell before `/auth/me` validates the server session.
- Added short retry handling for transient auth bootstrap network failures and fail-closed handling for invalid sessions.
- CI auth smoke now checks wrong-password rejection, real seeded-admin login, cookie-backed `/auth/me`, and logout in addition to the existing D1/build/visual gates.
- Phase 04 remains IN PROGRESS: registration, verification OTP, password recovery and approval workflow are still deferred within the phase.

## 2026-08-29 — Phase 03 database core verified
- CI run `33262977660` passed frozen install, TypeScript, tests, builds, clean local D1 reset/migrate/seed/invariant verification, Worker health/readiness, frontend startup, and the existing Playwright visual/navigation regression suite.
- Phase 03 database core is verified at implementation commit `287742541e98138d279ecdf99febf83d4f5589f9`.
- Phase 04 secure authentication is the next owning phase; the deterministic local admin identity now exists in D1 but login behavior remains deliberately unclaimed until Phase 04 is implemented and verified.

## 2026-08-29 — Phase 03 database core implementation
- Added immutable `0002_database_core.sql` for institutions, accounting periods, core user identities, idempotency keys, immutable audit events, and outbox events.
- Added foreign keys, uniqueness/check constraints, and targeted indexes for D1 query paths.
- Added database-level triggers that reject UPDATE/DELETE on audit events.
- Added deterministic local development identities and a fake local administrator bootstrap account.
- Added `pnpm db:reset:local` and `pnpm db:verify:local` so local D1 can be destroyed/recreated and invariant-checked in one repeatable workflow.
- Unified Wrangler and Cloudflare Vite local persistence under the repository `.wrangler/state` path so migrations/seed and the running Worker see the same D1 database.
- Strengthened `/api/ready` so readiness fails closed when required Phase 03 tables are absent.
- CI now performs a clean local D1 reset/migrate/seed/verify before Worker startup.
- Phase 04 authentication remains deliberately deferred until the Phase 03 gate is green.

## 2026-08-29 — Phase 00/01 verification checkpoint
- Frozen dependency install is now deterministic through the generated `pnpm-lock.yaml`.
- Added the pnpm 11 `allowBuilds` policy for the reviewed `esbuild` and `workerd` install scripts required by Vite/Workers.
- Added Vite client type declarations for the web workspace.
- Updated Wrangler to 4.127.1 to satisfy the current Cloudflare Vite plugin peer requirement.
- CI run 33259453876 passed dependency install, TypeScript, tests, builds, local D1 migration/seed, Worker health/readiness, and frontend startup.
- Phase 00 foundation is runtime-verified. Phase 01 source-audit baseline is recorded. Phase 02 has not started.

## 2026-08-29 — Phase 00/01 initialization
- Initialized clean `BoardOps-Fresh` target.
- Established React/Vite and standalone Cloudflare Worker workspace skeleton.
- Added local D1/R2 bindings, infrastructure migration/seed and health/readiness endpoints.
- Added CI bootstrap/frozen-install verification path.
- Audited the read-only `BoardOpsv2rewrite` golden master and recorded frontend/domain/accounting/security/performance migration findings.
- No Phase 02 product frontend port and no production deployment performed.
