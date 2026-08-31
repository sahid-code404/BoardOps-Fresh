-- Resident meals / leave — explicit self-service authorization.
-- Resident schedule/toggle routes are strictly self-scoped in the Worker; these
-- permissions make that boundary explicit instead of overloading configuration
-- or administrator meal-operation grants.
PRAGMA foreign_keys = ON;

INSERT INTO permissions (id, permission_key, feature, action, description) VALUES
  ('perm_meals_entries_read_self', 'meals.entries.read_self', 'meals', 'read_self', 'Read the authenticated user meal schedule'),
  ('perm_meals_toggle_self', 'meals.toggle_self', 'meals', 'toggle_self', 'Toggle the authenticated user meal selection before cutoff');

-- Golden behavior exposes the signed-in user schedule to every authenticated
-- role while keeping the returned/updated rows self-scoped. Granting these two
-- self-service permissions does not confer kitchen/configuration administration.
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
JOIN permissions p ON p.permission_key IN ('meals.entries.read_self', 'meals.toggle_self');

-- Future institution roles inherit the same narrow self-service contract.
CREATE TRIGGER roles_bootstrap_resident_meals_self_service
AFTER INSERT ON roles
BEGIN
  INSERT OR IGNORE INTO role_permissions (role_id, permission_id)
  SELECT NEW.id, p.id
  FROM permissions p
  WHERE p.permission_key IN ('meals.entries.read_self', 'meals.toggle_self');
END;
