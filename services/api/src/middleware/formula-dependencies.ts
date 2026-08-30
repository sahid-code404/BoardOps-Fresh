import type { MiddlewareHandler } from "hono";
import { authenticatedPrincipal } from "../auth/authorization";
import { validateFormula, type FormulaValidation } from "../domain/formula-engine";
import type { AppEnv } from "../types";

type ActiveFormulaReferenceRow = {
  id: string;
  key: string;
  referenced_variables_json: string;
};

type VariableDependencyRow = {
  key: string;
  is_protected: number;
};

function objectBody(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? value as Record<string, unknown> : {};
}

function parseStringArray(raw: string): string[] {
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed)
      ? parsed.filter((value): value is string => typeof value === "string")
      : [];
  } catch {
    return [];
  }
}

async function readClonedBody(request: Request): Promise<Record<string, unknown> | null> {
  try {
    return objectBody(await request.clone().json());
  } catch {
    return null;
  }
}

async function missingActiveVariables(
  db: D1Database,
  institutionId: string,
  validation: FormulaValidation,
): Promise<string[]> {
  if (validation.variableSlugs.length === 0) return [];
  const placeholders = validation.variableSlugs.map(() => "?").join(", ");
  const rows = await db.prepare(
    `SELECT key
       FROM variables
      WHERE institution_id = ?
        AND status = 'ACTIVE'
        AND key IN (${placeholders})`,
  )
    .bind(institutionId, ...validation.variableSlugs)
    .all<{ key: string }>();
  const found = new Set(rows.results.map((row) => row.key));
  return validation.variableSlugs.filter((slug) => !found.has(slug));
}

async function activeFormulaReferences(
  db: D1Database,
  institutionId: string,
  variableKey: string,
): Promise<Array<{ id: string; key: string }>> {
  const rows = await db.prepare(
    `SELECT f.id, f.key, fv.referenced_variables_json
       FROM formulas f
       JOIN formula_versions fv
         ON fv.formula_id = f.id
        AND fv.version = f.version
        AND fv.institution_id = f.institution_id
      WHERE f.institution_id = ?
        AND f.status = 'ACTIVE'`,
  )
    .bind(institutionId)
    .all<ActiveFormulaReferenceRow>();

  return rows.results
    .filter((row) => parseStringArray(row.referenced_variables_json).includes(variableKey))
    .map((row) => ({ id: row.id, key: row.key }));
}

async function blockMissingFormulaDependencies(
  c: Parameters<MiddlewareHandler<AppEnv>>[0],
  expression: string,
) {
  const validation = validateFormula(expression);
  if (!validation.valid) return null;

  const principal = await authenticatedPrincipal(c);
  if (!principal) return null;
  const missingVariables = await missingActiveVariables(c.env.DB, principal.institutionId, validation);
  if (missingVariables.length === 0) return null;

  return c.json({
    success: false,
    error: "Formula references missing or archived variables",
    missingVariables,
  }, 422);
}

/**
 * Cross-entity Formula/Variable lifecycle invariants.
 *
 * The route handlers own ordinary CRUD and version creation. This middleware
 * owns dependency rules that span both authorities:
 * - an ACTIVE formula cannot be created or versioned against a missing/archive variable;
 * - an ACTIVE variable cannot be archived while an ACTIVE formula version references it.
 *
 * Bodies are inspected through Request.clone(), so downstream handlers still
 * receive the original request body unchanged.
 */
export const enforceFormulaDependencyPolicy: MiddlewareHandler<AppEnv> = async (c, next) => {
  const path = c.req.path;
  const method = c.req.method.toUpperCase();

  if (method === "POST" && path === "/api/formulas") {
    const body = await readClonedBody(c.req.raw);
    const expression = typeof body?.expression === "string" ? body.expression.trim() : "";
    if (expression) {
      const blocked = await blockMissingFormulaDependencies(c, expression);
      if (blocked) return blocked;
    }
    await next();
    return;
  }

  const formulaMatch = /^\/api\/formulas\/([^/]+)$/u.exec(path);
  if (method === "PATCH" && formulaMatch) {
    const body = await readClonedBody(c.req.raw);
    if (typeof body?.expression === "string" && body.expression.trim()) {
      const blocked = await blockMissingFormulaDependencies(c, body.expression.trim());
      if (blocked) return blocked;
    }
    await next();
    return;
  }

  const variableMatch = /^\/api\/variables\/([^/]+)$/u.exec(path);
  if (variableMatch && (method === "DELETE" || method === "PUT")) {
    const shouldArchive = method === "DELETE"
      ? true
      : String((await readClonedBody(c.req.raw))?.status ?? "").trim().toUpperCase() === "ARCHIVED";

    if (shouldArchive) {
      const principal = await authenticatedPrincipal(c);
      if (principal) {
        const variableId = decodeURIComponent(variableMatch[1] ?? "");
        const variable = await c.env.DB.prepare(
          `SELECT key, is_protected
             FROM variables
            WHERE id = ? AND institution_id = ?
            LIMIT 1`,
        )
          .bind(variableId, principal.institutionId)
          .first<VariableDependencyRow>();

        // Preserve the route's stronger protected-variable error semantics.
        if (variable && variable.is_protected !== 1) {
          const referencedBy = await activeFormulaReferences(c.env.DB, principal.institutionId, variable.key);
          if (referencedBy.length > 0) {
            return c.json({
              success: false,
              error: "Variable is referenced by active formulas and cannot be archived",
              referencedBy,
            }, 409);
          }
        }
      }
    }
  }

  await next();
};
