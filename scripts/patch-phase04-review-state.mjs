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

patchFile("services/api/src/routes/auth-workflows.ts", [
  [
    "registration-status-can-read-rejected-registration",
    `async function findUserByEmail(c: Context<AppEnv>, email: string): Promise<RegistrationUserRow | null> {\n  return c.env.DB.prepare(\n    \`SELECT id, institution_id, name, email, phone, status, institution_user_id,\n            email_verified, room, gender, created_at\n     FROM users\n     WHERE lower(email) = ?\n       AND deleted_at IS NULL\n     LIMIT 1\`,\n  )\n    .bind(email)\n    .first<RegistrationUserRow>();\n}\n\nfunction parseCorrectionFields`,
    `async function findUserByEmail(c: Context<AppEnv>, email: string): Promise<RegistrationUserRow | null> {\n  return c.env.DB.prepare(\n    \`SELECT id, institution_id, name, email, phone, status, institution_user_id,\n            email_verified, room, gender, created_at\n     FROM users\n     WHERE lower(email) = ?\n       AND deleted_at IS NULL\n     LIMIT 1\`,\n  )\n    .bind(email)\n    .first<RegistrationUserRow>();\n}\n\nasync function findRegistrationUserByEmail(c: Context<AppEnv>, email: string): Promise<RegistrationUserRow | null> {\n  // Registration-access possession is the authorization boundary for status.\n  // Rejected registrations are soft-deleted, but applicants must still be able\n  // to read their terminal rejection state and reason with that scoped token.\n  return c.env.DB.prepare(\n    \`SELECT id, institution_id, name, email, phone, status, institution_user_id,\n            email_verified, room, gender, created_at\n     FROM users\n     WHERE lower(email) = ?\n     LIMIT 1\`,\n  )\n    .bind(email)\n    .first<RegistrationUserRow>();\n}\n\nfunction parseCorrectionFields`,
  ],
  [
    "registration-status-uses-registration-reader",
    `authWorkflowRoutes.get("/registration-status", async (c) => {\n  const email = normalizedEmail(c.req.query("email"));\n  const accessToken = registrationToken(c, c.req.query("token"));\n  if (!isEmail(email) || !accessToken) return c.json({ success: true, data: { exists: false } });\n\n  const user = await findUserByEmail(c, email);`,
    `authWorkflowRoutes.get("/registration-status", async (c) => {\n  const email = normalizedEmail(c.req.query("email"));\n  const accessToken = registrationToken(c, c.req.query("token"));\n  if (!isEmail(email) || !accessToken) return c.json({ success: true, data: { exists: false } });\n\n  const user = await findRegistrationUserByEmail(c, email);`,
  ],
]);

patchFile("services/api/src/routes/users.ts", [
  [
    "approval-requires-current-pending-review",
    `  if (action === "APPROVE") {\n    if (user.status !== "PENDING") return c.json({ success: false, error: "Only pending users can be approved" }, 422);\n    if (user.email_verified !== 1) return c.json({ success: false, error: "Email must be verified before approval" }, 422);\n    nextStatus = "ACTIVE";`,
    `  if (action === "APPROVE") {\n    if (user.status !== "PENDING") return c.json({ success: false, error: "Only pending users can be approved" }, 422);\n    if (user.email_verified !== 1) return c.json({ success: false, error: "Email must be verified before approval" }, 422);\n    const approvalReview = await latestRegistration(c, user.id);\n    if (!approvalReview || approvalReview.status !== "PENDING_REVIEW") {\n      return c.json({ success: false, error: "Registration is not awaiting approval" }, 409);\n    }\n    nextStatus = "ACTIVE";`,
  ],
]);

console.log("[BoardOps] Phase 04 review-state hardening applied.");
