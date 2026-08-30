import { spawnSync } from "node:child_process";

const WRANGLER = [
  "exec", "wrangler", "d1", "execute", "boardops-local",
  "--local", "--persist-to", ".wrangler/state",
  "--config", "services/api/wrangler.jsonc",
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
    console.error("[BoardOps] Could not parse Notifications verification output.", error);
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
    WHERE type = 'table' AND name IN ('notifications','announcements')) AS communication_tables,
  (SELECT COUNT(*) FROM sqlite_master
    WHERE type = 'trigger' AND name IN (
      'announcements_published_content_immutable',
      'announcements_published_time_immutable',
      'announcements_block_delete',
      'notifications_content_immutable',
      'notifications_block_delete',
      'roles_bootstrap_notifications_all',
      'roles_bootstrap_announcements_admin'
    )) AS communication_guards,
  (SELECT COUNT(*) FROM sqlite_master
    WHERE type = 'trigger' AND name IN (
      'notifications_leave_submitted',
      'notifications_leave_decision',
      'notifications_payment_submitted',
      'notifications_payment_status',
      'notifications_meal_override',
      'notifications_refund_created',
      'notifications_refund_transaction',
      'notifications_refund_cancelled',
      'notifications_registration_review',
      'notifications_user_status',
      'notifications_user_role'
    )) AS event_delivery_triggers,
  (SELECT COUNT(*) FROM permissions
    WHERE permission_key IN (
      'notifications.read_self','notifications.mark_read_self','announcements.read',
      'announcements.create','announcements.update','announcements.archive'
    )) AS communication_permissions,
  (SELECT COUNT(*)
     FROM roles r JOIN role_permissions rp ON rp.role_id = r.id JOIN permissions p ON p.id = rp.permission_id
    WHERE r.institution_id = 'inst_boardops_local' AND r.role_key = 'ADMIN'
      AND p.permission_key IN (
        'notifications.read_self','notifications.mark_read_self','announcements.read',
        'announcements.create','announcements.update','announcements.archive'
      )) AS admin_communication_permissions,
  (SELECT COUNT(*)
     FROM roles r JOIN role_permissions rp ON rp.role_id = r.id JOIN permissions p ON p.id = rp.permission_id
    WHERE r.institution_id = 'inst_boardops_local' AND r.role_key = 'SUPER_ADMIN'
      AND p.permission_key IN (
        'notifications.read_self','notifications.mark_read_self','announcements.read',
        'announcements.create','announcements.update','announcements.archive'
      )) AS super_admin_communication_permissions,
  (SELECT COUNT(*)
     FROM roles r JOIN role_permissions rp ON rp.role_id = r.id JOIN permissions p ON p.id = rp.permission_id
    WHERE r.institution_id = 'inst_boardops_local' AND r.role_key = 'MANAGER'
      AND p.permission_key IN (
        'notifications.read_self','notifications.mark_read_self','announcements.read',
        'announcements.create','announcements.update','announcements.archive'
      )) AS manager_communication_permissions,
  (SELECT COUNT(*)
     FROM roles r JOIN role_permissions rp ON rp.role_id = r.id JOIN permissions p ON p.id = rp.permission_id
    WHERE r.institution_id = 'inst_boardops_local' AND r.role_key = 'USER'
      AND p.permission_key IN (
        'notifications.read_self','notifications.mark_read_self','announcements.read',
        'announcements.create','announcements.update','announcements.archive'
      )) AS resident_communication_permissions,
  (SELECT COUNT(*) FROM announcements WHERE institution_id = 'inst_boardops_local') AS seeded_announcements,
  (SELECT COUNT(*) FROM announcements
    WHERE id = 'announcement_local_welcome' AND status = 'PUBLISHED' AND is_pinned = 1
      AND target_audience = 'ALL') AS seeded_published_announcement,
  (SELECT COUNT(*) FROM notifications
    WHERE institution_id = 'inst_boardops_local') AS seeded_total_notifications,
  (SELECT COUNT(*) FROM notifications
    WHERE institution_id = 'inst_boardops_local' AND source_type = 'ANNOUNCEMENT'
      AND source_id = 'announcement_local_welcome') AS seeded_announcement_notifications,
  (SELECT COUNT(*) FROM notifications
    WHERE institution_id = 'inst_boardops_local'
      AND delivery_key IN (
        'leave:leave_riya_pending_local:submitted',
        'payment:payment_arjun_pending_local:submitted'
      )) AS seeded_event_notifications,
  (SELECT COUNT(*) FROM notifications
    WHERE institution_id = 'inst_boardops_local' AND user_id = 'usr_admin_local'
      AND delivery_key IN (
        'leave:leave_riya_pending_local:submitted',
        'payment:payment_arjun_pending_local:submitted'
      ) AND read_at = '2026-08-30T11:59:00.000Z') AS seeded_event_notifications_read,
  (SELECT COUNT(*) FROM notifications
    WHERE id = 'notification_local_welcome_riya' AND user_id = 'usr_resident_riya_local' AND read_at IS NULL) AS seeded_riya_unread,
  (SELECT COUNT(*) FROM notifications
    WHERE id = 'notification_local_welcome_admin' AND user_id = 'usr_admin_local' AND read_at IS NULL) AS seeded_admin_unread,
  (SELECT COUNT(*) FROM notifications
    WHERE source_id = 'announcement_local_welcome'
      AND user_id IN ('usr_resident_kabir_local','usr_resident_arjun_local')) AS ineligible_seed_deliveries;
`;

const parsed = executeJson(query);
const row = parsed?.[0]?.results?.[0];
if (!row) {
  console.error("[BoardOps] Notifications verification query returned no row.");
  process.exit(1);
}

const exact = {
  permissions: 72,
  role_permissions: 178,
  communication_tables: 2,
  communication_guards: 7,
  event_delivery_triggers: 11,
  communication_permissions: 6,
  admin_communication_permissions: 6,
  super_admin_communication_permissions: 6,
  manager_communication_permissions: 3,
  resident_communication_permissions: 3,
  seeded_announcements: 1,
  seeded_published_announcement: 1,
  seeded_total_notifications: 4,
  seeded_announcement_notifications: 2,
  seeded_event_notifications: 2,
  seeded_event_notifications_read: 2,
  seeded_riya_unread: 1,
  seeded_admin_unread: 1,
  ineligible_seed_deliveries: 0,
};

for (const [field, expected] of Object.entries(exact)) {
  const actual = Number(row[field] ?? -1);
  if (actual !== expected) {
    console.error(`[BoardOps] Notifications invariant failed: ${field}=${row[field]} (expected ${expected})`);
    process.exit(1);
  }
}

expectSqlFailure(`INSERT INTO notifications (
  id, institution_id, user_id, title, description, type, priority, route,
  read_at, source_type, source_id, delivery_key, created_at
) VALUES (
  'verify_duplicate_delivery', 'inst_boardops_local', 'usr_resident_riya_local',
  'Duplicate probe', 'must fail', 'INFO', 'NORMAL', '/notifications', NULL,
  'ANNOUNCEMENT', 'announcement_local_welcome',
  'announcement:announcement_local_welcome:published', '2026-08-30T12:00:01.000Z'
);`, "UNIQUE constraint failed");

expectSqlFailure(`UPDATE notifications
  SET title = 'Mutated delivery'
  WHERE id = 'notification_local_welcome_riya';`,
"notification delivery content is immutable");

expectSqlFailure(`DELETE FROM notifications
  WHERE id = 'notification_local_welcome_riya';`,
"notifications are durable inbox history and cannot be hard-deleted");

expectSqlFailure(`UPDATE announcements
  SET title = 'Mutated published announcement'
  WHERE id = 'announcement_local_welcome';`,
"published announcement delivery content is immutable");

expectSqlFailure(`UPDATE announcements
  SET published_at = NULL
  WHERE id = 'announcement_local_welcome';`,
"announcement published_at is immutable");

expectSqlFailure(`DELETE FROM announcements
  WHERE id = 'announcement_local_welcome';`,
"announcements are durable history; archive instead");

// Read state is the only mutable notification field. Prove it works and restore
// the deterministic unread fixture for runtime/browser tests that follow.
executeJson(`UPDATE notifications
  SET read_at = '2026-08-30T13:00:00.000Z'
  WHERE id = 'notification_local_welcome_riya';`);
const marked = executeJson(`SELECT COUNT(*) AS marked
  FROM notifications
 WHERE id = 'notification_local_welcome_riya'
   AND read_at = '2026-08-30T13:00:00.000Z';`);
if (Number(marked?.[0]?.results?.[0]?.marked ?? 0) !== 1) {
  console.error("[BoardOps] Notification read-state mutation failed.");
  process.exit(1);
}
executeJson(`UPDATE notifications SET read_at = NULL WHERE id = 'notification_local_welcome_riya';`);

console.log("[BoardOps] Durable Notifications + Announcements + transactional idempotent event delivery + exact RBAC verified:", row);
