# Preset Themes Persistence Verification

## Scope
This record is a focused hardening addendum to the already-verified **Profile / Personalization** and **Settings / Policies / Holidays** checkpoints. It does not introduce a new top-level feature, schema, settings authority, or RBAC model.

The implementation candidate is `06501636867aa6ec9c3ce476705ece29b406b69e`, verified by CI run `33392752740`.

Formal project-record closure remains contingent on the documentation head containing this record passing the same CI gates.

## Problem found
The imported golden Appearance UI exposed a complete Preset Themes experience, but its legacy `/theme` behavior was not durably connected to Fresh's canonical institution Settings authority. A visual selection could therefore diverge from the durable theme returned after reload or to an unauthenticated login surface.

The correct Fresh architecture already existed: institution-wide public settings are owned by the canonical `settings` table and protected by the verified Settings RBAC boundary. Creating another theme table or a second privileged mutation route would have duplicated authority.

## Implementation
The hardening preserves the golden Preset Themes UI while adapting its legacy contract to the existing canonical Settings model:

- `GET /api/theme` reads the public `ui.theme` setting for the viewer's institution and validates the persisted JSON before returning it.
- For unauthenticated clients, `GET /api/theme` reads the deterministic public `ui.theme` setting so the login surface can use the institution theme before authentication.
- The golden UI's legacy `PUT /theme` call is adapted by the shared web API client to the existing audited, permission-controlled `POST /api/settings` upsert with key `ui.theme`.
- Appearance mode remains the viewer's self-service profile preference. Institution-global colors, preset, radius, glass mode, blur intensity, and transparency come from canonical Settings.
- Invalid or unusable stored theme JSON fails safely to the default theme rather than becoming a second unvalidated client authority.

No new migration, database table, mutable theme store, or duplicate Settings/RBAC path was added.

## Golden UI preserved
Dedicated visual coverage preserves the complete Appearance contract:

- Preset Themes heading.
- All eight golden presets: Violet, Ocean, Sunset, Forest, Rose, Midnight, Graphite, and Emerald.
- Custom Colors.
- Corner Radius.
- Live Preview.
- Unsaved-change state.
- Save Changes and Save & Apply actions.
- Ocean selection immediately previews the expected primary/accent CSS variables.
- Appearance remains layout-safe with no horizontal overflow.

The golden/reference repository remained read-only.

## Runtime contract proved
The real-D1 Preset Themes scenario proves the unique persistence contract end to end:

1. Administrator signs in through the real UI.
2. Existing canonical `ui.theme` state is captured for deterministic restoration.
3. Settings → Appearance is opened through the authenticated golden navigation.
4. Ocean is selected and its CSS variables are applied immediately in the browser.
5. Save Changes performs the real canonical `POST /api/settings` write.
6. Authenticated `GET /api/theme` returns the persisted Ocean preset/colors/radius.
7. Anonymous `GET /api/theme` returns the same public institution preset/colors.
8. Reloading Settings → Appearance reselects Ocean from durable state.
9. The original setting is restored during cleanup so later serial tests inherit the deterministic baseline.

The Preset test intentionally does not duplicate the Settings-domain resident write-denial setup. `tests/runtime-e2e/settings-policies-holidays.spec.ts` already logs in the canonical resident and proves `POST /api/settings` fails with `403` / `settings.write`, along with the other Settings/Policy/Holiday mutation boundaries. Security coverage therefore remains complete without coupling Preset persistence to mutable cross-test resident credentials.

## Harness hardening during verification
The implementation was validated without weakening application behavior:

- Preset setup/cleanup was moved to an explicit administrator API session so fixture management does not depend on frontend proxy-cookie timing.
- Browser assertions were bounded while retaining the full UI-save/reload behavior.
- The total Preset runtime budget was made cleanup-safe for CI variance.
- A separate Refunds test registration-rate fixture was isolated through the same trusted per-request TEST-NET IP pattern already used by the verified RBAC runtime tests. The production rate limiter itself was not relaxed.
- A stale duplicate Preset resident-login assertion was removed only after confirming the canonical Settings runtime test already proves the same `settings.write` denial with its own deterministic credential setup.

## Database and authorization evidence
Clean-D1 verification on the implementation head passes all **25 immutable migrations** and the complete verifier chain.

Current canonical baseline:

- **98 permissions**.
- **242 role grants**.
- 4 canonical roles.
- Settings domain: 11 permissions.
- Admin / Super Admin: all 11 Settings-domain permissions.
- Manager / Resident: 4 safe read permissions only.
- Profile self-service: 6 permissions for each canonical role.
- No new Preset Themes permission, role, table, or migration was introduced.

This preserves the existing separation of authority: institution Appearance configuration is administered through Settings permissions, while per-user appearance mode remains self-scoped Profile state.

## Files changed for the hardening
Product behavior:

- `services/api/src/routes/runtime.ts`
- `apps/web/src/lib/api-client.ts`

Dedicated coverage:

- `tests/runtime-e2e/preset-themes.spec.ts`
- `tests/e2e/preset-themes-visual.spec.ts`

Verification-harness isolation also touched existing registration-based runtime fixtures without changing production authorization or rate-limit policy.

## Implementation CI
CI run `33392752740` at `06501636867aa6ec9c3ce476705ece29b406b69e` passed:

- prepare ✅
- verify ✅
  - frozen dependency install
  - TypeScript
  - unit tests
  - production build
  - clean D1 reset/migrate/seed/all verifiers
  - Worker health/readiness/auth/dashboard/profile smoke
  - frontend smoke
- runtime-smoke ✅ — **34/34 passed**
  - Preset Themes persistence scenario: test **20/34**, passed
  - full serial runtime suite completed in 2.6 minutes
- visual-smoke ✅ — **58/58 passed**
  - Preset Themes visual contract: test **43/58**, passed
- bootstrap-lockfile skipped as expected

## Status
**IMPLEMENTATION VERIFIED.**

Formal **CLOSED / VERIFIED** status requires the documentation-head CI produced by this verification record to pass prepare, verify, runtime-smoke, and visual-smoke on the exact documentation head.

No production deployment was performed.