-- Deterministic LOCAL-ONLY billing data.
-- Applied after scripts/seed-local.sql on a fresh local D1 database.
PRAGMA foreign_keys = ON;
BEGIN TRANSACTION;

-- Historical resident: inactive today, but retained so past bills remain
-- attributable without changing current kitchen/dashboard active-user counts.
INSERT INTO users (
  id, institution_id, name, email, phone, password_hash, role, status,
  institution_user_id, email_verified, room, gender, emergency_contact,
  theme, language, timezone, last_login_at, created_at, updated_at
) VALUES (
  'usr_resident_arjun_local', 'inst_boardops_local', 'Arjun Rao', 'arjun@boardops.local',
  '+919000077701', NULL, 'USER', 'INACTIVE', 'RES-0101', 1, 'A-101', 'MALE', '+919000077799',
  'system', 'en', 'Asia/Kolkata', NULL,
  '2026-05-15T09:00:00.000Z', '2026-08-29T00:00:00.000Z'
)
ON CONFLICT(id) DO UPDATE SET
  institution_id = excluded.institution_id,
  name = excluded.name,
  email = excluded.email,
  phone = excluded.phone,
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

-- June is intentionally snapshotted but not yet billed. Runtime smoke uses it
-- to prove snapshot-only generation and idempotent regeneration.
INSERT OR IGNORE INTO billing_snapshots (
  id, institution_id, period_month, period_year, currency_code, snapshot_version,
  resident_count, total_resident_meals, total_guest_meals,
  total_expenses_minor, guest_revenue_minor, per_meal_charge_minor,
  snapshot_json, created_by, created_at
) VALUES (
  'snapshot_2026_06_local', 'inst_boardops_local', 5, 2026, 'INR', 1,
  1, 60, 2, 1860000, 60000, 30000,
  '{"version":1,"currency":"INR","period":{"month":5,"year":2026},"inputs":{"totalExpensesMinor":1860000,"guestRevenueMinor":60000,"totalResidentMeals":60,"totalGuestMeals":2,"perMealChargeMinor":30000},"residents":[{"userId":"usr_resident_arjun_local","mealCount":41,"mealChargesMinor":1230000,"otherChargesMinor":500000,"adjustmentsMinor":0,"totalAmountMinor":1730000}]}',
  'usr_admin_local', '2026-07-01T00:10:00.000Z'
);

-- July is a finalized historical example already represented by a bill. The
-- accounting period itself is CLOSED, so attempts to regenerate it are blocked.
INSERT OR IGNORE INTO billing_snapshots (
  id, institution_id, period_month, period_year, currency_code, snapshot_version,
  resident_count, total_resident_meals, total_guest_meals,
  total_expenses_minor, guest_revenue_minor, per_meal_charge_minor,
  snapshot_json, created_by, created_at
) VALUES (
  'snapshot_2026_07_local', 'inst_boardops_local', 6, 2026, 'INR', 1,
  1, 65, 3, 2050000, 90000, 30154,
  '{"version":1,"currency":"INR","period":{"month":6,"year":2026},"inputs":{"totalExpensesMinor":2050000,"guestRevenueMinor":90000,"totalResidentMeals":65,"totalGuestMeals":3,"perMealChargeMinor":30154},"residents":[{"userId":"usr_resident_arjun_local","mealCount":45,"mealChargesMinor":1350000,"otherChargesMinor":500000,"adjustmentsMinor":0,"totalAmountMinor":1850000}]}',
  'usr_admin_local', '2026-08-01T00:10:00.000Z'
);

INSERT OR IGNORE INTO bills (
  id, institution_id, user_id, snapshot_id, source,
  period_month, period_year, meal_charges_minor, other_charges_minor,
  adjustments_minor, total_amount_minor, paid_amount_minor, due_amount_minor,
  status, due_date, generated_at, created_at, updated_at
) VALUES (
  'bill_arjun_2026_07_local', 'inst_boardops_local', 'usr_resident_arjun_local',
  'snapshot_2026_07_local', 'SNAPSHOT',
  6, 2026, 1350000, 500000, 0, 1850000, 500000, 1350000,
  'PARTIALLY_PAID', '2026-08-10T00:00:00.000Z', '2026-08-01T00:15:00.000Z',
  '2026-08-01T00:15:00.000Z', '2026-08-01T00:15:00.000Z'
);

COMMIT;
