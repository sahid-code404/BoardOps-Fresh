import type { MiddlewareHandler } from "hono";
import { validatePasswordPolicy } from "../auth/password-policy";
import type { AppEnv } from "../types";

function passwordMutationField(path: string, method: string): "newPassword" | "password" | null {
  if (method === "POST" && path === "/api/auth/change-password") return "newPassword";
  if (method === "PUT" && /^\/api\/users\/[^/]+$/u.test(path)) return "password";
  return null;
}

export const enforcePasswordMutationPolicy: MiddlewareHandler<AppEnv> = async (c, next) => {
  const field = passwordMutationField(c.req.path, c.req.method.toUpperCase());
  if (!field) return next();

  let body: unknown;
  try {
    body = await c.req.raw.clone().json();
  } catch {
    return next();
  }

  if (typeof body !== "object" || body === null) return next();
  const value = (body as Record<string, unknown>)[field];
  if (typeof value !== "string" || value.length === 0) return next();

  const result = validatePasswordPolicy(value);
  if (!result.valid) {
    return c.json({ success: false, error: result.error }, 422);
  }
  return next();
};
