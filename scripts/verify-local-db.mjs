import { spawnSync } from "node:child_process";

const query = `
SELECT
  (SELECT COUNT(*) FROM institutions) AS institutions,
  (SELECT COUNT(*) FROM accounting_periods) AS accounting_periods,
  (SELECT COUNT(*) FROM users) AS users,
  (SELECT COUNT(*) FROM idempotency_keys) AS idempotency_keys,
  (SELECT COUNT(*) FROM audit_events) AS audit_events,
  (SELECT COUNT(*) FROM outbox_events) AS outbox_events,
  (SELECT COUNT(*) FROM registration_requests) AS registration_requests,
  (SELECT COUNT(*) FROM auth_challenges) AS auth_challenges,
  (SELECT COUNT(*) FROM users WHERE id = 'usr_admin_local' AND email = 'admin@boardops.local' AND role = 'ADMIN' AND status = 'ACTIVE') AS seeded_admin,
  (SELECT COUNT(*) FROM registration_requests WHERE user_id = 'usr_resident_kabir_local' AND cycle = 1 AND status = 'PENDING_REVIEW') AS seeded_registration,
  (SELECT COUNT(*) FROM accounting_periods WHERE institution_id = 'inst_boardops_local' AND status = 'OPEN') AS open_periods;
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
  console.error("[BoardOps] Could not parse Wrangler D1 JSON output.", error);
  console.error(result.stdout);
  process.exit(1);
}

const row = parsed?.[0]?.results?.[0];
if (!row) {
  console.error("[BoardOps] D1 verification query returned no row.");
  process.exit(1);
}

const required = {
  institutions: 1,
  accounting_periods: 2,
  users: 3,
  registration_requests: 1,
  seeded_registration: 1,
  seeded_admin: 1,
  open_periods: 1,
  audit_events: 1,
};

for (const [field, minimum] of Object.entries(required)) {
  const value = Number(row[field] ?? 0);
  if (!Number.isFinite(value) || value < minimum) {
    console.error(`[BoardOps] Database invariant failed: ${field}=${row[field]} (expected >= ${minimum})`);
    process.exit(1);
  }
}

console.log("[BoardOps] Local database core verified:", row);