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
    console.error("[BoardOps] Could not parse Audit/System verification output.", error);
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

const taskPermissions = [
  "tasks.read",
  "tasks.create",
  "tasks.cancel",
  "tasks.cleanup",
  "system.backup",
];
const quotedTaskPermissions = taskPermissions.map((key) => `'${key}'`).join(",");

const query = `
SELECT
  (SELECT COUNT(*) FROM permissions) AS permissions,
  (SELECT COUNT(*) FROM role_permissions) AS role_permissions,
  (SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = 'background_tasks') AS task_tables,
  (SELECT COUNT(*) FROM sqlite_master WHERE type = 'trigger' AND name IN (
    'background_tasks_validate_transition','background_tasks_terminal_immutable','background_tasks_block_delete'
  )) AS task_guards,
  (SELECT COUNT(*) FROM sqlite_master WHERE type = 'trigger' AND name IN (
    'audit_events_block_update','audit_events_block_delete'
  )) AS audit_guards,
  (SELECT COUNT(*) FROM sqlite_master WHERE type = 'index' AND name = 'audit_events_institution_action_time_idx') AS audit_action_indexes,
  (SELECT COUNT(*) FROM sqlite_master WHERE type = 'trigger' AND name = 'roles_bootstrap_audit_system_admin') AS bootstrap_triggers,
  (SELECT COUNT(*) FROM permissions WHERE permission_key IN (${quotedTaskPermissions})) AS task_permissions,
  (SELECT COUNT(*)
     FROM roles r JOIN role_permissions rp ON rp.role_id = r.id JOIN permissions p ON p.id = rp.permission_id
    WHERE r.institution_id = 'inst_boardops_local' AND r.role_key = 'ADMIN'
      AND p.permission_key IN (${quotedTaskPermissions})) AS admin_task_permissions,
  (SELECT COUNT(*)
     FROM roles r JOIN role_permissions rp ON rp.role_id = r.id JOIN permissions p ON p.id = rp.permission_id
    WHERE r.institution_id = 'inst_boardops_local' AND r.role_key = 'SUPER_ADMIN'
      AND p.permission_key IN (${quotedTaskPermissions})) AS super_admin_task_permissions,
  (SELECT COUNT(*)
     FROM roles r JOIN role_permissions rp ON rp.role_id = r.id JOIN permissions p ON p.id = rp.permission_id
    WHERE r.institution_id = 'inst_boardops_local' AND r.role_key IN ('MANAGER','USER')
      AND p.permission_key IN (${quotedTaskPermissions})) AS non_admin_task_permissions,
  (SELECT COUNT(*)
     FROM roles r JOIN role_permissions rp ON rp.role_id = r.id JOIN permissions p ON p.id = rp.permission_id
    WHERE r.institution_id = 'inst_boardops_local' AND r.role_key = 'ADMIN'
      AND p.permission_key = 'audit.read') AS admin_audit_read,
  (SELECT COUNT(*)
     FROM roles r JOIN role_permissions rp ON rp.role_id = r.id JOIN permissions p ON p.id = rp.permission_id
    WHERE r.institution_id = 'inst_boardops_local' AND r.role_key = 'SUPER_ADMIN'
      AND p.permission_key = 'audit.read') AS super_admin_audit_read,
  (SELECT COUNT(*)
     FROM roles r JOIN role_permissions rp ON rp.role_id = r.id JOIN permissions p ON p.id = rp.permission_id
    WHERE r.institution_id = 'inst_boardops_local' AND r.role_key IN ('MANAGER','USER')
      AND p.permission_key = 'audit.read') AS non_admin_audit_read,
  (SELECT COUNT(*) FROM background_tasks WHERE institution_id = 'inst_boardops_local') AS seeded_tasks,
  (SELECT COUNT(*) FROM background_tasks
    WHERE id = 'task_session_cleanup_seed' AND status = 'COMPLETED' AND progress = 100
      AND result_json = '{"purgedSessions":0}') AS seeded_completed_cleanup,
  (SELECT COUNT(*) FROM background_tasks
    WHERE id = 'task_system_backup_queued_seed' AND status = 'QUEUED' AND progress = 0) AS seeded_queued_backup,
  (SELECT COUNT(*) FROM audit_events
    WHERE id = 'audit_system_checkpoint_seed' AND institution_id = 'inst_boardops_local'
      AND action = 'SYSTEM_CHECKPOINT' AND entity_type = 'System') AS seeded_system_audit;
`;

const parsed = executeJson(query);
const row = parsed?.[0]?.results?.[0];
if (!row) {
  console.error("[BoardOps] Audit/System verification query returned no row.");
  process.exit(1);
}

const exact = {
  permissions: 90,
  role_permissions: 222,
  task_tables: 1,
  task_guards: 3,
  audit_guards: 2,
  audit_action_indexes: 1,
  bootstrap_triggers: 1,
  task_permissions: 5,
  admin_task_permissions: 5,
  super_admin_task_permissions: 5,
  non_admin_task_permissions: 0,
  admin_audit_read: 1,
  super_admin_audit_read: 1,
  non_admin_audit_read: 0,
  seeded_tasks: 2,
  seeded_completed_cleanup: 1,
  seeded_queued_backup: 1,
  seeded_system_audit: 1,
};

for (const [field, expected] of Object.entries(exact)) {
  const actual = Number(row[field] ?? -1);
  if (actual !== expected) {
    console.error(`[BoardOps] Audit/System invariant failed: ${field}=${row[field]} (expected ${expected})`);
    process.exit(1);
  }
}

expectFailure(
  "UPDATE background_tasks SET progress = 99 WHERE id = 'task_session_cleanup_seed'",
  "terminal background tasks are immutable",
);
expectFailure(
  "DELETE FROM background_tasks WHERE id = 'task_system_backup_queued_seed'",
  "background tasks cannot be hard-deleted",
);
expectFailure(
  "UPDATE background_tasks SET status = 'COMPLETED', finished_at = CURRENT_TIMESTAMP WHERE id = 'task_system_backup_queued_seed'",
  "invalid background task status transition",
);
expectFailure(
  `INSERT INTO background_tasks
    (id, institution_id, type, status, progress, retry_count, max_retries, triggered_by)
   VALUES ('probe_invalid_task_progress', 'inst_boardops_local', 'SESSION_CLEANUP', 'QUEUED', 101, 0, 0, 'usr_admin_local')`,
  "CHECK constraint failed",
);

console.log("[BoardOps] Audit / System / Background Tasks immutable history + exact RBAC verified:", row);
