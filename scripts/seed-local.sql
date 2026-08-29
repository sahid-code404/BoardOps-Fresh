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
-- Local development password: BoardOps@Fresh#2026!A7
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
    '+919123456789', NULL, 'USER', 'ACTIVE', 'RES-0204', 1, 'B-204', 'FEMALE', '+919111111111',
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