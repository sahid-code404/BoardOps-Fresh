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
    console.error("[BoardOps] Could not parse Kitchen verification output.", error);
    console.error(result.stdout);
    process.exit(1);
  }
}

const kitchenPermissions = ["kitchen.read", "kitchen.guest.create", "kitchen.guest.delete"];
const quotedKitchenPermissions = kitchenPermissions.map((key) => `'${key}'`).join(",");

const query = `
SELECT
  (SELECT COUNT(*) FROM permissions) AS permissions,
  (SELECT COUNT(*) FROM role_permissions) AS role_permissions,
  (SELECT COUNT(*) FROM permissions WHERE permission_key IN (${quotedKitchenPermissions})) AS kitchen_permissions,
  (SELECT COUNT(*)
     FROM roles r JOIN role_permissions rp ON rp.role_id = r.id JOIN permissions p ON p.id = rp.permission_id
    WHERE r.institution_id = 'inst_boardops_local' AND r.role_key = 'ADMIN'
      AND p.permission_key IN (${quotedKitchenPermissions})) AS admin_kitchen_permissions,
  (SELECT COUNT(*)
     FROM roles r JOIN role_permissions rp ON rp.role_id = r.id JOIN permissions p ON p.id = rp.permission_id
    WHERE r.institution_id = 'inst_boardops_local' AND r.role_key = 'SUPER_ADMIN'
      AND p.permission_key IN (${quotedKitchenPermissions})) AS super_admin_kitchen_permissions,
  (SELECT COUNT(*)
     FROM roles r JOIN role_permissions rp ON rp.role_id = r.id JOIN permissions p ON p.id = rp.permission_id
    WHERE r.institution_id = 'inst_boardops_local' AND r.role_key = 'MANAGER'
      AND p.permission_key IN (${quotedKitchenPermissions})) AS manager_kitchen_permissions,
  (SELECT COUNT(*)
     FROM roles r JOIN role_permissions rp ON rp.role_id = r.id JOIN permissions p ON p.id = rp.permission_id
    WHERE r.institution_id = 'inst_boardops_local' AND r.role_key = 'USER'
      AND p.permission_key IN (${quotedKitchenPermissions})) AS resident_kitchen_permissions,
  (SELECT COUNT(*)
     FROM roles r JOIN role_permissions rp ON rp.role_id = r.id JOIN permissions p ON p.id = rp.permission_id
    WHERE r.institution_id = 'inst_boardops_local' AND r.role_key IN ('ADMIN','SUPER_ADMIN')
      AND p.permission_key = 'meals.override') AS administrator_override_grants,
  (SELECT COUNT(*)
     FROM roles r JOIN role_permissions rp ON rp.role_id = r.id JOIN permissions p ON p.id = rp.permission_id
    WHERE r.institution_id = 'inst_boardops_local' AND r.role_key IN ('MANAGER','USER')
      AND p.permission_key IN ('kitchen.guest.create','kitchen.guest.delete','meals.override','leave.decide')) AS non_admin_privileged_kitchen_grants,
  (SELECT COUNT(*) FROM sqlite_master WHERE type = 'trigger' AND name IN (
    'guest_meals_block_locked_period_insert',
    'guest_meals_block_locked_period_update',
    'guest_meals_block_locked_period_delete'
  )) AS guest_period_lock_triggers,
  (SELECT COUNT(*) FROM sqlite_master WHERE type = 'trigger' AND name IN (
    'meal_entries_block_locked_period_insert',
    'meal_entries_block_locked_period_update',
    'meal_entries_block_locked_period_delete'
  )) AS meal_period_lock_triggers,
  (SELECT COUNT(*) FROM sqlite_master WHERE type = 'trigger' AND name IN (
    'guest_meals_block_holiday_on_insert',
    'guest_meals_block_holiday_on_update'
  )) AS guest_holiday_guard_triggers,
  (SELECT COUNT(*) FROM sqlite_master WHERE type = 'index' AND name = 'guest_meals_institution_service_idx') AS guest_service_indexes,
  (SELECT COUNT(*) FROM sqlite_master WHERE type = 'index' AND name = 'meal_entries_institution_service_idx') AS meal_service_indexes,
  (SELECT COUNT(*) FROM meal_configurations
    WHERE institution_id = 'inst_boardops_local' AND status = 'ACTIVE') AS active_meal_configurations,
  (SELECT COUNT(*) FROM users
    WHERE institution_id = 'inst_boardops_local' AND role = 'USER' AND status = 'ACTIVE' AND deleted_at IS NULL) AS active_residents,
  (SELECT COUNT(*) FROM guest_meals
    WHERE institution_id = 'inst_boardops_local' AND id = 'guest_local_lunch_20260830'
      AND meal_id = 'meal_lunch_local' AND guest_count = 2 AND service_date = '2026-08-30') AS seeded_guest_meals;
`;

const parsed = executeJson(query);
const row = parsed?.[0]?.results?.[0];
if (!row) {
  console.error("[BoardOps] Kitchen verification query returned no row.");
  process.exit(1);
}

const exact = {
  permissions: 98,
  role_permissions: 242,
  kitchen_permissions: 3,
  admin_kitchen_permissions: 3,
  super_admin_kitchen_permissions: 3,
  manager_kitchen_permissions: 1,
  resident_kitchen_permissions: 0,
  administrator_override_grants: 2,
  non_admin_privileged_kitchen_grants: 0,
  guest_period_lock_triggers: 3,
  meal_period_lock_triggers: 3,
  guest_holiday_guard_triggers: 2,
  guest_service_indexes: 1,
  meal_service_indexes: 1,
  active_meal_configurations: 3,
  active_residents: 1,
  seeded_guest_meals: 1,
};

for (const [field, expected] of Object.entries(exact)) {
  const actual = Number(row[field] ?? -1);
  if (actual !== expected) {
    console.error(`[BoardOps] Kitchen invariant failed: ${field}=${row[field]} (expected ${expected})`);
    process.exit(1);
  }
}

console.log("[BoardOps] Kitchen counts + least-privilege + source-lock invariants verified:", row);
