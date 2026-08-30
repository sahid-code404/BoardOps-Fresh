-- Settings / Policies / Holidays — authoritative institution configuration and calendar rules
-- This migration is immutable once released. Configuration is institution-scoped,
-- mutations are permission-controlled, and meals-disabled holidays are enforced at D1.
PRAGMA foreign_keys = ON;

ALTER TABLE institutions ADD COLUMN type TEXT NOT NULL DEFAULT 'HOSTEL'
  CHECK (type IN ('HOSTEL','PG','COLLEGE','COMPANY_ACCOMMODATION','NGO','TRAINING_INSTITUTE','RESIDENTIAL_SCHOOL','BOARDING_HOUSE','UNIVERSITY'));
ALTER TABLE institutions ADD COLUMN address TEXT;
ALTER TABLE institutions ADD COLUMN contact_email TEXT;
ALTER TABLE institutions ADD COLUMN contact_phone TEXT;
ALTER TABLE institutions ADD COLUMN logo_url TEXT;

CREATE TABLE settings (
  id TEXT PRIMARY KEY,
  institution_id TEXT NOT NULL,
  key TEXT NOT NULL,
  value TEXT NOT NULL,
  category TEXT NOT NULL
    CHECK (category IN ('INSTITUTION','FEATURE_FLAG','BILLING','NOTIFICATIONS','SECURITY','UI','GENERAL')),
  type TEXT NOT NULL CHECK (type IN ('TEXT','NUMBER','BOOLEAN','JSON')),
  description TEXT,
  is_public INTEGER NOT NULL DEFAULT 0 CHECK (is_public IN (0, 1)),
  created_by TEXT,
  updated_by TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (institution_id) REFERENCES institutions(id) ON DELETE RESTRICT,
  FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL,
  FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE SET NULL,
  UNIQUE (institution_id, key),
  CHECK (length(trim(key)) BETWEEN 2 AND 120),
  CHECK (length(value) <= 20000),
  CHECK (type <> 'BOOLEAN' OR value IN ('true', 'false')),
  CHECK (type <> 'JSON' OR json_valid(value))
);

CREATE INDEX settings_institution_category_idx
  ON settings(institution_id, category, key);
CREATE INDEX settings_public_idx
  ON settings(institution_id, is_public, category);

CREATE TABLE policies (
  id TEXT PRIMARY KEY,
  institution_id TEXT NOT NULL,
  key TEXT NOT NULL,
  category TEXT NOT NULL
    CHECK (category IN ('FINANCIAL','MEAL','BILLING','PAYMENT','NOTIFICATION','AUTH')),
  value TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('TEXT','NUMBER','BOOLEAN')),
  description TEXT NOT NULL DEFAULT '',
  updated_by TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (institution_id) REFERENCES institutions(id) ON DELETE RESTRICT,
  FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE SET NULL,
  UNIQUE (institution_id, key),
  CHECK (length(trim(key)) BETWEEN 2 AND 120),
  CHECK (length(value) <= 2000),
  CHECK (type <> 'BOOLEAN' OR value IN ('true', 'false'))
);

CREATE INDEX policies_institution_category_idx
  ON policies(institution_id, category, key);

CREATE TABLE holidays (
  id TEXT PRIMARY KEY,
  institution_id TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  type TEXT NOT NULL
    CHECK (type IN ('HOLIDAY','FESTIVAL','SPECIAL_MEAL','BILLING_DAY','REFUND_DAY','MAINTENANCE')),
  start_date TEXT NOT NULL,
  end_date TEXT NOT NULL,
  meals_disabled INTEGER NOT NULL DEFAULT 1 CHECK (meals_disabled IN (0, 1)),
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','ARCHIVED')),
  created_by TEXT,
  archived_by TEXT,
  archived_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (institution_id) REFERENCES institutions(id) ON DELETE RESTRICT,
  FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL,
  FOREIGN KEY (archived_by) REFERENCES users(id) ON DELETE SET NULL,
  CHECK (length(trim(name)) BETWEEN 2 AND 120),
  CHECK (length(start_date) = 10 AND length(end_date) = 10),
  CHECK (start_date <= end_date),
  CHECK ((status = 'ARCHIVED' AND archived_at IS NOT NULL) OR status = 'ACTIVE')
);

CREATE INDEX holidays_institution_status_date_idx
  ON holidays(institution_id, status, start_date, end_date);
CREATE INDEX holidays_meal_block_idx
  ON holidays(institution_id, meals_disabled, status, start_date, end_date);

-- Holiday records are operational/calendar history. The API archives them; physical
-- deletion is rejected so old dates cannot silently disappear from audit context.
CREATE TRIGGER holidays_block_delete
BEFORE DELETE ON holidays
BEGIN
  SELECT RAISE(ABORT, 'holidays must be archived, not deleted');
END;

-- A meals-disabled ACTIVE holiday is a database-level booking boundary. This
-- protects future/new write paths as well as today's API handlers from bypassing
-- the calendar rule. OFF rows remain legal so leave/cancellation evidence can be stored.
CREATE TRIGGER meal_entries_block_holiday_on_insert
BEFORE INSERT ON meal_entries
WHEN NEW.status IN ('ON', 'LOCKED')
 AND EXISTS (
   SELECT 1 FROM holidays h
   WHERE h.institution_id = NEW.institution_id
     AND h.status = 'ACTIVE'
     AND h.meals_disabled = 1
     AND NEW.service_date BETWEEN h.start_date AND h.end_date
 )
BEGIN
  SELECT RAISE(ABORT, 'meal booking disabled by active holiday');
END;

CREATE TRIGGER meal_entries_block_holiday_on_update
BEFORE UPDATE ON meal_entries
WHEN NEW.status IN ('ON', 'LOCKED')
 AND EXISTS (
   SELECT 1 FROM holidays h
   WHERE h.institution_id = NEW.institution_id
     AND h.status = 'ACTIVE'
     AND h.meals_disabled = 1
     AND NEW.service_date BETWEEN h.start_date AND h.end_date
 )
BEGIN
  SELECT RAISE(ABORT, 'meal booking disabled by active holiday');
END;

CREATE TRIGGER guest_meals_block_holiday_on_insert
BEFORE INSERT ON guest_meals
WHEN EXISTS (
  SELECT 1 FROM holidays h
  WHERE h.institution_id = NEW.institution_id
    AND h.status = 'ACTIVE'
    AND h.meals_disabled = 1
    AND NEW.service_date BETWEEN h.start_date AND h.end_date
)
BEGIN
  SELECT RAISE(ABORT, 'meal booking disabled by active holiday');
END;

CREATE TRIGGER guest_meals_block_holiday_on_update
BEFORE UPDATE ON guest_meals
WHEN EXISTS (
  SELECT 1 FROM holidays h
  WHERE h.institution_id = NEW.institution_id
    AND h.status = 'ACTIVE'
    AND h.meals_disabled = 1
    AND NEW.service_date BETWEEN h.start_date AND h.end_date
)
BEGIN
  SELECT RAISE(ABORT, 'meal booking disabled by active holiday');
END;

INSERT INTO permissions (id, permission_key, feature, action, description) VALUES
  ('perm_settings_read', 'settings.read', 'settings', 'read', 'Read institution settings visible to the caller'),
  ('perm_settings_write', 'settings.write', 'settings', 'write', 'Create or update institution settings'),
  ('perm_settings_delete', 'settings.delete', 'settings', 'delete', 'Delete institution settings'),
  ('perm_institution_read', 'institution.read', 'institution', 'read', 'Read the institution profile'),
  ('perm_institution_update', 'institution.update', 'institution', 'update', 'Update the institution profile'),
  ('perm_policies_read', 'policies.read', 'policies', 'read', 'Read institution policy values'),
  ('perm_policies_update', 'policies.update', 'policies', 'update', 'Update registered institution policy values'),
  ('perm_holidays_read', 'holidays.read', 'holidays', 'read', 'Read institution holidays and calendar rules'),
  ('perm_holidays_create', 'holidays.create', 'holidays', 'create', 'Create institution holidays'),
  ('perm_holidays_update', 'holidays.update', 'holidays', 'update', 'Update institution holidays'),
  ('perm_holidays_archive', 'holidays.archive', 'holidays', 'archive', 'Archive institution holidays');

-- Safe read-only configuration/calendar access is available to every authenticated
-- canonical role. All writes remain administrator-only.
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
JOIN permissions p ON p.permission_key IN (
  'settings.read','institution.read','policies.read','holidays.read'
);

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
JOIN permissions p ON p.permission_key IN (
  'settings.write','settings.delete','institution.update','policies.update',
  'holidays.create','holidays.update','holidays.archive'
)
WHERE r.role_key IN ('ADMIN', 'SUPER_ADMIN');

-- Future institutions inherit the same least-privilege baseline when their roles
-- are created by the existing institution bootstrap chain.
CREATE TRIGGER roles_bootstrap_settings_policy_holiday_read
AFTER INSERT ON roles
BEGIN
  INSERT OR IGNORE INTO role_permissions (role_id, permission_id)
  SELECT NEW.id, p.id
  FROM permissions p
  WHERE p.permission_key IN ('settings.read','institution.read','policies.read','holidays.read');
END;

CREATE TRIGGER roles_bootstrap_settings_policy_holiday_admin
AFTER INSERT ON roles
WHEN NEW.role_key IN ('ADMIN', 'SUPER_ADMIN')
BEGIN
  INSERT OR IGNORE INTO role_permissions (role_id, permission_id)
  SELECT NEW.id, p.id
  FROM permissions p
  WHERE p.permission_key IN (
    'settings.write','settings.delete','institution.update','policies.update',
    'holidays.create','holidays.update','holidays.archive'
  );
END;
