# Authentication / Registration / OTP / Recovery Verification

## Status
CLOSED + VERIFIED at the implementation boundary; formal project-record closure is contingent on the documentation-head CI run remaining fully green.

Implementation verification head: `2b7762f8d1f38be6c0e0d768474f3b31009d25e4`  
Implementation CI run: `33347865143`

No production deployment was performed.

## Scope decision
This parity checkpoint does **not** create a second authentication subsystem and does not add a new authentication migration. The secure authentication implementation already belongs to the verified Phase 04 core in `0003_auth_core.sql` and `0004_auth_workflows.sql`.

The remaining parity work was to re-audit that implementation against the fixed read-only golden source at `sahid-code404/BoardOpsv2rewrite@77f3dec3b264c42904207f27c5f008b33c03b868`, restore missing evergreen password-recovery runtime coverage, add explicit authentication-surface visual coverage, and promote the parity row only after the current full CI stack was green.

## Source-compatible authentication UX
The rebuilt application preserves the recognizable golden authentication workflow instead of replacing it with a different product flow:
- Sign in
- Register
- email verification OTP
- pending registration/review state
- administrator request-changes / correction / resubmission flow
- rejection visibility with reason
- forgot-password email entry
- reset OTP verification
- new-password reset

The parity visual test explicitly traverses Sign in → Register → Sign in → Forgot password and verifies the canonical registration fields, consent controls, and recovery entry surface. Existing real-runtime registration coverage continues through verification, corrections, mandatory email re-verification, resubmission, approval, login, suspension/session revocation, reactivation safety, and rejection visibility.

## Canonical D1 authentication authority
`0003_auth_core.sql` remains authoritative for server-side session state:
- `user_sessions` stores `token_digest`, expiry, revocation, user-agent and IP metadata.
- Raw session credentials are not stored in D1.
- `login_history` persists authentication attempt evidence.

`0004_auth_workflows.sql` remains authoritative for registration and one-time challenge state:
- `registration_requests` stores review cycles and explicit review states.
- `auth_challenges` stores purpose, one-way secret evidence, attempt counts, expiry and consumption state.
- Supported challenge purposes are `EMAIL_VERIFY`, `PASSWORD_RESET_OTP`, `PASSWORD_RESET_TOKEN`, and `REGISTRATION_ACCESS`.

The current clean-D1 verification stack also proves one session-digest credential column and **zero raw session-token columns**.

## Worker-owned security boundary
Authentication authority stays on the Worker/D1 boundary rather than browser storage:
- login, session validation, logout, active-session listing and revocation are server-managed;
- authenticated shell bootstrap waits for server-session validation;
- registration persists pending applicants and review-cycle evidence rather than activating an account immediately;
- applicant registration status requires the scoped registration-access credential and is not anonymously enumerable;
- administrator review states cannot be bypassed through generic activation/restore paths;
- changing a corrected email forces a new verification challenge before approval;
- password policy is enforced by the backend;
- disabling an account revokes its existing sessions;
- password reset revokes all previously active sessions for that user;
- security-sensitive transitions remain audited.

## Evergreen password-recovery proof
`tests/runtime-e2e/auth-recovery.spec.ts` restores a current real-D1 proof that the recovery path remains secure as the application evolves. It verifies:
1. a synthetic resident can register, verify email, receive administrator approval and authenticate;
2. forgot-password requests for unknown and known addresses return the generic successful shape needed to avoid account enumeration;
3. an incorrect reset OTP is rejected;
4. the valid local-only OTP is accepted and produces a reset credential;
5. the consumed OTP cannot be replayed;
6. the reset credential changes the password;
7. the consumed reset credential cannot be replayed;
8. the session that existed before reset is rejected afterward;
9. the old password no longer authenticates;
10. the new password authenticates and produces a valid new session;
11. the synthetic resident is archived so later serial accounting tests retain the canonical active-user population.

The deterministic `424242` OTP exists only in the local test transport. Normal HTTP responses do not expose OTP values.

## Registration/review proof retained
`tests/runtime-e2e/registration-workflow.spec.ts` remains part of the same evergreen runtime suite and proves:
- full browser registration and email verification;
- last-active-administrator protection;
- pending-registration activation bypass rejection;
- administrator request-changes with explicit fields and reason;
- approval rejection while corrections remain outstanding;
- correction submission and mandatory re-verification after an email change;
- successful resubmission and approval;
- applicant login after approval;
- session revocation on suspension and continued rejection of the old credential after reactivation;
- rejected registration visibility with the administrator reason;
- rejected applicants cannot bypass review through the normal restore path.

## Production delivery boundary
A production email provider is still intentionally **not** fabricated or claimed by this checkpoint. The current non-local delivery boundary fails closed where a real delivery capability is required, and unit coverage proves unavailable production delivery does not create a partial registration mutation. Unknown-account password recovery remains non-enumerating.

A real production email provider must be configured in an explicit deployment/readiness checkpoint. This parity closure does not imply production mail readiness.

## Optional 2FA
Optional two-factor authentication remains feature-gated/disabled and is not newly claimed by this checkpoint. Closing Authentication / Registration / OTP / Recovery does not silently broaden scope to an unimplemented 2FA product.

## Verification hardening
The first evergreen-coverage candidate (`e7c69f6cc5f499ee48dda94360ea0eaa45e9c1a5`, CI `33347298559`) passed the new password-recovery runtime test and all 56 visual tests, but an existing Active Sessions assertion assumed a browser/OS presentation label such as `Chrome on Windows` could occur only once. The additional legitimate administrator session created earlier in the serial runtime suite made that label non-unique.

The final test-only hardening at `2b7762f8d1f38be6c0e0d768474f3b31009d25e4` now requires at least one matching browser/OS presentation label and still explicitly requires the `This device` marker. This fixes a Playwright strict-locator assumption without weakening session identity, authentication, revocation, password recovery, rate limiting, or authorization behavior.

## Final implementation verification
CI run `33347865143` passed at `2b7762f8d1f38be6c0e0d768474f3b31009d25e4`:
- deterministic lockfile validation;
- frozen dependency installation;
- TypeScript typecheck;
- unit tests, including the fail-closed/non-enumerating production email boundary;
- production builds;
- clean local D1 reset, migration, seed and invariant verification through all **23 migrations**;
- current RBAC baseline of **96 permissions / 234 grants**;
- Worker health/readiness and authenticated API smoke;
- frontend smoke;
- **30/30 real-D1 Playwright runtime tests**;
- **56/56 visual tests**.

The runtime suite includes the new one-time/non-enumerating password-recovery and pre-reset-session-revocation proof. The visual suite includes the new source-compatible sign-in/registration/recovery surface proof.

## Explicitly not claimed
- No new authentication migration or competing auth store was added.
- Optional 2FA is not claimed.
- A real production email transport/provider is not configured.
- No production deployment or production-readiness approval is implied.
- The golden/reference repository remained read-only.

## Closure condition
Authentication / Registration / OTP / Recovery is implementation-verified at `2b7762f8d1f38be6c0e0d768474f3b31009d25e4`. The parity/project record is formally CLOSED + VERIFIED once the documentation-only head containing this record, the parity-row promotion, and the changelog entry completes the same full CI stack successfully.
