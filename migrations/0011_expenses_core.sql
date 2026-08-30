-- Post-Phase-05 integration — canonical expenses core
-- Approved expenses remain historical evidence. Financial/content corrections
-- create replacement rows; operational deletion never hard-deletes accounting
-- history. Currency is stored only as integer minor units.
PRAGMA foreign_keys = ON;

CREATE TABLE expenses (
  id TEXT PRIMARY KEY,
  institution_id TEXT NOT NULL,
  title TEXT NOT NULL CHECK (length(trim(title)) >= 2),
  category TEXT NOT NULL CHECK (length(trim(category)) >= 2),
  quantity REAL NOT NULL DEFAULT 1 CHECK (quantity > 0),
  unit TEXT NOT NULL DEFAULT 'piece' CHECK (length(trim(unit)) >= 1),
  amount_minor INTEGER NOT NULL CHECK (amount_minor > 0),
  currency_code TEXT NOT NULL DEFAULT 'INR' CHECK (length(currency_code) = 3),
  description TEXT,
  expense_date TEXT NOT NULL,
  paid_to TEXT,
  idempotency_key TEXT,
  status TEXT NOT NULL DEFAULT 'APPROVED'
    CHECK (status IN ('APPROVED', 'REVERSED', 'DELETED')),
  replaces_expense_id TEXT,
  replaced_by_expense_id TEXT,
  created_by TEXT NOT NULL,
  status_before_delete TEXT
    CHECK (status_before_delete IS NULL OR status_before_delete IN ('APPROVED')),
  deleted_on TEXT,
  deletion_scheduled_for TEXT,
  deleted_by TEXT,
  deletion_reason TEXT,
  purged_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (institution_id) REFERENCES institutions(id) ON DELETE RESTRICT,
  FOREIGN KEY (replaces_expense_id) REFERENCES expenses(id) ON DELETE RESTRICT,
  FOREIGN KEY (replaced_by_expense_id) REFERENCES expenses(id) ON DELETE RESTRICT,
  FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE RESTRICT,
  FOREIGN KEY (deleted_by) REFERENCES users(id) ON DELETE SET NULL,
  CHECK ((status = 'DELETED' AND deleted_on IS NOT NULL AND deletion_scheduled_for IS NOT NULL) OR
         (status <> 'DELETED' AND deleted_on IS NULL AND deletion_scheduled_for IS NULL)),
  CHECK ((status = 'REVERSED' AND replaced_by_expense_id IS NOT NULL) OR
         (status <> 'REVERSED' AND replaced_by_expense_id IS NULL))
);

CREATE INDEX expenses_institution_date_idx
  ON expenses(institution_id, expense_date DESC, status);
CREATE INDEX expenses_institution_category_idx
  ON expenses(institution_id, category, expense_date DESC, status);
CREATE INDEX expenses_deletion_queue_idx
  ON expenses(institution_id, status, deletion_scheduled_for)
  WHERE deleted_on IS NOT NULL AND purged_at IS NULL;
CREATE INDEX expenses_replacement_idx
  ON expenses(institution_id, replaces_expense_id)
  WHERE replaces_expense_id IS NOT NULL;
CREATE UNIQUE INDEX expenses_idempotency_idx
  ON expenses(institution_id, created_by, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

-- INTEGER affinity alone is not an accounting boundary in SQLite/D1.
CREATE TRIGGER expenses_integer_money_insert
BEFORE INSERT ON expenses
WHEN typeof(NEW.amount_minor) <> 'integer'
BEGIN
  SELECT RAISE(ABORT, 'expenses.amount_minor must be integer minor units');
END;

CREATE TRIGGER expenses_integer_money_update
BEFORE UPDATE OF amount_minor ON expenses
WHEN typeof(NEW.amount_minor) <> 'integer'
BEGIN
  SELECT RAISE(ABORT, 'expenses.amount_minor must be integer minor units');
END;

-- Approved financial/content evidence is immutable. The API performs an edit
-- by inserting a replacement APPROVED row and marking only the original status
-- as REVERSED with a pointer to that replacement.
CREATE TRIGGER expenses_approved_content_immutable
BEFORE UPDATE OF title, category, quantity, unit, amount_minor, currency_code,
                 description, expense_date, paid_to, created_by ON expenses
WHEN OLD.status = 'APPROVED'
 AND (
   NEW.title <> OLD.title OR
   NEW.category <> OLD.category OR
   NEW.quantity <> OLD.quantity OR
   NEW.unit <> OLD.unit OR
   NEW.amount_minor <> OLD.amount_minor OR
   NEW.currency_code <> OLD.currency_code OR
   COALESCE(NEW.description, '') <> COALESCE(OLD.description, '') OR
   NEW.expense_date <> OLD.expense_date OR
   COALESCE(NEW.paid_to, '') <> COALESCE(OLD.paid_to, '') OR
   NEW.created_by <> OLD.created_by
 )
BEGIN
  SELECT RAISE(ABORT, 'approved expense content is immutable; create a replacement');
END;

-- Financial history is never physically removed by application operations.
CREATE TRIGGER expenses_block_hard_delete
BEFORE DELETE ON expenses
BEGIN
  SELECT RAISE(ABORT, 'expenses are historical records and cannot be hard-deleted');
END;

INSERT INTO permissions (id, permission_key, feature, action, description) VALUES
  ('perm_expenses_read', 'expenses.read', 'expenses', 'read', 'Read approved expenses within the institution'),
  ('perm_expenses_create', 'expenses.create', 'expenses', 'create', 'Create an approved expense'),
  ('perm_expenses_replace', 'expenses.replace', 'expenses', 'replace', 'Correct an expense through reversal and replacement'),
  ('perm_expenses_delete', 'expenses.delete', 'expenses', 'delete', 'Schedule an expense reversal for operational deletion'),
  ('perm_expenses_restore', 'expenses.restore', 'expenses', 'restore', 'Restore an expense from the deletion queue');

-- Expense transparency is available to authenticated institution roles. Only
-- Admin/Super Admin can create or mutate the accounting evidence.
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
JOIN permissions p ON p.permission_key = 'expenses.read';

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
JOIN permissions p ON p.permission_key IN (
  'expenses.create',
  'expenses.replace',
  'expenses.delete',
  'expenses.restore'
)
WHERE r.role_key IN ('ADMIN', 'SUPER_ADMIN');

-- Keep future institution bootstrap aligned with the complete verified baseline.
DROP TRIGGER IF EXISTS institutions_bootstrap_rbac;

CREATE TRIGGER institutions_bootstrap_rbac
AFTER INSERT ON institutions
BEGIN
  INSERT INTO roles (id, institution_id, role_key, name, description, is_system)
  VALUES (NEW.id || ':role:SUPER_ADMIN', NEW.id, 'SUPER_ADMIN', 'Super Admin', 'System administrator role', 1);

  INSERT INTO roles (id, institution_id, role_key, name, description, is_system)
  VALUES (NEW.id || ':role:ADMIN', NEW.id, 'ADMIN', 'Admin', 'Institution administrator role', 1);

  INSERT INTO roles (id, institution_id, role_key, name, description, is_system)
  VALUES (NEW.id || ':role:MANAGER', NEW.id, 'MANAGER', 'Manager', 'Institution manager role', 1);

  INSERT INTO roles (id, institution_id, role_key, name, description, is_system)
  VALUES (NEW.id || ':role:USER', NEW.id, 'USER', 'Resident', 'Standard resident role', 1);

  INSERT INTO role_permissions (role_id, permission_id)
  SELECT r.id, p.id
  FROM roles r
  JOIN permissions p ON p.permission_key IN (
    'dashboard.read',
    'notifications.read_self',
    'profile.read_self',
    'profile.update_self',
    'sessions.read_self',
    'sessions.revoke_self',
    'password.change_self',
    'avatar.update_self',
    'meals.config.read',
    'leave.read',
    'leave.create',
    'bills.read',
    'payments.read',
    'expenses.read'
  )
  WHERE r.institution_id = NEW.id;

  INSERT INTO role_permissions (role_id, permission_id)
  SELECT r.id, p.id
  FROM roles r
  JOIN permissions p ON p.permission_key = 'payments.create'
  WHERE r.institution_id = NEW.id
    AND r.role_key = 'USER';

  INSERT INTO role_permissions (role_id, permission_id)
  SELECT r.id, p.id
  FROM roles r
  JOIN permissions p ON p.permission_key = 'kitchen.read'
  WHERE r.institution_id = NEW.id
    AND r.role_key IN ('MANAGER', 'ADMIN', 'SUPER_ADMIN');

  INSERT INTO role_permissions (role_id, permission_id)
  SELECT r.id, p.id
  FROM roles r
  JOIN permissions p ON p.permission_key IN (
    'audit.read',
    'users.read',
    'users.approve',
    'users.request_changes',
    'users.reject',
    'users.status_change',
    'users.role_assign',
    'users.update',
    'users.delete',
    'users.restore',
    'meals.config.create',
    'meals.config.update',
    'meals.config.delete',
    'kitchen.guest.create',
    'kitchen.guest.delete',
    'meals.override',
    'leave.decide',
    'billing.readiness',
    'bills.generate',
    'bills.delete',
    'bills.restore',
    'bills.void',
    'payments.decide',
    'payments.update',
    'payments.void',
    'payments.delete',
    'payments.restore',
    'payments.refund',
    'refunds.read',
    'expenses.create',
    'expenses.replace',
    'expenses.delete',
    'expenses.restore'
  )
  WHERE r.institution_id = NEW.id
    AND r.role_key IN ('ADMIN', 'SUPER_ADMIN');
END;
