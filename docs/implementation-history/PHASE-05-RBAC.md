# Phase 05 — Permission-Based RBAC Checkpoint

## Status
VERIFIED — permission-based backend RBAC is implemented, the implementation verification head passed the complete functional/visual gate, and the documentation verification head also passed the complete latest-head CI gate. Phase 05 is formally closed.

Implementation verification head: `aa7c5acbd759f88cf2c2f939a32b4d5b6cf3b1f2`  
Implementation CI run: `33298914080`  
Documentation verification head: `2bad3e059f7f03bee2a5f328d438651f95d8510e`  
Documentation CI run: `33299148953`

No production deployment was performed.

## Trigger
The source/security audit identified a coarse-role authorization boundary: protected user-management behavior ultimately depended on string role checks such as `ADMIN` / `SUPER_ADMIN`. Phase 04 intentionally kept only the minimum role gate required to complete authentication and account lifecycle safely, with fine-grained permission-based backend authorization explicitly deferred to Phase 05.

Phase 05 replaces that coarse authorization decision with institution-scoped role/permission grants while retaining `users.role` only as the compatibility role key required by the existing golden-master application contract.

## Canonical RBAC data model
- Added immutable `0005_rbac.sql` with institution-scoped `roles`, global canonical `permissions`, and many-to-many `role_permissions` grants.
- Defined 18 explicit permission keys covering dashboard access, audit visibility, self-service notifications/profile/session/password/avatar actions, and every currently implemented user-management mutation.
- `users.role` remains the compatibility key (`SUPER_ADMIN`, `ADMIN`, `MANAGER`, `USER`), but authorization resolves that key through D1 role/grant records. Permission grants are authoritative for protected backend access.
- Every authenticated role receives only the self-service permissions required by the already-verified Phase 04 application.
- Only `ADMIN` and `SUPER_ADMIN` receive the current audit/user-management permission set. `MANAGER` and `USER` do not inherit administrative user privileges.

## Institution bootstrap invariant
Migrations run before the deterministic local seed, so populating roles only for institutions that existed while `0005_rbac.sql` executed would leave a clean reset without role rows after the seed created its institution.

To close that database-boundary hole, Phase 05 added immutable `0006_rbac_institution_bootstrap.sql`:
- an `AFTER INSERT` institution trigger creates the four canonical compatibility roles for every newly created institution;
- the trigger grants the self-service permission set to all four roles;
- it grants audit/user-management permissions only to `ADMIN` and `SUPER_ADMIN`;
- the same invariant therefore holds for clean local seed resets and for institutions inserted after the baseline migration.

## Canonical authorization principal
- Added one permission resolver that derives the authenticated principal from the server-managed `boardops_session` HttpOnly cookie.
- The resolver validates the digested server session, expiry, revocation state, active/non-deleted user state, institution, compatibility role key, and D1 permission grants.
- Protected authorization no longer accepts a bearer-token fallback.
- Downstream Phase 04 route helpers were integrated with the same cookie-only rule so a copied session-cookie value cannot be replayed only as an `Authorization: Bearer ...` credential.

## Fail-closed API policy
Phase 05 adds a centralized authorization middleware over `/api/*`:
- explicitly public authentication/bootstrap endpoints are allowlisted;
- every protected exact or dynamic route must map to a concrete permission;
- user action mutations resolve distinct permissions such as `users.approve`, `users.role_assign`, and `users.status_change`;
- request-changes, reject, restore, update, delete, session-revoke, profile, dashboard, notifications, and related routes each have explicit mappings;
- an unknown future API endpoint is rejected with `403` until a permission policy is intentionally registered;
- an unknown user action is also rejected fail-closed instead of inheriting a broad role gate.

This makes omission safe by default: adding a new API route cannot accidentally create an unprotected endpoint.

## Removal of coarse downstream authorization
The guarded Phase 05 integration completed the remaining older-route cleanup:
- `auth.ts`, `runtime.ts`, and `users.ts` now read protected sessions from the HttpOnly cookie only;
- the older `currentAdmin` helper no longer independently authorizes by `role === "ADMIN" || role === "SUPER_ADMIN"`;
- authorization is performed by the permission middleware before the route handler, while the route-level lookup remains only for tenant scoping and mutation invariants.

Role-string comparisons can still exist where the compatibility value is part of presentation, seed/test fixtures, or domain invariants; they are no longer the authoritative backend permission boundary for the protected Phase 05 surface.

## Dashboard behavior
- `/api/dashboard` requires `dashboard.read`.
- Audit activity is returned only when the resolved principal has `audit.read`.
- The compatibility `isAdmin` response field is retained for the golden frontend, but its value is derived from `users.read` permission rather than a hard-coded role string.
- A normal resident therefore receives the dashboard without administrator-only audit activity.

## Database and readiness verification
The clean-D1 gate now verifies the Phase 05 schema and baseline rather than stopping at the Phase 04 authentication tables:
- `roles`, `permissions`, and `role_permissions` are required readiness tables;
- readiness fails closed if the permission count is below 18, the baseline role count is incomplete, or no grants exist;
- the database verification script proves expected role/grant counts;
- it explicitly proves the seeded resident has `dashboard.read` and does **not** have `users.read`.

The CI readiness assertion was updated to expect `phase05-rbac`; the implementation's stricter RBAC readiness checks were retained rather than downgraded to preserve the older Phase 04 label.

## Runtime security proofs
The real-D1 Playwright RBAC suite proves the backend boundary rather than relying on hidden frontend controls:
- Administrator cookie session can read `/api/users`.
- A newly registered, verified, and approved resident can read the normal dashboard.
- That resident receives `403 Permission denied` for `/api/users` with `requiredPermission: "users.read"`.
- The same resident receives a permission-specific `403` when attempting a user status mutation requiring `users.status_change`.
- Copying the real administrator session cookie value into only an `Authorization: Bearer ...` header is rejected with `401 Authentication required` when no cookie is present.
- An administrator calling an unmapped future API route receives `403 RBAC policy missing for endpoint`.

## Verification gates
CI run `33298914080` passed all implementation exit gates at head `aa7c5acbd759f88cf2c2f939a32b4d5b6cf3b1f2`, and CI run `33299148953` repeated the complete gate successfully on documentation head `2bad3e059f7f03bee2a5f328d438651f95d8510e`:
- deterministic lockfile validation
- frozen dependency installation
- TypeScript typecheck
- unit tests
- production builds
- clean local D1 reset, immutable migrations, deterministic seed, and database invariant verification
- Worker health/readiness and authenticated API smoke
- real-D1 Playwright runtime suite including the dedicated Phase 05 RBAC security proof
- complete Phase 02 visual regression suite, proving the authorization work did not regress the verified golden-master frontend

## Security invariants verified
- backend permissions are resolved from institution-scoped D1 grants
- every current protected `/api/*` route has an explicit permission decision
- unmapped future API endpoints fail closed
- unknown user actions fail closed
- protected authorization accepts the HttpOnly cookie only
- bearer-only replay of a copied session value is rejected
- residents keep required self-service/dashboard access
- residents do not receive `users.read` or user-management mutation permissions
- administrator user-management behavior remains available through explicit permissions
- dashboard audit/admin behavior is permission-derived
- newly inserted institutions automatically receive the canonical roles and least-privilege grants
- Phase 05 readiness fails closed if RBAC schema/baseline data is incomplete

## Explicitly not claimed by Phase 05
- No production deployment or production-readiness approval is implied.
- This phase does not add a UI for creating arbitrary custom roles or editing permission grants; it establishes the canonical backend RBAC model and current baseline grants.
- The compatibility `users.role` field is not removed because the existing application contract still uses it for presentation/domain compatibility; it is no longer the authoritative protected-route authorization decision.
- Optional 2FA and a real production authentication-email provider remain outside this phase, as already documented by Phase 04.

## Final status
VERIFIED — Phase 05 permission-based RBAC is formally closed. The implementation and documentation verification heads both passed the complete CI gate, with no production deployment performed.
