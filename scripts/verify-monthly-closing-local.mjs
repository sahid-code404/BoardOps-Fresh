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

function run(command, json = false) {
  return spawnSync(
    "pnpm",
    [...WRANGLER, ...(json ? ["--json"] : []), "--command", command],
    { encoding: "utf8", shell: process.platform === "win32" },
  );
}

function executeJson(command) {
  const result = run(command, true);
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

function expectSqlFailure(command, expectedMessage) {
  const result = run(command, false);
  const output = `${result.stdout || ""}\n${result.stderr || ""}`;
  if (result.status === 0 || !output.includes(expectedMessage)) {
    console.error(`[BoardOps] Expected D1 rejection containing: ${expectedMessage}`);
    console.error(output);
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
  (SELECT COUNT(*) FROM sqlite_master
    WHERE type = 'trigger' AND name IN (
      'meal_entries_block_locked_period_insert',
      'meal_entries_block_locked_period_update',
      'meal_entries_block_locked_period_delete',
      'guest_meals_block_locked_period_insert',
      'guest_meals_block_locked_period_update',
      'guest_meals_block_locked_period_delete',
      'expenses_block_locked_period_insert',
      'expenses_block_locked_period_update',
      'expenses_block_locked_period_delete'
    )) AS source_lock_guards,
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
  (SELECT COUNT(*) FROM billing_cycles
    WHERE id = 'cycle_2026_04_failed_local'
      AND institution_id = 'inst_boardops_local'
      AND period_month = 3 AND period_year = 2026
      AND status = 'FAILED' AND published_snapshot_id IS NULL) AS april_failed_unpublished_cycle,
  (SELECT COUNT(*) FROM accounting_periods
    WHERE institution_id = 'inst_boardops_local' AND period_key = '2026-04' AND status = 'CLOSING') AS april_closing_period,
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

// Global RBAC grows as later checkpoints add explicit permissions. Monthly
// Closing owns its three grants exactly but only requires the verified 67/164
// baseline as a floor so a later least-privilege extension cannot break history.
if (Number(row.permissions ?? 0) < 67 || Number(row.role_permissions ?? 0) < 164) {
  console.error(`[BoardOps] Monthly Closing RBAC baseline regressed: permissions=${row.permissions}, grants=${row.role_permissions}`);
  process.exit(1);
}

const exact = {
  closing_tables: 2,
  closing_guards: 7,
  source_lock_guards: 9,
  closing_permissions: 3,
  admin_closing_permissions: 3,
  super_admin_closing_permissions: 3,
  non_admin_closing_permissions: 0,
  seeded_cycles: 1,
  seeded_cycle_events: 1,
  april_failed_unpublished_cycle: 1,
  april_closing_period: 1,
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

// Prove CLOSING is an actual database source-data lock, not merely a route/UI
// convention. These insert probes use otherwise-valid foreign keys and assert
// the specific Monthly Closing trigger messages, so unrelated constraints
// cannot produce a false positive. Always restore August for downstream smoke.
executeJson(`UPDATE accounting_periods
  SET status = 'CLOSING', closing_started_at = '2026-08-30T00:00:00.000Z', updated_at = '2026-08-30T00:00:00.000Z'
  WHERE institution_id = 'inst_boardops_local' AND period_key = '2026-08' AND status = 'OPEN';`);

try {
  expectSqlFailure(`INSERT INTO meal_entries
    (id, institution_id, user_id, meal_id, service_date, status, original_state,
     editable_until, locked, notes, updated_by, created_at, updated_at)
   VALUES
    ('verify_locked_meal_insert', 'inst_boardops_local', 'usr_resident_riya_local',
     'meal_breakfast_local', '2026-08-31', 'ON', 'ON', '2026-08-30T16:30:00.000Z',
     1, 'must be blocked', 'usr_admin_local', '2026-08-30T00:00:00.000Z', '2026-08-30T00:00:00.000Z');`,
  "meal source period is closing or closed");

  expectSqlFailure(`INSERT INTO guest_meals
    (id, institution_id, meal_id, host_user_id, guest_name, guest_count, service_date, notes, created_at)
   VALUES
    ('verify_locked_guest_insert', 'inst_boardops_local', 'meal_lunch_local',
     'usr_resident_riya_local', 'Closing lock probe', 1, '2026-08-31',
     'must be blocked', '2026-08-30T00:00:00.000Z');`,
  "guest meal source period is closing or closed");

  expectSqlFailure(`INSERT INTO expenses
    (id, institution_id, title, category, quantity, unit, amount_minor, currency_code,
     description, expense_date, paid_to, idempotency_key, status, created_by, created_at, updated_at)
   VALUES
    ('verify_locked_expense_insert', 'inst_boardops_local', 'Closing lock probe', 'TEST',
     1, 'piece', 100, 'INR', 'must be blocked', '2026-08-31T12:00:00.000Z',
     'Verifier', 'verify-closing-source-lock', 'APPROVED', 'usr_admin_local',
     '2026-08-30T00:00:00.000Z', '2026-08-30T00:00:00.000Z');`,
  "expense source period is closing or closed");
} finally {
  executeJson(`UPDATE accounting_periods
    SET status = 'OPEN', closing_started_at = NULL, updated_at = '2026-08-30T00:00:00.000Z'
    WHERE institution_id = 'inst_boardops_local' AND period_key = '2026-08';`);
}

const restored = executeJson(`SELECT COUNT(*) AS open_count
  FROM accounting_periods
 WHERE institution_id = 'inst_boardops_local' AND period_key = '2026-08' AND status = 'OPEN';`);
if (Number(restored?.[0]?.results?.[0]?.open_count ?? 0) !== 1) {
  console.error("[BoardOps] Monthly Closing verifier failed to restore August OPEN state.");
  process.exit(1);
}

console.log("[BoardOps] Monthly Closing schema + exact owned RBAC + rollback fixture + source-freeze guards verified:", row);
