-- Post-Phase-05 integration — Funds read-model authorization
-- Funds is derived from canonical Payments + Expenses + Bills + Users and does
-- not introduce a second mutable balance authority.
PRAGMA foreign_keys = ON;

INSERT INTO permissions (id, permission_key, feature, action, description)
VALUES (
  'perm_funds_read',
  'funds.read',
  'funds',
  'read',
  'Read institution fund totals and resident fund breakdowns'
);

-- The audited Funds screen is administrator-only. Do not broaden access until
-- a later owning requirement explicitly introduces a resident/manager view.
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
JOIN permissions p ON p.permission_key = 'funds.read'
WHERE r.role_key IN ('ADMIN', 'SUPER_ADMIN');

-- Keep future institution bootstrap aligned with the complete verified baseline.
-- Preserve the already-green 0011 bootstrap body verbatim, then add the Funds
-- grant in a separate statement. This keeps each incremental permission change
-- small and avoids making the established bootstrap SELECT increasingly brittle.
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
    'leave.create',
    'bills.read',
    'payments.read',
    'expenses.read'
  )
  WHERE r.institution_id = NEW.id;

  INSERT INTO role_permissions (role_id, permission_id)
  SELECT r.id, p.id
  FROM roles r
  JOIN permissions p ON p.permission_key = 'payments.create'
  WHERE r.institution_id = NEW.id
    AND r.role_key = 'USER';

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
    'leave.decide',
    'billing.readiness',
    'bills.generate',
    'bills.delete',
    'bills.restore',
    'bills.void',
    'payments.decide',
    'payments.update',
    'payments.void',
    'payments.delete',
    'payments.restore',
    'payments.refund',
    'refunds.read',
    'expenses.create',
    'expenses.replace',
    'expenses.delete',
    'expenses.restore'
  )
  WHERE r.institution_id = NEW.id
    AND r.role_key IN ('ADMIN', 'SUPER_ADMIN');

  INSERT INTO role_permissions (role_id, permission_id)
  SELECT r.id, p.id
  FROM roles r
  JOIN permissions p ON p.permission_key = 'funds.read'
  WHERE r.institution_id = NEW.id
    AND r.role_key IN ('ADMIN', 'SUPER_ADMIN');
END;
