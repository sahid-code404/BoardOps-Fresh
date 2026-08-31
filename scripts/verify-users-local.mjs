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
    console.error("[BoardOps] Could not parse Residents / Users verification output.", error);
    console.error(result.stdout);
    process.exit(1);
  }
}

const userPermissions = [
  "users.read",
  "users.approve",
  "users.request_changes",
  "users.reject",
  "users.status_change",
  "users.role_assign",
  "users.update",
  "users.delete",
  "users.restore",
];
const quoted = userPermissions.map((key) => `'${key}'`).join(",");

const query = `
SELECT
  (SELECT COUNT(*) FROM permissions) AS permissions,
  (SELECT COUNT(*) FROM role_permissions) AS role_permissions,
  (SELECT COUNT(*) FROM permissions WHERE permission_key IN (${quoted})) AS user_permissions,
  (SELECT COUNT(*)
     FROM roles r JOIN role_permissions rp ON rp.role_id = r.id JOIN permissions p ON p.id = rp.permission_id
    WHERE r.institution_id = 'inst_boardops_local' AND r.role_key = 'ADMIN'
      AND p.permission_key IN (${quoted})) AS admin_user_permissions,
  (SELECT COUNT(*)
     FROM roles r JOIN role_permissions rp ON rp.role_id = r.id JOIN permissions p ON p.id = rp.permission_id
    WHERE r.institution_id = 'inst_boardops_local' AND r.role_key = 'SUPER_ADMIN'
      AND p.permission_key IN (${quoted})) AS super_admin_user_permissions,
  (SELECT COUNT(*)
     FROM roles r JOIN role_permissions rp ON rp.role_id = r.id JOIN permissions p ON p.id = rp.permission_id
    WHERE r.institution_id = 'inst_boardops_local' AND r.role_key = 'MANAGER'
      AND p.permission_key IN (${quoted})) AS manager_user_permissions,
  (SELECT COUNT(*)
     FROM roles r JOIN role_permissions rp ON rp.role_id = r.id JOIN permissions p ON p.id = rp.permission_id
    WHERE r.institution_id = 'inst_boardops_local' AND r.role_key = 'USER'
      AND p.permission_key IN (${quoted})) AS resident_user_permissions,
  (SELECT COUNT(*) FROM pragma_table_info('users')
    WHERE name IN ('email_verified','deleted_at','deletion_reason')) AS lifecycle_columns,
  (SELECT COUNT(*) FROM pragma_table_info('registration_requests')
    WHERE name IN ('status','reason','fields_needing_correction_json','reviewed_by','reviewed_at')) AS review_columns,
  (SELECT COUNT(*) FROM pragma_table_info('notifications')
    WHERE name IN ('user_id','source_type','source_id','delivery_key')) AS notification_delivery_columns,
  (SELECT COUNT(*) FROM pragma_index_list('notifications') WHERE [unique] = 1) AS notification_unique_indexes,
  (SELECT COUNT(*) FROM sqlite_master
    WHERE type = 'table' AND name IN ('bills','payments','refunds','meal_entries','restrictions')) AS user360_source_tables,
  (SELECT COUNT(*) FROM pragma_table_info('restrictions')
    WHERE name IN (
      'id','institution_id','user_id','type','reason','source','status',
      'applied_by','applied_at','expires_at','lifted_by','lifted_at','lift_reason',
      'created_at','updated_at'
    )) AS restriction_columns,
  (SELECT COUNT(*) FROM pragma_index_list('restrictions')) AS restriction_indexes,
  (SELECT COUNT(*) FROM restrictions WHERE institution_id = 'inst_boardops_local' AND status = 'ACTIVE') AS seeded_active_restrictions,
  (SELECT COUNT(*) FROM users WHERE institution_id = 'inst_boardops_local') AS seeded_users,
  (SELECT COUNT(*) FROM users
    WHERE id = 'usr_admin_local' AND institution_id = 'inst_boardops_local'
      AND role = 'ADMIN' AND status = 'ACTIVE' AND deleted_at IS NULL) AS seeded_active_admins,
  (SELECT COUNT(*) FROM users
    WHERE id = 'usr_resident_riya_local' AND institution_id = 'inst_boardops_local'
      AND role = 'USER' AND status = 'ACTIVE' AND deleted_at IS NULL AND email_verified = 1) AS seeded_active_residents,
  (SELECT COUNT(*) FROM users
    WHERE id = 'usr_resident_kabir_local' AND institution_id = 'inst_boardops_local'
      AND role = 'USER' AND status = 'PENDING' AND deleted_at IS NULL AND email_verified = 1) AS seeded_pending_residents,
  (SELECT COUNT(*) FROM registration_requests
    WHERE id = 'registration_kabir_cycle_1' AND institution_id = 'inst_boardops_local'
      AND user_id = 'usr_resident_kabir_local' AND status = 'PENDING_REVIEW') AS seeded_pending_reviews,
  (SELECT COUNT(*) FROM meal_entries
    WHERE institution_id = 'inst_boardops_local'
      AND user_id = 'usr_resident_riya_local'
      AND service_date >= '2026-08-01' AND service_date < '2026-09-01'
      AND status IN ('ON','LOCKED')) AS seeded_riya_august_on_meals,
  ((SELECT COUNT(*) FROM bills
      WHERE institution_id = 'inst_boardops_local' AND user_id = 'usr_resident_arjun_local'
        AND deleted_on IS NULL AND purged_at IS NULL)
   + (SELECT COUNT(*) FROM payments
      WHERE institution_id = 'inst_boardops_local' AND user_id = 'usr_resident_arjun_local'
        AND deleted_on IS NULL AND purged_at IS NULL)) AS seeded_arjun_finance_rows;
`;

const parsed = executeJson(query);
const row = parsed?.[0]?.results?.[0];
if (!row) {
  console.error("[BoardOps] Residents / Users verification query returned no row.");
  process.exit(1);
}

const exact = {
  permissions: 98,
  role_permissions: 242,
  user_permissions: 9,
  admin_user_permissions: 9,
  super_admin_user_permissions: 9,
  manager_user_permissions: 0,
  resident_user_permissions: 0,
  lifecycle_columns: 3,
  review_columns: 5,
  notification_delivery_columns: 4,
  user360_source_tables: 5,
  restriction_columns: 15,
  restriction_indexes: 2,
  seeded_active_restrictions: 0,
  // The complete deterministic seed chain intentionally contains four users.
  // The three named fixtures below are the Users checkpoint's owned baseline;
  // the fourth is supplied by an already-verified downstream fixture.
  seeded_users: 4,
  seeded_active_admins: 1,
  seeded_active_residents: 1,
  seeded_pending_residents: 1,
  seeded_pending_reviews: 1,
  seeded_riya_august_on_meals: 2,
  seeded_arjun_finance_rows: 3,
};

for (const [field, expected] of Object.entries(exact)) {
  const actual = Number(row[field] ?? -1);
  if (actual !== expected) {
    console.error(`[BoardOps] Residents / Users invariant failed: ${field}=${row[field]} (expected ${expected})`);
    process.exit(1);
  }
}

if (Number(row.notification_unique_indexes ?? 0) < 1) {
  console.error("[BoardOps] Residents / Users invariant failed: notifications has no unique delivery boundary");
  process.exit(1);
}

console.log("[BoardOps] Residents / Users lifecycle + least-privilege + User 360 + restriction invariants verified:", row);
