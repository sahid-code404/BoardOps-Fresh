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
    console.error("[BoardOps] Could not parse expenses verification output.", error);
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
  (SELECT COUNT(*) FROM expenses WHERE institution_id = 'inst_boardops_local') AS expenses,
  (SELECT COUNT(*)
     FROM expenses
    WHERE id = 'expense_grocery_aug_2026_local'
      AND amount_minor = 300000
      AND category = 'GROCERY'
      AND status = 'APPROVED') AS seeded_grocery,
  (SELECT COUNT(*)
     FROM expenses
    WHERE id = 'expense_utilities_aug_2026_local'
      AND amount_minor = 150000
      AND category = 'UTILITIES'
      AND status = 'APPROVED') AS seeded_utilities,
  (SELECT COALESCE(SUM(amount_minor), 0)
     FROM expenses
    WHERE institution_id = 'inst_boardops_local'
      AND status = 'APPROVED'
      AND purged_at IS NULL
      AND expense_date >= '2026-08-01T00:00:00.000Z'
      AND expense_date < '2026-09-01T00:00:00.000Z') AS august_expenses_minor,
  (SELECT COUNT(*) FROM sqlite_master
    WHERE type = 'trigger'
      AND name IN (
        'expenses_integer_money_insert',
        'expenses_integer_money_update',
        'expenses_approved_content_immutable',
        'expenses_block_hard_delete'
      )) AS expense_guards,
  (SELECT COUNT(*) FROM permissions) AS permissions,
  (SELECT COUNT(*) FROM role_permissions) AS role_permissions,
  (SELECT COUNT(*)
     FROM roles r
     JOIN role_permissions rp ON rp.role_id = r.id
     JOIN permissions p ON p.id = rp.permission_id
    WHERE r.institution_id = 'inst_boardops_local'
      AND r.role_key = 'ADMIN'
      AND p.permission_key IN (
        'expenses.read','expenses.create','expenses.replace','expenses.delete','expenses.restore'
      )) AS admin_expense_permissions,
  (SELECT COUNT(*)
     FROM roles r
     JOIN role_permissions rp ON rp.role_id = r.id
     JOIN permissions p ON p.id = rp.permission_id
    WHERE r.institution_id = 'inst_boardops_local'
      AND r.role_key = 'USER'
      AND p.permission_key = 'expenses.read') AS resident_expense_read,
  (SELECT COUNT(*)
     FROM roles r
     JOIN role_permissions rp ON rp.role_id = r.id
     JOIN permissions p ON p.id = rp.permission_id
    WHERE r.institution_id = 'inst_boardops_local'
      AND r.role_key = 'USER'
      AND p.permission_key IN ('expenses.create','expenses.replace','expenses.delete','expenses.restore')) AS resident_expense_mutations,
  (SELECT COUNT(*)
     FROM roles r
     JOIN role_permissions rp ON rp.role_id = r.id
     JOIN permissions p ON p.id = rp.permission_id
    WHERE r.institution_id = 'inst_boardops_local'
      AND r.role_key = 'MANAGER'
      AND p.permission_key = 'expenses.read') AS manager_expense_read,
  (SELECT COUNT(*)
     FROM roles r
     JOIN role_permissions rp ON rp.role_id = r.id
     JOIN permissions p ON p.id = rp.permission_id
    WHERE r.institution_id = 'inst_boardops_local'
      AND r.role_key = 'MANAGER'
      AND p.permission_key IN ('expenses.create','expenses.replace','expenses.delete','expenses.restore')) AS manager_expense_mutations;
`;

const parsed = executeJson(query);
const row = parsed?.[0]?.results?.[0];
if (!row) {
  console.error("[BoardOps] Expenses verification query returned no row.");
  process.exit(1);
}

const exact = {
  seeded_grocery: 1,
  seeded_utilities: 1,
  august_expenses_minor: 450000,
  expense_guards: 4,
  permissions: 50,
  role_permissions: 128,
  admin_expense_permissions: 5,
  resident_expense_read: 1,
  resident_expense_mutations: 0,
  manager_expense_read: 1,
  manager_expense_mutations: 0,
};

if (Number(row.expenses ?? 0) < 2) {
  console.error(`[BoardOps] Expenses invariant failed: expenses=${row.expenses} (expected >= 2)`);
  process.exit(1);
}
for (const [field, expected] of Object.entries(exact)) {
  const value = Number(row[field] ?? -1);
  if (value !== expected) {
    console.error(`[BoardOps] Expenses invariant failed: ${field}=${row[field]} (expected ${expected})`);
    process.exit(1);
  }
}

expectStatementFailure(
  `INSERT INTO expenses (
     id, institution_id, title, category, quantity, unit, amount_minor,
     currency_code, expense_date, status, created_by
   ) VALUES (
     'probe_non_integer_expense', 'inst_boardops_local', 'Probe expense', 'GENERAL',
     1, 'piece', 12.5, 'INR', '2026-08-30T00:00:00.000Z', 'APPROVED', 'usr_admin_local'
   );`,
  "expenses.amount_minor must be integer minor units",
  "integer-money",
);

expectStatementFailure(
  `UPDATE expenses SET amount_minor = 300001 WHERE id = 'expense_grocery_aug_2026_local';`,
  "approved expense content is immutable; create a replacement",
  "approved-content immutability",
);

expectStatementFailure(
  `DELETE FROM expenses WHERE id = 'expense_grocery_aug_2026_local';`,
  "expenses are historical records and cannot be hard-deleted",
  "hard-delete protection",
);

console.log("[BoardOps] Expenses core + RBAC + immutability + integer-money enforcement verified:", row);
