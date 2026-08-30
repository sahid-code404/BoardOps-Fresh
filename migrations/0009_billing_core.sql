-- Post-Phase-05 integration — immutable billing snapshots + bill lifecycle
-- Billing is intentionally snapshot-driven: generated bills never recalculate
-- from mutable live meal/expense data. Monetary values are stored as integer
-- minor units (paise for INR) at the database boundary.
PRAGMA foreign_keys = ON;

CREATE TABLE billing_snapshots (
  id TEXT PRIMARY KEY,
  institution_id TEXT NOT NULL,
  period_month INTEGER NOT NULL CHECK (period_month BETWEEN 0 AND 11),
  period_year INTEGER NOT NULL CHECK (period_year BETWEEN 2000 AND 9999),
  currency_code TEXT NOT NULL DEFAULT 'INR' CHECK (length(currency_code) = 3),
  snapshot_version INTEGER NOT NULL DEFAULT 1 CHECK (snapshot_version >= 1),
  resident_count INTEGER NOT NULL DEFAULT 0 CHECK (resident_count >= 0),
  total_resident_meals INTEGER NOT NULL DEFAULT 0 CHECK (total_resident_meals >= 0),
  total_guest_meals INTEGER NOT NULL DEFAULT 0 CHECK (total_guest_meals >= 0),
  total_expenses_minor INTEGER NOT NULL DEFAULT 0 CHECK (total_expenses_minor >= 0),
  guest_revenue_minor INTEGER NOT NULL DEFAULT 0 CHECK (guest_revenue_minor >= 0),
  per_meal_charge_minor INTEGER NOT NULL DEFAULT 0 CHECK (per_meal_charge_minor >= 0),
  snapshot_json TEXT NOT NULL CHECK (json_valid(snapshot_json)),
  created_by TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (institution_id) REFERENCES institutions(id) ON DELETE RESTRICT,
  FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL,
  UNIQUE (institution_id, period_month, period_year)
);

CREATE INDEX billing_snapshots_institution_period_idx
  ON billing_snapshots(institution_id, period_year DESC, period_month DESC);

-- Financial snapshots are immutable. Upstream corrections must produce a later
-- adjustment/reversal workflow rather than rewriting the evidence used to bill.
CREATE TRIGGER billing_snapshots_block_update
BEFORE UPDATE ON billing_snapshots
BEGIN
  SELECT RAISE(ABORT, 'billing_snapshots are immutable');
END;

CREATE TRIGGER billing_snapshots_block_delete
BEFORE DELETE ON billing_snapshots
BEGIN
  SELECT RAISE(ABORT, 'billing_snapshots are immutable');
END;

CREATE TABLE bills (
  id TEXT PRIMARY KEY,
  institution_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  snapshot_id TEXT,
  source TEXT NOT NULL DEFAULT 'SNAPSHOT' CHECK (source IN ('SNAPSHOT', 'MIGRATED')),
  period_month INTEGER NOT NULL CHECK (period_month BETWEEN 0 AND 11),
  period_year INTEGER NOT NULL CHECK (period_year BETWEEN 2000 AND 9999),
  meal_charges_minor INTEGER NOT NULL DEFAULT 0 CHECK (meal_charges_minor >= 0),
  other_charges_minor INTEGER NOT NULL DEFAULT 0 CHECK (other_charges_minor >= 0),
  adjustments_minor INTEGER NOT NULL DEFAULT 0,
  total_amount_minor INTEGER NOT NULL DEFAULT 0 CHECK (total_amount_minor >= 0),
  paid_amount_minor INTEGER NOT NULL DEFAULT 0 CHECK (paid_amount_minor >= 0),
  due_amount_minor INTEGER NOT NULL DEFAULT 0 CHECK (due_amount_minor >= 0),
  status TEXT NOT NULL DEFAULT 'DRAFT'
    CHECK (status IN ('DRAFT', 'GENERATED', 'PARTIALLY_PAID', 'PAID', 'OVERDUE', 'VOID', 'DELETED')),
  status_before_delete TEXT
    CHECK (status_before_delete IS NULL OR status_before_delete IN ('DRAFT', 'GENERATED', 'PARTIALLY_PAID', 'PAID', 'OVERDUE', 'VOID')),
  due_date TEXT,
  generated_at TEXT,
  deleted_on TEXT,
  deletion_scheduled_for TEXT,
  deleted_by TEXT,
  deletion_reason TEXT,
  purged_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (institution_id) REFERENCES institutions(id) ON DELETE RESTRICT,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE RESTRICT,
  FOREIGN KEY (snapshot_id) REFERENCES billing_snapshots(id) ON DELETE RESTRICT,
  FOREIGN KEY (deleted_by) REFERENCES users(id) ON DELETE SET NULL,
  UNIQUE (institution_id, user_id, period_month, period_year),
  CHECK (total_amount_minor = meal_charges_minor + other_charges_minor + adjustments_minor),
  CHECK ((deleted_on IS NULL AND deletion_scheduled_for IS NULL AND status <> 'DELETED') OR
         (deleted_on IS NOT NULL AND deletion_scheduled_for IS NOT NULL AND status = 'DELETED'))
);

CREATE INDEX bills_institution_period_idx
  ON bills(institution_id, period_year DESC, period_month DESC, status);
CREATE INDEX bills_user_period_idx
  ON bills(institution_id, user_id, period_year DESC, period_month DESC);
CREATE INDEX bills_deletion_queue_idx
  ON bills(institution_id, status, deletion_scheduled_for)
  WHERE deleted_on IS NOT NULL AND purged_at IS NULL;

-- Once a bill leaves DRAFT, the monetary basis and snapshot provenance cannot
-- be repriced in place. Payment/status/deletion metadata may still evolve.
CREATE TRIGGER bills_block_generated_reprice
BEFORE UPDATE OF snapshot_id, source, period_month, period_year,
                 meal_charges_minor, other_charges_minor, adjustments_minor,
                 total_amount_minor ON bills
WHEN OLD.status <> 'DRAFT'
BEGIN
  SELECT RAISE(ABORT, 'generated bill financial fields are immutable');
END;

INSERT INTO permissions (id, permission_key, feature, action, description) VALUES
  ('perm_bills_read', 'bills.read', 'billing', 'read', 'Read bills within the caller scope'),
  ('perm_billing_readiness', 'billing.readiness', 'billing', 'readiness', 'Read billing generation readiness'),
  ('perm_bills_generate', 'bills.generate', 'billing', 'generate', 'Generate bills from an immutable snapshot'),
  ('perm_bills_delete', 'bills.delete', 'billing', 'delete', 'Schedule bills for operational deletion'),
  ('perm_bills_restore', 'bills.restore', 'billing', 'restore', 'Restore bills from the deletion queue'),
  ('perm_bills_void', 'bills.void', 'billing', 'void', 'Void an unpaid generated bill');

-- Everyone with an authenticated application role may read billing. The route
-- applies self-scope to residents and institution scope to operational roles.
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
JOIN permissions p ON p.permission_key = 'bills.read';

-- Financial mutation/readiness controls remain administrator-only.
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
JOIN permissions p ON p.permission_key IN (
  'billing.readiness', 'bills.generate', 'bills.delete', 'bills.restore', 'bills.void'
)
WHERE r.role_key IN ('ADMIN', 'SUPER_ADMIN');

-- Keep future institution bootstrap in lock-step with the current canonical
-- permission baseline.
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
    'bills.read'
  )
  WHERE r.institution_id = NEW.id;

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
    'bills.void'
  )
  WHERE r.institution_id = NEW.id
    AND r.role_key IN ('ADMIN', 'SUPER_ADMIN');
END;
