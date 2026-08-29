# PHASE 00 — Governance + Foundation

## Objective
Establish a clean target repository and Cloudflare-native development/runtime foundation without inventing or approximating the BoardOps product UI.

## Source behavior inspected
The golden master was inspected for runtime architecture, frontend dependencies, global styling, navigation/state organization and persistence/backend shape so the target foundation would not accidentally dictate a redesign.

## Frontend behavior preserved
No replacement product frontend was created. `/` remains reserved for the Phase 02 golden-master port. Development-only status content exists only under `/dev`.

## Features preserved
Product features are represented in the Phase 01 feature-parity contract; no product feature was deleted or declared replaced in Phase 00.

## Problems found
- Initial pnpm 11 CI blocked unreviewed dependency build scripts.
- Initial web TypeScript configuration lacked Vite side-effect CSS import declarations.
- Wrangler 4.126.0 became incompatible with the current Cloudflare Vite plugin peer requirement.

## Bugs fixed
- Added explicit pnpm `allowBuilds` approval for `esbuild` and `workerd`.
- Added `vite-env.d.ts`.
- Updated Wrangler to 4.127.1 and regenerated the lockfile.
- Fixed the CI lockfile bootstrap gate so a new empty target can self-bootstrap deterministically.

## Architecture changes
- pnpm workspace
- React + Vite web application
- standalone Hono Cloudflare Worker API
- local D1 and R2 bindings
- strict TypeScript
- explicit SQL migration directory
- Vitest/Playwright foundations
- request-ID middleware plus `/api/health` and `/api/ready`
- CI with frozen install and real startup smoke tests

## Files added / modified / removed
Added root workspace configuration, `apps/web`, `services/api`, package boundary placeholders, migrations, scripts, CI, security policy and documentation structure. No golden-master source file was modified or removed.

## Database migrations
`0001_runtime.sql` creates only `_runtime_probe`. Business/domain tables intentionally wait for Phase 03 after the source audit and schema design are accepted.

## API changes
Foundation health/readiness endpoints only. No source business API was prematurely reimplemented.

## Accounting changes
No accounting implementation yet. Integer-money, immutable-ledger and snapshot-billing decisions are documented as target invariants.

## Security changes
Real env files, database files, backups, logs and user uploads are ignored/excluded. The target begins with backend request IDs and no production secrets.

## Performance / memory changes
The target starts as a lazy-capable workspace instead of importing source clutter. Product performance work waits for measured golden-master parity rather than removing glass/blur/motion.

## UI refinement / animation changes
None. No product UI redesign or approximation was permitted in Phase 00.

## Tests added
Worker health unit test, frozen dependency/typecheck/test/build gates, local D1 migration/seed checks, Worker health/readiness smoke and frontend startup smoke.

## Visual regression results
Not applicable yet; Phase 02 must first capture the actual source frontend baseline.

## Local verification
Verified in the GitHub Actions local-runtime environment: local D1 migration and seed succeeded; the Worker started with local bindings and returned successful health/readiness; the Vite frontend started and served its index.

## CI verification
Run `33259453876` passed all Phase 00 verification steps at commit `a67715dd4bb4b1898c5e5bd794e53861e5079f53`.

## Known limitations / deferred work
The real BoardOps product UI is intentionally absent until Phase 02. No visual approval should be requested against the development placeholder. Queues/Workflows and domain schema are added in the owning later phases.

## Exit criteria
Foundation install, typecheck, tests, build, local DB setup and local runtime smoke are green; source remains read-only; no redesign occurred.

## Status
VERIFIED — FOUNDATION ONLY.

`RUNNABLE — TEST NOW` applies only to the technical foundation smoke; do not treat `/dev` as BoardOps product UI.
