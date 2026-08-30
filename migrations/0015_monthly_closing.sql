-- Monthly Closing — durable, resumable, fail-closed billing publication
--
-- A billing cycle owns mutable workflow state and a PRE-PUBLICATION draft
-- snapshot. The existing billing_snapshots + bills tables remain the only
-- published financial authority. This separation allows rollback before bill
-- publication without weakening immutable published snapshots.
PRAGMA foreign_keys = ON;

CREATE TABLE billing_cycles (
  id TEXT PRIMARY KEY,
  institution_id TEXT NOT NULL,
  period_month INTEGER NOT NULL CHECK (period_month BETWEEN 0 AND 11),
  period_year INTEGER NOT NULL CHECK (period_year BETWEEN 2000 AND 9999),
  status TEXT NOT NULL DEFAULT 'OPEN'
    CHECK (status IN ('OPEN', 'PREPARING', 'SNAPSHOT_CREATED', 'BILLS_GENERATED', 'SETTLED', 'CLOSED', 'FAILED')),
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  draft_snapshot_json TEXT CHECK (draft_snapshot_json IS NULL OR json_valid(draft_snapshot_json)),
  published_snapshot_id TEXT,
  total_expenses_minor INTEGER NOT NULL DEFAULT 0 CHECK (total_expenses_minor >= 0),
  total_resident_meals INTEGER NOT NULL DEFAULT 0 CHECK (total_resident_meals >= 0),
  total_guest_meals INTEGER NOT NULL DEFAULT 0 CHECK (total_guest_meals >= 0),
  guest_revenue_minor INTEGER NOT NULL DEFAULT 0 CHECK (guest_revenue_minor >= 0),
  meal_charge_minor INTEGER NOT NULL DEFAULT 0 CHECK (meal_charge_minor >= 0),
  bills_generated INTEGER NOT NULL DEFAULT 0 CHECK (bills_generated >= 0),
  refund_queue_total_minor INTEGER NOT NULL DEFAULT 0 CHECK (refund_queue_total_minor >= 0),
  outstanding_due_minor INTEGER NOT NULL DEFAULT 0 CHECK (outstanding_due_minor >= 0),
  due_date TEXT,
  started_by TEXT,
  started_at TEXT,
  closed_by TEXT,
  closed_at TEXT,
  error_message TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (institution_id) REFERENCES institutions(id) ON DELETE RESTRICT,
  FOREIGN KEY (published_snapshot_id) REFERENCES billing_snapshots(id) ON DELETE RESTRICT,
  FOREIGN KEY (started_by) REFERENCES users(id) ON DELETE SET NULL,
  FOREIGN KEY (closed_by) REFERENCES users(id) ON DELETE SET NULL,
  UNIQUE (institution_id, period_month, period_year),
  CHECK ((status = 'CLOSED' AND closed_at IS NOT NULL AND published_snapshot_id IS NOT NULL) OR status <> 'CLOSED')
);

CREATE INDEX billing_cycles_institution_period_idx
  ON billing_cycles(institution_id, period_year DESC, period_month DESC);
CREATE INDEX billing_cycles_status_idx
  ON billing_cycles(institution_id, status, updated_at DESC);

-- SQLite/D1 INTEGER affinity does not itself reject REAL values.
CREATE TRIGGER billing_cycles_integer_money_insert
BEFORE INSERT ON billing_cycles
WHEN typeof(NEW.total_expenses_minor) <> 'integer'
  OR typeof(NEW.guest_revenue_minor) <> 'integer'
  OR typeof(NEW.meal_charge_minor) <> 'integer'
  OR typeof(NEW.refund_queue_total_minor) <> 'integer'
  OR typeof(NEW.outstanding_due_minor) <> 'integer'
BEGIN
  SELECT RAISE(ABORT, 'billing cycle money fields must be integer minor units');
END;

CREATE TRIGGER billing_cycles_integer_money_update
BEFORE UPDATE OF total_expenses_minor, guest_revenue_minor, meal_charge_minor,
                 refund_queue_total_minor, outstanding_due_minor ON billing_cycles
WHEN typeof(NEW.total_expenses_minor) <> 'integer'
  OR typeof(NEW.guest_revenue_minor) <> 'integer'
  OR typeof(NEW.meal_charge_minor) <> 'integer'
  OR typeof(NEW.refund_queue_total_minor) <> 'integer'
  OR typeof(NEW.outstanding_due_minor) <> 'integer'
BEGIN
  SELECT RAISE(ABORT, 'billing cycle money fields must be integer minor units');
END;

-- Once CLOSED the cycle is historical evidence. Corrections happen through the
-- already-verified adjustment/refund mechanisms, never by reopening or repricing.
CREATE TRIGGER billing_cycles_closed_immutable
BEFORE UPDATE ON billing_cycles
WHEN OLD.status = 'CLOSED'
BEGIN
  SELECT RAISE(ABORT, 'closed billing cycles are immutable; use adjustments');
END;

CREATE TRIGGER billing_cycles_block_delete
BEFORE DELETE ON billing_cycles
BEGIN
  SELECT RAISE(ABORT, 'billing cycles are durable history and cannot be deleted');
END;

CREATE TABLE billing_cycle_events (
  id TEXT PRIMARY KEY,
  institution_id TEXT NOT NULL,
  billing_cycle_id TEXT NOT NULL,
  from_status TEXT,
  to_status TEXT NOT NULL
    CHECK (to_status IN ('OPEN', 'PREPARING', 'SNAPSHOT_CREATED', 'BILLS_GENERATED', 'SETTLED', 'CLOSED', 'FAILED')),
  actor_user_id TEXT,
  reason TEXT,
  metadata_json TEXT CHECK (metadata_json IS NULL OR json_valid(metadata_json)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (institution_id) REFERENCES institutions(id) ON DELETE RESTRICT,
  FOREIGN KEY (billing_cycle_id) REFERENCES billing_cycles(id) ON DELETE RESTRICT,
  FOREIGN KEY (actor_user_id) REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX billing_cycle_events_cycle_time_idx
  ON billing_cycle_events(institution_id, billing_cycle_id, created_at);

CREATE TRIGGER billing_cycle_events_block_update
BEFORE UPDATE ON billing_cycle_events
BEGIN
  SELECT RAISE(ABORT, 'billing cycle events are immutable');
END;

CREATE TRIGGER billing_cycle_events_block_delete
BEFORE DELETE ON billing_cycle_events
BEGIN
  SELECT RAISE(ABORT, 'billing cycle events cannot be hard-deleted');
END;

INSERT INTO permissions (id, permission_key, feature, action, description) VALUES
  ('perm_billing_cycles_read', 'billing_cycles.read', 'monthly_closing', 'read', 'Read monthly closing cycles and status history'),
  ('perm_billing_cycles_close', 'billing_cycles.close', 'monthly_closing', 'close', 'Execute or resume a monthly closing workflow'),
  ('perm_billing_cycles_rollback', 'billing_cycles.rollback', 'monthly_closing', 'rollback', 'Roll back an unpublished monthly closing draft');

-- Monthly closing is an administrator accounting operation. Read access stays
-- administrator-only too so the golden admin workflow does not accidentally
-- expose institution-wide financial readiness to residents/managers.
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
JOIN permissions p ON p.permission_key IN (
  'billing_cycles.read', 'billing_cycles.close', 'billing_cycles.rollback'
)
WHERE r.role_key IN ('ADMIN', 'SUPER_ADMIN');

-- Incremental role bootstrap keeps future institutions aligned without
-- rewriting the previously verified global bootstrap trigger.
CREATE TRIGGER roles_bootstrap_monthly_closing_admin
AFTER INSERT ON roles
WHEN NEW.role_key IN ('SUPER_ADMIN', 'ADMIN')
BEGIN
  INSERT OR IGNORE INTO role_permissions (role_id, permission_id)
  SELECT NEW.id, p.id
  FROM permissions p
  WHERE p.permission_key IN (
    'billing_cycles.read', 'billing_cycles.close', 'billing_cycles.rollback'
  );
END;