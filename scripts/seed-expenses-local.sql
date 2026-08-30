-- Deterministic LOCAL-ONLY canonical expense evidence.
PRAGMA foreign_keys = ON;
BEGIN TRANSACTION;

INSERT INTO expenses (
  id, institution_id, title, category, quantity, unit, amount_minor,
  currency_code, description, expense_date, paid_to, idempotency_key,
  status, created_by, created_at, updated_at
) VALUES
  (
    'expense_grocery_aug_2026_local', 'inst_boardops_local', 'Monthly groceries',
    'GROCERY', 1, 'box', 300000, 'INR',
    'Deterministic August grocery expense', '2026-08-10T06:30:00.000Z',
    'Local Grocery Supplier', 'seed-expense-grocery-2026-08-v1',
    'APPROVED', 'usr_admin_local', '2026-08-10T06:30:00.000Z', '2026-08-10T06:30:00.000Z'
  ),
  (
    'expense_utilities_aug_2026_local', 'inst_boardops_local', 'Electricity bill',
    'UTILITIES', 1, 'piece', 150000, 'INR',
    'Deterministic August utilities expense', '2026-08-20T07:00:00.000Z',
    'Local Electricity Board', 'seed-expense-utilities-2026-08-v1',
    'APPROVED', 'usr_admin_local', '2026-08-20T07:00:00.000Z', '2026-08-20T07:00:00.000Z'
  )
ON CONFLICT(id) DO UPDATE SET
  title = excluded.title,
  category = excluded.category,
  quantity = excluded.quantity,
  unit = excluded.unit,
  amount_minor = excluded.amount_minor,
  currency_code = excluded.currency_code,
  description = excluded.description,
  expense_date = excluded.expense_date,
  paid_to = excluded.paid_to,
  idempotency_key = excluded.idempotency_key,
  updated_at = excluded.updated_at;

COMMIT;
