-- Experimental simplification: retire Variables + Formula Engine.
--
-- The released migration history remains immutable, so this migration performs
-- an upgrade-safe conversion of the small amount of configuration that still
-- belongs in the product before removing the generic expression subsystem.
PRAGMA foreign_keys = ON;

-- Preserve current per-meal rates as ordinary fixed meal prices wherever the
-- old convention has a positive numeric meal.rate.<name> Variable.
UPDATE meal_configurations
SET fixed_price_minor = (
      SELECT CAST(ROUND(CAST(v.value_text AS REAL) * 100.0) AS INTEGER)
      FROM variables v
      WHERE v.institution_id = meal_configurations.institution_id
        AND v.status = 'ACTIVE'
        AND v.key = 'meal.rate.' || lower(meal_configurations.name)
        AND CAST(v.value_text AS REAL) > 0
      LIMIT 1
    ),
    pricing_mode = 'FIXED',
    updated_at = CURRENT_TIMESTAMP
WHERE pricing_mode = 'FORMULA'
  AND EXISTS (
    SELECT 1
    FROM variables v
    WHERE v.institution_id = meal_configurations.institution_id
      AND v.status = 'ACTIVE'
      AND v.key = 'meal.rate.' || lower(meal_configurations.name)
      AND CAST(v.value_text AS REAL) > 0
  );

-- Ordinary billing configuration belongs in Settings, not an expression
-- language. Values remain major-unit exact text and are converted to integer
-- minor units by the billing service at the boundary.
INSERT INTO settings (
  id, institution_id, key, value, category, type, description, is_public,
  created_by, updated_by, created_at, updated_at
)
SELECT
  'setting_migrated_' || v.id,
  v.institution_id,
  v.key,
  v.value_text,
  'BILLING',
  CASE WHEN v.variable_type = 'BOOLEAN' THEN 'BOOLEAN' ELSE 'NUMBER' END,
  COALESCE(v.description, 'Migrated from retired Variables subsystem'),
  0,
  v.created_by,
  v.updated_by,
  v.created_at,
  v.updated_at
FROM variables v
WHERE v.status = 'ACTIVE'
  AND v.key IN (
    'billing.roomRent',
    'billing.securityDeposit',
    'billing.lateFeePercent',
    'billing.cleaningCharges',
    'billing.electricityPerUnit'
  )
ON CONFLICT(institution_id, key) DO UPDATE SET
  value = excluded.value,
  category = excluded.category,
  type = excluded.type,
  description = excluded.description,
  updated_by = excluded.updated_by,
  updated_at = excluded.updated_at;

-- Low-balance behavior is a policy, so preserve optional overrides in the
-- existing Policies domain before dropping Variables.
INSERT INTO policies (
  id, institution_id, key, category, value, type, description,
  updated_by, created_at, updated_at
)
SELECT
  'policy_migrated_' || v.id,
  v.institution_id,
  v.key,
  'FINANCIAL',
  v.value_text,
  CASE WHEN v.variable_type = 'BOOLEAN' THEN 'BOOLEAN' ELSE 'NUMBER' END,
  COALESCE(v.description, 'Migrated from retired Variables subsystem'),
  v.updated_by,
  v.created_at,
  v.updated_at
FROM variables v
WHERE v.status = 'ACTIVE'
  AND v.key IN (
    'policy.lowBalance.enabled',
    'policy.lowBalance.graceDays',
    'policy.lowBalance.requiredBalance'
  )
ON CONFLICT(institution_id, key) DO UPDATE SET
  category = excluded.category,
  value = excluded.value,
  type = excluded.type,
  description = excluded.description,
  updated_by = excluded.updated_by,
  updated_at = excluded.updated_at;

-- Formula/Variable bootstrap hooks are no longer part of RBAC.
DROP TRIGGER IF EXISTS roles_bootstrap_variables_read;
DROP TRIGGER IF EXISTS roles_bootstrap_variables_formulas_admin;

-- Phase-22 intentionally makes the permission catalog and system grants
-- immutable. Temporarily remove only the two delete guards required to retire
-- this domain, then restore those guards immediately below.
DROP TRIGGER IF EXISTS system_role_permissions_block_delete;
DROP TRIGGER IF EXISTS permissions_catalog_block_delete;

DELETE FROM role_permissions
WHERE permission_id IN (
  SELECT id FROM permissions
  WHERE permission_key LIKE 'variables.%' OR permission_key LIKE 'formulas.%'
);

DELETE FROM permissions
WHERE permission_key LIKE 'variables.%' OR permission_key LIKE 'formulas.%';

CREATE TRIGGER permissions_catalog_block_delete
BEFORE DELETE ON permissions
FOR EACH ROW
BEGIN
  SELECT RAISE(ABORT, 'permission catalog rows cannot be deleted');
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

-- Drop immutable-history guards first, then the retired tables in dependency
-- order. Existing billing snapshots remain self-contained JSON evidence.
DROP TRIGGER IF EXISTS formula_versions_block_update;
DROP TRIGGER IF EXISTS formula_versions_block_delete;
DROP TRIGGER IF EXISTS formulas_block_delete;
DROP TRIGGER IF EXISTS variable_versions_block_update;
DROP TRIGGER IF EXISTS variable_versions_block_delete;
DROP TRIGGER IF EXISTS variables_block_delete;

DROP TABLE IF EXISTS formula_versions;
DROP TABLE IF EXISTS formulas;
DROP TABLE IF EXISTS variable_versions;
DROP TABLE IF EXISTS variables;
