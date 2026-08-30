import { spawnSync } from "node:child_process";

const WRANGLER = [
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
];

function executeJson(command) {
  const result = spawnSync(
    "pnpm",
    [...WRANGLER, "--json", "--command", command],
    { encoding: "utf8", shell: process.platform === "win32" },
  );
  if (result.status !== 0) {
    process.stderr.write(result.stderr || result.stdout);
    process.exit(result.status ?? 1);
  }
  try {
    return JSON.parse(result.stdout);
  } catch (error) {
    console.error("[BoardOps] Could not parse payments verification output.", error);
    console.error(result.stdout);
    process.exit(1);
  }
}

const query = `
SELECT
  (SELECT COUNT(*) FROM payments WHERE institution_id = 'inst_boardops_local') AS payments,
  (SELECT COUNT(*) FROM refunds WHERE institution_id = 'inst_boardops_local') AS refunds,
  (SELECT COUNT(*)
     FROM payments
    WHERE id = 'bill_arjun_2026_07_local:migrated-paid-balance'
      AND institution_id = 'inst_boardops_local'
      AND user_id = 'usr_resident_arjun_local'
      AND bill_id = 'bill_arjun_2026_07_local'
      AND amount_minor = 500000
      AND method = 'BANK_TRANSFER'
      AND status = 'APPROVED'
      AND reference = 'MIGRATED_BILL_PAID_BALANCE') AS migrated_paid_evidence,
  (SELECT COUNT(*)
     FROM payments
    WHERE id = 'payment_arjun_pending_local'
      AND institution_id = 'inst_boardops_local'
      AND bill_id = 'bill_arjun_2026_07_local'
      AND amount_minor = 250000
      AND method = 'UPI'
      AND status = 'PENDING') AS seeded_pending_payment,
  (SELECT COALESCE(SUM(CASE
       WHEN status = 'APPROVED' AND deleted_on IS NULL THEN amount_minor
       WHEN status = 'REFUNDED' AND deleted_on IS NULL THEN -amount_minor
       ELSE 0 END), 0)
     FROM payments
    WHERE institution_id = 'inst_boardops_local'
      AND bill_id = 'bill_arjun_2026_07_local'
      AND purged_at IS NULL) AS canonical_bill_paid_minor,
  (SELECT paid_amount_minor
     FROM bills
    WHERE id = 'bill_arjun_2026_07_local') AS bill_paid_minor,
  (SELECT due_amount_minor
     FROM bills
    WHERE id = 'bill_arjun_2026_07_local') AS bill_due_minor,
  (SELECT COUNT(*) FROM sqlite_master
    WHERE type = 'trigger'
      AND name IN (
        'payments_integer_money_insert',
        'payments_integer_money_update',
        'refunds_integer_money_insert',
        'refunds_integer_money_update'
      )) AS integer_money_triggers,
  (SELECT COUNT(*) FROM permissions) AS permissions,
  (SELECT COUNT(*) FROM role_permissions) AS role_permissions,
  (SELECT COUNT(*)
     FROM roles r
     JOIN role_permissions rp ON rp.role_id = r.id
     JOIN permissions p ON p.id = rp.permission_id
    WHERE r.institution_id = 'inst_boardops_local'
      AND r.role_key = 'ADMIN'
      AND p.permission_key IN (
        'payments.read','payments.decide','payments.update','payments.void',
        'payments.delete','payments.restore','payments.refund','refunds.read'
      )) AS admin_payment_permissions,
  (SELECT COUNT(*)
     FROM roles r
     JOIN role_permissions rp ON rp.role_id = r.id
     JOIN permissions p ON p.id = rp.permission_id
    WHERE r.institution_id = 'inst_boardops_local'
      AND r.role_key = 'USER'
      AND p.permission_key IN ('payments.read','payments.create')) AS resident_payment_permissions,
  (SELECT COUNT(*)
     FROM roles r
     JOIN role_permissions rp ON rp.role_id = r.id
     JOIN permissions p ON p.id = rp.permission_id
    WHERE r.institution_id = 'inst_boardops_local'
      AND r.role_key = 'USER'
      AND p.permission_key IN (
        'payments.decide','payments.update','payments.void','payments.delete',
        'payments.restore','payments.refund','refunds.read'
      )) AS resident_privileged_payment_permissions,
  (SELECT COUNT(*)
     FROM roles r
     JOIN role_permissions rp ON rp.role_id = r.id
     JOIN permissions p ON p.id = rp.permission_id
    WHERE r.institution_id = 'inst_boardops_local'
      AND r.role_key = 'MANAGER'
      AND p.permission_key = 'payments.read') AS manager_payment_read,
  (SELECT COUNT(*)
     FROM roles r
     JOIN role_permissions rp ON rp.role_id = r.id
     JOIN permissions p ON p.id = rp.permission_id
    WHERE r.institution_id = 'inst_boardops_local'
      AND r.role_key = 'MANAGER'
      AND p.permission_key IN (
        'payments.decide','payments.update','payments.void','payments.delete',
        'payments.restore','payments.refund','refunds.read','payments.create'
      )) AS manager_payment_mutations;
`;

const parsed = executeJson(query);
const row = parsed?.[0]?.results?.[0];
if (!row) {
  console.error("[BoardOps] Payments verification query returned no row.");
  process.exit(1);
}

const required = {
  payments: 2,
  migrated_paid_evidence: 1,
  seeded_pending_payment: 1,
  integer_money_triggers: 4,
  permissions: 44,
  role_permissions: 114,
  admin_payment_permissions: 8,
  resident_payment_permissions: 2,
  manager_payment_read: 1,
};

for (const [field, minimum] of Object.entries(required)) {
  const value = Number(row[field] ?? 0);
  if (!Number.isFinite(value) || value < minimum) {
    console.error(`[BoardOps] Payments invariant failed: ${field}=${row[field]} (expected >= ${minimum})`);
    process.exit(1);
  }
}

if (Number(row.canonical_bill_paid_minor ?? -1) !== 500000) {
  console.error(`[BoardOps] Canonical payment evidence mismatch: canonical_bill_paid_minor=${row.canonical_bill_paid_minor} (expected 500000)`);
  process.exit(1);
}
if (Number(row.bill_paid_minor ?? -1) !== 500000 || Number(row.bill_due_minor ?? -1) !== 1350000) {
  console.error(`[BoardOps] Seeded bill/payment balance mismatch: paid=${row.bill_paid_minor}, due=${row.bill_due_minor}`);
  process.exit(1);
}
if (Number(row.resident_privileged_payment_permissions ?? -1) !== 0) {
  console.error(`[BoardOps] Payments least-privilege invariant failed: resident_privileged_payment_permissions=${row.resident_privileged_payment_permissions} (expected 0)`);
  process.exit(1);
}
if (Number(row.manager_payment_mutations ?? -1) !== 0) {
  console.error(`[BoardOps] Payments least-privilege invariant failed: manager_payment_mutations=${row.manager_payment_mutations} (expected 0)`);
  process.exit(1);
}

// Prove SQLite cannot silently store a REAL value in an INTEGER-affinity money
// column. This statement must fail at the database trigger boundary.
const realMoneyProbe = spawnSync(
  "pnpm",
  [
    ...WRANGLER,
    "--command",
    `INSERT INTO payments (
       id, institution_id, user_id, amount_minor, method, status, created_at, updated_at
     ) VALUES (
       'probe_non_integer_payment', 'inst_boardops_local', 'usr_resident_arjun_local',
       12.5, 'CASH', 'PENDING', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
     );`,
  ],
  { encoding: "utf8", shell: process.platform === "win32" },
);

if (realMoneyProbe.status === 0) {
  console.error("[BoardOps] Integer-money invariant failed: D1 accepted a REAL payment amount.");
  process.exit(1);
}

const probeOutput = `${realMoneyProbe.stdout}\n${realMoneyProbe.stderr}`;
if (!probeOutput.includes("payments.amount_minor must be integer minor units")) {
  console.error("[BoardOps] Integer-money probe failed for an unexpected reason.");
  console.error(probeOutput);
  process.exit(1);
}

console.log("[BoardOps] Payments core + canonical bill balance + RBAC + integer-money enforcement verified:", row);
