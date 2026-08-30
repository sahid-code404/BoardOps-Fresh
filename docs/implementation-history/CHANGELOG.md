# Changelog

## 2026-08-30 — Payments core implementation verified
- CI run `33306270289` passed deterministic lockfile validation, frozen install, TypeScript, unit tests, production builds, clean local D1 reset/migrate/seed/invariant verification, Worker/API smoke, the full real-D1 Playwright runtime suite, and the complete Phase 02 visual regression suite at implementation verification head `e3d5450ca146b92008025fcc3b0f31e9d3ec64d5`.
- Added immutable `0010_payments_core.sql` with canonical institution-scoped payments/refunds, integer minor-unit storage, explicit indexes/constraints, and D1 triggers that reject REAL/non-integer money values instead of trusting SQLite INTEGER affinity.
- Existing non-zero bill paid balances are migrated into deterministic approved payment evidence, while clean local resets seed equivalent canonical history after Billing fixtures so upgrade and clean-install paths preserve the same accounting authority.
- Payment approval/rejection/void/delete/restore recomputes bill paid/due state from canonical payment evidence. Approved amounts cannot be edited in place, repeated approval is idempotent, and restore preserves the exact pre-delete state rather than silently reactivating financial evidence.
- Resident payment submission is self-scoped and idempotency-key protected; major-unit input is validated to at most two decimals and converted to integer minor units before persistence.
- Refund handling only associates a refund with a bill when that bill contains sufficient overpayment, preventing unallocated resident credit refunds from incorrectly reopening a settled bill.
- Expanded fail-closed RBAC to 44 permissions / 114 deterministic role grants: Admin/Super Admin receive payment/refund administration, USER receives only `payments.read` + `payments.create`, and MANAGER receives read-only payment access.
- Clean-D1 verification proves canonical ₹5,000 historical payment evidence, the ₹2,500 pending lifecycle fixture, exact bill arithmetic, four integer-money enforcement triggers, and least-privilege grants.
- Real-runtime browser coverage proves the administrator payment lifecycle plus resident self-scope, ₹123.45 minor-unit conversion, idempotency replay, permission-specific mutation denial, and live-shell Payments UI rendering. No production deployment was performed.
- Payments implementation is VERIFIED. Formal checkpoint closure is contingent on the latest documentation-head CI run also remaining fully green.

## 2026-08-30 — Billing core implementation verified
- CI run `33304568070` passed deterministic lockfile validation, frozen install, TypeScript, unit tests, production builds, clean local D1 reset/migrate/seed/invariant verification, Worker/API smoke, real-D1 Playwright runtime smoke, and the complete Phase 02 visual regression suite at implementation verification head `a058e1983419b02a00b1977382dcd20bc17e582e`.
- Added immutable `0009_billing_core.sql` with immutable billing snapshots and bill records backed by integer minor-unit accounting fields, arithmetic constraints, targeted indexes, and snapshot/bill immutability enforcement.
- Bill generation is snapshot-driven and idempotent: rerunning a generated period does not re-price an existing bill, and generation is rejected when accounting-period/readiness conditions are not satisfied.
- Billing routes expose readiness, period bill reads/generation, explicit financial voiding, soft deletion, deletion-queue reads, and restoration while preserving historical financial state.
- The imported golden Billing UI keeps its visual/workflow behavior, but the legacy body-less DELETE used by its Void control is routed to the explicit financial void endpoint so void and soft delete remain distinct accounting actions.
- Billing RBAC is explicit and fail-closed: administrators receive billing mutations while resident/manager access remains read-only where required.
- Clean-D1 verification proves deterministic June/July snapshots, the seeded July bill, bill arithmetic, immutability triggers, and least-privilege Billing grants.
- Real-runtime browser coverage proves snapshot readiness, bill generation, idempotent regeneration, financial void, soft-delete/restore semantics, closed-period rejection, and visible real D1 Billing data. No production deployment was performed.
- Billing implementation is VERIFIED. Formal checkpoint closure is contingent on the latest documentation-head CI run also remaining fully green.

## 2026-08-30 — Phase 05 permission-based RBAC verified
- CI run `33298914080` passed deterministic lockfile validation, frozen install, TypeScript, unit tests, production builds, clean local D1 reset/migrate/seed/invariant verification, Worker/API smoke, real-D1 Playwright runtime smoke, and the complete Phase 02 visual regression suite at implementation verification head `aa7c5acbd759f88cf2c2f939a32b4d5b6cf3b1f2`.
- Added immutable `0005_rbac.sql` with institution-scoped roles, 18 canonical permissions, and explicit role-permission grants; `users.role` remains only the compatibility role key while D1 grants are authoritative for protected backend authorization.
- Added immutable `0006_rbac_institution_bootstrap.sql` so institutions created after the baseline migration automatically receive the canonical roles and least-privilege grants, including clean reset flows where migrations run before the deterministic seed.
- Added a canonical HttpOnly-cookie-only authorization principal and removed the remaining downstream bearer-session compatibility from protected Phase 04 route helpers.
- Added fail-closed `/api/*` RBAC middleware: every current protected route/action has an explicit permission mapping and an unmapped future endpoint or user action is rejected rather than accidentally becoming reachable.
- Residents retain required self-service and dashboard access but do not receive current audit/user-management grants; only Admin/Super Admin receive those permissions.
- Dashboard audit activity and the compatibility `isAdmin` field are permission-derived rather than hard-coded to an `ADMIN` role string.
- Clean-D1 readiness now requires the RBAC tables and baseline counts, and database verification explicitly proves the resident has `dashboard.read` but not `users.read`.
- Real-runtime RBAC coverage proves Admin allow, Resident permission-specific `403` deny, bearer-only replay rejection, and fail-closed rejection of an unmapped API route.
- The temporary guarded integration patch machinery was removed after the cookie-only/coarse-role cleanup landed. No production deployment was performed.
- Phase 05 implementation is VERIFIED. Formal phase closure is contingent on the latest documentation-head CI run also remaining fully green.

## 2026-08-30 — Phase 04 authentication core verified
- CI run `33297620321` passed deterministic lockfile validation, frozen install, TypeScript, unit tests, production builds, clean local D1 reset/migrate/seed verification, Worker/API smoke, real-D1 browser runtime smoke, and the complete Phase 02 visual regression suite at verification head `f04cc0f384f9083c1ba8bc9448ca1c3b24f5464b`.
- Added immutable `0003_auth_core.sql` and `0004_auth_workflows.sql` for digested server sessions, login history, registration-review cycles, and one-time authentication challenges.
- Authentication now uses opaque HttpOnly cookie sessions whose raw credentials are never stored in D1 or browser localStorage; account bootstrap waits for `/api/auth/me` before mounting the authenticated shell.
- Completed registration persistence, email verification, protected applicant status polling, administrator approval/reject/request-changes, correction resubmission, and mandatory email re-verification when the corrected address changes.
- Hardened the registration review state machine so pending users cannot bypass approval via generic activation, approvals cannot skip requested corrections, and rejected registrations cannot bypass rejection through the normal restore path.
- Added non-enumerating password recovery/reset with expiring challenges, shared password policy enforcement, and revocation of old sessions after reset.
- Suspending, deactivating, or archiving an account revokes its existing server sessions; browser coverage proves the pre-disable credential remains rejected even after account reactivation.
- Protected the last active administrator from disable/demotion operations that would strand the institution without an administrator.
- Completed real-runtime Profile security actions including active-session presentation/revocation, password change, audited profile mutation, and avatar R2 round-trip.
- Production auth-email delivery remains intentionally fail-closed until a real provider is configured; CI proves unavailable delivery does not create a partial registration mutation. Optional 2FA is not claimed by this phase.
- Phase 04 is closed as VERIFIED. Fine-grained permission-based backend RBAC remains Phase 05 work. No production deployment was performed.

## 2026-08-29 — Phase 02 frontend golden-master port verified
- CI run `33272421363` passed the frozen install, TypeScript, unit tests, production builds, clean D1 reset/migrate/seed verification, Worker smoke, real-D1 authenticated browser runtime smoke, and the complete Phase 02 visual browser gate at implementation head `3349f8c715ba3fee3891fa8117c7cf67bc20b3c5`.
- Canonical browser routes now cover every audited top-level golden-master view, with `/` canonicalized to `/dashboard`, browser Back/Forward synchronization, and guarded runtime route values.
- Route code splitting remains intact, but normal navigation preloads the destination before switching and cold authenticated direct routes begin warming before first React render, preventing routine full-page lazy-loading flashes.
- Persistent shell/navigation correctness no longer depends on Framer Motion opacity entrances finishing; the drawer, bottom-nav selection and internal hub active tabs have deterministic state-driven paint.
- Added accessible internal hub tabs and browser coverage for Notifications, Settings, Formula Engine and System; the new gate exposed and fixed the Settings → Policies fixture-shape crash.
- Added compact 320×568 touch-only navigation/search coverage in addition to the full phone/tablet/desktop dark and desktop-light route matrix.
- Browser API authentication is now cookie-only through the shared client: caller bearer headers are stripped, multipart uploads preserve browser-owned boundaries, and credential behavior has unit coverage.
- Phase 02 is closed as VERIFIED. Unimplemented backend-domain data remains assigned to its owning later phase rather than being hidden with production fixtures.

## 2026-08-29 — Golden-dashboard restoration and route-wide frontend glitch audit
- Removed the temporary "Signed in administrator" Dashboard card because it was not part of the audited golden master and duplicated Profile information.
- Restored the Dashboard composition to greeting → KPIs → recent activity while retaining explicit first-load error/retry handling.
- Expanded Phase 02 browser checks from representative screens to every canonical admin route.
- Added automatic detection for content-bearing UI stranded at zero opacity, missing persistent top-bar glyphs/profile affordance, horizontal document overflow, empty route content, persistent lazy skeletons, broken mesh/background geometry and insufficient fixed-bottom-nav clearance.
- Added a complete route matrix at 390×844 dark, 768×1024 dark, 1440×900 dark and 1440×900 light.
- Updated the real-D1 authenticated browser smoke to require golden Dashboard composition and to verify administrator identity in Profile instead of adding identity duplication to Dashboard.
- Phase 02 remains open until the latest expanded matrix is green and any newly exposed layout/visibility defects are corrected.

## 2026-08-29 — Authenticated shell completeness and performance hardening
- Removed the blocking route import that previously delayed React's first render when a persisted session existed.
- Made Dashboard the eager authenticated route and moved large secondary features, including Profile, back behind background-warmed route chunks so the first useful screen stays small and fast.
- Added real `/api/theme`, `/api/notifications`, and `/api/auth/profile` runtime endpoints so the golden-master shell no longer starts with missing theme/glass state or repeated 404 requests.
- Applied default glass/theme attributes before first paint and isolated the root/glass stacking contexts so fixed mesh and negative-z decorative backgrounds remain visible across browser/GPU paths.
- Reduced page/stagger entrance delays while preserving the golden-master motion language.
- Added a persistent administrator summary to Dashboard using authenticated identity data, including name, email, phone, role/status, last-login context and a direct Profile action. It renders independently of slower dashboard-domain data.
- Reduced Dashboard's user-count work to one conditional aggregate query.
- Added a real-runtime Playwright gate using the local D1 database and actual login cookie. It verifies authenticated dashboard identity, dashboard completion, mesh/background/theme attributes, Profile navigation and absence of failed core `/api/*` responses.

## 2026-08-29 — Phase 04 auth-core / blank-startup fix
- Real local testing exposed a cold-start race: the web Vite server became ready before the Worker, causing immediate `/api/*` proxy requests to fail with `ECONNREFUSED` while stale persisted auth state could still mount the shell.
- Added ordered local startup: root `pnpm dev` now starts the Worker first, waits for `/api/health`, then starts the web app.
- Added immutable `0003_auth_core.sql` for digested server sessions and persisted login history.
- Added PBKDF2-SHA256 password verification compatible with the deterministic local administrator seed.
- Added secure cookie-backed `/api/auth/login`, `/api/auth/me`, `/api/auth/logout`, session listing and session revocation.
- Raw session tokens are never stored in D1 and are never persisted in browser localStorage; the client stores only the non-secret `cookie-session` hint.
- Strengthened the frontend auth gate so stale persisted users cannot mount the authenticated shell before `/auth/me` validates the server session.
- Added short retry handling for transient auth bootstrap network failures and fail-closed handling for invalid sessions.
- CI auth smoke now checks wrong-password rejection, real seeded-admin login, cookie-backed `/api/auth/me`, and logout in addition to the existing D1/build/visual gates.
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
