# Changelog

## 2026-08-30 — Variables / Formula Engine implementation verified
- CI run `33319044942` passed deterministic lockfile validation, frozen install, TypeScript, unit tests, production builds, clean local D1 reset/migrate/seed/invariant verification, Worker/API readiness smoke, all 19 real-D1 Playwright runtime tests, and the complete Phase 02 visual regression suite at implementation verification head `b90808d1e5faca7bb2b5cb8434982408000b3b3c`.
- Added immutable `0014_variables_formula_engine.sql` with institution-scoped Variables/Formulas, append-only Variable/Formula version history, immutable-history guards, protected Variable rules, active dependency protection, nine fail-closed permissions, and future-institution RBAC bootstrap.
- Canonical Formula evaluation is Worker-owned and BigInt fixed-point. It supports persisted `var('...')` references plus runtime identifiers such as `breakfast_count`, `.5` numeric literals, deterministic rounding, missing-dependency reporting, and strict invalid-syntax/divide-by-zero rejection; unit coverage proves `0.1 + 0.2 = 0.3`.
- The canonical meal Formula now evaluates the real runtime example `3 × ₹40 + 2 × ₹60 + 1 × ₹70 = ₹310` without a JavaScript binary floating-point accounting path.
- ACTIVE Formulas cannot be created or updated against missing/archived persisted Variables; rejected updates do not advance immutable version history. ACTIVE Variables cannot be archived while an active Formula depends on them, and system-protected Variables remain non-archivable.
- Current deterministic RBAC is verified at **64 permissions / 158 grants**. Admin/Super Admin receive all nine Formula/Variable permissions; Manager and Resident/User receive only `variables.read`, including future-institution bootstrap.
- Clean-D1 Formula verification proves 10 active Variables + 10 immutable Variable versions, 4 active Formulas + 4 immutable Formula versions, six history guards, two bootstrap triggers, eight protected Variables, and the canonical meal Formula/dependency mapping.
- Dedicated runtime coverage proves real D1 rendering, exact ₹310 evaluation, Variable and Formula version lifecycles, fail-closed missing dependencies, dependency-aware archive guards, protected Variable behavior, deterministic cleanup, and permission-specific resident denial. The resident proof reuses the deterministic seeded resident so it does not exhaust the serial suite's shared-IP email challenge budget.
- Browser harness hardening replaced post-login cold navigation with live authenticated-shell navigation, aligned Formula Engine navigation with its accessible `tab` roles, and scoped duplicate KPI text correctly. These were test mechanics only; no accounting, evaluator, dependency, or authorization behavior was weakened.
- Variables / Formula Engine implementation is VERIFIED. Formal project-record closure is contingent on the latest documentation-head CI run also remaining fully green. Monthly Closing remains AUDITED and must later consume this canonical engine with strict dependency resolution and **no legacy arithmetic fallback**. No production deployment was performed.

## 2026-08-30 — Refunds and adjustments implementation verified
- CI run `33312728702` passed deterministic lockfile validation, frozen install, TypeScript, unit tests, production builds, clean local D1 reset/migrate/seed/invariant verification, Worker/API smoke, all 17 real-D1 Playwright runtime tests, and the complete Phase 02 visual regression suite at implementation verification head `8c13b08c2f2087e8cbc4035a53ec4de8ce9825b6`.
- Added immutable `0013_refunds_adjustments.sql` with durable resident refund obligations, immutable payout transactions, immutable additive adjustments, institution-scoped financial reference sequences, integer minor-unit constraints, and hard-delete/update guards for historical evidence.
- Outstanding `PENDING` and `PARTIALLY_PAID` refund obligations reserve resident-scoped refundable credit so the same approved credit cannot be promised twice. Partial payouts advance an explicit lifecycle and create canonical `REFUNDED` Payment evidence instead of a second mutable ledger.
- Refund creation, payout recording, and adjustment creation are idempotency-key protected. Cancellation is limited to unpaid obligations and releases the outstanding reservation; partially paid obligations cannot be silently cancelled.
- Adjustments are additive signed correction evidence against canonical Payment/Refund/Bill/Expense entities. Runtime verification proves a `-₹25` adjustment does not rewrite the seeded approved ₹3,000 Expense.
- Current fail-closed RBAC is verified at 55 permissions / 138 deterministic grants. Admin and Super Admin receive all six refund/adjustment permissions; Manager and Resident/User receive none, including for future-institution bootstrap.
- Clean-D1 verification proves ten financial guards, exact current RBAC counts, integer-money rejection, hard-delete protection, and adjustment immutability through an atomic UPSERT probe compatible with Wrangler local D1.
- The self-contained runtime test creates its own resident and approved ₹5,000 credit, proves ₹3,000 reservation and over-reservation rejection, idempotent partial→completed payout, canonical `REFUNDED` Payment evidence, cancellation/reservation release, immutable adjustment behavior, and permission-specific resident `403` responses.
- Two runtime failures during hardening were test-isolation defects, not accounting defects: the first incorrectly assumed Riya owned Arjun's seeded ₹5,000 credit; the second reused an Expenses-test phone number. Both were corrected without weakening production accounting rules.
- Refunds/adjustments implementation is VERIFIED. Formal project-record closure is contingent on the latest documentation-head CI run also remaining fully green. No production deployment was performed.

## 2026-08-30 — Expenses core implementation verified
- CI run `33307956198` passed deterministic lockfile validation, frozen install, TypeScript, unit tests, production builds, clean local D1 reset/migrate/seed/invariant verification, Worker/API smoke, all 14 real-D1 Playwright runtime tests, and the complete Phase 02 visual regression suite at implementation verification head `95cb15ced29bb801fe080bc0ae608d17a52ec236`.
- Added immutable `0011_expenses_core.sql` with institution-scoped canonical expenses, integer minor-unit money storage, explicit indexes/constraints, idempotency keys, replacement lineage, and a recoverable operational deletion queue.
- D1 rejects fractional/non-integer money, direct modification of approved expense content, and physical deletion of expense history. Approved corrections use reversal + replacement rows instead of silent in-place financial edits.
- Expense create and replacement requests require idempotency keys; major-unit values are accepted only when they convert exactly to integer paise.
- Expense mutation is blocked outside an OPEN accounting period. The golden Expenses UI contract remains intact while the Worker enforces canonical accounting semantics underneath it.
- Added five explicit fail-closed permissions: `expenses.read`, `expenses.create`, `expenses.replace`, `expenses.delete`, and `expenses.restore`. Authenticated roles receive read access; only Admin/Super Admin receive current expense mutations.
- Clean-D1 verification proves deterministic August expenses of ₹3,000 groceries + ₹1,500 utilities, the 49-permission RBAC baseline, least-privilege grants, integer-money enforcement, approved-content immutability, and hard-delete rejection.
- Real-runtime coverage proves visible seeded Expenses UI data, idempotent ₹123.45 creation, fractional-paise rejection, reversal/replacement correction, deletion queue + restore, closed-July rejection, resident read-only access, permission-specific mutation denial, and test isolation from later Kitchen counts. No production deployment was performed.
- Expenses implementation is VERIFIED. Formal checkpoint closure is contingent on the latest documentation-head CI run also remaining fully green. Funds remains AUDITED and must consume canonical Expenses + Payments + Bills rather than inventing financial totals.

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
