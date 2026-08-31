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
    console.error("[BoardOps] Could not parse Roles/Permissions verification output.", error);
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

const query = `
SELECT
  (SELECT COUNT(*) FROM permissions) AS permissions,
  (SELECT COUNT(*) FROM role_permissions) AS role_permissions,
  (SELECT COUNT(*) FROM roles WHERE institution_id = 'inst_boardops_local' AND is_system = 1) AS system_roles,
  (SELECT COUNT(*) FROM users u
    WHERE NOT EXISTS (
      SELECT 1 FROM roles r
      WHERE r.institution_id = u.institution_id AND r.role_key = u.role
    )) AS unresolved_user_roles,
  (SELECT COUNT(*) FROM sqlite_master WHERE type = 'trigger' AND name IN (
    'permissions_catalog_block_update',
    'permissions_catalog_block_delete',
    'system_roles_block_update',
    'system_roles_block_delete',
    'system_role_permissions_block_update',
    'system_role_permissions_block_delete',
    'users_require_resolved_role_insert',
    'users_require_resolved_role_update',
    'users_preserve_last_active_admin_update',
    'users_preserve_last_active_admin_delete'
  )) AS integrity_guards,
  (SELECT COUNT(*) FROM users
    WHERE institution_id = 'inst_boardops_local'
      AND role IN ('ADMIN','SUPER_ADMIN')
      AND status = 'ACTIVE' AND deleted_at IS NULL) AS active_admins,
  (SELECT COUNT(*)
     FROM roles r
     JOIN role_permissions rp ON rp.role_id = r.id
     JOIN permissions p ON p.id = rp.permission_id
    WHERE r.institution_id = 'inst_boardops_local'
      AND r.role_key = 'ADMIN'
      AND p.permission_key = 'users.role_assign') AS admin_role_assign,
  (SELECT COUNT(*)
     FROM roles r
     JOIN role_permissions rp ON rp.role_id = r.id
     JOIN permissions p ON p.id = rp.permission_id
    WHERE r.institution_id = 'inst_boardops_local'
      AND r.role_key = 'SUPER_ADMIN'
      AND p.permission_key = 'users.role_assign') AS super_admin_role_assign,
  (SELECT COUNT(*)
     FROM roles r
     JOIN role_permissions rp ON rp.role_id = r.id
     JOIN permissions p ON p.id = rp.permission_id
    WHERE r.institution_id = 'inst_boardops_local'
      AND r.role_key IN ('MANAGER','USER')
      AND p.permission_key = 'users.role_assign') AS non_admin_role_assign;
`;

const parsed = executeJson(query);
const row = parsed?.[0]?.results?.[0];
if (!row) {
  console.error("[BoardOps] Roles/Permissions verification query returned no row.");
  process.exit(1);
}

const exact = {
  permissions: 96,
  role_permissions: 234,
  system_roles: 4,
  unresolved_user_roles: 0,
  integrity_guards: 10,
  active_admins: 1,
  admin_role_assign: 1,
  super_admin_role_assign: 1,
  non_admin_role_assign: 0,
};

for (const [field, expected] of Object.entries(exact)) {
  const actual = Number(row[field] ?? -1);
  if (actual !== expected) {
    console.error(`[BoardOps] Roles/Permissions invariant failed: ${field}=${row[field]} (expected ${expected})`);
    process.exit(1);
  }
}

expectFailure(
  "UPDATE permissions SET description = description WHERE permission_key = 'users.role_assign'",
  "permission catalog rows are immutable",
);
expectFailure(
  "DELETE FROM permissions WHERE permission_key = 'users.role_assign'",
  "permission catalog rows cannot be deleted",
);
expectFailure(
  "UPDATE roles SET name = name WHERE id = 'inst_boardops_local:role:ADMIN'",
  "system role rows are immutable",
);
expectFailure(
  "DELETE FROM roles WHERE id = 'inst_boardops_local:role:USER'",
  "system role rows cannot be deleted",
);
expectFailure(
  `UPDATE role_permissions
      SET created_at = created_at
    WHERE role_id = 'inst_boardops_local:role:ADMIN'
      AND permission_id = 'perm_users_role_assign'`,
  "system role permission grants are immutable",
);
expectFailure(
  `DELETE FROM role_permissions
    WHERE role_id = 'inst_boardops_local:role:ADMIN'
      AND permission_id = 'perm_users_role_assign'`,
  "system role permission grants cannot be deleted",
);
expectFailure(
  "UPDATE users SET institution_id = 'missing_institution' WHERE id = 'usr_resident_riya_local'",
  "user role must resolve through institution role catalog",
);
expectFailure(
  "UPDATE users SET role = 'USER' WHERE id = 'usr_admin_local'",
  "cannot remove the last active administrator",
);
expectFailure(
  "DELETE FROM users WHERE id = 'usr_admin_local'",
  "cannot remove the last active administrator",
);

console.log("[BoardOps] Roles / Permissions canonical catalog + grant integrity verified:", row);