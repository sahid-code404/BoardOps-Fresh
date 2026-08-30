-- Post-Phase-05 integration — Meal configuration core
-- Ports the golden-master MealConfiguration surface into canonical D1 while
-- preserving Phase 05's explicit, fail-closed permission boundary.
PRAGMA foreign_keys = ON;

CREATE TABLE meal_configurations (
  id TEXT PRIMARY KEY,
  institution_id TEXT NOT NULL,
  name TEXT NOT NULL,
  display_name TEXT NOT NULL,
  description TEXT,
  icon TEXT NOT NULL DEFAULT '🍽️',
  color TEXT NOT NULL DEFAULT '#8b5cf6',
  meal_type TEXT NOT NULL DEFAULT 'REGULAR'
    CHECK (meal_type IN ('REGULAR', 'SPECIAL', 'GUEST_ONLY', 'FESTIVAL', 'CUSTOM')),
  status TEXT NOT NULL DEFAULT 'ACTIVE'
    CHECK (status IN ('ACTIVE', 'INACTIVE', 'ARCHIVED')),
  display_order INTEGER NOT NULL DEFAULT 0 CHECK (display_order >= 0),
  default_state TEXT NOT NULL DEFAULT 'ON' CHECK (default_state IN ('ON', 'OFF')),
  default_visibility TEXT NOT NULL DEFAULT 'VISIBLE'
    CHECK (default_visibility IN ('VISIBLE', 'HIDDEN')),
  cutoff_strategy TEXT NOT NULL DEFAULT 'SAME_DAY'
    CHECK (cutoff_strategy IN ('PREVIOUS_DAY', 'SAME_DAY', 'CUSTOM_OFFSET')),
  cutoff_offset_minutes INTEGER NOT NULL DEFAULT 0
    CHECK (cutoff_offset_minutes >= 0 AND cutoff_offset_minutes <= 1440),
  cutoff_time TEXT NOT NULL DEFAULT '16:00',
  start_time TEXT NOT NULL DEFAULT '08:00',
  end_time TEXT NOT NULL DEFAULT '10:00',
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (institution_id) REFERENCES institutions(id) ON DELETE CASCADE,
  UNIQUE (institution_id, name)
);

CREATE INDEX meal_configurations_institution_status_order_idx
  ON meal_configurations(institution_id, status, display_order, created_at);

INSERT INTO permissions (id, permission_key, feature, action, description) VALUES
  ('perm_meals_config_read', 'meals.config.read', 'meals', 'config_read', 'View institution meal configuration'),
  ('perm_meals_config_create', 'meals.config.create', 'meals', 'config_create', 'Create meal configuration'),
  ('perm_meals_config_update', 'meals.config.update', 'meals', 'config_update', 'Update meal configuration and status'),
  ('perm_meals_config_delete', 'meals.config.delete', 'meals', 'config_delete', 'Delete meal configuration');

-- Reading active meal configuration is required by resident meal experiences,
-- so every authenticated role receives read access. Mutation privileges remain
-- limited to institution administrators.
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
JOIN permissions p ON p.permission_key = 'meals.config.read';

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
JOIN permissions p ON p.permission_key IN (
  'meals.config.create',
  'meals.config.update',
  'meals.config.delete'
)
WHERE r.role_key IN ('ADMIN', 'SUPER_ADMIN');

-- 0006 installed the institution bootstrap trigger before meal permissions
-- existed. Recreate it so institutions provisioned after this migration receive
-- the complete current RBAC baseline, including meal configuration grants.
DROP TRIGGER IF EXISTS institutions_bootstrap_rbac;

CREATE TRIGGER institutions_bootstrap_rbac
AFTER INSERT ON institutions
BEGIN
  INSERT INTO roles (id, institution_id, role_key, name, description, is_system)
  VALUES (NEW.id || ':role:SUPER_ADMIN', NEW.id, 'SUPER_ADMIN', 'Super Admin', 'System administrator role', 1);

  INSERT INTO roles (id, institution_id, role_key, name, description, is_system)
  VALUES (NEW.id || ':role:ADMIN', NEW.id, 'ADMIN', 'Admin', 'Institution administrator role', 1);

  INSERT INTO roles (id, institution_id, role_key, name, description, is_system)
  VALUES (NEW.id || ':role:MANAGER', NEW.id, 'MANAGER', 'Manager', 'Institution manager role', 1);

  INSERT INTO roles (id, institution_id, role_key, name, description, is_system)
  VALUES (NEW.id || ':role:USER', NEW.id, 'USER', 'Resident', 'Standard resident role', 1);

  INSERT INTO role_permissions (role_id, permission_id)
  SELECT r.id, p.id
  FROM roles r
  JOIN permissions p ON p.permission_key IN (
    'dashboard.read',
    'notifications.read_self',
    'profile.read_self',
    'profile.update_self',
    'sessions.read_self',
    'sessions.revoke_self',
    'password.change_self',
    'avatar.update_self',
    'meals.config.read'
  )
  WHERE r.institution_id = NEW.id;

  INSERT INTO role_permissions (role_id, permission_id)
  SELECT r.id, p.id
  FROM roles r
  JOIN permissions p ON p.permission_key IN (
    'audit.read',
    'users.read',
    'users.approve',
    'users.request_changes',
    'users.reject',
    'users.status_change',
    'users.role_assign',
    'users.update',
    'users.delete',
    'users.restore',
    'meals.config.create',
    'meals.config.update',
    'meals.config.delete'
  )
  WHERE r.institution_id = NEW.id
    AND r.role_key IN ('ADMIN', 'SUPER_ADMIN');
END;
