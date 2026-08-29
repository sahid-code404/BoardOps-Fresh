# Phase 04 — Authentication Core Checkpoint

## Status
IN PROGRESS — secure administrator login/session path implemented and being verified. Registration, email verification/OTP, password recovery, approval workflow and Phase 05 RBAC remain separate exit work.

## Trigger
Real local testing exposed a startup/auth regression: the Vite web server became ready about two seconds before the Worker, so a persisted browser session immediately fired `/api/auth/me`, `/api/theme`, `/api/notifications` and `/api/dashboard` into a refused proxy connection. Because the frontend trusted a persisted user while session validation was still pending, the shell could mount from stale state and leave the user with only the animated background.

## Changes
- Added immutable `0003_auth_core.sql` with server-side session and login-history tables.
- Session credentials are generated as opaque random values, stored only as SHA-256 digests in D1, and delivered to the browser only through an HttpOnly cookie.
- The localStorage `token` value is now only the non-secret `cookie-session` hint.
- `/api/auth/login`, `/api/auth/me`, `/api/auth/logout`, `/api/auth/sessions` and session revocation are implemented.
- Login rate limiting uses persisted failed-login history.
- Successful login/logout actions write immutable audit events with the request ID.
- The seeded local administrator password is verified using PBKDF2-SHA256 (600,000 iterations).
- App startup no longer mounts an authenticated shell until `/auth/me` validates the persisted session.
- Transient network errors during `/auth/me` retry briefly; authorization failures fail closed and clear stale client auth state.
- Root `pnpm dev` now starts the Worker first, waits for health, and only then starts Vite web, eliminating the observed ECONNREFUSED startup race.
- Local Worker config explicitly marks the environment as `local` so the HttpOnly session cookie is usable over localhost HTTP while production remains secure-cookie-by-default.

## Local administrator
- email: `admin@boardops.local`
- database user ID: `usr_admin_local`
- institution user ID: `ADM-0001`
- role: `ADMIN`

The local development password is documented for manual testing but is not a production secret.

## Verification gates
CI must prove:
- migrations from a clean D1
- PBKDF2 known-seed password verification
- wrong password returns 401
- correct admin login sets a cookie and returns only a non-secret client session hint
- `/api/auth/me` resolves the cookie session
- logout succeeds and revokes the session
- existing frontend build and visual regression checks remain green

## Deferred before Phase 04 can be declared complete
- registration persistence/review cycle
- verification OTP delivery abstraction and local test transport
- password recovery/reset flow
- admin approval/reject/request-changes endpoints
- any optional two-factor authentication work
- full real-browser auth E2E

## Final status
IMPLEMENTED — CI VERIFICATION PENDING
