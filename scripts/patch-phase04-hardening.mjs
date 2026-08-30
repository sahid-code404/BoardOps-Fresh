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
    "delivery-availability-helper",
    `function logLocalDelivery(c: Context<AppEnv>, purpose: ChallengePurpose, email: string, code: string): boolean {\n  if (c.env.ENVIRONMENT !== "local") return false;\n  // Local development transport only. Production must configure a real mail\n  // adapter before these public flows are enabled; secrets are never returned\n  // in the HTTP response or stored in plaintext in D1.\n  console.info(\`[BoardOps local auth] \${purpose} for \${email}: \${code}\`);\n  return true;\n}\n\nasync function checkIssueRateLimit`,
    `function logLocalDelivery(c: Context<AppEnv>, purpose: ChallengePurpose, email: string, code: string): boolean {\n  if (c.env.ENVIRONMENT !== "local") return false;\n  // Local development transport only. Production must configure a real mail\n  // adapter before these public flows are enabled; secrets are never returned\n  // in the HTTP response or stored in plaintext in D1.\n  console.info(\`[BoardOps local auth] \${purpose} for \${email}: \${code}\`);\n  return true;\n}\n\nfunction authEmailDeliveryAvailable(c: Context<AppEnv>): boolean {\n  // Phase 04 has a deterministic local transport only. Non-local environments\n  // must fail closed before any registration/email mutation until a production\n  // mail adapter is explicitly configured in a later deployment checkpoint.\n  return c.env.ENVIRONMENT === "local";\n}\n\nasync function checkIssueRateLimit`,
  ],
  [
    "exclude-soft-deleted-auth-workflow-users",
    `     FROM users\n     WHERE lower(email) = ?\n     LIMIT 1`,
    `     FROM users\n     WHERE lower(email) = ?\n       AND deleted_at IS NULL\n     LIMIT 1`,
  ],
  [
    "register-delivery-preflight",
    `  const pwdError = passwordError(password);\n  if (pwdError) return c.json({ success: false, error: pwdError }, 422);\n  if (!(await checkIssueRateLimit(c, "EMAIL_VERIFY"))) {`,
    `  const pwdError = passwordError(password);\n  if (pwdError) return c.json({ success: false, error: pwdError }, 422);\n  if (!authEmailDeliveryAvailable(c)) {\n    return c.json({ success: false, error: "Email verification delivery is not configured" }, 503);\n  }\n  if (!(await checkIssueRateLimit(c, "EMAIL_VERIFY"))) {`,
  ],
  [
    "resend-nonenumerating-delivery-preflight",
    `  const email = normalizedEmail(body.email);\n  if (!isEmail(email)) return c.json({ success: false, error: "Enter a valid email" }, 400);\n\n  const user = await findUserByEmail(c, email);`,
    `  const email = normalizedEmail(body.email);\n  if (!isEmail(email)) return c.json({ success: false, error: "Enter a valid email" }, 400);\n  if (!authEmailDeliveryAvailable(c)) {\n    return c.json({ success: true, data: { sent: true, deliveryConfigured: false } });\n  }\n\n  const user = await findUserByEmail(c, email);`,
  ],
  [
    "resubmit-email-delivery-preflight",
    `  const emailChanged = nextEmail !== user.email;\n  const nextCycle = latest.cycle + 1;`,
    `  const emailChanged = nextEmail !== user.email;\n  if (emailChanged && !authEmailDeliveryAvailable(c)) {\n    return c.json({ success: false, error: "Email verification delivery is not configured" }, 503);\n  }\n  const nextCycle = latest.cycle + 1;`,
  ],
  [
    "password-reset-nonenumerating-delivery-preflight",
    `  const email = normalizedEmail(body.email);\n  if (!isEmail(email)) return c.json({ success: false, error: "Enter a valid email" }, 400);\n  if (!(await checkIssueRateLimit(c, "PASSWORD_RESET_OTP"))) {`,
    `  const email = normalizedEmail(body.email);\n  if (!isEmail(email)) return c.json({ success: false, error: "Enter a valid email" }, 400);\n  if (!authEmailDeliveryAvailable(c)) {\n    return c.json({ success: true, data: { sent: true, deliveryConfigured: false } });\n  }\n  if (!(await checkIssueRateLimit(c, "PASSWORD_RESET_OTP"))) {`,
  ],
]);

patchFile("apps/web/src/components/features/auth/auth-screen.tsx", [
  [
    "registration-motion-does-not-hide-critical-fields",
    `          <AnimatePresence mode="wait">\n            {mode === "register" && (\n              <motion.div\n                initial={{ opacity: 0, height: 0 }}\n                animate={{ opacity: 1, height: "auto" }}\n                exit={{ opacity: 0, height: 0 }}\n                className="space-y-4 overflow-hidden"`,
    `          <AnimatePresence initial={false}>\n            {mode === "register" && (\n              <motion.div\n                initial={false}\n                animate={{ height: "auto" }}\n                className="space-y-4 overflow-hidden"`,
  ],
  [
    "auth-layout-content-always-visible",
    `        <motion.div\n          initial={{ opacity: 0, y: 20, scale: 0.98 }}\n          animate={{ opacity: 1, y: 0, scale: 1 }}\n          transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}\n        >`,
    `        <motion.div\n          initial={{ y: 20, scale: 0.98 }}\n          animate={{ y: 0, scale: 1 }}\n          transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}\n        >`,
  ],
]);

console.log("[BoardOps] Phase 04 delivery and auth-visibility hardening applied.");
