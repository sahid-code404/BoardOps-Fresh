-- Residents / Users completion — canonical resident restriction evidence.
--
-- The golden Resident 360 contract evaluates active financial/administrative
-- restrictions alongside derived resident finance state. Fresh previously had
-- no D1 restriction domain at all, so the UI could only render a permanent
-- placeholder. This migration adds the missing durable record model without
-- introducing a second financial balance authority.
PRAGMA foreign_keys = ON;

CREATE TABLE restrictions (
  id TEXT PRIMARY KEY,
  institution_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('FINANCIAL', 'ADMINISTRATIVE')),
  reason TEXT NOT NULL CHECK (length(trim(reason)) > 0),
  source TEXT NOT NULL CHECK (source IN ('AUTOMATIC', 'MANUAL')),
  status TEXT NOT NULL DEFAULT 'ACTIVE'
    CHECK (status IN ('ACTIVE', 'LIFTED', 'EXEMPTED', 'EXPIRED')),
  applied_by TEXT,
  applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at TEXT,
  lifted_by TEXT,
  lifted_at TEXT,
  lift_reason TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (institution_id) REFERENCES institutions(id) ON DELETE RESTRICT,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE RESTRICT,
  FOREIGN KEY (applied_by) REFERENCES users(id) ON DELETE SET NULL,
  FOREIGN KEY (lifted_by) REFERENCES users(id) ON DELETE SET NULL,
  CHECK (
    (status = 'ACTIVE' AND lifted_at IS NULL)
    OR status IN ('LIFTED', 'EXEMPTED', 'EXPIRED')
  )
);

CREATE INDEX restrictions_user_status_idx
  ON restrictions(institution_id, user_id, status, applied_at DESC);

CREATE INDEX restrictions_expiry_idx
  ON restrictions(institution_id, status, expires_at)
  WHERE status = 'ACTIVE' AND expires_at IS NOT NULL;
