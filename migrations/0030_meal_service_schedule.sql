-- Meal service scheduling — recurring daily or one specific service date.
PRAGMA foreign_keys = ON;

ALTER TABLE meal_configurations
  ADD COLUMN service_schedule TEXT NOT NULL DEFAULT 'DAILY'
    CHECK (service_schedule IN ('DAILY', 'DATE_SPECIFIC'));

ALTER TABLE meal_configurations
  ADD COLUMN service_date TEXT;

CREATE INDEX meal_configurations_institution_service_schedule_idx
  ON meal_configurations(institution_id, service_schedule, service_date, status);

CREATE TRIGGER meal_configurations_service_schedule_insert_guard
BEFORE INSERT ON meal_configurations
WHEN
  (NEW.service_schedule = 'DAILY' AND NEW.service_date IS NOT NULL)
  OR
  (NEW.service_schedule = 'DATE_SPECIFIC' AND (
    NEW.service_date IS NULL
    OR length(NEW.service_date) <> 10
    OR date(NEW.service_date) IS NULL
    OR strftime('%Y-%m-%d', NEW.service_date) <> NEW.service_date
  ))
BEGIN
  SELECT RAISE(ABORT, 'Invalid meal service schedule/date');
END;

CREATE TRIGGER meal_configurations_service_schedule_update_guard
BEFORE UPDATE OF service_schedule, service_date ON meal_configurations
WHEN
  (NEW.service_schedule = 'DAILY' AND NEW.service_date IS NOT NULL)
  OR
  (NEW.service_schedule = 'DATE_SPECIFIC' AND (
    NEW.service_date IS NULL
    OR length(NEW.service_date) <> 10
    OR date(NEW.service_date) IS NULL
    OR strftime('%Y-%m-%d', NEW.service_date) <> NEW.service_date
  ))
BEGIN
  SELECT RAISE(ABORT, 'Invalid meal service schedule/date');
END;
