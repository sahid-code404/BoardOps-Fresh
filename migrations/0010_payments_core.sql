-- Post-Phase-05 integration — canonical payments + refunds core
-- Monetary values are stored only as integer minor units. Approved/refunded
-- payment rows are the canonical evidence used to derive bill paid/due state;
-- financial history is never hard-deleted by operational UI actions.
PRAGMA foreign_keys = ON;

CREATE TABLE payments (
  id TEXT PRIMARY KEY,
  institution_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  bill_id TEXT,
  amount_minor INTEGER NOT NULL CHECK (amount_minor > 0),
  method TEXT NOT NULL
    CHECK (method IN ('CASH', 'UPI', 'CARD', 'BANK_TRANSFER', 'WALLET', 'REFUND')),
  status TEXT NOT NULL DEFAULT 'PENDING'
    CHECK (status IN ('PENDING', 'APPROVED', 'REJECTED', 'REFUNDED', 'VOID', 'DELETED')),
  reference TEXT,
  notes TEXT,
  idempotency_key TEXT,
  approved_by TEXT,
  approved_at TEXT,
  effective_month INTEGER CHECK (effective_month IS NULL OR effective_month BETWEEN 0 AND 11),
  effective_year INTEGER CHECK (effective_year IS NULL OR effective_year BETWEEN 2000 AND 9999),
  status_before_delete TEXT
    CHECK (status_before_delete IS NULL OR status_before_delete IN ('PENDING', 'APPROVED', 'REJECTED', 'REFUNDED', 'VOID')),
  deleted_on TEXT,
  deletion_scheduled_for TEXT,
  deleted_by TEXT,
  deletion_reason TEXT,
  purged_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (institution_id) REFERENCES institutions(id) ON DELETE RESTRICT,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE RESTRICT,
  FOREIGN KEY (bill_id) REFERENCES bills(id) ON DELETE RESTRICT,
  FOREIGN KEY (approved_by) REFERENCES users(id) ON DELETE SET NULL,
  FOREIGN KEY (deleted_by) REFERENCES users(id) ON DELETE SET NULL,
  CHECK ((effective_month IS NULL AND effective_year IS NULL) OR
         (effective_month IS NOT NULL AND effective_year IS NOT NULL)),
  CHECK ((method = 'REFUND' AND status IN ('REFUNDED', 'DELETED')) OR
         (method <> 'REFUND' AND status <> 'REFUNDED')),
  CHECK ((deleted_on IS NULL AND deletion_scheduled_for IS NULL AND status <> 'DELETED') OR
         (deleted_on IS NOT NULL AND deletion_scheduled_for IS NOT NULL AND status = 'DELETED'))
);

CREATE INDEX payments_institution_created_idx
  ON payments(institution_id, created_at DESC, status);
CREATE INDEX payments_user_created_idx
  ON payments(institution_id, user_id, created_at DESC, status);
CREATE INDEX payments_bill_status_idx
  ON payments(institution_id, bill_id, status)
  WHERE bill_id IS NOT NULL;
CREATE INDEX payments_deletion_queue_idx
  ON payments(institution_id, status, deletion_scheduled_for)
  WHERE deleted_on IS NOT NULL AND purged_at IS NULL;
CREATE UNIQUE INDEX payments_idempotency_idx
  ON payments(institution_id, user_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

-- SQLite uses dynamic typing, so INTEGER affinity by itself is insufficient for
-- an accounting boundary. Reject REAL/TEXT values even when they are numerically
-- positive and would otherwise satisfy the column CHECK.
CREATE TRIGGER payments_integer_money_insert
BEFORE INSERT ON payments
WHEN typeof(NEW.amount_minor) <> 'integer'
BEGIN
  SELECT RAISE(ABORT, 'payments.amount_minor must be integer minor units');
END;

CREATE TRIGGER payments_integer_money_update
BEFORE UPDATE OF amount_minor ON payments
WHEN typeof(NEW.amount_minor) <> 'integer'
BEGIN
  SELECT RAISE(ABORT, 'payments.amount_minor must be integer minor units');
END;

-- Future monthly-closing work may create explicit refund obligations before
-- cash is actually paid out. This table keeps that liability separate from the
-- REFUNDED payment event that records the completed payout.
CREATE TABLE refunds (
  id TEXT PRIMARY KEY,
  institution_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  bill_id TEXT,
  amount_minor INTEGER NOT NULL CHECK (amount_minor > 0),
  paid_amount_minor INTEGER NOT NULL DEFAULT 0 CHECK (paid_amount_minor >= 0),
  remaining_amount_minor INTEGER NOT NULL CHECK (remaining_amount_minor >= 0),
  status TEXT NOT NULL DEFAULT 'PENDING'
    CHECK (status IN ('PENDING', 'PARTIALLY_PAID', 'PAID', 'CANCELLED')),
  reason TEXT,
  created_by TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (institution_id) REFERENCES institutions(id) ON DELETE RESTRICT,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE RESTRICT,
  FOREIGN KEY (bill_id) REFERENCES bills(id) ON DELETE RESTRICT,
  FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL,
  CHECK (amount_minor = paid_amount_minor + remaining_amount_minor)
);

CREATE INDEX refunds_institution_status_idx
  ON refunds(institution_id, status, created_at DESC);
CREATE INDEX refunds_user_status_idx
  ON refunds(institution_id, user_id, status, created_at DESC);

CREATE TRIGGER refunds_integer_money_insert
BEFORE INSERT ON refunds
WHEN typeof(NEW.amount_minor) <> 'integer'
  OR typeof(NEW.paid_amount_minor) <> 'integer'
  OR typeof(NEW.remaining_amount_minor) <> 'integer'
BEGIN
  SELECT RAISE(ABORT, 'refund money fields must be integer minor units');
END;

CREATE TRIGGER refunds_integer_money_update
BEFORE UPDATE OF amount_minor, paid_amount_minor, remaining_amount_minor ON refunds
WHEN typeof(NEW.amount_minor) <> 'integer'
  OR typeof(NEW.paid_amount_minor) <> 'integer'
  OR typeof(NEW.remaining_amount_minor) <> 'integer'
BEGIN
  SELECT RAISE(ABORT, 'refund money fields must be integer minor units');
END;

-- 0009 pre-dated canonical payment rows but its local/historical bills may
-- already contain a paid balance. Preserve that evidence as one deterministic
-- migrated approved payment so every non-zero paid_amount_minor has a source
-- row before payment-driven recomputation becomes authoritative.
INSERT INTO payments (
  id, institution_id, user_id, bill_id, amount_minor, method, status,
  reference, notes, approved_by, approved_at, created_at, updated_at
)
SELECT
  b.id || ':migrated-paid-balance',
  b.institution_id,
  b.user_id,
  b.id,
  b.paid_amount_minor,
  'BANK_TRANSFER',
  'APPROVED',
  'MIGRATED_BILL_PAID_BALANCE',
  'Backfilled from the canonical bill paid balance when payments core was introduced',
  NULL,
  COALESCE(b.generated_at, b.created_at),
  COALESCE(b.generated_at, b.created_at),
  COALESCE(b.updated_at, b.created_at)
FROM bills b
WHERE b.paid_amount_minor > 0
  AND NOT EXISTS (
    SELECT 1 FROM payments p
    WHERE p.bill_id = b.id AND p.reference = 'MIGRATED_BILL_PAID_BALANCE'
  );

INSERT INTO permissions (id, permission_key, feature, action, description) VALUES
  ('perm_payments_read', 'payments.read', 'payments', 'read', 'Read payments within the caller scope'),
  ('perm_payments_create', 'payments.create', 'payments', 'create', 'Submit a resident payment'),
  ('perm_payments_decide', 'payments.decide', 'payments', 'decide', 'Approve or reject a payment'),
  ('perm_payments_update', 'payments.update', 'payments', 'update', 'Edit allowed payment metadata'),
  ('perm_payments_void', 'payments.void', 'payments', 'void', 'Void a payment and reverse its bill contribution'),
  ('perm_payments_delete', 'payments.delete', 'payments', 'delete', 'Schedule a payment for operational deletion'),
  ('perm_payments_restore', 'payments.restore', 'payments', 'restore', 'Restore a payment from the deletion queue'),
  ('perm_payments_refund', 'payments.refund', 'payments', 'refund', 'Process refundable resident credit'),
  ('perm_refunds_read', 'refunds.read', 'payments', 'refunds_read', 'Read refund obligations');

-- Payment history is readable to authenticated roles; handlers still enforce
-- resident self-scope. Only residents can submit a normal payment through the
-- current product flow.
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
JOIN permissions p ON p.permission_key = 'payments.read';

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
JOIN permissions p ON p.permission_key = 'payments.create'
WHERE r.role_key = 'USER';

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
JOIN permissions p ON p.permission_key IN (
  'payments.decide',
  'payments.update',
  'payments.void',
  'payments.delete',
  'payments.restore',
  'payments.refund',
  'refunds.read'
)
WHERE r.role_key IN ('ADMIN', 'SUPER_ADMIN');

-- Keep newly inserted institutions aligned with the complete least-privilege
-- permission baseline through this migration.
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
    'payments.read'
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
    'refunds.read'
  )
  WHERE r.institution_id = NEW.id
    AND r.role_key IN ('ADMIN', 'SUPER_ADMIN');
END;
