-- Post-Phase-05 integration — durable refund obligations + immutable adjustments
-- Refund obligations reserve refundable resident credit. Actual cash payouts are
-- recorded as immutable refund_transactions plus canonical REFUNDED payments so
-- Bills, Payments and Funds continue to share one accounting authority.
PRAGMA foreign_keys = ON;

-- Rebuild the 0010 refund skeleton into the complete obligation model. There
-- were no inbound foreign keys to refunds before this migration.
DROP TRIGGER IF EXISTS refunds_integer_money_insert;
DROP TRIGGER IF EXISTS refunds_integer_money_update;
DROP INDEX IF EXISTS refunds_institution_status_idx;
DROP INDEX IF EXISTS refunds_user_status_idx;
ALTER TABLE refunds RENAME TO refunds_legacy_0010;

CREATE TABLE refunds (
  id TEXT PRIMARY KEY,
  institution_id TEXT NOT NULL,
  refund_number TEXT NOT NULL,
  user_id TEXT NOT NULL,
  bill_id TEXT,
  amount_minor INTEGER NOT NULL CHECK (amount_minor > 0),
  paid_amount_minor INTEGER NOT NULL DEFAULT 0 CHECK (paid_amount_minor >= 0),
  remaining_amount_minor INTEGER NOT NULL CHECK (remaining_amount_minor >= 0),
  status TEXT NOT NULL DEFAULT 'PENDING'
    CHECK (status IN ('PENDING', 'PARTIALLY_PAID', 'COMPLETED', 'CANCELLED')),
  method TEXT CHECK (method IS NULL OR method IN ('UPI', 'CASH', 'BANK_TRANSFER', 'CHEQUE')),
  reference TEXT,
  reason TEXT,
  notes TEXT,
  processed_by TEXT,
  processed_at TEXT,
  completed_at TEXT,
  idempotency_key TEXT,
  created_by TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (institution_id) REFERENCES institutions(id) ON DELETE RESTRICT,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE RESTRICT,
  FOREIGN KEY (bill_id) REFERENCES bills(id) ON DELETE RESTRICT,
  FOREIGN KEY (processed_by) REFERENCES users(id) ON DELETE SET NULL,
  FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL,
  UNIQUE (institution_id, refund_number),
  CHECK (amount_minor = paid_amount_minor + remaining_amount_minor),
  CHECK (
    (status = 'PENDING' AND paid_amount_minor = 0 AND remaining_amount_minor = amount_minor)
    OR (status = 'PARTIALLY_PAID' AND paid_amount_minor > 0 AND remaining_amount_minor > 0)
    OR (status = 'COMPLETED' AND paid_amount_minor = amount_minor AND remaining_amount_minor = 0 AND completed_at IS NOT NULL)
    OR status = 'CANCELLED'
  )
);

INSERT INTO refunds (
  id, institution_id, refund_number, user_id, bill_id,
  amount_minor, paid_amount_minor, remaining_amount_minor, status,
  reason, notes, processed_by, processed_at, completed_at, created_by,
  created_at, updated_at
)
SELECT
  id,
  institution_id,
  'REF-MIGRATED-' || id,
  user_id,
  bill_id,
  amount_minor,
  paid_amount_minor,
  remaining_amount_minor,
  CASE status WHEN 'PAID' THEN 'COMPLETED' ELSE status END,
  reason,
  reason,
  created_by,
  CASE WHEN paid_amount_minor > 0 THEN updated_at ELSE NULL END,
  CASE WHEN status = 'PAID' THEN updated_at ELSE NULL END,
  created_by,
  created_at,
  updated_at
FROM refunds_legacy_0010;

DROP TABLE refunds_legacy_0010;

CREATE INDEX refunds_institution_status_idx
  ON refunds(institution_id, status, created_at DESC);
CREATE INDEX refunds_user_status_idx
  ON refunds(institution_id, user_id, status, created_at DESC);
CREATE UNIQUE INDEX refunds_idempotency_idx
  ON refunds(institution_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

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

-- Identity and original obligation amount are immutable. Payout progress/status
-- metadata may evolve only through explicit refund actions.
CREATE TRIGGER refunds_block_obligation_rewrite
BEFORE UPDATE OF institution_id, refund_number, user_id, bill_id, amount_minor, created_by, created_at ON refunds
BEGIN
  SELECT RAISE(ABORT, 'refund obligation identity and amount are immutable');
END;

CREATE TRIGGER refunds_block_delete
BEFORE DELETE ON refunds
BEGIN
  SELECT RAISE(ABORT, 'refund history cannot be hard-deleted');
END;

CREATE TABLE refund_transactions (
  id TEXT PRIMARY KEY,
  institution_id TEXT NOT NULL,
  refund_id TEXT NOT NULL,
  amount_minor INTEGER NOT NULL CHECK (amount_minor > 0),
  method TEXT CHECK (method IS NULL OR method IN ('UPI', 'CASH', 'BANK_TRANSFER', 'CHEQUE')),
  reference TEXT,
  notes TEXT,
  processed_by TEXT,
  idempotency_key TEXT NOT NULL,
  payment_id TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (institution_id) REFERENCES institutions(id) ON DELETE RESTRICT,
  FOREIGN KEY (refund_id) REFERENCES refunds(id) ON DELETE RESTRICT,
  FOREIGN KEY (processed_by) REFERENCES users(id) ON DELETE SET NULL,
  FOREIGN KEY (payment_id) REFERENCES payments(id) ON DELETE RESTRICT,
  UNIQUE (institution_id, refund_id, idempotency_key),
  UNIQUE (payment_id)
);

CREATE INDEX refund_transactions_refund_idx
  ON refund_transactions(institution_id, refund_id, created_at DESC);

CREATE TRIGGER refund_transactions_integer_money_insert
BEFORE INSERT ON refund_transactions
WHEN typeof(NEW.amount_minor) <> 'integer'
BEGIN
  SELECT RAISE(ABORT, 'refund_transactions.amount_minor must be integer minor units');
END;

CREATE TRIGGER refund_transactions_block_update
BEFORE UPDATE ON refund_transactions
BEGIN
  SELECT RAISE(ABORT, 'refund transactions are immutable');
END;

CREATE TRIGGER refund_transactions_block_delete
BEFORE DELETE ON refund_transactions
BEGIN
  SELECT RAISE(ABORT, 'refund transactions cannot be hard-deleted');
END;

CREATE TABLE adjustments (
  id TEXT PRIMARY KEY,
  institution_id TEXT NOT NULL,
  adjustment_number TEXT NOT NULL,
  user_id TEXT,
  entity_type TEXT NOT NULL CHECK (entity_type IN ('Payment', 'Refund', 'Bill', 'Expense')),
  entity_id TEXT NOT NULL,
  amount_minor INTEGER NOT NULL CHECK (amount_minor <> 0),
  reason TEXT NOT NULL,
  notes TEXT,
  idempotency_key TEXT NOT NULL,
  created_by TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (institution_id) REFERENCES institutions(id) ON DELETE RESTRICT,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL,
  FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL,
  UNIQUE (institution_id, adjustment_number),
  UNIQUE (institution_id, idempotency_key)
);

CREATE INDEX adjustments_user_idx
  ON adjustments(institution_id, user_id, created_at DESC);
CREATE INDEX adjustments_entity_idx
  ON adjustments(institution_id, entity_type, entity_id, created_at DESC);

CREATE TRIGGER adjustments_integer_money_insert
BEFORE INSERT ON adjustments
WHEN typeof(NEW.amount_minor) <> 'integer'
BEGIN
  SELECT RAISE(ABORT, 'adjustments.amount_minor must be integer minor units');
END;

CREATE TRIGGER adjustments_block_update
BEFORE UPDATE ON adjustments
BEGIN
  SELECT RAISE(ABORT, 'adjustments are immutable');
END;

CREATE TRIGGER adjustments_block_delete
BEFORE DELETE ON adjustments
BEGIN
  SELECT RAISE(ABORT, 'adjustments cannot be hard-deleted');
END;

CREATE TABLE financial_reference_sequences (
  institution_id TEXT NOT NULL,
  sequence_key TEXT NOT NULL,
  value INTEGER NOT NULL DEFAULT 0 CHECK (value >= 0),
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (institution_id, sequence_key),
  FOREIGN KEY (institution_id) REFERENCES institutions(id) ON DELETE RESTRICT
);

INSERT INTO permissions (id, permission_key, feature, action, description) VALUES
  ('perm_refunds_create', 'refunds.create', 'refunds', 'create', 'Create a durable resident refund obligation'),
  ('perm_refunds_pay', 'refunds.pay', 'refunds', 'pay', 'Record partial or complete refund payouts'),
  ('perm_refunds_cancel', 'refunds.cancel', 'refunds', 'cancel', 'Cancel an unpaid refund obligation'),
  ('perm_adjustments_read', 'adjustments.read', 'accounting', 'read', 'Read immutable financial adjustments'),
  ('perm_adjustments_create', 'adjustments.create', 'accounting', 'create', 'Create immutable financial correction evidence');

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
JOIN permissions p ON p.permission_key IN (
  'refunds.create', 'refunds.pay', 'refunds.cancel',
  'adjustments.read', 'adjustments.create'
)
WHERE r.role_key IN ('ADMIN', 'SUPER_ADMIN');

-- Incremental future-institution bootstrap: 0012 still owns role creation. This
-- trigger attaches only the permissions introduced here whenever those roles are
-- inserted, avoiding another rewrite of the already-verified institution trigger.
CREATE TRIGGER roles_bootstrap_refunds_adjustments
AFTER INSERT ON roles
WHEN NEW.role_key IN ('ADMIN', 'SUPER_ADMIN')
BEGIN
  INSERT OR IGNORE INTO role_permissions (role_id, permission_id)
  SELECT NEW.id, p.id
  FROM permissions p
  WHERE p.permission_key IN (
    'refunds.create', 'refunds.pay', 'refunds.cancel',
    'adjustments.read', 'adjustments.create'
  );
END;
