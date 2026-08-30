import { Hono, type Context } from "hono";
import { authenticatedPrincipal, type AuthPrincipal } from "../auth/authorization";
import {
  evaluateFormula,
  normalizeNumericVariable,
  validateFormula,
  type FormulaValidation,
} from "../domain/formula-engine";
import type { AppEnv } from "../types";

type VariableType = "NUMBER" | "CURRENCY" | "PERCENTAGE" | "TEXT" | "BOOLEAN";
type VariableStatus = "ACTIVE" | "ARCHIVED";
type FormulaReturnType = "CURRENCY" | "NUMBER" | "PERCENTAGE";
type FormulaStatus = "ACTIVE" | "ARCHIVED";

type VariableRow = {
  id: string;
  institution_id: string;
  key: string;
  name: string;
  description: string | null;
  variable_type: VariableType;
  value_text: string;
  unit: string | null;
  category: string;
  is_system: number;
  is_protected: number;
  status: VariableStatus;
  version: number;
  created_at: string;
  updated_at: string;
};

type FormulaRow = {
  id: string;
  institution_id: string;
  name: string;
  key: string;
  description: string | null;
  expression: string;
  return_type: FormulaReturnType;
  category: string;
  status: FormulaStatus;
  version: number;
  created_at: string;
  updated_at: string;
};

type FormulaVersionRow = {
  id: string;
  formula_id: string;
  version: number;
  expression: string;
  return_type: FormulaReturnType;
  referenced_variables_json: string;
  referenced_context_json: string;
  changed_by: string | null;
  change_note: string | null;
  created_at: string;
  user_name: string | null;
  user_email: string | null;
};

type CreateVariableInput = {
  key: string;
  name: string;
  description: string | null;
  variableType: VariableType;
  valueText: string;
  unit: string | null;
  category: string;
};

type FormulaInput = {
  name: string;
  key: string;
  description: string | null;
  expression: string;
  returnType: FormulaReturnType;
  category: string;
};

export const variableFormulaRoutes = new Hono<AppEnv>();

async function principalFor(c: Context<AppEnv>): Promise<AuthPrincipal | Response> {
  const principal = await authenticatedPrincipal(c);
  return principal ?? c.json({ success: false, error: "Authentication required" }, 401);
}

async function readObjectBody(c: Context<AppEnv>): Promise<Record<string, unknown> | null> {
  try {
    const body: unknown = await c.req.json();
    return typeof body === "object" && body !== null ? body as Record<string, unknown> : {};
  } catch {
    return null;
  }
}

function optionalText(value: unknown, maxLength: number): string | null {
  if (value == null || value === "") return null;
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, maxLength) : null;
}

function variableResponse(row: VariableRow) {
  return {
    id: row.id,
    key: row.key,
    name: row.name,
    description: row.description,
    type: row.variable_type,
    value: row.value_text,
    unit: row.unit,
    category: row.category,
    isSystem: row.is_system === 1,
    isProtected: row.is_protected === 1,
    status: row.status,
    version: row.version,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function formulaResponse(row: FormulaRow, versions: FormulaVersionRow[] = []) {
  return {
    id: row.id,
    name: row.name,
    key: row.key,
    description: row.description,
    expression: row.expression,
    returnType: row.return_type,
    category: row.category,
    version: row.version,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    versions: versions.map((version) => ({
      id: version.id,
      version: version.version,
      expression: version.expression,
      returnType: version.return_type,
      referencedSlugs: parseJsonArray(version.referenced_variables_json),
      referencedContext: parseJsonArray(version.referenced_context_json),
      changedBy: version.changed_by,
      changeNote: version.change_note,
      createdAt: version.created_at,
      user: version.user_name
        ? { name: version.user_name, email: version.user_email ?? "" }
        : null,
    })),
  };
}

function parseJsonArray(raw: string): string[] {
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((value): value is string => typeof value === "string") : [];
  } catch {
    return [];
  }
}

function normalizeVariableValue(type: VariableType, raw: unknown): string | null {
  if (typeof raw !== "string" && typeof raw !== "number" && typeof raw !== "boolean") return null;
  const value = String(raw).trim();
  if (type === "CURRENCY") return normalizeNumericVariable(value, 2);
  if (type === "NUMBER" || type === "PERCENTAGE") return normalizeNumericVariable(value, 6);
  if (type === "BOOLEAN") {
    const normalized = value.toLowerCase();
    return normalized === "true" || normalized === "false" ? normalized : null;
  }
  return value && value.length <= 2_000 ? value : null;
}

function parseCreateVariable(body: Record<string, unknown>): CreateVariableInput | string {
  const key = typeof body.key === "string" ? body.key.trim() : "";
  const name = typeof body.name === "string" ? body.name.trim() : "";
  const typeRaw = typeof body.type === "string" ? body.type.trim().toUpperCase() : "NUMBER";
  const category = typeof body.category === "string" ? body.category.trim().toUpperCase() : "GENERAL";
  if (!/^[A-Za-z0-9_.-]{2,80}$/u.test(key)) return "Variable key must be 2 to 80 characters using letters, numbers, dots, underscores, or dashes";
  if (name.length < 2 || name.length > 120) return "Variable name must be 2 to 120 characters";
  if (!["NUMBER", "CURRENCY", "PERCENTAGE", "TEXT", "BOOLEAN"].includes(typeRaw)) return "Variable type is invalid";
  if (!/^[A-Z0-9_.-]{1,64}$/u.test(category)) return "Variable category is invalid";
  const variableType = typeRaw as VariableType;
  const valueText = normalizeVariableValue(variableType, body.value);
  if (valueText === null) {
    return variableType === "CURRENCY"
      ? "Currency values must be exact decimals with at most two decimal places"
      : variableType === "NUMBER" || variableType === "PERCENTAGE"
        ? "Numeric values must use at most six decimal places"
        : variableType === "BOOLEAN"
          ? "Boolean values must be true or false"
          : "Variable value is invalid";
  }
  return {
    key,
    name,
    description: optionalText(body.description, 1_000),
    variableType,
    valueText,
    unit: optionalText(body.unit, 32),
    category,
  };
}

function parseFormulaInput(body: Record<string, unknown>, existing?: FormulaRow): FormulaInput | string {
  const name = typeof body.name === "string" ? body.name.trim() : existing?.name ?? "";
  const key = existing?.key ?? (typeof body.key === "string" ? body.key.trim() : "");
  const expression = typeof body.expression === "string" ? body.expression.trim() : existing?.expression ?? "";
  const returnTypeRaw = typeof body.returnType === "string"
    ? body.returnType.trim().toUpperCase()
    : existing?.return_type ?? "CURRENCY";
  const category = typeof body.category === "string"
    ? body.category.trim().toUpperCase()
    : existing?.category ?? "BILLING";

  if (name.length < 2 || name.length > 100) return "Formula name must be 2 to 100 characters";
  if (!/^[A-Za-z0-9_.-]{3,80}$/u.test(key)) return "Formula key must be 3 to 80 characters using letters, numbers, dots, underscores, or dashes";
  if (!expression || expression.length > 4_000) return "Formula expression is required and must not exceed 4000 characters";
  if (!["CURRENCY", "NUMBER", "PERCENTAGE"].includes(returnTypeRaw)) return "Formula return type is invalid";
  if (!/^[A-Z0-9_.-]{1,64}$/u.test(category)) return "Formula category is invalid";
  return {
    name,
    key,
    description: body.description === undefined
      ? existing?.description ?? null
      : optionalText(body.description, 1_000),
    expression,
    returnType: returnTypeRaw as FormulaReturnType,
    category,
  };
}

async function audit(
  c: Context<AppEnv>,
  principal: AuthPrincipal,
  action: string,
  entityType: "Variable" | "Formula",
  entityId: string,
  reason: string | null,
  metadata: Record<string, unknown>,
) {
  await c.env.DB.prepare(
    `INSERT INTO audit_events
      (id, institution_id, actor_user_id, action, entity_type, entity_id,
       request_id, reason, metadata_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      crypto.randomUUID(), principal.institutionId, principal.id, action, entityType,
      entityId, c.get("requestId"), reason, JSON.stringify(metadata), new Date().toISOString(),
    )
    .run();
}

async function loadVariable(
  c: Context<AppEnv>,
  principal: AuthPrincipal,
  id: string,
): Promise<VariableRow | null> {
  return c.env.DB.prepare(
    `SELECT * FROM variables WHERE id = ? AND institution_id = ? LIMIT 1`,
  )
    .bind(id, principal.institutionId)
    .first<VariableRow>();
}

async function loadFormula(
  c: Context<AppEnv>,
  principal: AuthPrincipal,
  id: string,
): Promise<FormulaRow | null> {
  return c.env.DB.prepare(
    `SELECT * FROM formulas WHERE id = ? AND institution_id = ? LIMIT 1`,
  )
    .bind(id, principal.institutionId)
    .first<FormulaRow>();
}

async function missingVariableSlugs(
  c: Context<AppEnv>,
  principal: AuthPrincipal,
  validation: FormulaValidation,
): Promise<string[]> {
  if (validation.variableSlugs.length === 0) return [];
  const placeholders = validation.variableSlugs.map(() => "?").join(", ");
  const found = await c.env.DB.prepare(
    `SELECT key FROM variables
      WHERE institution_id = ? AND status = 'ACTIVE' AND key IN (${placeholders})`,
  )
    .bind(principal.institutionId, ...validation.variableSlugs)
    .all<{ key: string }>();
  const keys = new Set(found.results.map((row) => row.key));
  return validation.variableSlugs.filter((slug) => !keys.has(slug));
}

function variableVersionInsert(
  c: Context<AppEnv>,
  row: VariableRow,
  changedBy: string,
  note: string | null,
) {
  return c.env.DB.prepare(
    `INSERT INTO variable_versions (
       id, institution_id, variable_id, version, key, name, description,
       variable_type, value_text, unit, category, status, changed_by, change_note, created_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(
    crypto.randomUUID(), row.institution_id, row.id, row.version, row.key, row.name,
    row.description, row.variable_type, row.value_text, row.unit, row.category,
    row.status, changedBy, note, new Date().toISOString(),
  );
}

function formulaVersionInsert(
  c: Context<AppEnv>,
  row: FormulaRow,
  validation: FormulaValidation,
  changedBy: string,
  note: string,
) {
  return c.env.DB.prepare(
    `INSERT INTO formula_versions (
       id, institution_id, formula_id, version, expression, return_type,
       referenced_variables_json, referenced_context_json, changed_by, change_note, created_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(
    crypto.randomUUID(), row.institution_id, row.id, row.version, row.expression,
    row.return_type, JSON.stringify(validation.variableSlugs), JSON.stringify(validation.contextKeys),
    changedBy, note, new Date().toISOString(),
  );
}

variableFormulaRoutes.get("/variables", async (c) => {
  const principal = await principalFor(c);
  if (principal instanceof Response) return principal;
  const rows = await c.env.DB.prepare(
    `SELECT * FROM variables
      WHERE institution_id = ? AND status = 'ACTIVE'
      ORDER BY category ASC, name ASC`,
  )
    .bind(principal.institutionId)
    .all<VariableRow>();
  return c.json({ success: true, data: rows.results.map(variableResponse) });
});

variableFormulaRoutes.post("/variables", async (c) => {
  const principal = await principalFor(c);
  if (principal instanceof Response) return principal;
  const body = await readObjectBody(c);
  if (!body) return c.json({ success: false, error: "Invalid JSON body" }, 400);
  const parsed = parseCreateVariable(body);
  if (typeof parsed === "string") return c.json({ success: false, error: parsed }, 422);

  const duplicate = await c.env.DB.prepare(
    `SELECT id FROM variables WHERE institution_id = ? AND key = ? LIMIT 1`,
  )
    .bind(principal.institutionId, parsed.key)
    .first<{ id: string }>();
  if (duplicate) return c.json({ success: false, error: "Variable with this key already exists" }, 409);

  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  await c.env.DB.prepare(
    `INSERT INTO variables (
       id, institution_id, key, name, description, variable_type, value_text,
       unit, category, is_system, is_protected, status, version,
       created_by, updated_by, created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, 'ACTIVE', 1, ?, ?, ?, ?)`,
  )
    .bind(
      id, principal.institutionId, parsed.key, parsed.name, parsed.description,
      parsed.variableType, parsed.valueText, parsed.unit, parsed.category,
      principal.id, principal.id, now, now,
    )
    .run();
  const created = await loadVariable(c, principal, id);
  await c.env.DB.batch([variableVersionInsert(c, created!, principal.id, "Initial version")]);
  await audit(c, principal, "VARIABLE_CREATE", "Variable", id, null, {
    key: parsed.key,
    type: parsed.variableType,
    value: parsed.valueText,
    version: 1,
  });
  return c.json({ success: true, data: variableResponse(created!) }, 201);
});

variableFormulaRoutes.put("/variables/:id", async (c) => {
  const principal = await principalFor(c);
  if (principal instanceof Response) return principal;
  const existing = await loadVariable(c, principal, c.req.param("id"));
  if (!existing) return c.json({ success: false, error: "Variable not found" }, 404);

  const body = await readObjectBody(c);
  if (!body) return c.json({ success: false, error: "Invalid JSON body" }, 400);
  if (!("value" in body)) return c.json({ success: false, error: "Variable value is required" }, 422);
  const valueText = normalizeVariableValue(existing.variable_type, body.value);
  if (valueText === null) return c.json({ success: false, error: "Variable value is invalid for its type" }, 422);

  const name = body.name === undefined ? existing.name : typeof body.name === "string" ? body.name.trim() : "";
  const description = body.description === undefined ? existing.description : optionalText(body.description, 1_000);
  const unit = body.unit === undefined ? existing.unit : optionalText(body.unit, 32);
  const category = body.category === undefined
    ? existing.category
    : typeof body.category === "string" ? body.category.trim().toUpperCase() : "";
  const statusRaw = body.status === undefined ? existing.status : String(body.status).trim().toUpperCase();
  if (name.length < 2 || name.length > 120) return c.json({ success: false, error: "Variable name is invalid" }, 422);
  if (!/^[A-Z0-9_.-]{1,64}$/u.test(category)) return c.json({ success: false, error: "Variable category is invalid" }, 422);
  if (statusRaw !== "ACTIVE" && statusRaw !== "ARCHIVED") return c.json({ success: false, error: "Variable status is invalid" }, 422);
  if (existing.is_protected === 1 && statusRaw === "ARCHIVED") {
    return c.json({ success: false, error: "System-protected variables cannot be archived" }, 422);
  }

  const changed = valueText !== existing.value_text || name !== existing.name || description !== existing.description
    || unit !== existing.unit || category !== existing.category || statusRaw !== existing.status;
  if (!changed) return c.json({ success: true, data: variableResponse(existing) });

  const nextVersion = existing.version + 1;
  const now = new Date().toISOString();
  await c.env.DB.prepare(
    `UPDATE variables
        SET name = ?, description = ?, value_text = ?, unit = ?, category = ?, status = ?,
            version = ?, updated_by = ?, updated_at = ?
      WHERE id = ? AND institution_id = ?`,
  )
    .bind(
      name, description, valueText, unit, category, statusRaw, nextVersion,
      principal.id, now, existing.id, principal.institutionId,
    )
    .run();
  const updated = await loadVariable(c, principal, existing.id);
  await c.env.DB.batch([variableVersionInsert(c, updated!, principal.id, optionalText(body.changeNote, 500))]);
  await audit(c, principal, "VARIABLE_UPDATE", "Variable", existing.id, optionalText(body.changeNote, 500), {
    previousVersion: existing.version,
    version: nextVersion,
    previousValue: existing.value_text,
    value: valueText,
  });
  return c.json({ success: true, data: variableResponse(updated!) });
});

variableFormulaRoutes.delete("/variables/:id", async (c) => {
  const principal = await principalFor(c);
  if (principal instanceof Response) return principal;
  const existing = await loadVariable(c, principal, c.req.param("id"));
  if (!existing) return c.json({ success: false, error: "Variable not found" }, 404);
  if (existing.is_protected === 1) {
    return c.json({ success: false, error: "System-protected variables cannot be deleted" }, 422);
  }
  if (existing.status === "ARCHIVED") return c.json({ success: true, data: { success: true } });

  const nextVersion = existing.version + 1;
  const now = new Date().toISOString();
  await c.env.DB.prepare(
    `UPDATE variables
        SET status = 'ARCHIVED', version = ?, updated_by = ?, updated_at = ?
      WHERE id = ? AND institution_id = ?`,
  )
    .bind(nextVersion, principal.id, now, existing.id, principal.institutionId)
    .run();
  const archived = await loadVariable(c, principal, existing.id);
  await c.env.DB.batch([variableVersionInsert(c, archived!, principal.id, "Archived")]);
  await audit(c, principal, "VARIABLE_ARCHIVE", "Variable", existing.id, null, {
    key: existing.key,
    version: nextVersion,
  });
  return c.json({ success: true, data: { success: true } });
});

variableFormulaRoutes.get("/formulas", async (c) => {
  const principal = await principalFor(c);
  if (principal instanceof Response) return principal;
  const formulas = await c.env.DB.prepare(
    `SELECT * FROM formulas
      WHERE institution_id = ? AND status = 'ACTIVE'
      ORDER BY category ASC, name ASC`,
  )
    .bind(principal.institutionId)
    .all<FormulaRow>();

  const versions = await c.env.DB.prepare(
    `SELECT fv.id, fv.formula_id, fv.version, fv.expression, fv.return_type,
            fv.referenced_variables_json, fv.referenced_context_json,
            fv.changed_by, fv.change_note, fv.created_at,
            u.name AS user_name, u.email AS user_email
       FROM formula_versions fv
       JOIN formulas f ON f.id = fv.formula_id
       LEFT JOIN users u ON u.id = fv.changed_by
      WHERE fv.institution_id = ?
        AND f.institution_id = ?
        AND f.status = 'ACTIVE'
        AND fv.version >= f.version - 4
      ORDER BY fv.formula_id ASC, fv.version DESC`,
  )
    .bind(principal.institutionId, principal.institutionId)
    .all<FormulaVersionRow>();

  const byFormula = new Map<string, FormulaVersionRow[]>();
  for (const version of versions.results) {
    const list = byFormula.get(version.formula_id) ?? [];
    if (list.length < 5) list.push(version);
    byFormula.set(version.formula_id, list);
  }
  return c.json({
    success: true,
    data: formulas.results.map((formula) => formulaResponse(formula, byFormula.get(formula.id) ?? [])),
  });
});

variableFormulaRoutes.post("/formulas", async (c) => {
  const principal = await principalFor(c);
  if (principal instanceof Response) return principal;
  const body = await readObjectBody(c);
  if (!body) return c.json({ success: false, error: "Invalid JSON body" }, 400);
  const parsed = parseFormulaInput(body);
  if (typeof parsed === "string") return c.json({ success: false, error: parsed }, 422);
  const validation = validateFormula(parsed.expression);
  if (!validation.valid) return c.json({ success: false, error: `Invalid formula: ${validation.error}` }, 422);

  const duplicate = await c.env.DB.prepare(
    `SELECT id FROM formulas WHERE institution_id = ? AND key = ? LIMIT 1`,
  )
    .bind(principal.institutionId, parsed.key)
    .first<{ id: string }>();
  if (duplicate) return c.json({ success: false, error: "A formula with this key already exists" }, 409);
  const missingVariables = await missingVariableSlugs(c, principal, validation);

  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  await c.env.DB.prepare(
    `INSERT INTO formulas (
       id, institution_id, name, key, description, expression, return_type,
       category, status, version, created_by, updated_by, created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'ACTIVE', 1, ?, ?, ?, ?)`,
  )
    .bind(
      id, principal.institutionId, parsed.name, parsed.key, parsed.description,
      parsed.expression, parsed.returnType, parsed.category, principal.id, principal.id, now, now,
    )
    .run();
  const created = await loadFormula(c, principal, id);
  await c.env.DB.batch([formulaVersionInsert(c, created!, validation, principal.id, "Initial version")]);
  await audit(c, principal, "FORMULA_CREATE", "Formula", id, null, {
    key: parsed.key,
    version: 1,
    referencedVariables: validation.variableSlugs,
    referencedContext: validation.contextKeys,
    missingVariables,
  });
  return c.json({
    success: true,
    data: {
      ...formulaResponse(created!),
      referencedSlugs: validation.variableSlugs,
      referencedContext: validation.contextKeys,
      missingVariables,
    },
  }, 201);
});

variableFormulaRoutes.patch("/formulas/:id", async (c) => {
  const principal = await principalFor(c);
  if (principal instanceof Response) return principal;
  const existing = await loadFormula(c, principal, c.req.param("id"));
  if (!existing) return c.json({ success: false, error: "Formula not found" }, 404);
  const body = await readObjectBody(c);
  if (!body) return c.json({ success: false, error: "Invalid JSON body" }, 400);
  const parsed = parseFormulaInput(body, existing);
  if (typeof parsed === "string") return c.json({ success: false, error: parsed }, 422);

  const expressionChanged = parsed.expression !== existing.expression;
  const changeNote = optionalText(body.changeNote, 500);
  let validation: FormulaValidation | null = null;
  let missingVariables: string[] = [];
  if (expressionChanged) {
    if (!changeNote) {
      return c.json({ success: false, error: "A change note is required when updating the expression (creates a new version)" }, 400);
    }
    validation = validateFormula(parsed.expression);
    if (!validation.valid) return c.json({ success: false, error: `Invalid formula: ${validation.error}` }, 422);
    missingVariables = await missingVariableSlugs(c, principal, validation);
  }

  const metaChanged = parsed.name !== existing.name || parsed.description !== existing.description
    || parsed.returnType !== existing.return_type || parsed.category !== existing.category;
  if (!expressionChanged && !metaChanged) {
    return c.json({ success: true, data: formulaResponse(existing) });
  }

  const nextVersion = expressionChanged ? existing.version + 1 : existing.version;
  const now = new Date().toISOString();
  await c.env.DB.prepare(
    `UPDATE formulas
        SET name = ?, description = ?, expression = ?, return_type = ?, category = ?,
            version = ?, updated_by = ?, updated_at = ?
      WHERE id = ? AND institution_id = ?`,
  )
    .bind(
      parsed.name, parsed.description, parsed.expression, parsed.returnType, parsed.category,
      nextVersion, principal.id, now, existing.id, principal.institutionId,
    )
    .run();
  const updated = await loadFormula(c, principal, existing.id);

  if (expressionChanged && validation) {
    await c.env.DB.batch([formulaVersionInsert(c, updated!, validation, principal.id, changeNote!)]);
    await audit(c, principal, "FORMULA_UPDATE_VERSION", "Formula", existing.id, changeNote, {
      previousVersion: existing.version,
      version: nextVersion,
      referencedVariables: validation.variableSlugs,
      referencedContext: validation.contextKeys,
      missingVariables,
    });
  } else {
    await audit(c, principal, "FORMULA_UPDATE_META", "Formula", existing.id, null, {
      version: existing.version,
    });
  }

  return c.json({
    success: true,
    data: {
      ...formulaResponse(updated!),
      ...(validation ? {
        referencedSlugs: validation.variableSlugs,
        referencedContext: validation.contextKeys,
        missingVariables,
      } : {}),
    },
  });
});

variableFormulaRoutes.delete("/formulas/:id", async (c) => {
  const principal = await principalFor(c);
  if (principal instanceof Response) return principal;
  const existing = await loadFormula(c, principal, c.req.param("id"));
  if (!existing) return c.json({ success: false, error: "Formula not found" }, 404);
  if (existing.status === "ARCHIVED") return c.json({ success: true, data: { archived: true } });

  await c.env.DB.prepare(
    `UPDATE formulas SET status = 'ARCHIVED', updated_by = ?, updated_at = ?
      WHERE id = ? AND institution_id = ?`,
  )
    .bind(principal.id, new Date().toISOString(), existing.id, principal.institutionId)
    .run();
  await audit(c, principal, "FORMULA_ARCHIVE", "Formula", existing.id, null, {
    key: existing.key,
    version: existing.version,
  });
  return c.json({ success: true, data: { archived: true } });
});

variableFormulaRoutes.post("/formulas/test", async (c) => {
  const principal = await principalFor(c);
  if (principal instanceof Response) return principal;
  const body = await readObjectBody(c);
  if (!body) return c.json({ success: false, error: "Invalid JSON body" }, 400);
  const expression = typeof body.expression === "string" ? body.expression.trim() : "";
  const validation = validateFormula(expression);
  if (!validation.valid) {
    return c.json({
      success: true,
      data: {
        value: 0,
        valueExact: "0",
        error: validation.error,
        valid: false,
        referencedSlugs: [],
        referencedContext: [],
        missingVariables: [],
        missingContext: [],
        resolvedValues: {},
      },
    });
  }

  const rows = await c.env.DB.prepare(
    `SELECT key, variable_type, value_text
       FROM variables
      WHERE institution_id = ? AND status = 'ACTIVE'`,
  )
    .bind(principal.institutionId)
    .all<{ key: string; variable_type: VariableType; value_text: string }>();
  const variables: Record<string, string> = {};
  for (const row of rows.results) {
    if (row.variable_type === "BOOLEAN") variables[row.key] = row.value_text === "true" ? "1" : "0";
    else if (row.variable_type !== "TEXT") variables[row.key] = row.value_text;
  }

  const contextBody = typeof body.context === "object" && body.context !== null
    ? body.context as Record<string, unknown>
    : {};
  const context: Record<string, string> = {};
  for (const [key, value] of Object.entries(contextBody)) {
    if (typeof value === "string" || typeof value === "number") context[key] = String(value);
  }

  const result = evaluateFormula(expression, {
    variables,
    context,
    // Builder testing intentionally reports unresolved dependencies as zero so
    // an administrator can inspect them. Authoritative monthly closing must use
    // strictMissing=true and will block instead of falling back.
    strictMissing: false,
  });
  return c.json({
    success: true,
    data: {
      value: result.value,
      valueExact: result.valueExact,
      error: result.error,
      valid: result.valid,
      referencedSlugs: result.variableSlugs,
      referencedContext: result.contextKeys,
      missingVariables: result.missingVariables,
      missingContext: result.missingContext,
      resolvedValues: result.resolvedValues,
    },
  });
});
