# Changelog

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
