-- Service-time ordering for meal configurations.
-- display_order remains as a compatibility/read-model column for older queries,
-- but it is now derived from start_time rather than chosen by administrators.
PRAGMA foreign_keys = ON;

-- Normalize existing rows into a dense, deterministic order per institution.
-- Ties are resolved by end_time, created_at, then id so every row gets one
-- stable position while the primary ordering remains service start time.
UPDATE meal_configurations
SET display_order = (
  SELECT COUNT(*)
  FROM meal_configurations AS earlier
  WHERE earlier.institution_id = meal_configurations.institution_id
    AND earlier.deletion_finalized_at IS NULL
    AND (
      earlier.start_time < meal_configurations.start_time
      OR (
        earlier.start_time = meal_configurations.start_time
        AND earlier.end_time < meal_configurations.end_time
      )
      OR (
        earlier.start_time = meal_configurations.start_time
        AND earlier.end_time = meal_configurations.end_time
        AND earlier.created_at < meal_configurations.created_at
      )
      OR (
        earlier.start_time = meal_configurations.start_time
        AND earlier.end_time = meal_configurations.end_time
        AND earlier.created_at = meal_configurations.created_at
        AND earlier.id < meal_configurations.id
      )
    )
)
WHERE deletion_finalized_at IS NULL;

DROP TRIGGER IF EXISTS meal_configurations_auto_order_insert;
CREATE TRIGGER meal_configurations_auto_order_insert
AFTER INSERT ON meal_configurations
BEGIN
  UPDATE meal_configurations
  SET display_order = (
    SELECT COUNT(*)
    FROM meal_configurations AS earlier
    WHERE earlier.institution_id = meal_configurations.institution_id
      AND earlier.deletion_finalized_at IS NULL
      AND (
        earlier.start_time < meal_configurations.start_time
        OR (
          earlier.start_time = meal_configurations.start_time
          AND earlier.end_time < meal_configurations.end_time
        )
        OR (
          earlier.start_time = meal_configurations.start_time
          AND earlier.end_time = meal_configurations.end_time
          AND earlier.created_at < meal_configurations.created_at
        )
        OR (
          earlier.start_time = meal_configurations.start_time
          AND earlier.end_time = meal_configurations.end_time
          AND earlier.created_at = meal_configurations.created_at
          AND earlier.id < meal_configurations.id
        )
      )
  )
  WHERE institution_id = NEW.institution_id
    AND deletion_finalized_at IS NULL;
END;

DROP TRIGGER IF EXISTS meal_configurations_auto_order_time_update;
CREATE TRIGGER meal_configurations_auto_order_time_update
AFTER UPDATE OF start_time, end_time ON meal_configurations
BEGIN
  UPDATE meal_configurations
  SET display_order = (
    SELECT COUNT(*)
    FROM meal_configurations AS earlier
    WHERE earlier.institution_id = meal_configurations.institution_id
      AND earlier.deletion_finalized_at IS NULL
      AND (
        earlier.start_time < meal_configurations.start_time
        OR (
          earlier.start_time = meal_configurations.start_time
          AND earlier.end_time < meal_configurations.end_time
        )
        OR (
          earlier.start_time = meal_configurations.start_time
          AND earlier.end_time = meal_configurations.end_time
          AND earlier.created_at < meal_configurations.created_at
        )
        OR (
          earlier.start_time = meal_configurations.start_time
          AND earlier.end_time = meal_configurations.end_time
          AND earlier.created_at = meal_configurations.created_at
          AND earlier.id < meal_configurations.id
        )
      )
  )
  WHERE institution_id = NEW.institution_id
    AND deletion_finalized_at IS NULL;
END;

CREATE INDEX IF NOT EXISTS meal_configurations_institution_status_time_idx
  ON meal_configurations(institution_id, status, start_time, end_time, created_at);
