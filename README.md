# BoardOps

Production rewrite of BoardOps with the existing BoardOps frontend as the visual and behavioral golden master.

- Source / golden master: `sahid-code404/BoardOpsv2rewrite` — **read only**
- Target repository: `sahid-code404/BoardOps-Fresh`
- Frontend: React + Vite + TypeScript
- Backend: Cloudflare Workers + Hono
- Database: Cloudflare D1 with explicit SQL migrations
- Files: Cloudflare R2
- Background work: Cloudflare Queues / Workflows where appropriate

## Current rewrite gate

Only **Phase 00 (Governance + Foundation)** and **Phase 01 (Complete Source Audit)** are allowed before the Phase 01 findings are reviewed. Phase 02 frontend porting must not start early.

The rewrite must preserve BoardOps visual identity, navigation, animation language, glass/blur effects, iconography, responsive behavior, and feature depth while correcting implementation, accounting, security, performance, and maintainability problems.
