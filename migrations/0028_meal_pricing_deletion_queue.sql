-- Meal pricing modes and settlement-gated configuration deletion queue.
PRAGMA foreign_keys = ON;

ALTER TABLE meal_configurations ADD COLUMN pricing_mode TEXT NOT NULL DEFAULT 'FORMULA'
  CHECK (pricing_mode IN ('FORMULA', 'FIXED'));
ALTER TABLE meal_configurations ADD COLUMN fixed_price_minor INTEGER
  CHECK (fixed_price_minor IS NULL OR (typeof(fixed_price_minor) = 'integer' AND fixed_price_minor > 0));
ALTER TABLE meal_configurations ADD COLUMN deletion_requested_at TEXT;
ALTER TABLE meal_configurations ADD COLUMN deletion_eligible_month INTEGER
  CHECK (deletion_eligible_month IS NULL OR deletion_eligible_month BETWEEN 0 AND 11);
ALTER TABLE meal_configurations ADD COLUMN deletion_eligible_year INTEGER
  CHECK (deletion_eligible_year IS NULL OR deletion_eligible_year >= 2000);
ALTER TABLE meal_configurations ADD COLUMN deletion_requested_by TEXT;
ALTER TABLE meal_configurations ADD COLUMN deletion_finalized_at TEXT;

CREATE INDEX meal_configurations_deletion_queue_idx
  ON meal_configurations(
    institution_id, deletion_finalized_at, deletion_eligible_year, deletion_eligible_month
  )
  WHERE deletion_requested_at IS NOT NULL;

-- Configuration removal is now an application-owned settlement-gated queue.
-- Keep every historical row for bill/snapshot/meal-entry referential integrity.
DROP TRIGGER IF EXISTS meal_configurations_preserve_evidence_delete;
DROP TRIGGER IF EXISTS meal_configurations_block_hard_delete;
CREATE TRIGGER meal_configurations_block_hard_delete
BEFORE DELETE ON meal_configurations
BEGIN
  SELECT RAISE(ABORT, 'meal configurations are historical records; use the deletion queue');
END;
