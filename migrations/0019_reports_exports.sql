-- Reports / Exports — explicit least-privilege access over canonical D1 read models
-- Reports do not introduce a second accounting store. Every financial value is
-- derived from the immutable/verified owning domain tables at request time.
PRAGMA foreign_keys = ON;

INSERT INTO permissions (id, permission_key, feature, action, description) VALUES
  ('perm_reports_read', 'reports.read', 'reports', 'read', 'Read institution reports and analytics'),
  ('perm_reports_export', 'reports.export', 'reports', 'export', 'Export institution reports as CSV');

-- Source Reports are an administrator surface. Keep the rewrite fail-closed and
-- explicit instead of inferring access from a role string inside route handlers.
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
JOIN permissions p ON p.permission_key IN ('reports.read', 'reports.export')
WHERE r.role_key IN ('ADMIN', 'SUPER_ADMIN');

-- Future institutions receive the same least-privilege Reports baseline when
-- their canonical roles are inserted by the institution bootstrap chain.
CREATE TRIGGER roles_bootstrap_reports_admin
AFTER INSERT ON roles
WHEN NEW.role_key IN ('ADMIN', 'SUPER_ADMIN')
BEGIN
  INSERT OR IGNORE INTO role_permissions (role_id, permission_id)
  SELECT NEW.id, p.id
  FROM permissions p
  WHERE p.permission_key IN ('reports.read', 'reports.export');
END;
