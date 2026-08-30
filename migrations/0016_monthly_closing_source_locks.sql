-- Monthly Closing source freeze hardening.
--
-- The closing workflow marks accounting_periods CLOSING before it freezes live
-- source rows. These database guards make that lock authoritative across every
-- route and concurrent request: once a period is CLOSING or CLOSED, canonical
-- meal/guest/expense source data for that month cannot be inserted, rewritten,
-- moved into/out of the period, or deleted. Post-close financial corrections
-- must use the verified adjustment/reversal mechanisms instead.
PRAGMA foreign_keys = ON;

CREATE TRIGGER meal_entries_block_locked_period_insert
BEFORE INSERT ON meal_entries
WHEN EXISTS (
  SELECT 1
    FROM accounting_periods ap
   WHERE ap.institution_id = NEW.institution_id
     AND ap.period_key = substr(NEW.service_date, 1, 7)
     AND ap.status <> 'OPEN'
)
BEGIN
  SELECT RAISE(ABORT, 'meal source period is closing or closed');
END;

CREATE TRIGGER meal_entries_block_locked_period_update
BEFORE UPDATE ON meal_entries
WHEN EXISTS (
  SELECT 1
    FROM accounting_periods ap
   WHERE ap.institution_id = OLD.institution_id
     AND ap.period_key = substr(OLD.service_date, 1, 7)
     AND ap.status <> 'OPEN'
) OR EXISTS (
  SELECT 1
    FROM accounting_periods ap
   WHERE ap.institution_id = NEW.institution_id
     AND ap.period_key = substr(NEW.service_date, 1, 7)
     AND ap.status <> 'OPEN'
)
BEGIN
  SELECT RAISE(ABORT, 'meal source period is closing or closed');
END;

CREATE TRIGGER meal_entries_block_locked_period_delete
BEFORE DELETE ON meal_entries
WHEN EXISTS (
  SELECT 1
    FROM accounting_periods ap
   WHERE ap.institution_id = OLD.institution_id
     AND ap.period_key = substr(OLD.service_date, 1, 7)
     AND ap.status <> 'OPEN'
)
BEGIN
  SELECT RAISE(ABORT, 'meal source period is closing or closed');
END;

CREATE TRIGGER guest_meals_block_locked_period_insert
BEFORE INSERT ON guest_meals
WHEN EXISTS (
  SELECT 1
    FROM accounting_periods ap
   WHERE ap.institution_id = NEW.institution_id
     AND ap.period_key = substr(NEW.service_date, 1, 7)
     AND ap.status <> 'OPEN'
)
BEGIN
  SELECT RAISE(ABORT, 'guest meal source period is closing or closed');
END;

CREATE TRIGGER guest_meals_block_locked_period_update
BEFORE UPDATE ON guest_meals
WHEN EXISTS (
  SELECT 1
    FROM accounting_periods ap
   WHERE ap.institution_id = OLD.institution_id
     AND ap.period_key = substr(OLD.service_date, 1, 7)
     AND ap.status <> 'OPEN'
) OR EXISTS (
  SELECT 1
    FROM accounting_periods ap
   WHERE ap.institution_id = NEW.institution_id
     AND ap.period_key = substr(NEW.service_date, 1, 7)
     AND ap.status <> 'OPEN'
)
BEGIN
  SELECT RAISE(ABORT, 'guest meal source period is closing or closed');
END;

CREATE TRIGGER guest_meals_block_locked_period_delete
BEFORE DELETE ON guest_meals
WHEN EXISTS (
  SELECT 1
    FROM accounting_periods ap
   WHERE ap.institution_id = OLD.institution_id
     AND ap.period_key = substr(OLD.service_date, 1, 7)
     AND ap.status <> 'OPEN'
)
BEGIN
  SELECT RAISE(ABORT, 'guest meal source period is closing or closed');
END;

CREATE TRIGGER expenses_block_locked_period_insert
BEFORE INSERT ON expenses
WHEN EXISTS (
  SELECT 1
    FROM accounting_periods ap
   WHERE ap.institution_id = NEW.institution_id
     AND ap.period_key = substr(NEW.expense_date, 1, 7)
     AND ap.status <> 'OPEN'
)
BEGIN
  SELECT RAISE(ABORT, 'expense source period is closing or closed');
END;

CREATE TRIGGER expenses_block_locked_period_update
BEFORE UPDATE ON expenses
WHEN EXISTS (
  SELECT 1
    FROM accounting_periods ap
   WHERE ap.institution_id = OLD.institution_id
     AND ap.period_key = substr(OLD.expense_date, 1, 7)
     AND ap.status <> 'OPEN'
) OR EXISTS (
  SELECT 1
    FROM accounting_periods ap
   WHERE ap.institution_id = NEW.institution_id
     AND ap.period_key = substr(NEW.expense_date, 1, 7)
     AND ap.status <> 'OPEN'
)
BEGIN
  SELECT RAISE(ABORT, 'expense source period is closing or closed');
END;

CREATE TRIGGER expenses_block_locked_period_delete
BEFORE DELETE ON expenses
WHEN EXISTS (
  SELECT 1
    FROM accounting_periods ap
   WHERE ap.institution_id = OLD.institution_id
     AND ap.period_key = substr(OLD.expense_date, 1, 7)
     AND ap.status <> 'OPEN'
)
BEGIN
  SELECT RAISE(ABORT, 'expense source period is closing or closed');
END;
