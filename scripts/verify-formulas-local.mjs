import { spawnSync } from "node:child_process";

const WRANGLER = [
  "exec",
  "wrangler",
  "d1",
  "execute",
  "boardops-local",
  "--local",
  "--persist-to",
  ".wrangler/state",
  "--config",
  "services/api/wrangler.jsonc",
];

function executeJson(command) {
  const result = spawnSync(
    "pnpm",
    [...WRANGLER, "--json", "--command", command],
    { encoding: "utf8", shell: process.platform === "win32" },
  );
  if (result.status !== 0) {
    process.stderr.write(result.stderr || result.stdout);
    process.exit(result.status ?? 1);
  }
  try {
    return JSON.parse(result.stdout);
  } catch (error) {
    console.error("[BoardOps] Could not parse Variables/Formula verification output.", error);
    console.error(result.stdout);
    process.exit(1);
  }
}

function expectStatementFailure(command, expectedText, label) {
  const result = spawnSync(
    "pnpm",
    [...WRANGLER, "--command", command],
    { encoding: "utf8", shell: process.platform === "win32" },
  );
  if (result.status === 0) {
    console.error(`[BoardOps] ${label} invariant failed: prohibited statement succeeded.`);
    process.exit(1);
  }
  const output = `${result.stdout}\n${result.stderr}`;
  if (!output.includes(expectedText)) {
    console.error(`[BoardOps] ${label} probe failed for an unexpected reason.`);
    console.error(output);
    process.exit(1);
  }
}

const query = `
SELECT
  (SELECT COUNT(*) FROM variables WHERE institution_id = 'inst_boardops_local' AND status = 'ACTIVE') AS active_variables,
  (SELECT COUNT(*) FROM variable_versions WHERE institution_id = 'inst_boardops_local') AS variable_versions,
  (SELECT COUNT(*) FROM formulas WHERE institution_id = 'inst_boardops_local' AND status = 'ACTIVE') AS active_formulas,
  (SELECT COUNT(*) FROM formula_versions WHERE institution_id = 'inst_boardops_local') AS formula_versions,
  (SELECT COUNT(*) FROM permissions) AS permissions,
  (SELECT COUNT(*) FROM role_permissions) AS role_permissions,
  (SELECT COUNT(*) FROM sqlite_master
    WHERE type = 'trigger'
      AND name IN (
        'variable_versions_block_update', 'variable_versions_block_delete',
        'variables_block_delete', 'formula_versions_block_update',
        'formula_versions_block_delete', 'formulas_block_delete'
      )) AS history_guards,
  (SELECT COUNT(*) FROM sqlite_master
    WHERE type = 'trigger'
      AND name IN ('roles_bootstrap_variables_read', 'roles_bootstrap_variables_formulas_admin')) AS bootstrap_triggers,
  (SELECT COUNT(*)
     FROM variables
    WHERE institution_id = 'inst_boardops_local'
      AND is_protected = 1
      AND status = 'ACTIVE') AS protected_variables,
  (SELECT COUNT(*)
     FROM formulas
    WHERE institution_id = 'inst_boardops_local'
      AND key = 'formula.mealCharges'
      AND status = 'ACTIVE'
      AND version = 1) AS canonical_meal_formula,
  (SELECT COUNT(*)
     FROM formula_versions fv
     JOIN formulas f ON f.id = fv.formula_id
    WHERE f.institution_id = 'inst_boardops_local'
      AND f.key = 'formula.mealCharges'
      AND fv.version = 1
      AND fv.referenced_variables_json LIKE '%meal.rate.breakfast%'
      AND fv.referenced_variables_json LIKE '%meal.rate.lunch%'
      AND fv.referenced_variables_json LIKE '%meal.rate.dinner%'
      AND fv.referenced_context_json LIKE '%breakfast_count%'
      AND fv.referenced_context_json LIKE '%lunch_count%'
      AND fv.referenced_context_json LIKE '%dinner_count%') AS canonical_meal_formula_refs,
  (SELECT COUNT(*)
     FROM roles r
     JOIN role_permissions rp ON rp.role_id = r.id
     JOIN permissions p ON p.id = rp.permission_id
    WHERE r.institution_id = 'inst_boardops_local'
      AND r.role_key = 'ADMIN'
      AND p.permission_key IN (
        'variables.read','variables.create','variables.update','variables.archive',
        'formulas.read','formulas.create','formulas.update','formulas.archive','formulas.test'
      )) AS admin_formula_permissions,
  (SELECT COUNT(*)
     FROM roles r
     JOIN role_permissions rp ON rp.role_id = r.id
     JOIN permissions p ON p.id = rp.permission_id
    WHERE r.institution_id = 'inst_boardops_local'
      AND r.role_key = 'SUPER_ADMIN'
      AND p.permission_key IN (
        'variables.read','variables.create','variables.update','variables.archive',
        'formulas.read','formulas.create','formulas.update','formulas.archive','formulas.test'
      )) AS super_admin_formula_permissions,
  (SELECT COUNT(*)
     FROM roles r
     JOIN role_permissions rp ON rp.role_id = r.id
     JOIN permissions p ON p.id = rp.permission_id
    WHERE r.institution_id = 'inst_boardops_local'
      AND r.role_key = 'MANAGER'
      AND p.permission_key IN (
        'variables.read','variables.create','variables.update','variables.archive',
        'formulas.read','formulas.create','formulas.update','formulas.archive','formulas.test'
      )) AS manager_formula_permissions,
  (SELECT COUNT(*)
     FROM roles r
     JOIN role_permissions rp ON rp.role_id = r.id
     JOIN permissions p ON p.id = rp.permission_id
    WHERE r.institution_id = 'inst_boardops_local'
      AND r.role_key = 'USER'
      AND p.permission_key IN (
        'variables.read','variables.create','variables.update','variables.archive',
        'formulas.read','formulas.create','formulas.update','formulas.archive','formulas.test'
      )) AS resident_formula_permissions;
`;

const parsed = executeJson(query);
const row = parsed?.[0]?.results?.[0];
if (!row) {
  console.error("[BoardOps] Variables/Formula verification query returned no row.");
  process.exit(1);
}

const exact = {
  active_variables: 10,
  variable_versions: 10,
  active_formulas: 4,
  formula_versions: 4,
  permissions: 64,
  role_permissions: 158,
  history_guards: 6,
  bootstrap_triggers: 2,
  protected_variables: 8,
  canonical_meal_formula: 1,
  canonical_meal_formula_refs: 1,
  admin_formula_permissions: 9,
  super_admin_formula_permissions: 9,
  manager_formula_permissions: 1,
  resident_formula_permissions: 1,
};

for (const [field, expected] of Object.entries(exact)) {
  const actual = Number(row[field] ?? -1);
  if (actual !== expected) {
    console.error(`[BoardOps] Variables/Formula invariant failed: ${field}=${row[field]} (expected ${expected})`);
    process.exit(1);
  }
}

expectStatementFailure(
  `UPDATE formula_versions
      SET expression = '1 + 1'
    WHERE id = 'formula_version_meal_charges_v1_local';`,
  "formula versions are immutable",
  "formula-version immutability",
);

expectStatementFailure(
  `DELETE FROM variable_versions
    WHERE id = 'version_var_meal_rate_breakfast_local';`,
  "variable versions cannot be hard-deleted",
  "variable-version deletion",
);

expectStatementFailure(
  `DELETE FROM formulas WHERE id = 'formula_meal_charges_local';`,
  "formulas cannot be hard-deleted; archive them instead",
  "formula hard-delete",
);

expectStatementFailure(
  `DELETE FROM variables WHERE id = 'var_meal_rate_breakfast_local';`,
  "variables cannot be hard-deleted; archive them instead",
  "variable hard-delete",
);

console.log("[BoardOps] Variables + fixed-version Formula Engine + least-privilege RBAC verified:", row);
