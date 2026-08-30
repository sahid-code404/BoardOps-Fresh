# Phase 04 — Authentication Core Checkpoint

## Status
VERIFIED — the authentication core, registration lifecycle, account-recovery path, administrator review workflow, and account/session safety invariants are implemented and CI-green.

Verification head: `f04cc0f384f9083c1ba8bc9448ca1c3b24f5464b`  
CI run: `33297620321`

No production deployment was performed.

## Trigger
Real local testing originally exposed a startup/auth regression: the Vite web server became ready before the Worker, so a persisted browser session immediately fired `/api/auth/me`, `/api/theme`, `/api/notifications`, and `/api/dashboard` into a refused proxy connection. Because the frontend trusted persisted user state while server-session validation was still pending, the authenticated shell could mount from stale state and leave only the animated background visible.

Phase 04 expanded from that failure into the complete authentication and registration lifecycle needed before permission-based RBAC can safely become the next backend security layer.

## Database and credential model
- Added immutable `0003_auth_core.sql` for server-side sessions and login history.
- Added immutable `0004_auth_workflows.sql` for registration requests and one-time authentication challenges.
- Session credentials are opaque random values delivered through an HttpOnly cookie and stored in D1 only as SHA-256 digests.
- Registration-access tokens and password-reset tokens are stored only as digests.
- OTP values are stored using one-way password hashing rather than plaintext.
- The browser never persists a raw session credential; the legacy-compatible client `token` value is only the non-secret `cookie-session` hint.
- Production cookies remain secure-by-default. Local development explicitly uses the `local` environment so localhost HTTP testing works without weakening the production cookie policy.

## Login and session lifecycle
- Implemented `/api/auth/login`, `/api/auth/me`, `/api/auth/logout`, `/api/auth/sessions`, and explicit session revocation.
- Login checks account status and verified-email state before issuing a session.
- Failed-login history is persisted and used for rate limiting.
- Successful login/logout actions produce immutable audit events carrying the request ID and relevant session metadata.
- The deterministic local administrator password is verified with PBKDF2-SHA256 at 600,000 iterations.
- Authenticated app startup does not mount the shell until `/api/auth/me` validates the server-side session.
- Transient auth-bootstrap network failures retry briefly; invalid/unauthorized sessions fail closed and clear stale client auth state.
- Root `pnpm dev` starts the Worker, waits for health, and only then starts Vite, eliminating the original local startup race.
- Suspending, deactivating, or archiving an account revokes all of that user's live sessions in D1.
- Browser runtime coverage proves that a pre-suspension session remains rejected even after the same account is later reactivated, so account-status checks cannot merely hide an otherwise reusable session.

## Registration and verification lifecycle
- Registration persists a pending user plus a review-cycle record instead of creating an active account directly.
- Registration validates institution membership, required fields, consent flags, password policy, and duplicate email/phone/institution-user-ID constraints.
- Email verification uses a time-limited one-time challenge with attempt limits.
- Local development has a deterministic test transport (`424242`) for browser/CI verification only; OTP values are never returned in normal HTTP payloads.
- Registration status is not anonymously enumerable. Applicant status access requires the registration-access credential carried by the protected registration cookie.
- Pending users cannot sign in until the account is approved and the email address is verified.

## Administrator review state machine
- Administrators can approve, request corrections, or reject a pending registration.
- Request-changes records the exact fields needing correction plus the administrator's reason.
- Applicants can edit and resubmit requested fields into a new review cycle.
- If email is changed during a correction cycle, the account becomes unverified and the applicant is forced through a fresh verification challenge before approval can succeed.
- Approval is accepted only when the latest registration record is actually `PENDING_REVIEW`; it cannot bypass `CHANGES_REQUESTED` or another review state.
- Generic `ACTIVATE` cannot activate a pending registration and bypass the approval workflow.
- Rejected applicants can still securely see the rejection result and administrator-provided reason.
- Rejected registrations cannot bypass review by using the normal deleted-user restore path.
- Account status transitions are enforced by the backend rather than inferred from frontend controls.
- The last active administrator cannot be demoted or disabled in a way that would leave the institution without an active administrator.

## Password recovery and account security
- Forgot-password responses do not disclose whether an email address exists.
- Password-reset OTPs and reset tokens are single-purpose, expiring challenges.
- Password mutation endpoints share the enforced backend password policy.
- Completing password reset revokes all previously active sessions for the account.
- Profile account-security actions are backed by the real runtime: active-session presentation/revocation, password change, profile mutation audit events, and avatar round-trip storage through local R2.

## Delivery fail-closed boundary
A production email provider is intentionally not fabricated in this phase. Non-local verification/reset delivery fails closed until a real provider is configured. The hardened flow checks delivery capability before security-sensitive registration/verification mutations where required, and CI includes a mutation-free failure proof for disabled delivery. Unknown-account password recovery remains non-enumerating.

This means Phase 04 verifies the authentication workflow and delivery boundary; it does **not** claim that a production mail provider has been configured or that production deployment is ready.

## Security invariants verified
- no raw session tokens stored in D1
- no raw session token persisted in browser localStorage
- no OTP or registration credential exposed in normal API responses
- no anonymous registration-status enumeration
- no approval while requested corrections are outstanding
- corrected email requires re-verification
- pending users cannot bypass review with generic activation
- rejected registrations cannot use generic restore to bypass rejection
- disabling an account revokes its existing sessions
- revoked sessions remain revoked after account reactivation
- the final active administrator cannot be disabled/demoted
- password reset revokes old sessions
- unavailable production auth-email delivery fails closed instead of pretending success or leaving a partial registration mutation

## Local administrator
- email: `admin@boardops.local`
- database user ID: `usr_admin_local`
- institution user ID: `ADM-0001`
- role: `ADMIN`

The local development password exists only for deterministic local/CI testing and is not a production secret.

## Verification gates
CI run `33297620321` passed all Phase 04 exit gates at head `f04cc0f384f9083c1ba8bc9448ca1c3b24f5464b`:
- deterministic lockfile validation
- frozen dependency installation
- TypeScript typecheck
- unit tests
- production builds
- clean local D1 reset, migrations, seed, and invariant verification
- Worker health/readiness and authenticated API smoke
- real-D1 browser runtime smoke covering login, registration, OTP verification, requested corrections, email re-verification, resubmission, approval, rejection visibility, user-state invariants, password recovery, session revocation, profile account-security actions, and R2 avatar round-trip
- complete Phase 02 visual regression smoke, ensuring the authentication work did not regress the verified golden-master frontend shell

## Explicitly not claimed by Phase 04
- Optional two-factor authentication remains disabled and is not part of this phase's verified exit scope.
- Fine-grained permission-based backend RBAC remains Phase 05 work; Phase 04 still uses the minimum administrator role gate required to secure the review endpoints.
- A real production email transport/provider is not configured yet; the production boundary intentionally fails closed.
- No production deployment or production-readiness approval is implied.

## Final status
VERIFIED — Phase 04 authentication core and account lifecycle are closed. Phase 05 permission-based RBAC is the next owning phase.
