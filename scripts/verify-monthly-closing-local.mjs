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
    console.error("[BoardOps] Could not parse Monthly Closing verification output.", error);
    console.error(result.stdout);
    process.exit(1);
  }
}

const query = `
SELECT
  (SELECT COUNT(*) FROM permissions) AS permissions,
  (SELECT COUNT(*) FROM role_permissions) AS role_permissions,
  (SELECT COUNT(*) FROM sqlite_master
    WHERE type = 'table' AND name IN ('billing_cycles','billing_cycle_events')) AS closing_tables,
  (SELECT COUNT(*) FROM sqlite_master
    WHERE type = 'trigger' AND name IN (
      'billing_cycles_integer_money_insert',
      'billing_cycles_integer_money_update',
      'billing_cycles_closed_immutable',
      'billing_cycles_block_delete',
      'billing_cycle_events_block_update',
      'billing_cycle_events_block_delete',
      'roles_bootstrap_monthly_closing_admin'
    )) AS closing_guards,
  (SELECT COUNT(*) FROM permissions
    WHERE permission_key IN (
      'billing_cycles.read','billing_cycles.close','billing_cycles.rollback'
    )) AS closing_permissions,
  (SELECT COUNT(*)
     FROM roles r
     JOIN role_permissions rp ON rp.role_id = r.id
     JOIN permissions p ON p.id = rp.permission_id
    WHERE r.institution_id = 'inst_boardops_local'
      AND r.role_key = 'ADMIN'
      AND p.permission_key IN (
        'billing_cycles.read','billing_cycles.close','billing_cycles.rollback'
      )) AS admin_closing_permissions,
  (SELECT COUNT(*)
     FROM roles r
     JOIN role_permissions rp ON rp.role_id = r.id
     JOIN permissions p ON p.id = rp.permission_id
    WHERE r.institution_id = 'inst_boardops_local'
      AND r.role_key = 'SUPER_ADMIN'
      AND p.permission_key IN (
        'billing_cycles.read','billing_cycles.close','billing_cycles.rollback'
      )) AS super_admin_closing_permissions,
  (SELECT COUNT(*)
     FROM roles r
     JOIN role_permissions rp ON rp.role_id = r.id
     JOIN permissions p ON p.id = rp.permission_id
    WHERE r.institution_id = 'inst_boardops_local'
      AND r.role_key IN ('MANAGER','USER')
      AND p.permission_key IN (
        'billing_cycles.read','billing_cycles.close','billing_cycles.rollback'
      )) AS non_admin_closing_permissions,
  (SELECT COUNT(*) FROM billing_cycles WHERE institution_id = 'inst_boardops_local') AS seeded_cycles,
  (SELECT COUNT(*) FROM billing_cycle_events WHERE institution_id = 'inst_boardops_local') AS seeded_cycle_events,
  (SELECT COUNT(*) FROM accounting_periods
    WHERE institution_id = 'inst_boardops_local' AND period_key = '2026-08' AND status = 'OPEN') AS august_open_period,
  (SELECT COUNT(*) FROM formulas
    WHERE institution_id = 'inst_boardops_local'
      AND key IN ('formula.mealCharges','formula.totalBill')
      AND status = 'ACTIVE') AS required_formulas,
  (SELECT COUNT(*) FROM formula_versions fv
     JOIN formulas f ON f.id = fv.formula_id
    WHERE f.institution_id = 'inst_boardops_local'
      AND f.key IN ('formula.mealCharges','formula.totalBill')
      AND fv.version = f.version) AS required_formula_versions;
`;

const parsed = executeJson(query);
const row = parsed?.[0]?.results?.[0];
if (!row) {
  console.error("[BoardOps] Monthly Closing verification query returned no row.");
  process.exit(1);
}

const exact = {
  permissions: 67,
  role_permissions: 164,
  closing_tables: 2,
  closing_guards: 7,
  closing_permissions: 3,
  admin_closing_permissions: 3,
  super_admin_closing_permissions: 3,
  non_admin_closing_permissions: 0,
  seeded_cycles: 0,
  seeded_cycle_events: 0,
  august_open_period: 1,
  required_formulas: 2,
  required_formula_versions: 2,
};

for (const [field, expected] of Object.entries(exact)) {
  const actual = Number(row[field] ?? -1);
  if (actual !== expected) {
    console.error(`[BoardOps] Monthly Closing invariant failed: ${field}=${row[field]} (expected ${expected})`);
    process.exit(1);
  }
}

console.log("[BoardOps] Monthly Closing schema + exact RBAC baseline verified:", row);
