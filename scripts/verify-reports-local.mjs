import { spawnSync } from "node:child_process";

const WRANGLER = [
  "exec", "wrangler", "d1", "execute", "boardops-local",
  "--local", "--persist-to", ".wrangler/state",
  "--config", "services/api/wrangler.jsonc",
];

function executeJson(command) {
  const result = spawnSync("pnpm", [...WRANGLER, "--json", "--command", command], {
    encoding: "utf8",
    shell: process.platform === "win32",
  });
  if (result.status !== 0) {
    process.stderr.write(result.stderr || result.stdout);
    process.exit(result.status ?? 1);
  }
  try {
    return JSON.parse(result.stdout);
  } catch (error) {
    console.error("[BoardOps] Could not parse Reports verification output.", error);
    console.error(result.stdout);
    process.exit(1);
  }
}

const query = `
SELECT
  (SELECT COUNT(*) FROM permissions) AS permissions,
  (SELECT COUNT(*) FROM role_permissions) AS role_permissions,
  (SELECT COUNT(*) FROM permissions
    WHERE permission_key IN ('reports.read','reports.export')) AS report_permissions,
  (SELECT COUNT(*)
     FROM roles r JOIN role_permissions rp ON rp.role_id = r.id JOIN permissions p ON p.id = rp.permission_id
    WHERE r.institution_id = 'inst_boardops_local' AND r.role_key = 'ADMIN'
      AND p.permission_key IN ('reports.read','reports.export')) AS admin_report_permissions,
  (SELECT COUNT(*)
     FROM roles r JOIN role_permissions rp ON rp.role_id = r.id JOIN permissions p ON p.id = rp.permission_id
    WHERE r.institution_id = 'inst_boardops_local' AND r.role_key = 'SUPER_ADMIN'
      AND p.permission_key IN ('reports.read','reports.export')) AS super_admin_report_permissions,
  (SELECT COUNT(*)
     FROM roles r JOIN role_permissions rp ON rp.role_id = r.id JOIN permissions p ON p.id = rp.permission_id
    WHERE r.institution_id = 'inst_boardops_local' AND r.role_key = 'MANAGER'
      AND p.permission_key IN ('reports.read','reports.export')) AS manager_report_permissions,
  (SELECT COUNT(*)
     FROM roles r JOIN role_permissions rp ON rp.role_id = r.id JOIN permissions p ON p.id = rp.permission_id
    WHERE r.institution_id = 'inst_boardops_local' AND r.role_key = 'USER'
      AND p.permission_key IN ('reports.read','reports.export')) AS resident_report_permissions,
  (SELECT COUNT(*) FROM sqlite_master
    WHERE type = 'trigger' AND name = 'roles_bootstrap_reports_admin') AS report_bootstrap_triggers,
  (SELECT COALESCE(SUM(amount_minor), 0) FROM expenses
    WHERE institution_id = 'inst_boardops_local' AND status = 'APPROVED' AND purged_at IS NULL
      AND expense_date >= '2026-07-31T18:30:00.000Z' AND expense_date < '2026-08-31T18:30:00.000Z') AS august_expense_minor,
  (SELECT COALESCE(SUM(p.amount_minor), 0)
     FROM payments p JOIN users u ON u.id = p.user_id AND u.institution_id = p.institution_id
    WHERE p.institution_id = 'inst_boardops_local' AND u.role = 'USER'
      AND p.status = 'APPROVED' AND p.deleted_on IS NULL AND p.purged_at IS NULL
      AND p.created_at >= '2026-07-31T18:30:00.000Z' AND p.created_at < '2026-08-31T18:30:00.000Z') AS august_deposit_minor,
  (SELECT COUNT(*) FROM meal_configurations
    WHERE institution_id = 'inst_boardops_local' AND status = 'ACTIVE') AS active_meals,
  (SELECT COUNT(*) FROM meal_entries me JOIN users u ON u.id = me.user_id
    WHERE me.institution_id = 'inst_boardops_local' AND u.role = 'USER'
      AND me.service_date >= '2026-05-01' AND me.service_date < '2026-06-01'
      AND (me.status = 'ON' OR (me.status = 'LOCKED' AND me.original_state = 'ON'))) AS may_confirmed_meals;
`;

const parsed = executeJson(query);
const row = parsed?.[0]?.results?.[0];
if (!row) {
  console.error("[BoardOps] Reports verification query returned no row.");
  process.exit(1);
}

const exact = {
  permissions: 74,
  role_permissions: 182,
  report_permissions: 2,
  admin_report_permissions: 2,
  super_admin_report_permissions: 2,
  manager_report_permissions: 0,
  resident_report_permissions: 0,
  report_bootstrap_triggers: 1,
  august_expense_minor: 450000,
  august_deposit_minor: 500000,
  active_meals: 3,
  may_confirmed_meals: 4,
};

for (const [field, expected] of Object.entries(exact)) {
  const actual = Number(row[field] ?? -1);
  if (actual !== expected) {
    console.error(`[BoardOps] Reports invariant failed: ${field}=${row[field]} (expected ${expected})`);
    process.exit(1);
  }
}

console.log("[BoardOps] Reports / Exports exact RBAC + deterministic canonical source evidence verified:", row);
