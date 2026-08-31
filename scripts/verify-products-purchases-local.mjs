import { spawnSync } from "node:child_process";

const WRANGLER = [
  "exec", "wrangler", "d1", "execute", "boardops-local",
  "--local", "--persist-to", ".wrangler/state",
  "--config", "services/api/wrangler.jsonc",
];

function run(command, json = false) {
  const args = [...WRANGLER, ...(json ? ["--json"] : []), "--command", command];
  return spawnSync("pnpm", args, {
    encoding: "utf8",
    shell: process.platform === "win32",
  });
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
    console.error("[BoardOps] Could not parse Products/Purchases verification output.", error);
    console.error(result.stdout);
    process.exit(1);
  }
}

function expectFailure(command, expectedText) {
  const result = run(command);
  if (result.status === 0) {
    console.error(`[BoardOps] Expected D1 command to fail but it succeeded: ${command}`);
    process.exit(1);
  }
  const output = `${result.stdout}\n${result.stderr}`;
  if (!output.includes(expectedText)) {
    console.error(`[BoardOps] D1 command failed for an unexpected reason. Expected text: ${expectedText}`);
    console.error(output);
    process.exit(1);
  }
}

const query = `
SELECT
  (SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name IN ('units','products','purchases','purchase_items')) AS procurement_tables,
  (SELECT COUNT(*) FROM sqlite_master WHERE type = 'trigger' AND name IN (
    'purchases_integer_money_insert',
    'purchase_items_integer_money_insert',
    'purchases_require_matching_expense',
    'purchases_content_immutable',
    'purchases_block_hard_delete',
    'purchase_items_block_update',
    'purchase_items_block_delete',
    'purchase_items_scope_guard',
    'purchase_items_count_guard',
    'purchase_items_total_guard',
    'products_block_delete',
    'units_block_delete'
  )) AS procurement_guards,
  (SELECT COUNT(*) FROM sqlite_master WHERE type = 'trigger' AND name = 'roles_bootstrap_products_purchases_admin') AS bootstrap_triggers,
  (SELECT COUNT(*) FROM permissions) AS permissions,
  (SELECT COUNT(*) FROM role_permissions) AS role_permissions,
  (SELECT COUNT(*) FROM permissions WHERE permission_key IN (
    'products.read','products.write','purchases.read','purchases.create','purchases.delete','purchases.restore'
  )) AS procurement_permissions,
  (SELECT COUNT(*) FROM roles r JOIN role_permissions rp ON rp.role_id = r.id JOIN permissions p ON p.id = rp.permission_id
    WHERE r.institution_id = 'inst_boardops_local' AND r.role_key = 'ADMIN'
      AND p.permission_key IN ('products.read','products.write','purchases.read','purchases.create','purchases.delete','purchases.restore')) AS admin_procurement_permissions,
  (SELECT COUNT(*) FROM roles r JOIN role_permissions rp ON rp.role_id = r.id JOIN permissions p ON p.id = rp.permission_id
    WHERE r.institution_id = 'inst_boardops_local' AND r.role_key = 'SUPER_ADMIN'
      AND p.permission_key IN ('products.read','products.write','purchases.read','purchases.create','purchases.delete','purchases.restore')) AS super_admin_procurement_permissions,
  (SELECT COUNT(*) FROM roles r JOIN role_permissions rp ON rp.role_id = r.id JOIN permissions p ON p.id = rp.permission_id
    WHERE r.institution_id = 'inst_boardops_local' AND r.role_key IN ('MANAGER','USER')
      AND p.permission_key IN ('products.read','products.write','purchases.read','purchases.create','purchases.delete','purchases.restore')) AS non_admin_procurement_permissions,
  (SELECT COUNT(*) FROM units WHERE institution_id = 'inst_boardops_local' AND is_active = 1) AS seeded_units,
  (SELECT COUNT(*) FROM products WHERE institution_id = 'inst_boardops_local' AND is_active = 1) AS seeded_products,
  (SELECT COUNT(*) FROM purchases WHERE institution_id = 'inst_boardops_local') AS seeded_purchases;
`;

const parsed = executeJson(query);
const row = parsed?.[0]?.results?.[0];
if (!row) {
  console.error("[BoardOps] Products/Purchases verification query returned no row.");
  process.exit(1);
}

const exact = {
  procurement_tables: 4,
  procurement_guards: 12,
  bootstrap_triggers: 1,
  permissions: 96,
  role_permissions: 234,
  procurement_permissions: 6,
  admin_procurement_permissions: 6,
  super_admin_procurement_permissions: 6,
  non_admin_procurement_permissions: 0,
  seeded_units: 4,
  seeded_products: 3,
  seeded_purchases: 0,
};

for (const [field, expected] of Object.entries(exact)) {
  const actual = Number(row[field] ?? -1);
  if (actual !== expected) {
    console.error(`[BoardOps] Products/Purchases invariant failed: ${field}=${row[field]} (expected ${expected})`);
    process.exit(1);
  }
}

// Wrangler local D1 intentionally rejects explicit BEGIN/SAVEPOINT statements.
// Creation, idempotency, linked-expense lifecycle and report integration are
// therefore proven by tests/runtime-e2e/products-purchases.spec.ts against the
// running Worker. This verifier stays side-effect free and probes only D1 guards.
expectFailure(
  `INSERT INTO purchases (
     id, institution_id, vendor, purchase_date, total_amount_minor, currency_code,
     item_count, expense_id, created_by
   ) VALUES (
     'verify_missing_expense_purchase', 'inst_boardops_local', 'Verifier Market',
     '2026-08-15', 60000, 'INR', 1, 'missing_expense', 'usr_admin_local'
   )`,
  "purchase must reference matching approved expense evidence",
);
expectFailure(
  "DELETE FROM products WHERE id = 'product_rice_local'",
  "products must be archived, not deleted",
);
expectFailure(
  "DELETE FROM units WHERE id = 'unit_kg_local'",
  "units must be deactivated, not deleted",
);

console.log("[BoardOps] Products / Purchases catalog + immutable accounting schema verified:", row);
