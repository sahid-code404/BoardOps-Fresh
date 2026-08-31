-- Meal Configuration integrity hardening
-- Preserve source-compatible creation/update semantics while preventing the
-- golden hard-delete cascade from erasing canonical meal evidence.
PRAGMA foreign_keys = ON;

-- The internal name is a durable system identifier. The golden update API did
-- not allow it to change, and current Formula/closing/reporting code may derive
-- runtime identifiers from it.
CREATE TRIGGER meal_configurations_internal_name_immutable
BEFORE UPDATE OF name ON meal_configurations
WHEN NEW.name <> OLD.name
BEGIN
  SELECT RAISE(ABORT, 'meal configuration internal name is immutable');
END;

-- Golden creation always produced ACTIVE meals. Keep that invariant at the
-- storage boundary so direct D1 writes cannot create a configuration in a
-- lifecycle state the owning API never publishes initially.
CREATE TRIGGER meal_configurations_require_active_insert
BEFORE INSERT ON meal_configurations
WHEN NEW.status <> 'ACTIVE'
BEGIN
  SELECT RAISE(ABORT, 'new meal configuration must start ACTIVE');
END;

-- Once a configuration owns operational evidence it becomes durable history.
-- Archive/inactivate it instead of allowing the legacy ON DELETE CASCADE graph
-- to erase resident meals, guest meals, or override evidence.
CREATE TRIGGER meal_configurations_preserve_evidence_delete
BEFORE DELETE ON meal_configurations
WHEN EXISTS (
       SELECT 1 FROM meal_entries
        WHERE institution_id = OLD.institution_id AND meal_id = OLD.id
     )
   OR EXISTS (
       SELECT 1 FROM guest_meals
        WHERE institution_id = OLD.institution_id AND meal_id = OLD.id
     )
   OR EXISTS (
       SELECT 1 FROM meal_overrides
        WHERE institution_id = OLD.institution_id AND meal_id = OLD.id
     )
BEGIN
  SELECT RAISE(ABORT, 'meal configuration with historical evidence cannot be deleted');
END;
