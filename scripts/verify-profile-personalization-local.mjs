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
    console.error("[BoardOps] Could not parse Profile/Personalization verification output.", error);
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
  "profile.read_self",
  "profile.update_self",
  "sessions.read_self",
  "sessions.revoke_self",
  "password.change_self",
  "avatar.update_self",
];
const quotedPermissions = permissionKeys.map((key) => `'${key}'`).join(",");

const query = `
SELECT
  (SELECT COUNT(*) FROM permissions) AS permissions,
  (SELECT COUNT(*) FROM role_permissions) AS role_permissions,
  (SELECT COUNT(*) FROM permissions WHERE permission_key IN (${quotedPermissions})) AS profile_permissions,
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
  (SELECT COUNT(*) FROM sqlite_master WHERE type = 'trigger' AND name = 'institutions_bootstrap_rbac') AS institution_bootstrap_trigger,
  (SELECT COUNT(*) FROM sqlite_master WHERE type = 'index' AND name = 'users_institution_phone_uidx') AS phone_unique_index,
  (SELECT COUNT(*) FROM pragma_table_info('user_sessions') WHERE name = 'token_digest') AS session_digest_columns,
  (SELECT COUNT(*) FROM pragma_table_info('user_sessions') WHERE name IN ('token', 'session_token', 'raw_token')) AS raw_session_token_columns,
  (SELECT COUNT(*) FROM users
    WHERE id = 'usr_admin_local'
      AND institution_id = 'inst_boardops_local'
      AND name = 'BoardOps Admin'
      AND email = 'admin@boardops.local'
      AND phone = '+919000000001'
      AND room = 'ADMIN'
      AND gender = 'OTHER'
      AND emergency_contact = '+919000009999'
      AND theme = 'system'
      AND language = 'en'
      AND timezone = 'Asia/Kolkata'
      AND role = 'ADMIN'
      AND status = 'ACTIVE') AS seeded_admin_profile;
`;

const parsed = executeJson(query);
const row = parsed?.[0]?.results?.[0];
if (!row) {
  console.error("[BoardOps] Profile/Personalization verification query returned no row.");
  process.exit(1);
}

const exact = {
  permissions: 85,
  role_permissions: 212,
  profile_permissions: 6,
  admin_permissions: 6,
  super_admin_permissions: 6,
  manager_permissions: 6,
  resident_permissions: 6,
  institution_bootstrap_trigger: 1,
  phone_unique_index: 1,
  session_digest_columns: 1,
  raw_session_token_columns: 0,
  seeded_admin_profile: 1,
};

for (const [field, expected] of Object.entries(exact)) {
  const actual = Number(row[field] ?? -1);
  if (actual !== expected) {
    console.error(`[BoardOps] Profile/Personalization invariant failed: ${field}=${row[field]} (expected ${expected})`);
    process.exit(1);
  }
}

expectFailure(
  "UPDATE users SET theme = 'neon' WHERE id = 'usr_admin_local'",
  "CHECK constraint failed",
);

expectFailure(
  "UPDATE users SET gender = 'INVALID' WHERE id = 'usr_admin_local'",
  "CHECK constraint failed",
);

expectFailure(
  "UPDATE users SET phone = '+919123456789' WHERE id = 'usr_admin_local'",
  "UNIQUE constraint failed",
);

console.log("[BoardOps] Profile / Personalization persistence + exact RBAC + cookie-session storage invariants verified:", row);
