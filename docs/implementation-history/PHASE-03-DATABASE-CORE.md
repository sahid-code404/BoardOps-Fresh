# Phase 03 — Database Core

## Scope
Phase 03 establishes the first real BoardOps D1 domain foundation without starting Phase 04 session/OTP authentication or later accounting modules.

## Source files reviewed
- `BoardOpsv2rewrite/prisma/schema.prisma`
- `docs/source-audit/DATABASE-INVENTORY.md`
- `docs/source-audit/MIGRATION-MAP.md`
- production rewrite master specification sections 32–46 and Phase 03.

## Existing problems discovered
- Phase 00 had only `_runtime_probe`; no real domain schema existed yet.
- Root Wrangler commands and the API Vite dev server could persist local Cloudflare state in different working-directory locations, risking a migrated database that the running Worker did not actually use.
- Local seed data had no institution, period, identity, audit or idempotency foundation.

## Architecture decisions
- D1 remains the authoritative relational store.
- Released migration `0001_runtime.sql` remains untouched; Phase 03 is added as immutable `0002_database_core.sql`.
- Core identity rows exist now so audit/idempotency records can reference actors, but secure sessions, OTP, registration review and password-reset behavior remain Phase 04.
- The source `role` string is retained only as compatibility data. Phase 05 will own permission authorization.
- Audit events are append-only and database triggers reject UPDATE/DELETE.
- Idempotency records are scoped by institution + operation scope + idempotency key and include request hashes and expiry.
- Local Wrangler and Vite use one repository-level `.wrangler/state` persistence directory.

## Files added
- `migrations/0002_database_core.sql`
- `scripts/reset-local-db.mjs`
- `scripts/verify-local-db.mjs`

## Files changed
- `scripts/seed-local.sql`
- `package.json`
- `services/api/vite.config.ts`
- `services/api/src/index.ts`
- `services/api/src/index.test.ts`
- `.github/workflows/ci.yml`
- `docs/implementation-history/CHANGELOG.md`

## Files removed
None.

## Database changes
Added:
- institutions
- accounting periods
- core user identities
- idempotency keys
- immutable audit events
- outbox events
- required unique/check/foreign-key constraints and query indexes

No payment, expense, ledger, bill, snapshot or monthly-close tables are introduced prematurely.

## Local reset and bootstrap
`pnpm db:reset:local` deletes the local D1 state, reapplies all immutable migrations, seeds deterministic local development data and runs database invariant checks.

The local development bootstrap contains a fake admin and two fake resident identities. It contains no copied production/user data.

## API changes
`/api/ready` now fails closed unless all Phase 03 core tables exist and reports schema marker `phase03-core` on success.

## Business-rule changes
None of the later financial workflows are implemented in this phase.

## UI/UX changes
None. The BoardOps golden-master frontend remains unchanged.

## Animation/design changes
None.

## Performance optimizations
Indexes were added for common period/status, user/status, idempotency expiry, audit lookup and outbox delivery paths.

## Memory optimizations
No new long-lived in-memory caches were introduced.

## Security changes
- audit rows are immutable at the SQLite/D1 boundary
- foreign keys are enabled
- core statuses are check-constrained
- local admin password is stored only as a PBKDF2-SHA256 development hash, never plaintext in D1
- credentials are explicitly local-development-only

## Tests added
- readiness succeeds only with the complete core schema
- readiness fails closed if a required core table is missing
- CI performs a fresh local D1 reset/migrate/seed/verify before starting the Worker
- local database verification asserts institution, periods, identities, seeded admin and audit foundation

## Local verification
Verified in CI run `33262977660`: a clean local D1 was deleted, migrations were reapplied, deterministic seed data was inserted, invariants were checked, and the Worker successfully started against the same persisted D1 state. `/api/health` and `/api/ready` both passed.

## CI verification
Run `33262977660` passed frozen dependency install, TypeScript, unit tests, production builds, clean local D1 reset/migrate/seed/verify, Worker health/readiness, frontend startup, and the Phase 02 Playwright visual/navigation regression suite on commit `287742541e98138d279ecdf99febf83d4f5589f9`.

## Known limitations
- Phase 04 authentication is not implemented yet; the seeded admin credential is reserved for the next phase and is not yet a real login guarantee.
- Domain seed data for meals/payments/expenses/purchases/billing will be added only when their owning migrations exist.

## Deferred work
Phase 04 — secure authentication backend while preserving the existing auth UI.

## Exit criteria
Phase exit requires frozen install, TypeScript, tests, build, clean D1 reset/migrations/seed/invariant verification, Worker startup, `/api/health`, `/api/ready`, and regression visual smoke.

## Final status
VERIFIED
