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
    console.error("[BoardOps] Could not parse Settings/Policies/Holidays verification output.", error);
    console.error(result.stdout);
    process.exit(1);
  }
}

function expectFailure(command, expectedText) {
  const result = spawnSync("pnpm", [...WRANGLER, "--command", command], {
    encoding: "utf8",
    shell: process.platform === "win32",
  });
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

const permissionKeys = [
  "settings.read",
  "settings.write",
  "settings.delete",
  "institution.read",
  "institution.update",
  "policies.read",
  "policies.update",
  "holidays.read",
  "holidays.create",
  "holidays.update",
  "holidays.archive",
];
const readKeys = ["settings.read", "institution.read", "policies.read", "holidays.read"];
const quotedPermissions = permissionKeys.map((key) => `'${key}'`).join(",");
const quotedReads = readKeys.map((key) => `'${key}'`).join(",");

const query = `
SELECT
  (SELECT COUNT(*) FROM permissions) AS permissions,
  (SELECT COUNT(*) FROM role_permissions) AS role_permissions,
  (SELECT COUNT(*) FROM permissions WHERE permission_key IN (${quotedPermissions})) AS settings_domain_permissions,
  (SELECT COUNT(*) FROM settings WHERE institution_id = 'inst_boardops_local') AS settings_count,
  (SELECT COUNT(*) FROM settings WHERE institution_id = 'inst_boardops_local' AND is_public = 1) AS public_settings,
  (SELECT COUNT(*) FROM policies WHERE institution_id = 'inst_boardops_local') AS policies_count,
  (SELECT COUNT(*) FROM holidays WHERE institution_id = 'inst_boardops_local' AND status = 'ACTIVE') AS active_holidays,
  (SELECT COUNT(*) FROM holidays WHERE institution_id = 'inst_boardops_local' AND status = 'ACTIVE' AND meals_disabled = 1) AS meal_blocking_holidays,
  (SELECT COUNT(*) FROM sqlite_master WHERE type = 'trigger' AND name IN (
    'roles_bootstrap_settings_policy_holiday_read',
    'roles_bootstrap_settings_policy_holiday_admin'
  )) AS bootstrap_triggers,
  (SELECT COUNT(*) FROM sqlite_master WHERE type = 'trigger' AND name IN (
    'meal_entries_block_holiday_on_insert',
    'meal_entries_block_holiday_on_update',
    'guest_meals_block_holiday_on_insert',
    'guest_meals_block_holiday_on_update'
  )) AS meal_holiday_guards,
  (SELECT COUNT(*) FROM sqlite_master WHERE type = 'trigger' AND name = 'holidays_block_delete') AS holiday_delete_guard,
  (SELECT COUNT(*)
     FROM roles r JOIN role_permissions rp ON rp.role_id = r.id JOIN permissions p ON p.id = rp.permission_id
    WHERE r.institution_id = 'inst_boardops_local' AND r.role_key = 'ADMIN'
      AND p.permission_key IN (${quotedPermissions})) AS admin_permissions,
  (SELECT COUNT(*)
     FROM roles r JOIN role_permissions rp ON rp.role_id = r.id JOIN permissions p ON p.id = rp.permission_id
    WHERE r.institution_id = 'inst_boardops_local' AND r.role_key = 'SUPER_ADMIN'
      AND p.permission_key IN (${quotedPermissions})) AS super_admin_permissions,
  (SELECT COUNT(*)
     FROM roles r JOIN role_permissions rp ON rp.role_id = r.id JOIN permissions p ON p.id = rp.permission_id
    WHERE r.institution_id = 'inst_boardops_local' AND r.role_key = 'MANAGER'
      AND p.permission_key IN (${quotedPermissions})) AS manager_permissions,
  (SELECT COUNT(*)
     FROM roles r JOIN role_permissions rp ON rp.role_id = r.id JOIN permissions p ON p.id = rp.permission_id
    WHERE r.institution_id = 'inst_boardops_local' AND r.role_key = 'USER'
      AND p.permission_key IN (${quotedPermissions})) AS resident_permissions,
  (SELECT COUNT(*)
     FROM roles r JOIN role_permissions rp ON rp.role_id = r.id JOIN permissions p ON p.id = rp.permission_id
    WHERE r.institution_id = 'inst_boardops_local' AND r.role_key = 'USER'
      AND p.permission_key IN (${quotedReads})) AS resident_read_permissions,
  (SELECT COUNT(*) FROM institutions
    WHERE id = 'inst_boardops_local' AND type = 'HOSTEL'
      AND address = 'Bengaluru, Karnataka'
      AND contact_email = 'office@boardops.local'
      AND contact_phone = '+918000000000'
      AND currency_code = 'INR'
      AND timezone = 'Asia/Kolkata') AS seeded_institution_profile;
`;

const parsed = executeJson(query);
const row = parsed?.[0]?.results?.[0];
if (!row) {
  console.error("[BoardOps] Settings/Policies/Holidays verification query returned no row.");
  process.exit(1);
}

const exact = {
  permissions: 98,
  role_permissions: 242,
  settings_domain_permissions: 11,
  settings_count: 4,
  public_settings: 3,
  policies_count: 3,
  active_holidays: 2,
  meal_blocking_holidays: 2,
  bootstrap_triggers: 2,
  meal_holiday_guards: 4,
  holiday_delete_guard: 1,
  admin_permissions: 11,
  super_admin_permissions: 11,
  manager_permissions: 4,
  resident_permissions: 4,
  resident_read_permissions: 4,
  seeded_institution_profile: 1,
};

for (const [field, expected] of Object.entries(exact)) {
  const actual = Number(row[field] ?? -1);
  if (actual !== expected) {
    console.error(`[BoardOps] Settings/Policies/Holidays invariant failed: ${field}=${row[field]} (expected ${expected})`);
    process.exit(1);
  }
}

expectFailure(
  `INSERT INTO settings
    (id, institution_id, key, value, category, type, description, is_public, created_by, updated_by)
   VALUES ('probe_invalid_json_setting', 'inst_boardops_local', 'general.invalidJsonProbe', '{bad', 'GENERAL', 'JSON', NULL, 0, 'usr_admin_local', 'usr_admin_local')`,
  "CHECK constraint failed",
);

expectFailure(
  `INSERT INTO holidays
    (id, institution_id, name, description, type, start_date, end_date, meals_disabled, status, created_by)
   VALUES ('probe_invalid_holiday', 'inst_boardops_local', 'Invalid range', NULL, 'HOLIDAY', '2026-09-20', '2026-09-19', 1, 'ACTIVE', 'usr_admin_local')`,
  "CHECK constraint failed",
);

expectFailure(
  `DELETE FROM holidays WHERE id = 'holiday_foundation_local'`,
  "holidays must be archived, not deleted",
);

expectFailure(
  `INSERT INTO meal_entries
    (id, institution_id, user_id, meal_id, service_date, status, original_state, editable_until, locked, updated_by)
   VALUES ('probe_holiday_meal_entry', 'inst_boardops_local', 'usr_resident_riya_local', 'meal_breakfast_local',
           '2026-09-12', 'ON', 'ON', '2026-09-11T22:00:00.000Z', 0, 'usr_admin_local')`,
  "meal booking disabled by active holiday",
);

expectFailure(
  `INSERT INTO guest_meals
    (id, institution_id, meal_id, host_user_id, guest_name, guest_count, service_date, notes)
   VALUES ('probe_holiday_guest', 'inst_boardops_local', 'meal_breakfast_local', 'usr_admin_local',
           'Holiday guest probe', 1, '2026-09-12', NULL)`,
  "meal booking disabled by active holiday",
);

executeJson(`
  INSERT INTO meal_entries
    (id, institution_id, user_id, meal_id, service_date, status, original_state, editable_until, locked, updated_by)
  VALUES ('probe_holiday_off_entry', 'inst_boardops_local', 'usr_resident_riya_local', 'meal_breakfast_local',
          '2026-09-12', 'OFF', 'OFF', '2026-09-11T22:00:00.000Z', 0, 'usr_admin_local');
  DELETE FROM meal_entries WHERE id = 'probe_holiday_off_entry';
`);

console.log("[BoardOps] Settings / Policies / Holidays validation + exact RBAC + D1 holiday meal guards verified:", row);