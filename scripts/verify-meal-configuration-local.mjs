import { spawnSync } from "node:child_process";

const baseArgs = [
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

function execute(command, json = false) {
  const args = [...baseArgs, ...(json ? ["--json"] : []), "--command", command];
  return spawnSync("pnpm", args, {
    encoding: "utf8",
    shell: process.platform === "win32",
  });
}

function expectFailure(label, command, expectedText) {
  const result = execute(command);
  if (result.status === 0) {
    console.error(`[BoardOps] Meal Configuration invariant failed: ${label} unexpectedly succeeded.`);
    process.exit(1);
  }
  const output = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
  if (!output.includes(expectedText)) {
    console.error(`[BoardOps] Meal Configuration invariant failed: ${label} did not report ${JSON.stringify(expectedText)}.`);
    console.error(output);
    process.exit(1);
  }
}

function queryRow(command) {
  const result = execute(command, true);
  if (result.status !== 0) {
    process.stderr.write(result.stderr || result.stdout);
    process.exit(result.status ?? 1);
  }
  let parsed;
  try {
    parsed = JSON.parse(result.stdout);
  } catch (error) {
    console.error("[BoardOps] Could not parse Meal Configuration verifier JSON.", error);
    console.error(result.stdout);
    process.exit(1);
  }
  const row = parsed?.[0]?.results?.[0];
  if (!row) {
    console.error("[BoardOps] Meal Configuration verifier query returned no row.");
    process.exit(1);
  }
  return row;
}

const before = queryRow(`
SELECT
  (SELECT COUNT(*) FROM meal_configurations WHERE institution_id = 'inst_boardops_local') AS meal_configurations,
  (SELECT COUNT(*) FROM meal_entries WHERE institution_id = 'inst_boardops_local' AND meal_id = 'meal_breakfast_local') AS breakfast_entries,
  (SELECT COUNT(*) FROM sqlite_master WHERE type = 'trigger' AND name IN (
    'meal_configurations_internal_name_immutable',
    'meal_configurations_require_active_insert',
    'meal_configurations_block_hard_delete'
  )) AS integrity_guards,
  (SELECT COUNT(*) FROM pragma_table_info('meal_configurations') WHERE name IN (
    'pricing_mode',
    'fixed_price_minor',
    'deletion_requested_at',
    'deletion_eligible_month',
    'deletion_eligible_year',
    'deletion_requested_by',
    'deletion_finalized_at'
  )) AS lifecycle_columns,
  (SELECT COUNT(*) FROM sqlite_master WHERE type = 'index' AND name = 'meal_configurations_deletion_queue_idx') AS deletion_queue_indexes;
`);

if (Number(before.meal_configurations) !== 3) {
  console.error(`[BoardOps] Meal Configuration baseline failed: meal_configurations=${before.meal_configurations} (expected 3)`);
  process.exit(1);
}
if (Number(before.breakfast_entries) < 1) {
  console.error(`[BoardOps] Meal Configuration evidence fixture missing: breakfast_entries=${before.breakfast_entries}`);
  process.exit(1);
}
if (Number(before.integrity_guards) !== 3) {
  console.error(`[BoardOps] Meal Configuration integrity guards=${before.integrity_guards} (expected 3)`);
  process.exit(1);
}
if (Number(before.lifecycle_columns) !== 7) {
  console.error(`[BoardOps] Meal Configuration pricing/deletion columns=${before.lifecycle_columns} (expected 7)`);
  process.exit(1);
}
if (Number(before.deletion_queue_indexes) !== 1) {
  console.error(`[BoardOps] Meal Configuration deletion queue indexes=${before.deletion_queue_indexes} (expected 1)`);
  process.exit(1);
}

expectFailure(
  "internal-name mutation",
  "UPDATE meal_configurations SET name = 'breakfast_renamed' WHERE id = 'meal_breakfast_local';",
  "meal configuration internal name is immutable",
);

// All configured meals are durable financial/operational history now. Even a
// row with no current meal entries must leave the application through the
// settlement-gated deletion queue rather than a physical SQL DELETE.
expectFailure(
  "hard deletion",
  "DELETE FROM meal_configurations WHERE id = 'meal_breakfast_local';",
  "meal configurations are historical records; use the deletion queue",
);

expectFailure(
  "non-active insertion",
  `INSERT INTO meal_configurations (
     id, institution_id, name, display_name, icon, color, meal_type, status,
     display_order, default_state, default_visibility, cutoff_strategy,
     cutoff_offset_minutes, cutoff_time, start_time, end_time
   ) VALUES (
     'meal_verifier_inactive', 'inst_boardops_local', 'verifier_inactive', 'Verifier Inactive',
     '🍽️', '#8b5cf6', 'REGULAR', 'ARCHIVED', 999, 'OFF', 'VISIBLE', 'SAME_DAY',
     0, '16:00', '17:00', '18:00'
   );`,
  "new meal configuration must start ACTIVE",
);

const after = queryRow(`
SELECT
  (SELECT COUNT(*) FROM meal_configurations WHERE institution_id = 'inst_boardops_local') AS meal_configurations,
  (SELECT COUNT(*) FROM meal_configurations WHERE id = 'meal_breakfast_local' AND name = 'breakfast') AS breakfast_identity,
  (SELECT COUNT(*) FROM meal_entries WHERE institution_id = 'inst_boardops_local' AND meal_id = 'meal_breakfast_local') AS breakfast_entries,
  (SELECT COUNT(*) FROM meal_configurations WHERE id = 'meal_verifier_inactive') AS verifier_rows;
`);

if (Number(after.meal_configurations) !== 3 || Number(after.breakfast_identity) !== 1 || Number(after.breakfast_entries) < 1 || Number(after.verifier_rows) !== 0) {
  console.error("[BoardOps] Meal Configuration verifier did not preserve the deterministic baseline:", after);
  process.exit(1);
}

console.log("[BoardOps] Meal Configuration pricing + deletion-queue integrity verified:", {
  meal_configurations: Number(after.meal_configurations),
  integrity_guards: Number(before.integrity_guards),
  lifecycle_columns: Number(before.lifecycle_columns),
  deletion_queue_indexes: Number(before.deletion_queue_indexes),
  breakfast_entries: Number(after.breakfast_entries),
  internal_name_immutable: 1,
  hard_delete_blocked: 1,
  active_on_create_required: 1,
});
