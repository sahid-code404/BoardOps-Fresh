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
    console.error("[BoardOps] Could not parse Refunds/adjustments verification output.", error);
    console.error(result.stdout);
    process.exit(1);
  }
}

function expectStatementFailure(command, expectedText, label) {
  const result = spawnSync(
    "pnpm",
    [...WRANGLER, "--command", command],
    { encoding: "utf8", shell: process.platform === "win32" },
  );
  if (result.status === 0) {
    console.error(`[BoardOps] ${label} invariant failed: prohibited statement succeeded.`);
    process.exit(1);
  }
  const output = `${result.stdout}\n${result.stderr}`;
  if (!output.includes(expectedText)) {
    console.error(`[BoardOps] ${label} probe failed for an unexpected reason.`);
    console.error(output);
    process.exit(1);
  }
}

const query = `
SELECT
  (SELECT COUNT(*) FROM refunds WHERE institution_id = 'inst_boardops_local') AS refunds,
  (SELECT COUNT(*) FROM refund_transactions WHERE institution_id = 'inst_boardops_local') AS refund_transactions,
  (SELECT COUNT(*) FROM adjustments WHERE institution_id = 'inst_boardops_local') AS adjustments,
  (SELECT COUNT(*) FROM financial_reference_sequences WHERE institution_id = 'inst_boardops_local') AS reference_sequences,
  (SELECT COUNT(*) FROM permissions) AS permissions,
  (SELECT COUNT(*) FROM role_permissions) AS role_permissions,
  (SELECT COUNT(*) FROM sqlite_master
    WHERE type = 'trigger'
      AND name IN (
        'refunds_integer_money_insert',
        'refunds_integer_money_update',
        'refunds_block_obligation_rewrite',
        'refunds_block_delete',
        'refund_transactions_integer_money_insert',
        'refund_transactions_block_update',
        'refund_transactions_block_delete',
        'adjustments_integer_money_insert',
        'adjustments_block_update',
        'adjustments_block_delete'
      )) AS financial_guards,
  (SELECT COUNT(*) FROM sqlite_master
    WHERE type = 'trigger' AND name = 'roles_bootstrap_refunds_adjustments') AS bootstrap_trigger,
  (SELECT COUNT(*)
     FROM roles r
     JOIN role_permissions rp ON rp.role_id = r.id
     JOIN permissions p ON p.id = rp.permission_id
    WHERE r.institution_id = 'inst_boardops_local'
      AND r.role_key = 'ADMIN'
      AND p.permission_key IN (
        'refunds.read','refunds.create','refunds.pay','refunds.cancel',
        'adjustments.read','adjustments.create'
      )) AS admin_refund_adjustment_permissions,
  (SELECT COUNT(*)
     FROM roles r
     JOIN role_permissions rp ON rp.role_id = r.id
     JOIN permissions p ON p.id = rp.permission_id
    WHERE r.institution_id = 'inst_boardops_local'
      AND r.role_key = 'SUPER_ADMIN'
      AND p.permission_key IN (
        'refunds.read','refunds.create','refunds.pay','refunds.cancel',
        'adjustments.read','adjustments.create'
      )) AS super_admin_refund_adjustment_permissions,
  (SELECT COUNT(*)
     FROM roles r
     JOIN role_permissions rp ON rp.role_id = r.id
     JOIN permissions p ON p.id = rp.permission_id
    WHERE r.institution_id = 'inst_boardops_local'
      AND r.role_key = 'MANAGER'
      AND p.permission_key IN (
        'refunds.read','refunds.create','refunds.pay','refunds.cancel',
        'adjustments.read','adjustments.create'
      )) AS manager_refund_adjustment_permissions,
  (SELECT COUNT(*)
     FROM roles r
     JOIN role_permissions rp ON rp.role_id = r.id
     JOIN permissions p ON p.id = rp.permission_id
    WHERE r.institution_id = 'inst_boardops_local'
      AND r.role_key = 'USER'
      AND p.permission_key IN (
        'refunds.read','refunds.create','refunds.pay','refunds.cancel',
        'adjustments.read','adjustments.create'
      )) AS resident_refund_adjustment_permissions;
`;

const parsed = executeJson(query);
const row = parsed?.[0]?.results?.[0];
if (!row) {
  console.error("[BoardOps] Refunds/adjustments verification query returned no row.");
  process.exit(1);
}

const exact = {
  refunds: 0,
  refund_transactions: 0,
  adjustments: 0,
  reference_sequences: 0,
  permissions: 55,
  role_permissions: 138,
  financial_guards: 10,
  bootstrap_trigger: 1,
  admin_refund_adjustment_permissions: 6,
  super_admin_refund_adjustment_permissions: 6,
  manager_refund_adjustment_permissions: 0,
  resident_refund_adjustment_permissions: 0,
};

for (const [field, expected] of Object.entries(exact)) {
  const actual = Number(row[field] ?? -1);
  if (actual !== expected) {
    console.error(`[BoardOps] Refunds/adjustments invariant failed: ${field}=${row[field]} (expected ${expected})`);
    process.exit(1);
  }
}

expectStatementFailure(
  `INSERT INTO refunds (
     id, institution_id, refund_number, user_id, amount_minor,
     paid_amount_minor, remaining_amount_minor, status, created_by
   ) VALUES (
     'probe_non_integer_refund', 'inst_boardops_local', 'REF-PROBE-REAL',
     'usr_resident_riya_local', 12.5, 0, 12.5, 'PENDING', 'usr_admin_local'
   );`,
  "refund money fields must be integer minor units",
  "refund integer-money",
);

expectStatementFailure(
  `INSERT INTO adjustments (
     id, institution_id, adjustment_number, user_id, entity_type, entity_id,
     amount_minor, reason, idempotency_key, created_by
   ) VALUES (
     'probe_non_integer_adjustment', 'inst_boardops_local', 'ADJ-PROBE-REAL',
     'usr_resident_riya_local', 'Expense', 'expense_grocery_aug_2026_local',
     12.5, 'Probe integer enforcement', 'probe-adjustment-real', 'usr_admin_local'
   );`,
  "adjustments.amount_minor must be integer minor units",
  "adjustment integer-money",
);

// One SQL statement is atomic in D1. The first VALUES row inserts the probe;
// the second conflicts on id and attempts an UPDATE. The immutable UPDATE
// trigger must abort the whole statement, proving the rule without explicit
// BEGIN/ROLLBACK (which Wrangler local D1 intentionally rejects).
expectStatementFailure(
  `INSERT INTO adjustments (
     id, institution_id, adjustment_number, user_id, entity_type, entity_id,
     amount_minor, reason, idempotency_key, created_by
   ) VALUES
   (
     'probe_immutable_adjustment', 'inst_boardops_local', 'ADJ-PROBE-IMMUTABLE',
     'usr_resident_riya_local', 'Expense', 'expense_grocery_aug_2026_local',
     1234, 'Probe immutable adjustment', 'probe-adjustment-immutable', 'usr_admin_local'
   ),
   (
     'probe_immutable_adjustment', 'inst_boardops_local', 'ADJ-PROBE-IMMUTABLE-2',
     'usr_resident_riya_local', 'Expense', 'expense_grocery_aug_2026_local',
     1234, 'Rewritten reason', 'probe-adjustment-immutable-2', 'usr_admin_local'
   )
   ON CONFLICT(id) DO UPDATE SET reason = excluded.reason;`,
  "adjustments are immutable",
  "adjustment immutability",
);

const leaked = executeJson(`
SELECT
  (SELECT COUNT(*) FROM refunds WHERE id LIKE 'probe_%') AS refunds,
  (SELECT COUNT(*) FROM refund_transactions WHERE id LIKE 'probe_%') AS refund_transactions,
  (SELECT COUNT(*) FROM adjustments WHERE id LIKE 'probe_%') AS adjustments;
`)?.[0]?.results?.[0];
if (
  Number(leaked?.refunds ?? -1) !== 0 ||
  Number(leaked?.refund_transactions ?? -1) !== 0 ||
  Number(leaked?.adjustments ?? -1) !== 0
) {
  console.error("[BoardOps] Refunds/adjustments probe cleanup invariant failed:", leaked);
  process.exit(1);
}

console.log("[BoardOps] Durable refunds + immutable adjustments + least-privilege RBAC verified:", row);
