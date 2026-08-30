import { readFileSync, writeFileSync } from "node:fs";

function replaceOnce(path, before, after, label) {
  let source = readFileSync(path, "utf8");
  const count = source.split(before).length - 1;
  if (count !== 1) throw new Error(`${label}: expected one match in ${path}, found ${count}`);
  source = source.replace(before, after);
  writeFileSync(path, source);
}

const cookieOnlyBefore = `function readSessionToken(c: Context<AppEnv>): string | null {\n  const cookie = getCookie(c, SESSION_COOKIE);\n  if (cookie) return cookie;\n  const authorization = c.req.header("authorization");\n  if (!authorization?.toLowerCase().startsWith("bearer ")) return null;\n  return authorization.slice(7).trim() || null;\n}`;
const cookieOnlyAfter = `function readSessionToken(c: Context<AppEnv>): string | null {\n  return getCookie(c, SESSION_COOKIE)?.trim() || null;\n}`;

replaceOnce(
  "services/api/src/routes/auth.ts",
  cookieOnlyBefore,
  cookieOnlyAfter,
  "auth cookie-only session",
);
replaceOnce(
  "services/api/src/routes/runtime.ts",
  cookieOnlyBefore,
  cookieOnlyAfter,
  "runtime cookie-only session",
);
replaceOnce(
  "services/api/src/routes/users.ts",
  cookieOnlyBefore,
  cookieOnlyAfter,
  "users cookie-only session",
);

replaceOnce(
  "services/api/src/routes/users.ts",
  `  if (!row || (row.role !== "ADMIN" && row.role !== "SUPER_ADMIN")) return null;\n  return row;`,
  `  // Authorization is enforced by the Phase 05 permission middleware before\n  // this route handler runs. Keep this lookup only for tenant scoping and the\n  // role/status invariants used by the mutation itself.\n  if (!row) return null;\n  return row;`,
  "remove coarse admin authorization",
);

console.log("[BoardOps] Phase 05 RBAC route integration patch applied.");
