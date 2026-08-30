# Settings / Policies / Holidays Verification Checkpoint

Date: 2026-08-31

## Status

**IMPLEMENTATION VERIFIED — formal project-record closure pending documentation-head CI.**

Implementation verification head:

`520729b0d4f7a81bb3ddc5e8230736a063e7e92c`

Implementation CI run:

`33331332144`

The implementation run passed deterministic lockfile validation, frozen dependency install, TypeScript typecheck, unit tests, production builds, clean local D1 reset through all **20 immutable migrations**, deterministic seed/invariant verification, Worker readiness/API smoke, frontend smoke, **25/25 real-D1 Playwright runtime tests**, and **50/50 visual tests**.

No production deployment was performed.

## Scope and source-audit boundary

This checkpoint owns **Settings / Policies / Holidays** and the Institution Profile surface rendered inside Settings.

The source Settings hub remains recognizable through its four tabs:

- Institution
- Policies
- Appearance
- Calendar

The Appearance tab continues to render the existing personalization surface, but **Profile / Personalization remains a separate AUDITED domain** and is not claimed as verified by this checkpoint.

## Authoritative durable model

Migration `0020_settings_policies_holidays.sql` adds authoritative institution-scoped configuration/calendar ownership:

- `settings`
- `policies`
- `holidays`

It also extends the institution profile with validated institution type, address, contact email, contact phone, and logo URL fields.

Settings are keyed per institution and validated by category/type. Boolean and JSON values are constrained at D1 as well as at the Worker boundary. Policies use a registered typed key/value model. Holidays have validated date ranges and an explicit `ACTIVE` / `ARCHIVED` lifecycle.

Holiday records are operational history. `holidays_block_delete` rejects physical deletion, so a historical calendar rule is archived rather than silently erased.

Institution-profile mutations are audited. Currency changes fail closed after financial history exists so already-recorded accounting evidence cannot be silently re-denominated.

## Holiday meal enforcement

A meals-disabled active Holiday is a real database booking boundary, not only a calendar badge.

Migration `0020_settings_policies_holidays.sql` installs four D1 guards:

- `meal_entries_block_holiday_on_insert`
- `meal_entries_block_holiday_on_update`
- `guest_meals_block_holiday_on_insert`
- `guest_meals_block_holiday_on_update`

These guards protect the canonical resident and guest meal tables directly. Current or future HTTP write paths therefore cannot bypass the holiday rule merely by omitting an application-layer check.

OFF/cancellation evidence remains legal. ON/LOCKED resident meal evidence and guest meal writes are rejected when the service date falls inside an active meals-disabled Holiday.

The real-runtime test proves this through the existing Kitchen guest API and administrator meal-override TURN_ON flow. The guest path returns `409` with `Meal booking is disabled for this holiday`, and the override path is also rejected without writing booking evidence.

## Authorization

Migration `0020_settings_policies_holidays.sql` adds exactly eleven fail-closed permissions:

- `settings.read`
- `settings.write`
- `settings.delete`
- `institution.read`
- `institution.update`
- `policies.read`
- `policies.update`
- `holidays.read`
- `holidays.create`
- `holidays.update`
- `holidays.archive`

Role coverage is least privilege:

- Admin: 11
- Super Admin: 11
- Manager: 4 read permissions
- Resident/User: 4 read permissions

The verified global RBAC baseline is:

- **85 permissions**
- **212 deterministic grants**

All authenticated canonical roles receive only the four safe read permissions: `settings.read`, `institution.read`, `policies.read`, and `holidays.read`. Only Admin/Super Admin receive the seven mutation permissions.

`roles_bootstrap_settings_policy_holiday_read` and `roles_bootstrap_settings_policy_holiday_admin` apply the same least-privilege baseline to future roles/institutions.

Private Settings remain server-filtered even for authenticated read-only callers. The deterministic institution contains four Settings rows, but a Resident receives only the three marked public.

## Deterministic clean-D1 verification

`scripts/verify-settings-policies-holidays-local.mjs` is part of `db:reset:local`.

The successful implementation run verifies:

- 20 immutable migrations applied
- 85 permissions
- 212 grants
- 11 Settings-domain permissions
- 4 Settings rows
- 3 public Settings rows
- 3 Policies
- 2 active Holidays
- 2 meals-disabled Holidays
- 2 future-role bootstrap triggers
- 4 holiday meal guards
- 1 Holiday hard-delete guard
- Admin domain permissions: 11
- Super Admin domain permissions: 11
- Manager domain permissions: 4
- Resident domain permissions: 4
- Resident read permissions: 4
- 1 seeded institution profile

The same reset run also re-verifies every previously closed accounting, Formula, Monthly Closing, communication, and Reports invariant against the grown **85 / 212** global baseline.

## Real-runtime proof

The dedicated test `Settings, Policies, and Holidays are validated, scoped, audited, and fail closed` exercises the actual Worker and clean local D1 database.

Institution Profile proof:

- seeded institution reads as `BoardOps Institute`
- type is `HOSTEL`
- address is `Bengaluru, Karnataka`
- contact email is `office@boardops.local`
- contact phone is `+918000000000`
- currency is `INR`
- timezone is `Asia/Kolkata`
- a normal institution rename persists and can be restored
- changing currency to USD after financial evidence exists is rejected with `409`

Settings proof:

- Admin receives all four seeded Settings, including private `security.administratorNote`
- runtime Setting create succeeds
- repeated create by key acts as validated upsert and preserves identity
- invalid JSON is rejected
- runtime Setting deletion succeeds
- Resident receives only the three public Settings

Policies proof:

- registered Meal and Payment policy groups load from D1
- a BOOLEAN policy update succeeds
- an invalid NUMBER value is rejected
- the deterministic policy is restored after the probe

Holiday proof:

- two seeded active Holidays are returned
- `holiday_foundation_local` / Foundation Day is meals-disabled
- a runtime meals-disabled Holiday can be created and updated
- an invalid end-before-start date range is rejected
- resident/guest meal writes on the blocked date fail closed
- deletion archives the runtime Holiday
- archived history remains queryable

Resident least-privilege proof verifies safe reads and permission-specific `403` responses for:

- `settings.write`
- `settings.delete`
- `institution.update`
- `policies.update`
- `holidays.create`
- `holidays.update`
- `holidays.archive`

Authenticated-shell coverage navigates Dashboard → More navigation → Settings and proves the real Institution Profile, policy groups, Foundation Day, maintenance Holiday, and Meals Disabled state render from the live Worker/D1 path.

CI `33331332144` completed **25/25 runtime tests green**.

## Visual proof

Dedicated visual coverage proves:

- the Institution, Policies, Appearance, and Calendar tabs remain usable
- the Institution surface retains the golden Settings affordances
- Institution Profile fields render in Policies
- Meal Policies and Payment Policies are visible
- Calendar renders the empty-state/add-Holiday workflow in the visual fixture
- the Holiday dialog explains that meals-disabled dates prevent meal booking
- phone, tablet, and desktop layouts remain overflow-safe

The full route/theme regression matrix also keeps `/settings` healthy.

CI `33331332144` completed **50/50 visual tests green**.

## Harness corrections during verification

The first complete browser candidate exposed one test-harness error in each dedicated Settings browser suite: both used nonexistent Playwright `getByDisplayValue()` helpers.

The assertions were corrected to the real accessible contract:

- visual fixture: labeled `Institution Name` input has value `BoardOps Residence`
- real runtime: labeled `Institution Name` input has value `BoardOps Institute`

These were test mechanics only. No Settings, Policy, Holiday, meal, accounting, validation, or authorization rule was weakened.

An older Reports verifier was also made future-safe when the new domain legitimately grew the global RBAC count from its historical 74/182 checkpoint. Reports continues to own exact Reports-specific grants and deterministic report evidence while treating its historical global totals as a floor; the newest Settings verifier owns the exact current 85/212 totals.

## Closure condition

Settings / Policies / Holidays implementation is **VERIFIED** at implementation head `520729b0d4f7a81bb3ddc5e8230736a063e7e92c` with CI run `33331332144` fully green.

Formal project-record closure requires the documentation head containing this verification record, the feature-parity update, and the changelog entry to pass the same complete CI gate.

Profile / Personalization remains **AUDITED** and is not claimed by this checkpoint.

No production deployment was performed, and the golden repository remained read-only.
