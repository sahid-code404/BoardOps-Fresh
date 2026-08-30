# Roles / Permissions Verification

Verified: 2026-08-31  
Status: implementation VERIFIED at `7a16838e4efd5f81b28ae5b8f0aa30f48f8ca0d0`; formal project-record closure pending documentation-head CI

## Scope verified

- The canonical `permissions` catalog and `role_permissions` grant table remain the authorization authority; no client-side role matrix or second permission store was introduced.
- Four system roles remain canonical: `SUPER_ADMIN`, `ADMIN`, `MANAGER`, and `USER`.
- Permission checks resolve from live D1 grants for the authenticated principal and fail closed at the Worker middleware boundary.
- Role assignment remains an explicit privileged operation. Admin and Super Admin can assign roles; Manager and Resident/User cannot.
- A role change affects an already-authenticated principal on the next authorized request without requiring logout/login or a stale client-side role cache refresh.
- Direct access to protected APIs remains permission-scoped. A Resident/User cannot read the institution user directory or assign roles.
- Existing last-active-administrator safeguards remain intact; the checkpoint does not weaken administrator continuity protections.
- Migration `0022_roles_permissions_integrity.sql` hardens canonical role/grant integrity without replacing the existing RBAC model.
- The recognizable Users / role-management UX is preserved while permission ownership and route visibility are driven by explicit grants rather than duplicated role-name checks.
- Deterministic clean-D1 verification and real-runtime Playwright coverage exercise canonical roles, grants, assignment authority, live grant resolution, direct-route denial, and cross-checkpoint regression safety.

## Evidence

- Implementation verification head: `7a16838e4efd5f81b28ae5b8f0aa30f48f8ca0d0`.
- CI run `33341631331` completed successfully and passed deterministic lockfile validation, frozen dependency installation, TypeScript, unit tests, production builds, clean local D1 reset/migration/seed/invariant verification through all 22 migrations, Worker/API readiness smoke, frontend smoke, runtime smoke, and visual smoke.
- Clean-D1 Roles / Permissions verification owns the current **90 permissions / 222 role grants** baseline and proves:
  - 4 system roles,
  - 0 unresolved user roles,
  - 10 role/grant integrity guards,
  - 1 active administrator in the deterministic fixture,
  - Admin `users.role_assign`: 1,
  - Super Admin `users.role_assign`: 1,
  - non-admin `users.role_assign`: 0.
- Real-D1 Playwright runtime: **28/28 passed**. The dedicated Roles / Permissions scenario proves live Admin permissions, Resident/User least privilege, permission-specific `403` denial for `/api/users`, live `USER → MANAGER → USER` grant resolution for an already-authenticated principal, and cleanup of the synthetic verification account so later accounting scenarios retain their canonical population.
- The complete runtime suite passed after the Roles scenario, including Refunds / Adjustments, proving the test fixture no longer leaks active-user state into downstream accounting verification.
- Visual Playwright: **54/54 passed**, including healthy `/users` and `/user-meals` routes plus the complete phone/tablet/desktop/theme route matrix.

## Authorization invariants

- The Worker remains authoritative for permission enforcement. UI navigation visibility is convenience/parity behavior, not the security boundary.
- The authenticated principal's effective permission set is resolved from current D1 role grants; changing the user's role changes subsequent authorization decisions without reissuing a role-specific client matrix.
- `users.read` remains unavailable to Resident/User.
- `users.role_assign` remains Admin/Super Admin-only.
- Permission denial remains explicit and fail closed; protected routes do not silently downgrade into broader data exposure.
- Role assignment does not bypass user status, institution scope, or last-active-administrator constraints.

## Source behavior re-opened before implementation

The golden product exposed recognizable user/role administration, but role names and UI visibility could not be treated as the authorization system. The implementation preserves the recognizable role-management workflow while keeping the rebuilt Worker + D1 permission catalog authoritative for every protected operation.

## What changed

1. Added immutable migration `0022_roles_permissions_integrity.sql` to harden canonical role and grant integrity.
2. Added deterministic Roles / Permissions verification for catalog/grant counts, system-role resolution, integrity guards, administrator continuity, and exact role-assignment authority.
3. Added real-D1 runtime coverage proving live grant resolution and least-privilege denial without relying on a client-side role matrix.
4. Kept navigation/route parity aligned with the golden UX, including the `/users` administration surface and resident `/user-meals` access.
5. Hardened the runtime test fixture so its synthetic registration is rate-limit isolated and its temporary user state is removed from the active accounting population after verification.

## What was deliberately not changed

- No production deployment was performed.
- The golden repository remained read-only.
- No new client-side authorization authority was introduced.
- No permission, role, status, institution-scope, or last-active-administrator check was relaxed to satisfy tests.
- No accounting, billing, meal, notification, audit, or background-task ownership rule was moved into the Roles / Permissions checkpoint.

## Hardening during verification

1. Visual regression initially exposed a parity issue around the resident `/user-meals` route. The route/navigation contract was corrected without granting Resident/User access to administrator-only Users or role-management functions.
2. An early runtime assertion relied on layout-specific Users navigation text rather than the actual permission boundary. That brittle UI assumption was removed; navigation visibility continues to be covered by permission-aware UI tests while runtime coverage focuses on authoritative API behavior.
3. The first synthetic registration used the shared localhost rate-limit bucket and could contaminate later serial registration tests. Test isolation was introduced rather than weakening the production limiter.
4. The next isolation attempt used `x-forwarded-for`, but the production `clientIp()` boundary correctly prioritizes `cf-connecting-ip`. The final test uses the actual trusted header path, preserving production limiter behavior.
5. The runtime test also assumed an API-request login automatically bootstrapped a newly opened frontend page session. That invalid harness assumption was removed rather than altering cookie/session architecture.
6. The synthetic resident initially remained ACTIVE after the RBAC scenario and changed the population observed by later accounting verification. The final test archives the synthetic user after permission checks so each serial scenario remains self-contained.
7. Commit `7a16838e4efd5f81b28ae5b8f0aa30f48f8ca0d0` contains the final test-only self-containment fix. No production authorization, rate-limit, session, accounting, or domain behavior was weakened.

## Verification summary

- Implementation CI: `33341631331`
- Implementation head: `7a16838e4efd5f81b28ae5b8f0aa30f48f8ca0d0`
- Migrations: 22
- RBAC baseline: **90 permissions / 222 grants**
- Canonical system roles: 4
- Unresolved user roles: 0
- Integrity guards: 10
- Runtime: **28/28 passed**
- Visual: **54/54 passed**
- Result: **VERIFIED**

## Current ownership state

Roles / Permissions now has an explicitly verified D1-backed authorization contract: the permission catalog and role grants remain canonical, role assignment is least-privilege, protected API access is fail-closed, and effective permissions update live for authenticated principals.

## Formal checkpoint closure

Implementation verification is complete. Formal project-record closure requires the final documentation-head CI run to remain fully green after this verification record, the feature-parity matrix, and the changelog are updated.

## Deployment state

No production deployment was performed. The golden repository was not modified.