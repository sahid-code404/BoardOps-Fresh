-- Phase 05 — Permission-based RBAC
-- Canonical authorization tables. `users.role` remains the compatibility role key;
-- authorization decisions resolve that key through institution-scoped roles and
-- explicit permission grants instead of hard-coded role string checks.
PRAGMA foreign_keys = ON;

CREATE TABLE roles (
  id TEXT PRIMARY KEY,
  institution_id TEXT NOT NULL,
  role_key TEXT NOT NULL CHECK (role_key IN ('SUPER_ADMIN', 'ADMIN', 'MANAGER', 'USER')),
  name TEXT NOT NULL,
  description TEXT,
  is_system INTEGER NOT NULL DEFAULT 1 CHECK (is_system IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (institution_id) REFERENCES institutions(id) ON DELETE CASCADE,
  UNIQUE (institution_id, role_key)
);

CREATE INDEX roles_institution_idx ON roles(institution_id, role_key);

CREATE TABLE permissions (
  id TEXT PRIMARY KEY,
  permission_key TEXT NOT NULL UNIQUE,
  feature TEXT NOT NULL,
  action TEXT NOT NULL,
  description TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX permissions_feature_action_idx ON permissions(feature, action);

CREATE TABLE role_permissions (
  role_id TEXT NOT NULL,
  permission_id TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (role_id, permission_id),
  FOREIGN KEY (role_id) REFERENCES roles(id) ON DELETE CASCADE,
  FOREIGN KEY (permission_id) REFERENCES permissions(id) ON DELETE CASCADE
);

CREATE INDEX role_permissions_permission_idx ON role_permissions(permission_id, role_id);

INSERT INTO permissions (id, permission_key, feature, action, description) VALUES
  ('perm_dashboard_read', 'dashboard.read', 'dashboard', 'read', 'View the authenticated dashboard'),
  ('perm_audit_read', 'audit.read', 'audit', 'read', 'View institution audit activity'),
  ('perm_notifications_read_self', 'notifications.read_self', 'notifications', 'read_self', 'View own notifications'),
  ('perm_profile_read_self', 'profile.read_self', 'profile', 'read_self', 'View own profile'),
  ('perm_profile_update_self', 'profile.update_self', 'profile', 'update_self', 'Update own profile'),
  ('perm_sessions_read_self', 'sessions.read_self', 'sessions', 'read_self', 'View own sessions'),
  ('perm_sessions_revoke_self', 'sessions.revoke_self', 'sessions', 'revoke_self', 'Revoke own sessions'),
  ('perm_password_change_self', 'password.change_self', 'password', 'change_self', 'Change own password'),
  ('perm_avatar_update_self', 'avatar.update_self', 'avatar', 'update_self', 'Update own avatar'),
  ('perm_users_read', 'users.read', 'users', 'read', 'View institution users'),
  ('perm_users_approve', 'users.approve', 'users', 'approve', 'Approve pending registrations'),
  ('perm_users_request_changes', 'users.request_changes', 'users', 'request_changes', 'Request registration corrections'),
  ('perm_users_reject', 'users.reject', 'users', 'reject', 'Reject pending registrations'),
  ('perm_users_status_change', 'users.status_change', 'users', 'status_change', 'Suspend, activate, deactivate, archive, or restore users'),
  ('perm_users_role_assign', 'users.role_assign', 'users', 'role_assign', 'Assign institution roles'),
  ('perm_users_update', 'users.update', 'users', 'update', 'Edit user identity/profile fields'),
  ('perm_users_delete', 'users.delete', 'users', 'delete', 'Move a user into the deletion queue'),
  ('perm_users_restore', 'users.restore', 'users', 'restore', 'Restore an eligible deleted user');

-- Seed the four compatibility roles for every institution that exists when this
-- immutable migration runs. Future institution provisioning must create the same
-- role set transactionally as part of its own owning phase.
INSERT INTO roles (id, institution_id, role_key, name, description, is_system)
SELECT id || ':role:SUPER_ADMIN', id, 'SUPER_ADMIN', 'Super Admin', 'System administrator role', 1 FROM institutions;
INSERT INTO roles (id, institution_id, role_key, name, description, is_system)
SELECT id || ':role:ADMIN', id, 'ADMIN', 'Admin', 'Institution administrator role', 1 FROM institutions;
INSERT INTO roles (id, institution_id, role_key, name, description, is_system)
SELECT id || ':role:MANAGER', id, 'MANAGER', 'Manager', 'Institution manager role', 1 FROM institutions;
INSERT INTO roles (id, institution_id, role_key, name, description, is_system)
SELECT id || ':role:USER', id, 'USER', 'Resident', 'Standard resident role', 1 FROM institutions;

-- Every authenticated role receives only the self-service permissions required
-- by the already-verified Phase 04 experience.
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
  'avatar.update_self'
);

-- Preserve the verified Phase 04 user-management surface without expanding
-- privileges: only ADMIN and SUPER_ADMIN receive administrative user powers.
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
  'users.restore'
)
WHERE r.role_key IN ('ADMIN', 'SUPER_ADMIN');
