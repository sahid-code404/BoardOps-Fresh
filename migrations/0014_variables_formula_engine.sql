-- Post-Phase-05 integration — canonical variables + formula engine
--
-- Variables remain editable current configuration, but every accepted change is
-- snapshotted into immutable variable_versions. Formula expressions are versioned
-- immutably and evaluated by the Worker; historical billing will freeze the exact
-- variable/formula versions it consumes rather than reading mutable live rows.
PRAGMA foreign_keys = ON;

CREATE TABLE variables (
  id TEXT PRIMARY KEY,
  institution_id TEXT NOT NULL,
  key TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  variable_type TEXT NOT NULL DEFAULT 'NUMBER'
    CHECK (variable_type IN ('NUMBER', 'CURRENCY', 'PERCENTAGE', 'TEXT', 'BOOLEAN')),
  value_text TEXT NOT NULL,
  unit TEXT,
  category TEXT NOT NULL DEFAULT 'GENERAL',
  is_system INTEGER NOT NULL DEFAULT 0 CHECK (is_system IN (0, 1)),
  is_protected INTEGER NOT NULL DEFAULT 0 CHECK (is_protected IN (0, 1)),
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'ARCHIVED')),
  version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_by TEXT,
  updated_by TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (institution_id) REFERENCES institutions(id) ON DELETE RESTRICT,
  FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL,
  FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE SET NULL,
  UNIQUE (institution_id, key)
);

CREATE INDEX variables_institution_status_category_idx
  ON variables(institution_id, status, category, name);

CREATE TABLE variable_versions (
  id TEXT PRIMARY KEY,
  institution_id TEXT NOT NULL,
  variable_id TEXT NOT NULL,
  version INTEGER NOT NULL CHECK (version >= 1),
  key TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  variable_type TEXT NOT NULL
    CHECK (variable_type IN ('NUMBER', 'CURRENCY', 'PERCENTAGE', 'TEXT', 'BOOLEAN')),
  value_text TEXT NOT NULL,
  unit TEXT,
  category TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('ACTIVE', 'ARCHIVED')),
  changed_by TEXT,
  change_note TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (institution_id) REFERENCES institutions(id) ON DELETE RESTRICT,
  FOREIGN KEY (variable_id) REFERENCES variables(id) ON DELETE RESTRICT,
  FOREIGN KEY (changed_by) REFERENCES users(id) ON DELETE SET NULL,
  UNIQUE (variable_id, version)
);

CREATE INDEX variable_versions_lookup_idx
  ON variable_versions(institution_id, variable_id, version DESC);

CREATE TRIGGER variable_versions_block_update
BEFORE UPDATE ON variable_versions
BEGIN
  SELECT RAISE(ABORT, 'variable versions are immutable');
END;

CREATE TRIGGER variable_versions_block_delete
BEFORE DELETE ON variable_versions
BEGIN
  SELECT RAISE(ABORT, 'variable versions cannot be hard-deleted');
END;

CREATE TRIGGER variables_block_delete
BEFORE DELETE ON variables
BEGIN
  SELECT RAISE(ABORT, 'variables cannot be hard-deleted; archive them instead');
END;

CREATE TABLE formulas (
  id TEXT PRIMARY KEY,
  institution_id TEXT NOT NULL,
  name TEXT NOT NULL,
  key TEXT NOT NULL,
  description TEXT,
  expression TEXT NOT NULL,
  return_type TEXT NOT NULL DEFAULT 'CURRENCY'
    CHECK (return_type IN ('CURRENCY', 'NUMBER', 'PERCENTAGE')),
  category TEXT NOT NULL DEFAULT 'BILLING',
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'ARCHIVED')),
  version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_by TEXT,
  updated_by TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (institution_id) REFERENCES institutions(id) ON DELETE RESTRICT,
  FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL,
  FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE SET NULL,
  UNIQUE (institution_id, key)
);

CREATE INDEX formulas_institution_status_category_idx
  ON formulas(institution_id, status, category, name);

CREATE TABLE formula_versions (
  id TEXT PRIMARY KEY,
  institution_id TEXT NOT NULL,
  formula_id TEXT NOT NULL,
  version INTEGER NOT NULL CHECK (version >= 1),
  expression TEXT NOT NULL,
  return_type TEXT NOT NULL CHECK (return_type IN ('CURRENCY', 'NUMBER', 'PERCENTAGE')),
  referenced_variables_json TEXT NOT NULL DEFAULT '[]',
  referenced_context_json TEXT NOT NULL DEFAULT '[]',
  changed_by TEXT,
  change_note TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (institution_id) REFERENCES institutions(id) ON DELETE RESTRICT,
  FOREIGN KEY (formula_id) REFERENCES formulas(id) ON DELETE RESTRICT,
  FOREIGN KEY (changed_by) REFERENCES users(id) ON DELETE SET NULL,
  UNIQUE (formula_id, version)
);

CREATE INDEX formula_versions_lookup_idx
  ON formula_versions(institution_id, formula_id, version DESC);

CREATE TRIGGER formula_versions_block_update
BEFORE UPDATE ON formula_versions
BEGIN
  SELECT RAISE(ABORT, 'formula versions are immutable');
END;

CREATE TRIGGER formula_versions_block_delete
BEFORE DELETE ON formula_versions
BEGIN
  SELECT RAISE(ABORT, 'formula versions cannot be hard-deleted');
END;

CREATE TRIGGER formulas_block_delete
BEFORE DELETE ON formulas
BEGIN
  SELECT RAISE(ABORT, 'formulas cannot be hard-deleted; archive them instead');
END;

INSERT INTO permissions (id, permission_key, feature, action, description) VALUES
  ('perm_variables_read', 'variables.read', 'variables', 'read', 'Read active institution variables'),
  ('perm_variables_create', 'variables.create', 'variables', 'create', 'Create institution variables'),
  ('perm_variables_update', 'variables.update', 'variables', 'update', 'Update institution variable configuration'),
  ('perm_variables_archive', 'variables.archive', 'variables', 'archive', 'Archive non-protected institution variables'),
  ('perm_formulas_read', 'formulas.read', 'formulas', 'read', 'Read active formulas and immutable versions'),
  ('perm_formulas_create', 'formulas.create', 'formulas', 'create', 'Create canonical formulas'),
  ('perm_formulas_update', 'formulas.update', 'formulas', 'update', 'Update formula metadata or create a new expression version'),
  ('perm_formulas_archive', 'formulas.archive', 'formulas', 'archive', 'Archive formulas without deleting history'),
  ('perm_formulas_test', 'formulas.test', 'formulas', 'test', 'Validate and test formulas with current institution variables');

-- Golden behavior allowed any authenticated user to read Variables. Current
-- mutations and every Formula action remain administrator-only.
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
JOIN permissions p ON p.permission_key = 'variables.read'
WHERE r.role_key IN ('SUPER_ADMIN', 'ADMIN', 'MANAGER', 'USER');

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
JOIN permissions p ON p.permission_key IN (
  'variables.create', 'variables.update', 'variables.archive',
  'formulas.read', 'formulas.create', 'formulas.update', 'formulas.archive', 'formulas.test'
)
WHERE r.role_key IN ('SUPER_ADMIN', 'ADMIN');

-- 0012 owns canonical role creation. These incremental role triggers ensure
-- institutions created after this migration receive this domain's grants too.
CREATE TRIGGER roles_bootstrap_variables_read
AFTER INSERT ON roles
WHEN NEW.role_key IN ('SUPER_ADMIN', 'ADMIN', 'MANAGER', 'USER')
BEGIN
  INSERT OR IGNORE INTO role_permissions (role_id, permission_id)
  SELECT NEW.id, p.id
  FROM permissions p
  WHERE p.permission_key = 'variables.read';
END;

CREATE TRIGGER roles_bootstrap_variables_formulas_admin
AFTER INSERT ON roles
WHEN NEW.role_key IN ('SUPER_ADMIN', 'ADMIN')
BEGIN
  INSERT OR IGNORE INTO role_permissions (role_id, permission_id)
  SELECT NEW.id, p.id
  FROM permissions p
  WHERE p.permission_key IN (
    'variables.create', 'variables.update', 'variables.archive',
    'formulas.read', 'formulas.create', 'formulas.update', 'formulas.archive', 'formulas.test'
  );
END;