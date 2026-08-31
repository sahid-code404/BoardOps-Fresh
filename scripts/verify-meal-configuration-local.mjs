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
    'meal_configurations_preserve_evidence_delete'
  )) AS integrity_guards;
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

expectFailure(
  "internal-name mutation",
  "UPDATE meal_configurations SET name = 'breakfast_renamed' WHERE id = 'meal_breakfast_local';",
  "meal configuration internal name is immutable",
);

expectFailure(
  "historical-evidence deletion",
  "DELETE FROM meal_configurations WHERE id = 'meal_breakfast_local';",
  "meal configuration with historical evidence cannot be deleted",
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

const disposable = execute(`
INSERT INTO meal_configurations (
  id, institution_id, name, display_name, icon, color, meal_type, status,
  display_order, default_state, default_visibility, cutoff_strategy,
  cutoff_offset_minutes, cutoff_time, start_time, end_time
) VALUES (
  'meal_verifier_disposable', 'inst_boardops_local', 'verifier_disposable', 'Verifier Disposable',
  '🍽️', '#8b5cf6', 'REGULAR', 'ACTIVE', 999, 'OFF', 'VISIBLE', 'SAME_DAY',
  0, '16:00', '17:00', '18:00'
);
DELETE FROM meal_configurations WHERE id = 'meal_verifier_disposable';
`);
if (disposable.status !== 0) {
  console.error("[BoardOps] Unused Meal Configuration delete should remain allowed.");
  console.error(disposable.stderr || disposable.stdout);
  process.exit(disposable.status ?? 1);
}

const after = queryRow(`
SELECT
  (SELECT COUNT(*) FROM meal_configurations WHERE institution_id = 'inst_boardops_local') AS meal_configurations,
  (SELECT COUNT(*) FROM meal_configurations WHERE id = 'meal_breakfast_local' AND name = 'breakfast') AS breakfast_identity,
  (SELECT COUNT(*) FROM meal_entries WHERE institution_id = 'inst_boardops_local' AND meal_id = 'meal_breakfast_local') AS breakfast_entries,
  (SELECT COUNT(*) FROM meal_configurations WHERE id IN ('meal_verifier_inactive', 'meal_verifier_disposable')) AS verifier_rows;
`);

if (Number(after.meal_configurations) !== 3 || Number(after.breakfast_identity) !== 1 || Number(after.breakfast_entries) < 1 || Number(after.verifier_rows) !== 0) {
  console.error("[BoardOps] Meal Configuration verifier did not restore/preserve the deterministic baseline:", after);
  process.exit(1);
}

console.log("[BoardOps] Meal Configuration integrity verified:", {
  meal_configurations: Number(after.meal_configurations),
  integrity_guards: Number(before.integrity_guards),
  breakfast_entries: Number(after.breakfast_entries),
  internal_name_immutable: 1,
  evidence_delete_blocked: 1,
  active_on_create_required: 1,
  unused_delete_allowed: 1,
});
