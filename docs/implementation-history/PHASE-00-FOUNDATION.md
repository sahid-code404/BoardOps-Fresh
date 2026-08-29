# PHASE 00 — Governance + Foundation

Objective: establish a clean target workspace and Cloudflare-native local runtime without inventing the BoardOps product UI.

Architecture changes: pnpm workspace; React/Vite frontend; standalone Hono Worker; local D1/R2 bindings; explicit migrations; strict TypeScript; CI; Playwright foundation.

Frontend behavior preserved: no user-facing BoardOps approximation was created. `/dev` contains development-only status text; `/` is reserved for the future golden-master port.

Database migrations: `0001_runtime.sql` is infrastructure-only. Domain tables intentionally wait for Phase 03.

Tests: Worker health unit test and CI smoke plan.

Local verification: unavailable in this execution environment because outbound package/network access and pnpm are unavailable here.

CI verification: pending the target repository's lockfile bootstrap run and subsequent frozen-install verification run.

Known limitation: Phase 00 is not considered verified until green CI confirms install, typecheck, test, build, local D1 migration/seed, Worker health/readiness and frontend startup.

Status: IMPLEMENTED / VERIFICATION PENDING.

NOT READY — CONTINUE FIXING
