-- Deterministic LOCAL-ONLY seed data for BoardOps-Fresh.
-- Never use these credentials in staging or production.
PRAGMA foreign_keys = ON;
BEGIN TRANSACTION;

INSERT INTO _runtime_probe (id, initialized_at)
VALUES (1, '2026-08-29T00:00:00.000Z')
ON CONFLICT(id) DO UPDATE SET initialized_at = excluded.initialized_at;

INSERT INTO institutions (
  id, slug, name, status, timezone, currency_code, locale, created_at, updated_at
) VALUES (
  'inst_boardops_local', 'boardops-local', 'BoardOps Institute', 'ACTIVE',
  'Asia/Kolkata', 'INR', 'en-IN', '2026-08-01T00:00:00.000Z', '2026-08-29T00:00:00.000Z'
)
ON CONFLICT(id) DO UPDATE SET
  slug = excluded.slug,
  name = excluded.name,
  status = excluded.status,
  timezone = excluded.timezone,
  currency_code = excluded.currency_code,
  locale = excluded.locale,
  updated_at = excluded.updated_at;

INSERT INTO accounting_periods (
  id, institution_id, period_key, starts_on, ends_on, status,
  opened_at, closing_started_at, closed_at, created_at, updated_at
) VALUES
  (
    'period_2026_07_local', 'inst_boardops_local', '2026-07',
    '2026-07-01', '2026-07-31', 'CLOSED',
    '2026-07-01T00:00:00.000Z', '2026-08-01T00:00:00.000Z', '2026-08-01T00:05:00.000Z',
    '2026-07-01T00:00:00.000Z', '2026-08-01T00:05:00.000Z'
  ),
  (
    'period_2026_08_local', 'inst_boardops_local', '2026-08',
    '2026-08-01', '2026-08-31', 'OPEN',
    '2026-08-01T00:00:00.000Z', NULL, NULL,
    '2026-08-01T00:00:00.000Z', '2026-08-29T00:00:00.000Z'
  )
ON CONFLICT(id) DO UPDATE SET
  status = excluded.status,
  opened_at = excluded.opened_at,
  closing_started_at = excluded.closing_started_at,
  closed_at = excluded.closed_at,
  updated_at = excluded.updated_at;

-- Password scheme reserved for Phase 04 verifier:
-- pbkdf2_sha256$iterations$salt(base64)$digest(base64)
-- Local development credentials only:
--   Admin: admin@boardops.local / BoardOps@Fresh#2026!A7
--   Resident: riya@boardops.local / BoardOps@Resident#2026!R7
INSERT INTO users (
  id, institution_id, name, email, phone, password_hash, role, status,
  institution_user_id, email_verified, room, gender, emergency_contact,
  theme, language, timezone, last_login_at, created_at, updated_at
) VALUES
  (
    'usr_admin_local', 'inst_boardops_local', 'BoardOps Admin', 'admin@boardops.local',
    '+919000000001',
    'pbkdf2_sha256$600000$Ym9hcmRvcHMtbG9jYWwtYWRtaW4tdjE=$xbrxH9D7NtxPtPFYnR1NeUEdZ7jQhPC01btucnPNrJI=',
    'ADMIN', 'ACTIVE', 'ADM-0001', 1, 'ADMIN', 'OTHER', '+919000009999',
    'system', 'en', 'Asia/Kolkata', NULL,
    '2026-08-01T00:00:00.000Z', '2026-08-29T00:00:00.000Z'
  ),
  (
    'usr_resident_riya_local', 'inst_boardops_local', 'Riya Sen', 'riya@boardops.local',
    '+919123456789',
    'pbkdf2_sha256$600000$Ym9hcmRvcHMtbG9jYWwtcml5YS12MQ==$5GtCbbrHvPQv5e03kXoAqJgWfgOWdcLl8ieuxbVg4H0=',
    'USER', 'ACTIVE', 'RES-0204', 1, 'B-204', 'FEMALE', '+919111111111',
    'system', 'en', 'Asia/Kolkata', NULL,
    '2026-08-11T10:00:00.000Z', '2026-08-29T00:00:00.000Z'
  ),
  (
    'usr_resident_kabir_local', 'inst_boardops_local', 'Kabir Mehta', 'kabir@boardops.local',
    '+919000012345', NULL, 'USER', 'PENDING', 'RES-0305', 1, 'C-305', 'MALE', '+919000054321',
    'system', 'en', 'Asia/Kolkata', NULL,
    '2026-08-28T09:00:00.000Z', '2026-08-29T00:00:00.000Z'
  )
ON CONFLICT(id) DO UPDATE SET
  institution_id = excluded.institution_id,
  name = excluded.name,
  email = excluded.email,
  phone = excluded.phone,
  password_hash = excluded.password_hash,
  role = excluded.role,
  status = excluded.status,
  institution_user_id = excluded.institution_user_id,
  email_verified = excluded.email_verified,
  room = excluded.room,
  gender = excluded.gender,
  emergency_contact = excluded.emergency_contact,
  theme = excluded.theme,
  language = excluded.language,
  timezone = excluded.timezone,
  updated_at = excluded.updated_at;

-- Real local meal configuration used by the Admin Console and resident/kitchen
-- meal operations. These rows are deterministic and institution-scoped.
INSERT INTO meal_configurations (
  id, institution_id, name, display_name, description, icon, color, meal_type,
  status, display_order, default_state, default_visibility, cutoff_strategy,
  cutoff_offset_minutes, cutoff_time, start_time, end_time, notes, created_at, updated_at
) VALUES
  (
    'meal_breakfast_local', 'inst_boardops_local', 'breakfast', 'Breakfast',
    'Daily morning meal', '🍳', '#f59e0b', 'REGULAR', 'ACTIVE', 1, 'ON', 'VISIBLE',
    'PREVIOUS_DAY', 0, '22:00', '07:30', '09:30', NULL,
    '2026-08-01T00:00:00.000Z', '2026-08-29T00:00:00.000Z'
  ),
  (
    'meal_lunch_local', 'inst_boardops_local', 'lunch', 'Lunch',
    'Daily afternoon meal', '🍛', '#10b981', 'REGULAR', 'ACTIVE', 2, 'ON', 'VISIBLE',
    'SAME_DAY', 0, '09:30', '12:30', '14:30', NULL,
    '2026-08-01T00:00:00.000Z', '2026-08-29T00:00:00.000Z'
  ),
  (
    'meal_dinner_local', 'inst_boardops_local', 'dinner', 'Dinner',
    'Daily evening meal', '🍲', '#8b5cf6', 'REGULAR', 'ACTIVE', 3, 'ON', 'VISIBLE',
    'SAME_DAY', 0, '16:00', '19:30', '21:30', NULL,
    '2026-08-01T00:00:00.000Z', '2026-08-29T00:00:00.000Z'
  )
ON CONFLICT(id) DO UPDATE SET
  institution_id = excluded.institution_id,
  name = excluded.name,
  display_name = excluded.display_name,
  description = excluded.description,
  icon = excluded.icon,
  color = excluded.color,
  meal_type = excluded.meal_type,
  status = excluded.status,
  display_order = excluded.display_order,
  default_state = excluded.default_state,
  default_visibility = excluded.default_visibility,
  cutoff_strategy = excluded.cutoff_strategy,
  cutoff_offset_minutes = excluded.cutoff_offset_minutes,
  cutoff_time = excluded.cutoff_time,
  start_time = excluded.start_time,
  end_time = excluded.end_time,
  notes = excluded.notes,
  updated_at = excluded.updated_at;

-- A small, real operational dataset makes the local Counts page immediately
-- useful. It deliberately includes one confirmed ON, one confirmed OFF, and
-- one still-editable/default ON state for the active resident.
INSERT INTO meal_entries (
  id, institution_id, user_id, meal_id, service_date, status, original_state,
  editable_until, locked, notes, updated_by, created_at, updated_at
) VALUES
  (
    'entry_riya_breakfast_20260830', 'inst_boardops_local', 'usr_resident_riya_local',
    'meal_breakfast_local', '2026-08-30', 'ON', 'ON', '2026-08-29T16:30:00.000Z', 1,
    'Deterministic local confirmed breakfast', 'usr_resident_riya_local',
    '2026-08-29T16:00:00.000Z', '2026-08-29T16:30:00.000Z'
  ),
  (
    'entry_riya_lunch_20260830', 'inst_boardops_local', 'usr_resident_riya_local',
    'meal_lunch_local', '2026-08-30', 'OFF', 'OFF', '2026-08-30T04:00:00.000Z', 1,
    'Deterministic local resident opt-out', 'usr_resident_riya_local',
    '2026-08-29T16:00:00.000Z', '2026-08-30T04:00:00.000Z'
  ),
  (
    'entry_riya_dinner_20260830', 'inst_boardops_local', 'usr_resident_riya_local',
    'meal_dinner_local', '2026-08-30', 'ON', 'ON', '2026-08-30T10:30:00.000Z', 0,
    'Deterministic local dinner selection', 'usr_resident_riya_local',
    '2026-08-29T16:00:00.000Z', '2026-08-29T16:00:00.000Z'
  )
ON CONFLICT(institution_id, user_id, meal_id, service_date) DO UPDATE SET
  status = excluded.status,
  original_state = excluded.original_state,
  editable_until = excluded.editable_until,
  locked = excluded.locked,
  notes = excluded.notes,
  updated_by = excluded.updated_by,
  updated_at = excluded.updated_at;

INSERT INTO guest_meals (
  id, institution_id, meal_id, host_user_id, guest_name, guest_count,
  service_date, notes, created_at
) VALUES (
  'guest_local_lunch_20260830', 'inst_boardops_local', 'meal_lunch_local',
  'usr_admin_local', 'Guest (Lunch)', 2, '2026-08-30',
  'Deterministic local guest lunch', '2026-08-30T03:30:00.000Z'
)
ON CONFLICT(id) DO UPDATE SET
  meal_id = excluded.meal_id,
  host_user_id = excluded.host_user_id,
  guest_name = excluded.guest_name,
  guest_count = excluded.guest_count,
  service_date = excluded.service_date,
  notes = excluded.notes;

INSERT INTO leave_applications (
  id, institution_id, user_id, start_date, end_date, reason, status,
  approved_by, meal_type, meal_ids_json, admin_notes, created_at, updated_at
) VALUES (
  'leave_riya_pending_local', 'inst_boardops_local', 'usr_resident_riya_local',
  '2026-09-02', '2026-09-03', 'Family visit', 'PENDING', NULL,
  'ALL', '[]', NULL, '2026-08-30T02:00:00.000Z', '2026-08-30T02:00:00.000Z'
)
ON CONFLICT(id) DO UPDATE SET
  start_date = excluded.start_date,
  end_date = excluded.end_date,
  reason = excluded.reason,
  status = excluded.status,
  approved_by = excluded.approved_by,
  meal_type = excluded.meal_type,
  meal_ids_json = excluded.meal_ids_json,
  admin_notes = excluded.admin_notes,
  updated_at = excluded.updated_at;

INSERT INTO registration_requests (
  id, institution_id, user_id, cycle, status, fields_json,
  reason, fields_needing_correction_json, reviewed_by, reviewed_at,
  request_ip, created_at, updated_at
) VALUES (
  'registration_kabir_cycle_1',
  'inst_boardops_local',
  'usr_resident_kabir_local',
  1,
  'PENDING_REVIEW',
  '{"name":"Kabir Mehta","email":"kabir@boardops.local","phone":"+919000012345","room":"C-305","gender":"MALE","institutionName":"BoardOps Institute","institutionUserId":"RES-0305"}',
  NULL,
  NULL,
  NULL,
  NULL,
  '127.0.0.1',
  '2026-08-28T09:00:00.000Z',
  '2026-08-29T00:00:00.000Z'
)
ON CONFLICT(id) DO UPDATE SET
  status = excluded.status,
  fields_json = excluded.fields_json,
  reason = excluded.reason,
  fields_needing_correction_json = excluded.fields_needing_correction_json,
  reviewed_by = excluded.reviewed_by,
  reviewed_at = excluded.reviewed_at,
  updated_at = excluded.updated_at;

INSERT INTO audit_events (
  id, institution_id, actor_user_id, action, entity_type, entity_id,
  request_id, reason, metadata_json, created_at
) VALUES (
  'audit_local_bootstrap_20260829',
  'inst_boardops_local',
  'usr_admin_local',
  'LOCAL_DATABASE_BOOTSTRAPPED',
  'Institution',
  'inst_boardops_local',
  'seed-local-20260829',
  'Deterministic local development bootstrap',
  '{"environment":"LOCAL","source":"scripts/seed-local.sql"}',
  '2026-08-29T00:00:00.000Z'
)
ON CONFLICT(id) DO NOTHING;

COMMIT;
