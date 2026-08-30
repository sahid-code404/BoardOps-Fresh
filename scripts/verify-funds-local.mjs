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
    console.error("[BoardOps] Could not parse Funds verification output.", error);
    console.error(result.stdout);
    process.exit(1);
  }
}

const query = `
SELECT
  (SELECT COUNT(*) FROM permissions) AS permissions,
  (SELECT COUNT(*) FROM role_permissions) AS role_permissions,
  (SELECT COUNT(*)
     FROM roles r
     JOIN role_permissions rp ON rp.role_id = r.id
     JOIN permissions p ON p.id = rp.permission_id
    WHERE r.institution_id = 'inst_boardops_local'
      AND r.role_key = 'ADMIN'
      AND p.permission_key = 'funds.read') AS admin_funds_read,
  (SELECT COUNT(*)
     FROM roles r
     JOIN role_permissions rp ON rp.role_id = r.id
     JOIN permissions p ON p.id = rp.permission_id
    WHERE r.institution_id = 'inst_boardops_local'
      AND r.role_key = 'SUPER_ADMIN'
      AND p.permission_key = 'funds.read') AS super_admin_funds_read,
  (SELECT COUNT(*)
     FROM roles r
     JOIN role_permissions rp ON rp.role_id = r.id
     JOIN permissions p ON p.id = rp.permission_id
    WHERE r.institution_id = 'inst_boardops_local'
      AND r.role_key = 'MANAGER'
      AND p.permission_key = 'funds.read') AS manager_funds_read,
  (SELECT COUNT(*)
     FROM roles r
     JOIN role_permissions rp ON rp.role_id = r.id
     JOIN permissions p ON p.id = rp.permission_id
    WHERE r.institution_id = 'inst_boardops_local'
      AND r.role_key = 'USER'
      AND p.permission_key = 'funds.read') AS resident_funds_read,
  (SELECT COALESCE(SUM(p.amount_minor), 0)
     FROM payments p
     JOIN users u ON u.id = p.user_id
    WHERE p.institution_id = 'inst_boardops_local'
      AND u.institution_id = p.institution_id
      AND u.role = 'USER'
      AND p.status = 'APPROVED'
      AND p.deleted_on IS NULL
      AND p.purged_at IS NULL
      AND p.created_at >= '2026-07-31T18:30:00.000Z'
      AND p.created_at < '2026-08-31T18:30:00.000Z') AS august_deposit_minor,
  (SELECT COALESCE(SUM(p.amount_minor), 0)
     FROM payments p
     JOIN users u ON u.id = p.user_id
    WHERE p.institution_id = 'inst_boardops_local'
      AND u.institution_id = p.institution_id
      AND u.role = 'USER'
      AND p.status = 'REFUNDED'
      AND p.deleted_on IS NULL
      AND p.purged_at IS NULL
      AND p.created_at >= '2026-07-31T18:30:00.000Z'
      AND p.created_at < '2026-08-31T18:30:00.000Z') AS august_refunded_minor,
  (SELECT COALESCE(SUM(amount_minor), 0)
     FROM expenses
    WHERE institution_id = 'inst_boardops_local'
      AND status = 'APPROVED'
      AND purged_at IS NULL
      AND expense_date >= '2026-07-31T18:30:00.000Z'
      AND expense_date < '2026-08-31T18:30:00.000Z') AS august_expenses_minor,
  (SELECT COUNT(*)
     FROM users
    WHERE institution_id = 'inst_boardops_local'
      AND role = 'USER'
      AND status = 'ACTIVE'
      AND deleted_at IS NULL) AS active_residents,
  (SELECT COUNT(*)
     FROM bills
    WHERE institution_id = 'inst_boardops_local'
      AND period_month = 7
      AND period_year = 2026
      AND deleted_on IS NULL
      AND purged_at IS NULL
      AND status NOT IN ('VOID', 'DELETED')) AS august_bills;
`;

const parsed = executeJson(query);
const row = parsed?.[0]?.results?.[0];
if (!row) {
  console.error("[BoardOps] Funds verification query returned no row.");
  process.exit(1);
}

const expected = {
  permissions: 50,
  role_permissions: 128,
  admin_funds_read: 1,
  super_admin_funds_read: 1,
  manager_funds_read: 0,
  resident_funds_read: 0,
  august_deposit_minor: 500000,
  august_refunded_minor: 0,
  august_expenses_minor: 450000,
  active_residents: 1,
  august_bills: 0,
};

for (const [field, value] of Object.entries(expected)) {
  const actual = Number(row[field] ?? -1);
  if (actual !== value) {
    console.error(`[BoardOps] Funds invariant failed: ${field}=${row[field]} (expected ${value})`);
    process.exit(1);
  }
}

const remainingMinor = Number(row.august_deposit_minor) - Number(row.august_expenses_minor);
if (remainingMinor !== 50000) {
  console.error(`[BoardOps] Funds remaining-balance invariant failed: ${remainingMinor} (expected 50000)`);
  process.exit(1);
}

console.log("[BoardOps] Funds canonical inputs + least-privilege RBAC verified:", {
  ...row,
  august_remaining_minor: remainingMinor,
});
