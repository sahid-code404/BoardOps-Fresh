-- Audit / System / Background Tasks — durable administration primitives for Cloudflare Workers
-- This migration is immutable once released. Existing audit_events remains the single
-- append-only audit authority; background_tasks adds durable operational state only.
PRAGMA foreign_keys = ON;

CREATE TABLE background_tasks (
  id TEXT PRIMARY KEY,
  institution_id TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN (
    'MONTHLY_CLOSING','REPORT_EXPORT','SESSION_CLEANUP','BILL_GENERATION',
    'ANNOUNCEMENT_SCHEDULE','SYSTEM_BACKUP'
  )),
  status TEXT NOT NULL DEFAULT 'QUEUED'
    CHECK (status IN ('QUEUED','RUNNING','COMPLETED','FAILED','CANCELLED')),
  progress INTEGER NOT NULL DEFAULT 0 CHECK (progress BETWEEN 0 AND 100),
  payload_json TEXT CHECK (payload_json IS NULL OR json_valid(payload_json)),
  result_json TEXT CHECK (result_json IS NULL OR json_valid(result_json)),
  error_message TEXT,
  retry_count INTEGER NOT NULL DEFAULT 0 CHECK (retry_count >= 0),
  max_retries INTEGER NOT NULL DEFAULT 0 CHECK (max_retries BETWEEN 0 AND 10),
  scheduled_for TEXT,
  started_at TEXT,
  finished_at TEXT,
  triggered_by TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (institution_id) REFERENCES institutions(id) ON DELETE RESTRICT,
  FOREIGN KEY (triggered_by) REFERENCES users(id) ON DELETE SET NULL,
  CHECK (status <> 'RUNNING' OR started_at IS NOT NULL),
  CHECK (
    (status IN ('COMPLETED','FAILED','CANCELLED') AND finished_at IS NOT NULL)
    OR (status IN ('QUEUED','RUNNING') AND finished_at IS NULL)
  )
);

CREATE INDEX background_tasks_institution_status_time_idx
  ON background_tasks(institution_id, status, created_at DESC);
CREATE INDEX background_tasks_due_idx
  ON background_tasks(status, scheduled_for, created_at)
  WHERE status = 'QUEUED';
CREATE INDEX background_tasks_triggered_by_idx
  ON background_tasks(triggered_by, created_at DESC);

-- Running tasks can report progress and then finish. Queued tasks can be claimed or
-- cancelled. Terminal history is immutable so operators cannot rewrite outcomes.
CREATE TRIGGER background_tasks_validate_transition
BEFORE UPDATE ON background_tasks
WHEN NOT (
  (OLD.status = 'QUEUED' AND NEW.status IN ('QUEUED','RUNNING','CANCELLED'))
  OR (OLD.status = 'RUNNING' AND NEW.status IN ('RUNNING','COMPLETED','FAILED'))
  OR (OLD.status IN ('COMPLETED','FAILED','CANCELLED') AND NEW.status = OLD.status)
)
BEGIN
  SELECT RAISE(ABORT, 'invalid background task status transition');
END;

CREATE TRIGGER background_tasks_terminal_immutable
BEFORE UPDATE ON background_tasks
WHEN OLD.status IN ('COMPLETED','FAILED','CANCELLED')
BEGIN
  SELECT RAISE(ABORT, 'terminal background tasks are immutable');
END;

CREATE TRIGGER background_tasks_block_delete
BEFORE DELETE ON background_tasks
BEGIN
  SELECT RAISE(ABORT, 'background tasks cannot be hard-deleted');
END;

CREATE INDEX audit_events_institution_action_time_idx
  ON audit_events(institution_id, action, created_at DESC);

INSERT INTO permissions (id, permission_key, feature, action, description) VALUES
  ('perm_tasks_read', 'tasks.read', 'tasks', 'read', 'Read institution background task history'),
  ('perm_tasks_create', 'tasks.create', 'tasks', 'create', 'Dispatch supported system background tasks'),
  ('perm_tasks_cancel', 'tasks.cancel', 'tasks', 'cancel', 'Cancel a queued background task'),
  ('perm_tasks_cleanup', 'tasks.cleanup', 'tasks', 'cleanup', 'Run expired and revoked session cleanup'),
  ('perm_system_backup', 'system.backup', 'system', 'backup', 'Create a private institution D1 logical backup in R2');

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
JOIN permissions p ON p.permission_key IN (
  'tasks.read','tasks.create','tasks.cancel','tasks.cleanup','system.backup'
)
WHERE r.role_key IN ('ADMIN', 'SUPER_ADMIN');

CREATE TRIGGER roles_bootstrap_audit_system_admin
AFTER INSERT ON roles
WHEN NEW.role_key IN ('ADMIN', 'SUPER_ADMIN')
BEGIN
  INSERT OR IGNORE INTO role_permissions (role_id, permission_id)
  SELECT NEW.id, p.id
  FROM permissions p
  WHERE p.permission_key IN (
    'tasks.read','tasks.create','tasks.cancel','tasks.cleanup','system.backup'
  );
END;
