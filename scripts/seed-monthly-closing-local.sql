-- Deterministic LOCAL-ONLY Monthly Closing fixture.
-- Applied after the canonical operational/accounting/formula seeds.
-- May 2026 is intentionally OPEN with no snapshot or bill so the runtime suite
-- can prove the complete close lifecycle without disturbing June/July Billing
-- Core fixtures.
PRAGMA foreign_keys = ON;
BEGIN TRANSACTION;

-- Keep the existing active resident count stable while giving the closing
-- fixture a historically enrolled resident for May.
UPDATE users
   SET created_at = '2026-05-01T00:00:00.000Z'
 WHERE id = 'usr_resident_riya_local'
   AND institution_id = 'inst_boardops_local';

INSERT INTO accounting_periods (
  id, institution_id, period_key, starts_on, ends_on, status,
  opened_at, closing_started_at, closed_at, created_at, updated_at
) VALUES (
  'period_2026_05_local', 'inst_boardops_local', '2026-05',
  '2026-05-01', '2026-05-31', 'OPEN',
  '2026-05-01T00:00:00.000Z', NULL, NULL,
  '2026-05-01T00:00:00.000Z', '2026-08-30T00:00:00.000Z'
)
ON CONFLICT(institution_id, period_key) DO UPDATE SET
  status = 'OPEN',
  closing_started_at = NULL,
  closed_at = NULL,
  updated_at = excluded.updated_at;

-- Canonical May resident meal inputs:
--   Breakfast x2 @ ₹40 = ₹80
--   Lunch     x1 @ ₹60 = ₹60
--   Dinner    x1 @ ₹70 = ₹70
-- formula.mealCharges => ₹210
-- formula.totalBill   => ₹210 + ₹4,500 room rent + ₹150 cleaning = ₹4,860
INSERT INTO meal_entries (
  id, institution_id, user_id, meal_id, service_date, status, original_state,
  editable_until, locked, notes, updated_by, created_at, updated_at
) VALUES
  (
    'entry_riya_breakfast_20260520', 'inst_boardops_local', 'usr_resident_riya_local',
    'meal_breakfast_local', '2026-05-20', 'ON', 'ON', '2026-05-19T16:30:00.000Z', 1,
    'Monthly Closing deterministic breakfast 1', 'usr_resident_riya_local',
    '2026-05-19T15:00:00.000Z', '2026-05-19T16:30:00.000Z'
  ),
  (
    'entry_riya_breakfast_20260521', 'inst_boardops_local', 'usr_resident_riya_local',
    'meal_breakfast_local', '2026-05-21', 'ON', 'ON', '2026-05-20T16:30:00.000Z', 1,
    'Monthly Closing deterministic breakfast 2', 'usr_resident_riya_local',
    '2026-05-20T15:00:00.000Z', '2026-05-20T16:30:00.000Z'
  ),
  (
    'entry_riya_lunch_20260520', 'inst_boardops_local', 'usr_resident_riya_local',
    'meal_lunch_local', '2026-05-20', 'ON', 'ON', '2026-05-20T04:00:00.000Z', 1,
    'Monthly Closing deterministic lunch', 'usr_resident_riya_local',
    '2026-05-20T03:00:00.000Z', '2026-05-20T04:00:00.000Z'
  ),
  (
    'entry_riya_dinner_20260520', 'inst_boardops_local', 'usr_resident_riya_local',
    'meal_dinner_local', '2026-05-20', 'ON', 'ON', '2026-05-20T10:30:00.000Z', 1,
    'Monthly Closing deterministic dinner', 'usr_resident_riya_local',
    '2026-05-20T09:30:00.000Z', '2026-05-20T10:30:00.000Z'
  )
ON CONFLICT(institution_id, user_id, meal_id, service_date) DO UPDATE SET
  status = excluded.status,
  original_state = excluded.original_state,
  editable_until = excluded.editable_until,
  locked = excluded.locked,
  notes = excluded.notes,
  updated_by = excluded.updated_by,
  updated_at = excluded.updated_at;

COMMIT;
