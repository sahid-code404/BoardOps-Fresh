# PHASE 02 — Exact Frontend Golden-Master Port

## Objective
Port the audited BoardOps client UI from `sahid-code404/BoardOpsv2rewrite` commit `77f3dec3b264c42904207f27c5f008b33c03b868` into the React/Vite target without redesigning it.

## Current status
IN PROGRESS — GENERATED PORT PRESENT, POST-PIN VERIFICATION RUNNING.

The port workflow checks out the golden master read-only at the audited commit, copies the client component/store/provider/hook tree, preserves the original global CSS/design tokens and public assets, resolves the client-side `@/lib/*` dependency closure, and provides only minimal compatibility adapters for browser-facing Next helpers (`next/link`, `next/navigation`, `next/image`, `next/dynamic`).

The generated frontend port is committed in the target. The target remains React/Vite. Next.js, Prisma and the source backend are not migrated into the target.

The imported client now passes strict TypeScript and the existing unit test gate. A production-bundle incompatibility was then isolated to Framer Motion 12.23.x resolving a newer incompatible `motion-dom` runtime. The workspace now pins the matching Motion 12.23 runtime family and the deterministic pnpm lockfile has been refreshed. A full frozen-install/typecheck/test/build/runtime verification run is required on this post-pin state before this phase can be called test-ready.

Server-only Prisma helpers accidentally pulled into the browser dependency closure were removed from the Vite client; only their browser-safe countdown helpers remain. The corresponding persistence lifecycle behavior belongs in the Cloudflare Worker/domain phases, not in the browser bundle.

## Verification gate
Do not declare this phase test-ready until frozen install, TypeScript, unit tests, Vite build, local Worker/D1 smoke, and user-facing frontend startup are green after the generated port commit. Visual screenshot coverage must then be added for the required viewport/theme matrix.

`NOT READY — CONTINUE FIXING`
