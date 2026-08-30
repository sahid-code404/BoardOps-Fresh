import { readFileSync, writeFileSync } from "node:fs";

const path = "tests/runtime-e2e/registration-workflow.spec.ts";
let source = readFileSync(path, "utf8");
const before = `    const suspendedMe = await page.context().request.get(\`${API}/api/auth/me\`);\n    expect(suspendedMe.status()).toBe(401);\n\n    const reactivate = await adminApi.patch(\`${API}/api/users/\${applicant!.id}\`, {`;
const after = `    // Dashboard rejects a suspended account but does not clear the browser\n    // cookie. After reactivation, /auth/me must still reject that same cookie,\n    // proving the server-side session itself was revoked rather than merely\n    // hidden by the account-status check.\n    const suspendedDashboard = await page.context().request.get(\`${API}/api/dashboard\`);\n    expect(suspendedDashboard.status()).toBe(401);\n\n    const reactivate = await adminApi.patch(\`${API}/api/users/\${applicant!.id}\`, {`;
const count = source.split(before).length - 1;
if (count !== 1) throw new Error(`expected one suspended-session assertion block, found ${count}`);
source = source.replace(before, after);
writeFileSync(path, source);
console.log("[BoardOps] Session revocation browser proof hardened.");
