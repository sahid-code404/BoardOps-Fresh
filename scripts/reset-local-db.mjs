import { rmSync } from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";

const root = process.cwd();
const localD1State = resolve(root, ".wrangler", "state", "v3", "d1");

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: root,
    stdio: "inherit",
    shell: process.platform === "win32",
  });

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

console.log(`[BoardOps] Removing local D1 state: ${localD1State}`);
rmSync(localD1State, { recursive: true, force: true });

console.log("[BoardOps] Reapplying immutable local migrations...");
run("pnpm", ["db:migrate:local"]);

console.log("[BoardOps] Seeding deterministic local development data...");
run("pnpm", ["db:seed:local"]);

console.log("[BoardOps] Verifying local database invariants...");
run("pnpm", ["db:verify:local"]);

console.log("[BoardOps] Local D1 reset finished successfully.");
