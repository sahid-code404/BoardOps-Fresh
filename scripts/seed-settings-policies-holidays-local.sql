-- Deterministic LOCAL-ONLY Settings / Policies / Holidays fixtures.
PRAGMA foreign_keys = ON;
BEGIN TRANSACTION;

UPDATE institutions
SET type = 'HOSTEL',
    address = 'Bengaluru, Karnataka',
    contact_email = 'office@boardops.local',
    contact_phone = '+918000000000',
    logo_url = NULL,
    updated_at = '2026-08-30T00:00:00.000Z'
WHERE id = 'inst_boardops_local';

INSERT INTO settings (
  id, institution_id, key, value, category, type, description, is_public,
  created_by, updated_by, created_at, updated_at
) VALUES
  (
    'setting_short_name_local', 'inst_boardops_local', 'institution.shortName', 'BoardOps',
    'INSTITUTION', 'TEXT', 'Short institution label used where compact text is needed.', 1,
    'usr_admin_local', 'usr_admin_local', '2026-08-01T00:00:00.000Z', '2026-08-30T00:00:00.000Z'
  ),
  (
    'setting_date_format_local', 'inst_boardops_local', 'ui.dateFormat', 'dd MMM yyyy',
    'UI', 'TEXT', 'Preferred human-readable date format for administrative surfaces.', 1,
    'usr_admin_local', 'usr_admin_local', '2026-08-01T00:00:00.000Z', '2026-08-30T00:00:00.000Z'
  ),
  (
    'setting_support_contact_local', 'inst_boardops_local', 'general.supportContact', 'office@boardops.local',
    'GENERAL', 'TEXT', 'Public support contact shown by institution-facing interfaces.', 1,
    'usr_admin_local', 'usr_admin_local', '2026-08-01T00:00:00.000Z', '2026-08-30T00:00:00.000Z'
  ),
  (
    'setting_admin_note_local', 'inst_boardops_local', 'security.administratorNote', 'Local configuration checkpoint',
    'SECURITY', 'TEXT', 'Private administrator-only configuration note.', 0,
    'usr_admin_local', 'usr_admin_local', '2026-08-01T00:00:00.000Z', '2026-08-30T00:00:00.000Z'
  ),
  (
    'setting_billing_room_rent_local', 'inst_boardops_local', 'billing.roomRent', '4500',
    'BILLING', 'NUMBER', 'Monthly room rent used directly by Monthly Closing.', 0,
    'usr_admin_local', 'usr_admin_local', '2026-08-01T00:00:00.000Z', '2026-08-30T00:00:00.000Z'
  ),
  (
    'setting_billing_cleaning_local', 'inst_boardops_local', 'billing.cleaningCharges', '150',
    'BILLING', 'NUMBER', 'Monthly cleaning charge used directly by Monthly Closing.', 0,
    'usr_admin_local', 'usr_admin_local', '2026-08-01T00:00:00.000Z', '2026-08-30T00:00:00.000Z'
  )
ON CONFLICT(institution_id, key) DO UPDATE SET
  value = excluded.value,
  category = excluded.category,
  type = excluded.type,
  description = excluded.description,
  is_public = excluded.is_public,
  updated_by = excluded.updated_by,
  updated_at = excluded.updated_at;

-- Policies remain the home for behavioral configuration. User 360 reads its
-- optional low-balance overrides from this domain instead of Variables.
INSERT INTO policies (
  id, institution_id, key, category, value, type, description, updated_by, created_at, updated_at
) VALUES
  (
    'policy_meal_late_change_local', 'inst_boardops_local', 'policy.meal.allowLateChange', 'MEAL',
    'false', 'BOOLEAN', 'Allow resident meal changes after the configured cutoff.',
    'usr_admin_local', '2026-08-01T00:00:00.000Z', '2026-08-30T00:00:00.000Z'
  ),
  (
    'policy_meal_grace_local', 'inst_boardops_local', 'policy.meal.cutoffGraceMinutes', 'MEAL',
    '15', 'NUMBER', 'Grace period applied to meal cutoffs.',
    'usr_admin_local', '2026-08-01T00:00:00.000Z', '2026-08-30T00:00:00.000Z'
  ),
  (
    'policy_payment_reference_local', 'inst_boardops_local', 'policy.payment.requireReference', 'PAYMENT',
    'true', 'BOOLEAN', 'Require a reference when an administrator records a payment.',
    'usr_admin_local', '2026-08-01T00:00:00.000Z', '2026-08-30T00:00:00.000Z'
  )
ON CONFLICT(institution_id, key) DO UPDATE SET
  category = excluded.category,
  value = excluded.value,
  type = excluded.type,
  description = excluded.description,
  updated_by = excluded.updated_by,
  updated_at = excluded.updated_at;

INSERT INTO holidays (
  id, institution_id, name, description, type, start_date, end_date,
  meals_disabled, status, created_by, archived_by, archived_at, created_at, updated_at
) VALUES
  (
    'holiday_foundation_local', 'inst_boardops_local', 'Foundation Day',
    'Local deterministic holiday fixture.', 'HOLIDAY', '2026-09-12', '2026-09-12',
    1, 'ACTIVE', 'usr_admin_local', NULL, NULL,
    '2026-08-30T00:00:00.000Z', '2026-08-30T00:00:00.000Z'
  ),
  (
    'holiday_maintenance_local', 'inst_boardops_local', 'Dining hall maintenance',
    'Scheduled local maintenance window.', 'MAINTENANCE', '2026-09-20', '2026-09-20',
    1, 'ACTIVE', 'usr_admin_local', NULL, NULL,
    '2026-08-30T00:00:00.000Z', '2026-08-30T00:00:00.000Z'
  )
ON CONFLICT(id) DO UPDATE SET
  name = excluded.name,
  description = excluded.description,
  type = excluded.type,
  start_date = excluded.start_date,
  end_date = excluded.end_date,
  meals_disabled = excluded.meals_disabled,
  status = excluded.status,
  created_by = excluded.created_by,
  archived_by = excluded.archived_by,
  archived_at = excluded.archived_at,
  updated_at = excluded.updated_at;

COMMIT;
