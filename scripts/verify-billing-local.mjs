import { spawnSync } from "node:child_process";

const query = `
SELECT
  (SELECT COUNT(*) FROM billing_snapshots WHERE institution_id = 'inst_boardops_local') AS billing_snapshots,
  (SELECT COUNT(*) FROM bills WHERE institution_id = 'inst_boardops_local') AS bills,
  (SELECT COUNT(*) FROM billing_snapshots WHERE id = 'snapshot_2026_06_local' AND period_month = 5 AND period_year = 2026) AS seeded_june_snapshot,
  (SELECT COUNT(*) FROM billing_snapshots WHERE id = 'snapshot_2026_07_local' AND period_month = 6 AND period_year = 2026) AS seeded_july_snapshot,
  (SELECT COUNT(*) FROM bills WHERE id = 'bill_arjun_2026_07_local' AND snapshot_id = 'snapshot_2026_07_local') AS seeded_july_bill,
  (SELECT COUNT(*) FROM bills WHERE total_amount_minor = meal_charges_minor + other_charges_minor + adjustments_minor) AS valid_bill_arithmetic,
  (SELECT COUNT(*) FROM sqlite_master WHERE type = 'trigger' AND name IN ('billing_snapshots_block_update','billing_snapshots_block_delete','bills_block_generated_reprice')) AS billing_immutability_triggers,
  (SELECT COUNT(*) FROM permissions) AS permissions,
  (SELECT COUNT(*) FROM role_permissions) AS role_permissions,
  (SELECT COUNT(*)
     FROM roles r
     JOIN role_permissions rp ON rp.role_id = r.id
     JOIN permissions p ON p.id = rp.permission_id
    WHERE r.institution_id = 'inst_boardops_local'
      AND r.role_key = 'ADMIN'
      AND p.permission_key IN (
        'bills.read','billing.readiness','bills.generate','bills.delete','bills.restore','bills.void'
      )) AS admin_billing_permissions,
  (SELECT COUNT(*)
     FROM roles r
     JOIN role_permissions rp ON rp.role_id = r.id
     JOIN permissions p ON p.id = rp.permission_id
    WHERE r.institution_id = 'inst_boardops_local'
      AND r.role_key = 'MANAGER'
      AND p.permission_key = 'bills.read') AS manager_billing_read,
  (SELECT COUNT(*)
     FROM roles r
     JOIN role_permissions rp ON rp.role_id = r.id
     JOIN permissions p ON p.id = rp.permission_id
    WHERE r.institution_id = 'inst_boardops_local'
      AND r.role_key = 'USER'
      AND p.permission_key = 'bills.read') AS resident_billing_read,
  (SELECT COUNT(*)
     FROM roles r
     JOIN role_permissions rp ON rp.role_id = r.id
     JOIN permissions p ON p.id = rp.permission_id
    WHERE r.institution_id = 'inst_boardops_local'
      AND r.role_key = 'USER'
      AND p.permission_key IN (
        'billing.readiness','bills.generate','bills.delete','bills.restore','bills.void'
      )) AS resident_billing_mutations;
`;

const result = spawnSync(
  "pnpm",
  [
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
    "--json",
    "--command",
    query,
  ],
  { encoding: "utf8", shell: process.platform === "win32" },
);

if (result.status !== 0) {
  process.stderr.write(result.stderr || result.stdout);
  process.exit(result.status ?? 1);
}

let parsed;
try {
  parsed = JSON.parse(result.stdout);
} catch (error) {
  console.error("[BoardOps] Could not parse billing verification output.", error);
  console.error(result.stdout);
  process.exit(1);
}

const row = parsed?.[0]?.results?.[0];
if (!row) {
  console.error("[BoardOps] Billing verification query returned no row.");
  process.exit(1);
}

const required = {
  billing_snapshots: 2,
  bills: 1,
  seeded_june_snapshot: 1,
  seeded_july_snapshot: 1,
  seeded_july_bill: 1,
  valid_bill_arithmetic: 1,
  billing_immutability_triggers: 3,
  permissions: 35,
  role_permissions: 95,
  admin_billing_permissions: 6,
  manager_billing_read: 1,
  resident_billing_read: 1,
};

for (const [field, minimum] of Object.entries(required)) {
  const value = Number(row[field] ?? 0);
  if (!Number.isFinite(value) || value < minimum) {
    console.error(`[BoardOps] Billing invariant failed: ${field}=${row[field]} (expected >= ${minimum})`);
    process.exit(1);
  }
}

if (Number(row.resident_billing_mutations ?? -1) !== 0) {
  console.error(`[BoardOps] Billing least-privilege invariant failed: resident_billing_mutations=${row.resident_billing_mutations} (expected 0)`);
  process.exit(1);
}

console.log("[BoardOps] Immutable billing core + RBAC verified:", row);
