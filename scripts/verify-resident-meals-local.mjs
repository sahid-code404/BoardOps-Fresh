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
    console.error("[BoardOps] Could not parse Resident Meals verification output.", error);
    console.error(result.stdout);
    process.exit(1);
  }
}

const selfPermissions = ["meals.entries.read_self", "meals.toggle_self"];
const quotedSelfPermissions = selfPermissions.map((key) => `'${key}'`).join(",");

const query = `
SELECT
  (SELECT COUNT(*) FROM permissions) AS permissions,
  (SELECT COUNT(*) FROM role_permissions) AS role_permissions,
  (SELECT COUNT(*) FROM permissions WHERE permission_key IN (${quotedSelfPermissions})) AS resident_meal_self_permissions,
  (SELECT COUNT(*) FROM sqlite_master WHERE type = 'trigger' AND name = 'roles_bootstrap_resident_meals_self_service') AS bootstrap_triggers,
  (SELECT COUNT(*) FROM pragma_table_info('meal_entries') WHERE name IN ('original_state','locked','editable_until')) AS meal_entry_state_columns,
  (SELECT COUNT(*) FROM meal_entries WHERE institution_id = 'inst_boardops_local') AS seeded_meal_entries,
  (SELECT COUNT(*) FROM leave_applications WHERE institution_id = 'inst_boardops_local') AS seeded_leave_applications,
  (SELECT COUNT(*)
     FROM roles r JOIN role_permissions rp ON rp.role_id = r.id JOIN permissions p ON p.id = rp.permission_id
    WHERE r.institution_id = 'inst_boardops_local' AND r.role_key = 'ADMIN'
      AND p.permission_key IN (${quotedSelfPermissions})) AS admin_self_permissions,
  (SELECT COUNT(*)
     FROM roles r JOIN role_permissions rp ON rp.role_id = r.id JOIN permissions p ON p.id = rp.permission_id
    WHERE r.institution_id = 'inst_boardops_local' AND r.role_key = 'SUPER_ADMIN'
      AND p.permission_key IN (${quotedSelfPermissions})) AS super_admin_self_permissions,
  (SELECT COUNT(*)
     FROM roles r JOIN role_permissions rp ON rp.role_id = r.id JOIN permissions p ON p.id = rp.permission_id
    WHERE r.institution_id = 'inst_boardops_local' AND r.role_key = 'MANAGER'
      AND p.permission_key IN (${quotedSelfPermissions})) AS manager_self_permissions,
  (SELECT COUNT(*)
     FROM roles r JOIN role_permissions rp ON rp.role_id = r.id JOIN permissions p ON p.id = rp.permission_id
    WHERE r.institution_id = 'inst_boardops_local' AND r.role_key = 'USER'
      AND p.permission_key IN (${quotedSelfPermissions})) AS resident_self_permissions,
  (SELECT COUNT(*)
     FROM roles r JOIN role_permissions rp ON rp.role_id = r.id JOIN permissions p ON p.id = rp.permission_id
    WHERE r.institution_id = 'inst_boardops_local' AND r.role_key = 'USER'
      AND p.permission_key IN ('kitchen.read','kitchen.guest.create','kitchen.guest.delete','meals.override','leave.decide')) AS resident_privileged_meal_permissions;
`;

const parsed = executeJson(query);
const row = parsed?.[0]?.results?.[0];
if (!row) {
  console.error("[BoardOps] Resident Meals verification query returned no row.");
  process.exit(1);
}

const exact = {
  permissions: 98,
  role_permissions: 242,
  resident_meal_self_permissions: 2,
  bootstrap_triggers: 1,
  meal_entry_state_columns: 3,
  seeded_meal_entries: 3,
  seeded_leave_applications: 1,
  admin_self_permissions: 2,
  super_admin_self_permissions: 2,
  manager_self_permissions: 2,
  resident_self_permissions: 2,
  resident_privileged_meal_permissions: 0,
};

for (const [field, expected] of Object.entries(exact)) {
  const actual = Number(row[field] ?? -1);
  if (actual !== expected) {
    console.error(`[BoardOps] Resident Meals invariant failed: ${field}=${row[field]} (expected ${expected})`);
    process.exit(1);
  }
}

console.log("[BoardOps] Resident meals self-service + least-privilege + baseline storage invariants verified:", row);
