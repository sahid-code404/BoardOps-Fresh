-- Roles / Permissions checkpoint — canonical RBAC integrity hardening.
--
-- Phase 05 already established permission-based authorization. This append-only
-- migration protects that canonical catalog from accidental in-place rewrites,
-- requires every user compatibility role to resolve through the institution
-- role catalog, and prevents the last active administrator from being removed
-- at the database boundary.
PRAGMA foreign_keys = ON;

CREATE TRIGGER permissions_catalog_block_update
BEFORE UPDATE ON permissions
FOR EACH ROW
BEGIN
  SELECT RAISE(ABORT, 'permission catalog rows are immutable');
END;

CREATE TRIGGER permissions_catalog_block_delete
BEFORE DELETE ON permissions
FOR EACH ROW
BEGIN
  SELECT RAISE(ABORT, 'permission catalog rows cannot be deleted');
END;

CREATE TRIGGER system_roles_block_update
BEFORE UPDATE ON roles
FOR EACH ROW
WHEN OLD.is_system = 1
BEGIN
  SELECT RAISE(ABORT, 'system role rows are immutable');
END;

CREATE TRIGGER system_roles_block_delete
BEFORE DELETE ON roles
FOR EACH ROW
WHEN OLD.is_system = 1
BEGIN
  SELECT RAISE(ABORT, 'system role rows cannot be deleted');
END;

CREATE TRIGGER system_role_permissions_block_update
BEFORE UPDATE ON role_permissions
FOR EACH ROW
WHEN EXISTS (
  SELECT 1 FROM roles r WHERE r.id = OLD.role_id AND r.is_system = 1
)
BEGIN
  SELECT RAISE(ABORT, 'system role permission grants are immutable');
END;

CREATE TRIGGER system_role_permissions_block_delete
BEFORE DELETE ON role_permissions
FOR EACH ROW
WHEN EXISTS (
  SELECT 1 FROM roles r WHERE r.id = OLD.role_id AND r.is_system = 1
)
BEGIN
  SELECT RAISE(ABORT, 'system role permission grants cannot be deleted');
END;

CREATE TRIGGER users_require_resolved_role_insert
BEFORE INSERT ON users
FOR EACH ROW
WHEN NOT EXISTS (
  SELECT 1
  FROM roles r
  WHERE r.institution_id = NEW.institution_id
    AND r.role_key = NEW.role
)
BEGIN
  SELECT RAISE(ABORT, 'user role must resolve through institution role catalog');
END;

CREATE TRIGGER users_require_resolved_role_update
BEFORE UPDATE OF institution_id, role ON users
FOR EACH ROW
WHEN NOT EXISTS (
  SELECT 1
  FROM roles r
  WHERE r.institution_id = NEW.institution_id
    AND r.role_key = NEW.role
)
BEGIN
  SELECT RAISE(ABORT, 'user role must resolve through institution role catalog');
END;

CREATE TRIGGER users_preserve_last_active_admin_update
BEFORE UPDATE OF role, status, deleted_at ON users
FOR EACH ROW
WHEN OLD.role IN ('ADMIN', 'SUPER_ADMIN')
  AND OLD.status = 'ACTIVE'
  AND OLD.deleted_at IS NULL
  AND NOT (
    NEW.role IN ('ADMIN', 'SUPER_ADMIN')
    AND NEW.status = 'ACTIVE'
    AND NEW.deleted_at IS NULL
  )
  AND NOT EXISTS (
    SELECT 1
    FROM users u
    WHERE u.institution_id = OLD.institution_id
      AND u.id <> OLD.id
      AND u.role IN ('ADMIN', 'SUPER_ADMIN')
      AND u.status = 'ACTIVE'
      AND u.deleted_at IS NULL
  )
BEGIN
  SELECT RAISE(ABORT, 'cannot remove the last active administrator');
END;

CREATE TRIGGER users_preserve_last_active_admin_delete
BEFORE DELETE ON users
FOR EACH ROW
WHEN OLD.role IN ('ADMIN', 'SUPER_ADMIN')
  AND OLD.status = 'ACTIVE'
  AND OLD.deleted_at IS NULL
  AND NOT EXISTS (
    SELECT 1
    FROM users u
    WHERE u.institution_id = OLD.institution_id
      AND u.id <> OLD.id
      AND u.role IN ('ADMIN', 'SUPER_ADMIN')
      AND u.status = 'ACTIVE'
      AND u.deleted_at IS NULL
  )
BEGIN
  SELECT RAISE(ABORT, 'cannot remove the last active administrator');
END;
