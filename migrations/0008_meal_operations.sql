-- Post-Phase-05 integration — resident meal operations + kitchen counts
-- Adds the canonical D1 state required by the golden Kitchen/Counts surface
-- without weakening Phase 05's explicit fail-closed authorization boundary.
PRAGMA foreign_keys = ON;

CREATE TABLE meal_entries (
  id TEXT PRIMARY KEY,
  institution_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  meal_id TEXT NOT NULL,
  service_date TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'OFF'
    CHECK (status IN ('ON', 'OFF', 'LOCKED')),
  original_state TEXT NOT NULL DEFAULT 'OFF'
    CHECK (original_state IN ('ON', 'OFF')),
  editable_until TEXT NOT NULL,
  locked INTEGER NOT NULL DEFAULT 0 CHECK (locked IN (0, 1)),
  notes TEXT,
  updated_by TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (institution_id) REFERENCES institutions(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (meal_id) REFERENCES meal_configurations(id) ON DELETE CASCADE,
  FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE SET NULL,
  UNIQUE (institution_id, user_id, meal_id, service_date)
);

CREATE INDEX meal_entries_institution_service_idx
  ON meal_entries(institution_id, service_date, meal_id, status);
CREATE INDEX meal_entries_user_service_idx
  ON meal_entries(institution_id, user_id, service_date);

CREATE TABLE guest_meals (
  id TEXT PRIMARY KEY,
  institution_id TEXT NOT NULL,
  meal_id TEXT NOT NULL,
  host_user_id TEXT,
  guest_name TEXT NOT NULL,
  guest_count INTEGER NOT NULL DEFAULT 1 CHECK (guest_count >= 1 AND guest_count <= 100),
  service_date TEXT NOT NULL,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (institution_id) REFERENCES institutions(id) ON DELETE CASCADE,
  FOREIGN KEY (meal_id) REFERENCES meal_configurations(id) ON DELETE CASCADE,
  FOREIGN KEY (host_user_id) REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX guest_meals_institution_service_idx
  ON guest_meals(institution_id, service_date, meal_id);

CREATE TABLE meal_overrides (
  id TEXT PRIMARY KEY,
  institution_id TEXT NOT NULL,
  meal_entry_id TEXT NOT NULL,
  meal_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  service_date TEXT NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('TURN_ON', 'TURN_OFF', 'LOCK', 'UNLOCK')),
  reason TEXT NOT NULL,
  admin_id TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (institution_id) REFERENCES institutions(id) ON DELETE CASCADE,
  FOREIGN KEY (meal_entry_id) REFERENCES meal_entries(id) ON DELETE CASCADE,
  FOREIGN KEY (meal_id) REFERENCES meal_configurations(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (admin_id) REFERENCES users(id) ON DELETE RESTRICT
);

CREATE INDEX meal_overrides_institution_service_idx
  ON meal_overrides(institution_id, service_date, meal_id, user_id);

CREATE TABLE leave_applications (
  id TEXT PRIMARY KEY,
  institution_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  start_date TEXT NOT NULL,
  end_date TEXT NOT NULL,
  reason TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'PENDING'
    CHECK (status IN ('PENDING', 'APPROVED', 'REJECTED')),
  approved_by TEXT,
  meal_type TEXT NOT NULL DEFAULT 'ALL'
    CHECK (meal_type IN ('ALL', 'SPECIFIC')),
  meal_ids_json TEXT,
  admin_notes TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (institution_id) REFERENCES institutions(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (approved_by) REFERENCES users(id) ON DELETE SET NULL,
  CHECK (end_date >= start_date)
);

CREATE INDEX leave_applications_user_status_idx
  ON leave_applications(institution_id, user_id, status, created_at);
CREATE INDEX leave_applications_status_start_idx
  ON leave_applications(institution_id, status, start_date, created_at);

INSERT INTO permissions (id, permission_key, feature, action, description) VALUES
  ('perm_kitchen_read', 'kitchen.read', 'kitchen', 'read', 'View institution meal counts and resident meal status'),
  ('perm_kitchen_guest_create', 'kitchen.guest.create', 'kitchen', 'guest_create', 'Add guest meal counts'),
  ('perm_kitchen_guest_delete', 'kitchen.guest.delete', 'kitchen', 'guest_delete', 'Remove guest meal counts'),
  ('perm_meals_override', 'meals.override', 'meals', 'override', 'Override a locked resident meal current state'),
  ('perm_leave_read', 'leave.read', 'leave', 'read', 'Read leave applications within the caller scope'),
  ('perm_leave_create', 'leave.create', 'leave', 'create', 'Create a leave application for the current user'),
  ('perm_leave_decide', 'leave.decide', 'leave', 'decide', 'Approve or reject institution leave applications');

-- Kitchen read is operationally useful to managers. Guest adjustments,
-- overrides, and leave decisions remain administrator-only.
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
JOIN permissions p ON p.permission_key = 'kitchen.read'
WHERE r.role_key IN ('MANAGER', 'ADMIN', 'SUPER_ADMIN');

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
JOIN permissions p ON p.permission_key IN (
  'kitchen.guest.create',
  'kitchen.guest.delete',
  'meals.override',
  'leave.decide'
)
WHERE r.role_key IN ('ADMIN', 'SUPER_ADMIN');

-- Every authenticated role can read leave state in its handler-defined scope
-- and submit its own leave application. The route never accepts a caller-
-- supplied user id for creation.
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
JOIN permissions p ON p.permission_key IN ('leave.read', 'leave.create');

-- Recreate the institution bootstrap trigger so institutions created after this
-- migration receive the complete current permission baseline.
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
    'meals.config.read',
    'leave.read',
    'leave.create'
  )
  WHERE r.institution_id = NEW.id;

  INSERT INTO role_permissions (role_id, permission_id)
  SELECT r.id, p.id
  FROM roles r
  JOIN permissions p ON p.permission_key = 'kitchen.read'
  WHERE r.institution_id = NEW.id
    AND r.role_key IN ('MANAGER', 'ADMIN', 'SUPER_ADMIN');

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
    'meals.config.delete',
    'kitchen.guest.create',
    'kitchen.guest.delete',
    'meals.override',
    'leave.decide'
  )
  WHERE r.institution_id = NEW.id
    AND r.role_key IN ('ADMIN', 'SUPER_ADMIN');
END;
