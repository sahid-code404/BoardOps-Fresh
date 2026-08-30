import { readFileSync, writeFileSync } from "node:fs";

function patchFile(path, patches) {
  let source = readFileSync(path, "utf8");
  for (const [label, before, after] of patches) {
    const count = source.split(before).length - 1;
    if (count !== 1) throw new Error(`${path} ${label}: expected exactly one match, found ${count}`);
    source = source.replace(before, after);
  }
  writeFileSync(path, source);
}

patchFile("services/api/src/routes/auth.ts", [
  [
    "session-requires-active-user",
    `       AND s.expires_at > ?\n       AND u.deleted_at IS NULL\n     LIMIT 1`,
    `       AND s.expires_at > ?\n       AND u.deleted_at IS NULL\n       AND u.status = 'ACTIVE'\n     LIMIT 1`,
  ],
]);

patchFile("services/api/src/routes/users.ts", [
  [
    "protect-last-active-admin-status",
    `  const validActions = new Set(["APPROVE", "SUSPEND", "ACTIVATE", "DEACTIVATE", "ARCHIVE", "RESTORE", "ASSIGN_ROLE"]);\n  if (!validActions.has(action)) return c.json({ success: false, error: "Invalid user action" }, 400);\n\n  let nextStatus = user.status;`,
    `  const validActions = new Set(["APPROVE", "SUSPEND", "ACTIVATE", "DEACTIVATE", "ARCHIVE", "RESTORE", "ASSIGN_ROLE"]);\n  if (!validActions.has(action)) return c.json({ success: false, error: "Invalid user action" }, 400);\n\n  const disablesActiveAdmin =\n    user.status === "ACTIVE" &&\n    (user.role === "ADMIN" || user.role === "SUPER_ADMIN") &&\n    ["SUSPEND", "DEACTIVATE", "ARCHIVE"].includes(action);\n  if (disablesActiveAdmin) {\n    const count = await c.env.DB.prepare(\n      \`SELECT COUNT(*) AS count FROM users\n       WHERE institution_id = ? AND role IN ('ADMIN', 'SUPER_ADMIN')\n         AND status = 'ACTIVE' AND deleted_at IS NULL\`,\n    )\n      .bind(admin.institution_id)\n      .first<{ count: number }>();\n    if (Number(count?.count ?? 0) <= 1) {\n      return c.json({ success: false, error: "Cannot disable the last active administrator" }, 422);\n    }\n  }\n\n  let nextStatus = user.status;`,
  ],
  [
    "revoke-sessions-on-disabled-status",
    `  if (action === "APPROVE" && latest?.status === "PENDING_REVIEW") {\n    statements.push(\n      c.env.DB.prepare(\n        \`UPDATE registration_requests\n         SET status = 'APPROVED', reason = ?, reviewed_by = ?, reviewed_at = ?, updated_at = ?\n         WHERE id = ?\`,\n      ).bind(reason || null, admin.id, now, now, latest.id),\n    );\n  }\n  await c.env.DB.batch(statements);`,
    `  if (action === "APPROVE" && latest?.status === "PENDING_REVIEW") {\n    statements.push(\n      c.env.DB.prepare(\n        \`UPDATE registration_requests\n         SET status = 'APPROVED', reason = ?, reviewed_by = ?, reviewed_at = ?, updated_at = ?\n         WHERE id = ?\`,\n      ).bind(reason || null, admin.id, now, now, latest.id),\n    );\n  }\n  if (["SUSPEND", "DEACTIVATE", "ARCHIVE"].includes(action)) {\n    statements.push(\n      c.env.DB.prepare(\n        \`UPDATE user_sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL\`,\n      ).bind(now, user.id),\n    );\n  }\n  await c.env.DB.batch(statements);`,
  ],
]);

console.log("[BoardOps] Phase 04 session-status hardening applied.");
