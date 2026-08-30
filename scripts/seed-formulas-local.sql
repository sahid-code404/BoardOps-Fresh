-- Deterministic LOCAL-ONLY Variables / Formula Engine fixtures.
-- These rows make the imported Formula Engine screen useful after a clean reset
-- while remaining institution-scoped and versioned for reproducibility.
PRAGMA foreign_keys = ON;

INSERT INTO variables (
  id, institution_id, key, name, description, variable_type, value_text, unit,
  category, is_system, is_protected, status, version, created_by, updated_by,
  created_at, updated_at
) VALUES
  ('var_meal_rate_breakfast_local', 'inst_boardops_local', 'meal.rate.breakfast', 'Breakfast Rate', 'Per-meal breakfast rate', 'CURRENCY', '40', 'INR', 'MEAL_RATES', 1, 1, 'ACTIVE', 1, 'usr_admin_local', 'usr_admin_local', '2026-08-01T00:00:00.000Z', '2026-08-01T00:00:00.000Z'),
  ('var_meal_rate_lunch_local', 'inst_boardops_local', 'meal.rate.lunch', 'Lunch Rate', 'Per-meal lunch rate', 'CURRENCY', '60', 'INR', 'MEAL_RATES', 1, 1, 'ACTIVE', 1, 'usr_admin_local', 'usr_admin_local', '2026-08-01T00:00:00.000Z', '2026-08-01T00:00:00.000Z'),
  ('var_meal_rate_dinner_local', 'inst_boardops_local', 'meal.rate.dinner', 'Dinner Rate', 'Per-meal dinner rate', 'CURRENCY', '70', 'INR', 'MEAL_RATES', 1, 1, 'ACTIVE', 1, 'usr_admin_local', 'usr_admin_local', '2026-08-01T00:00:00.000Z', '2026-08-01T00:00:00.000Z'),
  ('var_meal_rate_snacks_local', 'inst_boardops_local', 'meal.rate.snacks', 'Snacks Rate', 'Optional snacks rate for configurable future meal types', 'CURRENCY', '20', 'INR', 'MEAL_RATES', 1, 1, 'ACTIVE', 1, 'usr_admin_local', 'usr_admin_local', '2026-08-01T00:00:00.000Z', '2026-08-01T00:00:00.000Z'),
  ('var_meal_rate_festival_local', 'inst_boardops_local', 'meal.rate.festival', 'Festival Meal Rate', 'Optional festival meal rate', 'CURRENCY', '120', 'INR', 'MEAL_RATES', 1, 1, 'ACTIVE', 1, 'usr_admin_local', 'usr_admin_local', '2026-08-01T00:00:00.000Z', '2026-08-01T00:00:00.000Z'),
  ('var_billing_room_rent_local', 'inst_boardops_local', 'billing.roomRent', 'Monthly Room Rent', 'Monthly room rent', 'CURRENCY', '4500', 'INR', 'BILLING', 1, 1, 'ACTIVE', 1, 'usr_admin_local', 'usr_admin_local', '2026-08-01T00:00:00.000Z', '2026-08-01T00:00:00.000Z'),
  ('var_billing_security_deposit_local', 'inst_boardops_local', 'billing.securityDeposit', 'Security Deposit', 'Default refundable security deposit', 'CURRENCY', '5000', 'INR', 'BILLING', 1, 1, 'ACTIVE', 1, 'usr_admin_local', 'usr_admin_local', '2026-08-01T00:00:00.000Z', '2026-08-01T00:00:00.000Z'),
  ('var_billing_late_fee_local', 'inst_boardops_local', 'billing.lateFeePercent', 'Late Fee %', 'Late fee percentage', 'PERCENTAGE', '2', '%', 'BILLING', 1, 1, 'ACTIVE', 1, 'usr_admin_local', 'usr_admin_local', '2026-08-01T00:00:00.000Z', '2026-08-01T00:00:00.000Z'),
  ('var_billing_cleaning_local', 'inst_boardops_local', 'billing.cleaningCharges', 'Cleaning Charges', 'Monthly cleaning charge', 'CURRENCY', '150', 'INR', 'BILLING', 0, 0, 'ACTIVE', 1, 'usr_admin_local', 'usr_admin_local', '2026-08-01T00:00:00.000Z', '2026-08-01T00:00:00.000Z'),
  ('var_billing_electricity_local', 'inst_boardops_local', 'billing.electricityPerUnit', 'Electricity Rate / Unit', 'Electricity rate per unit', 'CURRENCY', '8', 'INR', 'BILLING', 0, 0, 'ACTIVE', 1, 'usr_admin_local', 'usr_admin_local', '2026-08-01T00:00:00.000Z', '2026-08-01T00:00:00.000Z')
ON CONFLICT(id) DO NOTHING;

INSERT INTO variable_versions (
  id, institution_id, variable_id, version, key, name, description,
  variable_type, value_text, unit, category, status, changed_by, change_note, created_at
)
SELECT
  'version_' || id,
  institution_id,
  id,
  1,
  key,
  name,
  description,
  variable_type,
  value_text,
  unit,
  category,
  status,
  'usr_admin_local',
  'Deterministic local initial version',
  '2026-08-01T00:00:00.000Z'
FROM variables
WHERE institution_id = 'inst_boardops_local'
  AND id IN (
    'var_meal_rate_breakfast_local', 'var_meal_rate_lunch_local',
    'var_meal_rate_dinner_local', 'var_meal_rate_snacks_local',
    'var_meal_rate_festival_local', 'var_billing_room_rent_local',
    'var_billing_security_deposit_local', 'var_billing_late_fee_local',
    'var_billing_cleaning_local', 'var_billing_electricity_local'
  )
ON CONFLICT(id) DO NOTHING;

INSERT INTO formulas (
  id, institution_id, name, key, description, expression, return_type,
  category, status, version, created_by, updated_by, created_at, updated_at
) VALUES
  (
    'formula_meal_charges_local', 'inst_boardops_local', 'Meal Charges', 'formula.mealCharges',
    'Canonical per-resident meal charge formula for the current Breakfast/Lunch/Dinner configuration',
    'breakfast_count * var(''meal.rate.breakfast'') + lunch_count * var(''meal.rate.lunch'') + dinner_count * var(''meal.rate.dinner'')',
    'CURRENCY', 'BILLING', 'ACTIVE', 1, 'usr_admin_local', 'usr_admin_local',
    '2026-08-01T00:00:00.000Z', '2026-08-01T00:00:00.000Z'
  ),
  (
    'formula_total_bill_local', 'inst_boardops_local', 'Total Bill', 'formula.totalBill',
    'Canonical total-bill composition formula',
    'meal_charges + var(''billing.roomRent'') + var(''billing.cleaningCharges'') + adjustments',
    'CURRENCY', 'BILLING', 'ACTIVE', 1, 'usr_admin_local', 'usr_admin_local',
    '2026-08-01T00:00:00.000Z', '2026-08-01T00:00:00.000Z'
  ),
  (
    'formula_due_amount_local', 'inst_boardops_local', 'Due Amount', 'formula.dueAmount',
    'Outstanding amount after canonical approved payment evidence',
    'total_amount - paid_amount',
    'CURRENCY', 'BILLING', 'ACTIVE', 1, 'usr_admin_local', 'usr_admin_local',
    '2026-08-01T00:00:00.000Z', '2026-08-01T00:00:00.000Z'
  ),
  (
    'formula_late_fee_local', 'inst_boardops_local', 'Late Fee', 'formula.lateFee',
    'Late fee derived from outstanding amount and configured percentage',
    'due_amount * (var(''billing.lateFeePercent'') / 100)',
    'CURRENCY', 'BILLING', 'ACTIVE', 1, 'usr_admin_local', 'usr_admin_local',
    '2026-08-01T00:00:00.000Z', '2026-08-01T00:00:00.000Z'
  )
ON CONFLICT(id) DO NOTHING;

INSERT INTO formula_versions (
  id, institution_id, formula_id, version, expression, return_type,
  referenced_variables_json, referenced_context_json,
  changed_by, change_note, created_at
) VALUES
  (
    'formula_version_meal_charges_v1_local', 'inst_boardops_local', 'formula_meal_charges_local', 1,
    'breakfast_count * var(''meal.rate.breakfast'') + lunch_count * var(''meal.rate.lunch'') + dinner_count * var(''meal.rate.dinner'')',
    'CURRENCY', '["meal.rate.breakfast","meal.rate.lunch","meal.rate.dinner"]',
    '["breakfast_count","lunch_count","dinner_count"]', 'usr_admin_local',
    'Deterministic local initial version', '2026-08-01T00:00:00.000Z'
  ),
  (
    'formula_version_total_bill_v1_local', 'inst_boardops_local', 'formula_total_bill_local', 1,
    'meal_charges + var(''billing.roomRent'') + var(''billing.cleaningCharges'') + adjustments',
    'CURRENCY', '["billing.roomRent","billing.cleaningCharges"]',
    '["meal_charges","adjustments"]', 'usr_admin_local',
    'Deterministic local initial version', '2026-08-01T00:00:00.000Z'
  ),
  (
    'formula_version_due_amount_v1_local', 'inst_boardops_local', 'formula_due_amount_local', 1,
    'total_amount - paid_amount', 'CURRENCY', '[]', '["total_amount","paid_amount"]',
    'usr_admin_local', 'Deterministic local initial version', '2026-08-01T00:00:00.000Z'
  ),
  (
    'formula_version_late_fee_v1_local', 'inst_boardops_local', 'formula_late_fee_local', 1,
    'due_amount * (var(''billing.lateFeePercent'') / 100)', 'CURRENCY',
    '["billing.lateFeePercent"]', '["due_amount"]', 'usr_admin_local',
    'Deterministic local initial version', '2026-08-01T00:00:00.000Z'
  )
ON CONFLICT(id) DO NOTHING;
