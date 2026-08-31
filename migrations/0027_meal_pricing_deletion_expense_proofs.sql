-- Explicit product rules: per-meal pricing, deferred meal deletion, and expense proof metadata.
PRAGMA foreign_keys = ON;

ALTER TABLE meal_configurations
  ADD COLUMN pricing_mode TEXT NOT NULL DEFAULT 'FORMULA'
  CHECK (pricing_mode IN ('FORMULA', 'FIXED'));
ALTER TABLE meal_configurations
  ADD COLUMN fixed_price_minor INTEGER
  CHECK (fixed_price_minor IS NULL OR fixed_price_minor > 0);
ALTER TABLE meal_configurations ADD COLUMN deletion_requested_at TEXT;
ALTER TABLE meal_configurations ADD COLUMN deletion_requested_by TEXT;
ALTER TABLE meal_configurations ADD COLUMN deletion_eligible_month INTEGER
  CHECK (deletion_eligible_month IS NULL OR (deletion_eligible_month >= 0 AND deletion_eligible_month <= 11));
ALTER TABLE meal_configurations ADD COLUMN deletion_eligible_year INTEGER
  CHECK (deletion_eligible_year IS NULL OR deletion_eligible_year >= 2000);
ALTER TABLE meal_configurations ADD COLUMN deletion_reason TEXT;
ALTER TABLE meal_configurations ADD COLUMN deletion_completed_at TEXT;

CREATE INDEX meal_configurations_deletion_queue_idx
  ON meal_configurations(institution_id, deletion_completed_at, deletion_eligible_year, deletion_eligible_month)
  WHERE deletion_requested_at IS NOT NULL;

CREATE TRIGGER meal_configurations_pricing_insert
BEFORE INSERT ON meal_configurations
WHEN (NEW.pricing_mode = 'FIXED' AND (NEW.fixed_price_minor IS NULL OR NEW.fixed_price_minor <= 0))
  OR (NEW.pricing_mode = 'FORMULA' AND NEW.fixed_price_minor IS NOT NULL)
BEGIN
  SELECT RAISE(ABORT, 'meal pricing mode and fixed price are inconsistent');
END;

CREATE TRIGGER meal_configurations_pricing_update
BEFORE UPDATE OF pricing_mode, fixed_price_minor ON meal_configurations
WHEN (NEW.pricing_mode = 'FIXED' AND (NEW.fixed_price_minor IS NULL OR NEW.fixed_price_minor <= 0))
  OR (NEW.pricing_mode = 'FORMULA' AND NEW.fixed_price_minor IS NOT NULL)
BEGIN
  SELECT RAISE(ABORT, 'meal pricing mode and fixed price are inconsistent');
END;

CREATE TABLE expense_proofs (
  id TEXT PRIMARY KEY,
  institution_id TEXT NOT NULL,
  expense_id TEXT NOT NULL,
  object_key TEXT NOT NULL,
  file_name TEXT NOT NULL,
  content_type TEXT NOT NULL,
  size_bytes INTEGER NOT NULL CHECK (size_bytes > 0),
  uploaded_by TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (institution_id) REFERENCES institutions(id) ON DELETE RESTRICT,
  FOREIGN KEY (expense_id) REFERENCES expenses(id) ON DELETE RESTRICT,
  FOREIGN KEY (uploaded_by) REFERENCES users(id) ON DELETE RESTRICT,
  UNIQUE (institution_id, object_key)
);

CREATE INDEX expense_proofs_expense_idx
  ON expense_proofs(institution_id, expense_id, created_at DESC);

CREATE TRIGGER expense_proofs_same_institution
BEFORE INSERT ON expense_proofs
WHEN NOT EXISTS (
  SELECT 1 FROM expenses e
   WHERE e.id = NEW.expense_id AND e.institution_id = NEW.institution_id
)
BEGIN
  SELECT RAISE(ABORT, 'expense proof institution mismatch');
END;

CREATE TRIGGER expense_proofs_block_update
BEFORE UPDATE ON expense_proofs
BEGIN
  SELECT RAISE(ABORT, 'expense proof metadata is immutable');
END;

CREATE TRIGGER expense_proofs_block_delete
BEFORE DELETE ON expense_proofs
BEGIN
  SELECT RAISE(ABORT, 'expense proof metadata cannot be hard-deleted');
END;