# Changelog

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
