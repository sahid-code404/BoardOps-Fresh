import { Hono, type Context } from "hono";
import { authenticatedPrincipal, type AuthPrincipal } from "../auth/authorization";
import type { AppEnv } from "../types";

export const productPurchaseRoutes = new Hono<AppEnv>();

type UnitCategory = "WEIGHT" | "VOLUME" | "QUANTITY" | "OTHER";
type ExpenseStatus = "APPROVED" | "REVERSED" | "DELETED";

type UnitRow = {
  id: string;
  institution_id: string;
  name: string;
  category: UnitCategory;
  is_active: number;
  created_at: string;
  updated_at: string;
};

type ProductRow = {
  id: string;
  institution_id: string;
  name: string;
  slug: string;
  category: string;
  default_unit_id: string | null;
  default_unit_name: string | null;
  default_unit_category: UnitCategory | null;
  default_unit_active: number | null;
  is_active: number;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
};

type PurchaseRow = {
  id: string;
  institution_id: string;
  vendor: string;
  purchase_date: string;
  total_amount_minor: number;
  currency_code: string;
  item_count: number;
  receipt_url: string | null;
  notes: string | null;
  expense_id: string;
  idempotency_key: string | null;
  created_by: string;
  created_at: string;
  expense_status: ExpenseStatus;
  deletion_scheduled_for: string | null;
  deletion_reason: string | null;
  purged_at: string | null;
  creator_name: string | null;
  creator_email: string | null;
};

type PurchaseItemRow = {
  id: string;
  purchase_id: string;
  product_id: string | null;
  product_name: string;
  category: string;
  quantity_milli: number;
  unit: string;
  rate_minor: number;
  total_minor: number;
};

type ParsedPurchaseItem = {
  id: string;
  productId: string | null;
  productName: string;
  category: string;
  quantityMilli: number;
  unit: string;
  rateMinor: number;
  totalMinor: number;
};

const UNIT_CATEGORIES = new Set<UnitCategory>(["WEIGHT", "VOLUME", "QUANTITY", "OTHER"]);

async function principalFor(c: Context<AppEnv>): Promise<AuthPrincipal | Response> {
  const principal = await authenticatedPrincipal(c);
  return principal ?? c.json({ success: false, error: "Authentication required" }, 401);
}

async function readObjectBody(c: Context<AppEnv>): Promise<Record<string, unknown> | null> {
  try {
    const value: unknown = await c.req.json();
    return value && typeof value === "object" ? value as Record<string, unknown> : {};
  } catch {
    return null;
  }
}

function optionalText(value: unknown, maxLength: number): string | null {
  if (value == null || value === "") return null;
  if (typeof value !== "string") return null;
  const text = value.trim();
  return text ? text.slice(0, maxLength) : null;
}

function minorToMajor(value: number): number {
  return Number(value || 0) / 100;
}

function majorToMinor(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return null;
  const scaled = value * 100;
  const rounded = Math.round(scaled);
  if (!Number.isSafeInteger(rounded) || Math.abs(scaled - rounded) > 1e-7) return null;
  return rounded;
}

function quantityToMilli(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0 || value > 1_000_000) return null;
  const scaled = value * 1000;
  const rounded = Math.round(scaled);
  if (!Number.isSafeInteger(rounded) || Math.abs(scaled - rounded) > 1e-7) return null;
  return rounded;
}

function unitResponse(row: UnitRow) {
  return {
    id: row.id,
    name: row.name,
    category: row.category,
    isActive: row.is_active === 1,
  };
}

function productResponse(row: ProductRow) {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    category: row.category,
    defaultUnitId: row.default_unit_id,
    defaultUnit: row.default_unit_id && row.default_unit_name
      ? {
          id: row.default_unit_id,
          name: row.default_unit_name,
          category: row.default_unit_category ?? "OTHER",
          isActive: row.default_unit_active === 1,
        }
      : null,
    isActive: row.is_active === 1,
    archivedAt: row.archived_at,
    createdAt: row.created_at,
  };
}

function purchaseItemResponse(row: PurchaseItemRow) {
  return {
    id: row.id,
    productId: row.product_id,
    productName: row.product_name,
    category: row.category,
    quantity: row.quantity_milli / 1000,
    unit: row.unit,
    rate: minorToMajor(row.rate_minor),
    total: minorToMajor(row.total_minor),
    notes: null,
  };
}

function purchaseResponse(row: PurchaseRow, items: PurchaseItemRow[] = []) {
  return {
    id: row.id,
    vendor: row.vendor,
    purchaseDate: row.purchase_date,
    totalAmount: minorToMajor(row.total_amount_minor),
    receiptUrl: row.receipt_url,
    notes: row.notes,
    status: row.expense_status,
    deletedAt: row.deletion_scheduled_for,
    deletionReason: row.deletion_reason,
    createdBy: row.created_by,
    createdAt: row.created_at,
    expenseId: row.expense_id,
    items: items.map(purchaseItemResponse),
    user: row.creator_name
      ? { name: row.creator_name, email: row.creator_email ?? "" }
      : null,
  };
}

function slugBase(name: string): string {
  const slug = name
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-+|-+$/gu, "")
    .slice(0, 150);
  return slug || "product";
}

async function uniqueSlug(
  c: Context<AppEnv>,
  institutionId: string,
  name: string,
  excludeId: string | null = null,
): Promise<string> {
  const base = slugBase(name);
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const candidate = attempt === 0 ? base : `${base}-${attempt + 1}`;
    const row = await c.env.DB.prepare(
      `SELECT id FROM products
        WHERE institution_id = ? AND slug = ?
          AND (? IS NULL OR id <> ?)
        LIMIT 1`,
    )
      .bind(institutionId, candidate, excludeId, excludeId)
      .first<{ id: string }>();
    if (!row) return candidate;
  }
  return `${base}-${crypto.randomUUID().slice(0, 8)}`;
}

async function audit(
  c: Context<AppEnv>,
  principal: AuthPrincipal,
  action: string,
  entityType: string,
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
      crypto.randomUUID(),
      principal.institutionId,
      principal.id,
      action,
      entityType,
      entityId,
      c.get("requestId"),
      reason,
      JSON.stringify(metadata),
      new Date().toISOString(),
    )
    .run();
}

async function institutionContext(
  c: Context<AppEnv>,
  institutionId: string,
): Promise<{ timezone: string; currencyCode: string }> {
  const row = await c.env.DB.prepare(
    `SELECT timezone, currency_code FROM institutions WHERE id = ? LIMIT 1`,
  )
    .bind(institutionId)
    .first<{ timezone: string; currency_code: string }>();
  return { timezone: row?.timezone || "UTC", currencyCode: row?.currency_code || "INR" };
}

function timezoneOffsetMinutes(timeZone: string, instant: Date): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(instant);
  const part = (name: string) => Number(parts.find((item) => item.type === name)?.value ?? 0);
  const localAsUtc = Date.UTC(
    part("year"), part("month") - 1, part("day"), part("hour"), part("minute"), part("second"),
  );
  return Math.round((localAsUtc - instant.getTime()) / 60_000);
}

function localMidnightUtc(year: number, month: number, day: number, timeZone: string): string {
  const wallClockUtc = Date.UTC(year, month, day, 0, 0, 0, 0);
  let candidate = new Date(wallClockUtc);
  let offset = timezoneOffsetMinutes(timeZone, candidate);
  candidate = new Date(wallClockUtc - offset * 60_000);
  const corrected = timezoneOffsetMinutes(timeZone, candidate);
  if (corrected !== offset) candidate = new Date(wallClockUtc - corrected * 60_000);
  return candidate.toISOString();
}

function localDateKey(timeZone: string, instant = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(instant);
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

function validDateKey(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  if (!year || !month || !day) return false;
  const probe = new Date(Date.UTC(year, month - 1, day));
  return probe.getUTCFullYear() === year && probe.getUTCMonth() === month - 1 && probe.getUTCDate() === day;
}

function purchaseDateToExpenseIso(dateKey: string, timeZone: string): string {
  const [year, month, day] = dateKey.split("-").map(Number);
  return localMidnightUtc(year!, month! - 1, day!, timeZone);
}

async function requireOpenPeriod(
  c: Context<AppEnv>,
  institutionId: string,
  purchaseDate: string,
): Promise<Response | null> {
  const key = purchaseDate.slice(0, 7);
  const row = await c.env.DB.prepare(
    `SELECT status FROM accounting_periods WHERE institution_id = ? AND period_key = ? LIMIT 1`,
  )
    .bind(institutionId, key)
    .first<{ status: string }>();
  if (row?.status !== "OPEN") {
    return c.json({ success: false, error: `Purchase period ${key} is not open` }, 422);
  }
  return null;
}

async function loadUnit(c: Context<AppEnv>, principal: AuthPrincipal, id: string): Promise<UnitRow | null> {
  return c.env.DB.prepare(
    `SELECT id, institution_id, name, category, is_active, created_at, updated_at
       FROM units WHERE id = ? AND institution_id = ? LIMIT 1`,
  )
    .bind(id, principal.institutionId)
    .first<UnitRow>();
}

async function loadProduct(c: Context<AppEnv>, principal: AuthPrincipal, id: string): Promise<ProductRow | null> {
  return c.env.DB.prepare(
    `SELECT p.id, p.institution_id, p.name, p.slug, p.category, p.default_unit_id,
            u.name AS default_unit_name, u.category AS default_unit_category,
            u.is_active AS default_unit_active,
            p.is_active, p.archived_at, p.created_at, p.updated_at
       FROM products p
       LEFT JOIN units u ON u.id = p.default_unit_id
      WHERE p.id = ? AND p.institution_id = ?
      LIMIT 1`,
  )
    .bind(id, principal.institutionId)
    .first<ProductRow>();
}

async function loadPurchase(c: Context<AppEnv>, principal: AuthPrincipal, id: string): Promise<PurchaseRow | null> {
  return c.env.DB.prepare(
    `SELECT p.id, p.institution_id, p.vendor, p.purchase_date, p.total_amount_minor,
            p.currency_code, p.item_count, p.receipt_url, p.notes, p.expense_id,
            p.idempotency_key, p.created_by, p.created_at,
            e.status AS expense_status, e.deletion_scheduled_for, e.deletion_reason, e.purged_at,
            u.name AS creator_name, u.email AS creator_email
       FROM purchases p
       JOIN expenses e ON e.id = p.expense_id AND e.institution_id = p.institution_id
       LEFT JOIN users u ON u.id = p.created_by
      WHERE p.id = ? AND p.institution_id = ?
      LIMIT 1`,
  )
    .bind(id, principal.institutionId)
    .first<PurchaseRow>();
}

async function loadPurchaseByIdempotency(
  c: Context<AppEnv>,
  principal: AuthPrincipal,
  key: string,
): Promise<PurchaseRow | null> {
  return c.env.DB.prepare(
    `SELECT p.id, p.institution_id, p.vendor, p.purchase_date, p.total_amount_minor,
            p.currency_code, p.item_count, p.receipt_url, p.notes, p.expense_id,
            p.idempotency_key, p.created_by, p.created_at,
            e.status AS expense_status, e.deletion_scheduled_for, e.deletion_reason, e.purged_at,
            u.name AS creator_name, u.email AS creator_email
       FROM purchases p
       JOIN expenses e ON e.id = p.expense_id AND e.institution_id = p.institution_id
       LEFT JOIN users u ON u.id = p.created_by
      WHERE p.institution_id = ? AND p.created_by = ? AND p.idempotency_key = ?
      LIMIT 1`,
  )
    .bind(principal.institutionId, principal.id, key)
    .first<PurchaseRow>();
}

async function loadItems(c: Context<AppEnv>, purchaseId: string): Promise<PurchaseItemRow[]> {
  const rows = await c.env.DB.prepare(
    `SELECT id, purchase_id, product_id, product_name, category,
            quantity_milli, unit, rate_minor, total_minor
       FROM purchase_items
      WHERE purchase_id = ?
      ORDER BY created_at ASC, id ASC`,
  )
    .bind(purchaseId)
    .all<PurchaseItemRow>();
  return rows.results;
}

async function loadItemsForPurchases(
  c: Context<AppEnv>,
  purchaseIds: string[],
): Promise<Map<string, PurchaseItemRow[]>> {
  const grouped = new Map<string, PurchaseItemRow[]>();
  for (let offset = 0; offset < purchaseIds.length; offset += 80) {
    const chunk = purchaseIds.slice(offset, offset + 80);
    if (chunk.length === 0) continue;
    const placeholders = chunk.map(() => "?").join(",");
    const rows = await c.env.DB.prepare(
      `SELECT id, purchase_id, product_id, product_name, category,
              quantity_milli, unit, rate_minor, total_minor
         FROM purchase_items
        WHERE purchase_id IN (${placeholders})
        ORDER BY purchase_id ASC, created_at ASC, id ASC`,
    )
      .bind(...chunk)
      .all<PurchaseItemRow>();
    for (const row of rows.results) {
      const current = grouped.get(row.purchase_id) ?? [];
      current.push(row);
      grouped.set(row.purchase_id, current);
    }
  }
  return grouped;
}

async function catalogProductsByIds(
  c: Context<AppEnv>,
  principal: AuthPrincipal,
  ids: string[],
): Promise<Map<string, ProductRow>> {
  const unique = [...new Set(ids)];
  if (unique.length === 0) return new Map();
  const placeholders = unique.map(() => "?").join(",");
  const rows = await c.env.DB.prepare(
    `SELECT p.id, p.institution_id, p.name, p.slug, p.category, p.default_unit_id,
            u.name AS default_unit_name, u.category AS default_unit_category,
            u.is_active AS default_unit_active,
            p.is_active, p.archived_at, p.created_at, p.updated_at
       FROM products p
       LEFT JOIN units u ON u.id = p.default_unit_id
      WHERE p.institution_id = ? AND p.id IN (${placeholders})`,
  )
    .bind(principal.institutionId, ...unique)
    .all<ProductRow>();
  return new Map(rows.results.map((row) => [row.id, row]));
}

async function activeUnitNames(c: Context<AppEnv>, principal: AuthPrincipal): Promise<Set<string>> {
  const rows = await c.env.DB.prepare(
    `SELECT name FROM units WHERE institution_id = ? AND is_active = 1`,
  )
    .bind(principal.institutionId)
    .all<{ name: string }>();
  return new Set(rows.results.map((row) => row.name));
}

productPurchaseRoutes.get("/units", async (c) => {
  const principal = await principalFor(c);
  if (principal instanceof Response) return principal;
  const rows = await c.env.DB.prepare(
    `SELECT id, institution_id, name, category, is_active, created_at, updated_at
       FROM units
      WHERE institution_id = ?
      ORDER BY is_active DESC, category ASC, name ASC`,
  )
    .bind(principal.institutionId)
    .all<UnitRow>();
  return c.json({ success: true, data: rows.results.map(unitResponse) });
});

productPurchaseRoutes.post("/units", async (c) => {
  const principal = await principalFor(c);
  if (principal instanceof Response) return principal;
  const body = await readObjectBody(c);
  if (!body) return c.json({ success: false, error: "Invalid JSON body" }, 400);
  const name = typeof body.name === "string" ? body.name.trim() : "";
  const category = typeof body.category === "string" ? body.category.trim().toUpperCase() as UnitCategory : "" as UnitCategory;
  if (name.length < 1 || name.length > 32) return c.json({ success: false, error: "Unit name must be 1 to 32 characters" }, 422);
  if (!UNIT_CATEGORIES.has(category)) return c.json({ success: false, error: "Invalid unit category" }, 422);

  const existing = await c.env.DB.prepare(
    `SELECT id FROM units WHERE institution_id = ? AND name = ? LIMIT 1`,
  ).bind(principal.institutionId, name).first<{ id: string }>();
  if (existing) return c.json({ success: false, error: "Unit already exists" }, 409);

  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  await c.env.DB.prepare(
    `INSERT INTO units (id, institution_id, name, category, is_active, created_by, created_at, updated_at)
     VALUES (?, ?, ?, ?, 1, ?, ?, ?)`,
  ).bind(id, principal.institutionId, name, category, principal.id, now, now).run();
  await audit(c, principal, "UNIT_CREATE", "Unit", id, null, { name, category });
  const created = await loadUnit(c, principal, id);
  return c.json({ success: true, data: unitResponse(created!) }, 201);
});

productPurchaseRoutes.patch("/units/:id", async (c) => {
  const principal = await principalFor(c);
  if (principal instanceof Response) return principal;
  const existing = await loadUnit(c, principal, c.req.param("id"));
  if (!existing) return c.json({ success: false, error: "Unit not found" }, 404);
  const body = await readObjectBody(c);
  if (!body) return c.json({ success: false, error: "Invalid JSON body" }, 400);
  if (typeof body.isActive !== "boolean") return c.json({ success: false, error: "isActive boolean is required" }, 422);
  const now = new Date().toISOString();
  await c.env.DB.prepare(
    `UPDATE units SET is_active = ?, updated_at = ? WHERE id = ? AND institution_id = ?`,
  ).bind(body.isActive ? 1 : 0, now, existing.id, principal.institutionId).run();
  await audit(c, principal, body.isActive ? "UNIT_ACTIVATE" : "UNIT_DEACTIVATE", "Unit", existing.id, null, {});
  const updated = await loadUnit(c, principal, existing.id);
  return c.json({ success: true, data: unitResponse(updated!) });
});

productPurchaseRoutes.get("/products", async (c) => {
  const principal = await principalFor(c);
  if (principal instanceof Response) return principal;
  const includeArchived = c.req.query("includeArchived") === "true";
  const rows = await c.env.DB.prepare(
    `SELECT p.id, p.institution_id, p.name, p.slug, p.category, p.default_unit_id,
            u.name AS default_unit_name, u.category AS default_unit_category,
            u.is_active AS default_unit_active,
            p.is_active, p.archived_at, p.created_at, p.updated_at
       FROM products p
       LEFT JOIN units u ON u.id = p.default_unit_id
      WHERE p.institution_id = ? ${includeArchived ? "" : "AND p.is_active = 1"}
      ORDER BY p.is_active DESC, p.category ASC, p.name ASC`,
  )
    .bind(principal.institutionId)
    .all<ProductRow>();
  return c.json({ success: true, data: rows.results.map(productResponse) });
});

productPurchaseRoutes.post("/products", async (c) => {
  const principal = await principalFor(c);
  if (principal instanceof Response) return principal;
  const body = await readObjectBody(c);
  if (!body) return c.json({ success: false, error: "Invalid JSON body" }, 400);
  const name = typeof body.name === "string" ? body.name.trim() : "";
  const category = typeof body.category === "string" ? body.category.trim() : "";
  const defaultUnitId = body.defaultUnitId == null || body.defaultUnitId === "" ? null : String(body.defaultUnitId);
  if (name.length < 2 || name.length > 160) return c.json({ success: false, error: "Product name must be 2 to 160 characters" }, 422);
  if (category.length < 2 || category.length > 64) return c.json({ success: false, error: "Product category must be 2 to 64 characters" }, 422);
  if (defaultUnitId) {
    const unit = await loadUnit(c, principal, defaultUnitId);
    if (!unit || unit.is_active !== 1) return c.json({ success: false, error: "Default unit must be active" }, 422);
  }
  const slug = await uniqueSlug(c, principal.institutionId, name);
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  await c.env.DB.prepare(
    `INSERT INTO products
      (id, institution_id, name, slug, category, default_unit_id, is_active, archived_at, created_by, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, 1, NULL, ?, ?, ?)`,
  ).bind(id, principal.institutionId, name, slug, category, defaultUnitId, principal.id, now, now).run();
  await audit(c, principal, "PRODUCT_CREATE", "Product", id, null, { name, category, defaultUnitId });
  const created = await loadProduct(c, principal, id);
  return c.json({ success: true, data: productResponse(created!) }, 201);
});

productPurchaseRoutes.patch("/products/:id", async (c) => {
  const principal = await principalFor(c);
  if (principal instanceof Response) return principal;
  const existing = await loadProduct(c, principal, c.req.param("id"));
  if (!existing) return c.json({ success: false, error: "Product not found" }, 404);
  const body = await readObjectBody(c);
  if (!body) return c.json({ success: false, error: "Invalid JSON body" }, 400);

  let name = existing.name;
  let category = existing.category;
  let defaultUnitId = existing.default_unit_id;
  let isActive = existing.is_active === 1;
  let slug = existing.slug;

  if ("name" in body) {
    name = typeof body.name === "string" ? body.name.trim() : "";
    if (name.length < 2 || name.length > 160) return c.json({ success: false, error: "Product name must be 2 to 160 characters" }, 422);
    slug = await uniqueSlug(c, principal.institutionId, name, existing.id);
  }
  if ("category" in body) {
    category = typeof body.category === "string" ? body.category.trim() : "";
    if (category.length < 2 || category.length > 64) return c.json({ success: false, error: "Product category must be 2 to 64 characters" }, 422);
  }
  if ("defaultUnitId" in body) {
    defaultUnitId = body.defaultUnitId == null || body.defaultUnitId === "" ? null : String(body.defaultUnitId);
    if (defaultUnitId) {
      const unit = await loadUnit(c, principal, defaultUnitId);
      if (!unit || unit.is_active !== 1) return c.json({ success: false, error: "Default unit must be active" }, 422);
    }
  }
  if ("isActive" in body) {
    if (typeof body.isActive !== "boolean") return c.json({ success: false, error: "isActive must be boolean" }, 422);
    isActive = body.isActive;
  }

  const now = new Date().toISOString();
  await c.env.DB.prepare(
    `UPDATE products
        SET name = ?, slug = ?, category = ?, default_unit_id = ?, is_active = ?,
            archived_at = ?, updated_at = ?
      WHERE id = ? AND institution_id = ?`,
  ).bind(
    name, slug, category, defaultUnitId, isActive ? 1 : 0,
    isActive ? null : (existing.archived_at ?? now), now, existing.id, principal.institutionId,
  ).run();
  await audit(c, principal, "PRODUCT_UPDATE", "Product", existing.id, null, {
    name, category, defaultUnitId, isActive,
  });
  const updated = await loadProduct(c, principal, existing.id);
  return c.json({ success: true, data: productResponse(updated!) });
});

productPurchaseRoutes.delete("/products/:id", async (c) => {
  const principal = await principalFor(c);
  if (principal instanceof Response) return principal;
  const existing = await loadProduct(c, principal, c.req.param("id"));
  if (!existing) return c.json({ success: false, error: "Product not found" }, 404);
  if (existing.is_active === 0) return c.json({ success: true, data: productResponse(existing) });
  const now = new Date().toISOString();
  await c.env.DB.prepare(
    `UPDATE products SET is_active = 0, archived_at = ?, updated_at = ?
      WHERE id = ? AND institution_id = ?`,
  ).bind(now, now, existing.id, principal.institutionId).run();
  await audit(c, principal, "PRODUCT_ARCHIVE", "Product", existing.id, null, {});
  const archived = await loadProduct(c, principal, existing.id);
  return c.json({ success: true, data: productResponse(archived!) });
});

function currentMonthYear(timeZone: string): { month: number; year: number } {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone, year: "numeric", month: "2-digit" }).formatToParts(new Date());
  return {
    month: Number(parts.find((part) => part.type === "month")?.value ?? "1"),
    year: Number(parts.find((part) => part.type === "year")?.value ?? "1970"),
  };
}

function parsePurchasePeriod(c: Context<AppEnv>, timeZone: string): { month: number; year: number; startDate: string; endDate: string } | Response {
  const current = currentMonthYear(timeZone);
  const rawMonth = c.req.query("month");
  const rawYear = c.req.query("year");
  const month = rawMonth == null ? current.month : Number(rawMonth);
  const year = rawYear == null ? current.year : Number(rawYear);
  if (!Number.isInteger(month) || month < 1 || month > 12 || !Number.isInteger(year) || year < 2000 || year > 9999) {
    return c.json({ success: false, error: "Invalid month/year" }, 400);
  }
  const nextMonth = month === 12 ? 1 : month + 1;
  const nextYear = month === 12 ? year + 1 : year;
  return {
    month,
    year,
    startDate: `${year}-${String(month).padStart(2, "0")}-01`,
    endDate: `${nextYear}-${String(nextMonth).padStart(2, "0")}-01`,
  };
}

productPurchaseRoutes.get("/purchases", async (c) => {
  const principal = await principalFor(c);
  if (principal instanceof Response) return principal;
  const institution = await institutionContext(c, principal.institutionId);
  const period = parsePurchasePeriod(c, institution.timezone);
  if (period instanceof Response) return period;
  const requestedLimit = Number(c.req.query("limit") ?? 200);
  const limit = Number.isInteger(requestedLimit) ? Math.min(Math.max(requestedLimit, 1), 500) : 200;
  const includeDeleted = c.req.query("includeDeleted") === "true";
  const statusClause = includeDeleted ? "e.status = 'DELETED' AND e.purged_at IS NULL" : "e.status = 'APPROVED' AND e.purged_at IS NULL";

  const rows = await c.env.DB.prepare(
    `SELECT p.id, p.institution_id, p.vendor, p.purchase_date, p.total_amount_minor,
            p.currency_code, p.item_count, p.receipt_url, p.notes, p.expense_id,
            p.idempotency_key, p.created_by, p.created_at,
            e.status AS expense_status, e.deletion_scheduled_for, e.deletion_reason, e.purged_at,
            u.name AS creator_name, u.email AS creator_email
       FROM purchases p
       JOIN expenses e ON e.id = p.expense_id AND e.institution_id = p.institution_id
       LEFT JOIN users u ON u.id = p.created_by
      WHERE p.institution_id = ? AND p.purchase_date >= ? AND p.purchase_date < ?
        AND ${statusClause}
      ORDER BY p.purchase_date DESC, p.created_at DESC
      LIMIT ?`,
  )
    .bind(principal.institutionId, period.startDate, period.endDate, limit)
    .all<PurchaseRow>();
  const items = await loadItemsForPurchases(c, rows.results.map((row) => row.id));
  return c.json({ success: true, data: rows.results.map((row) => purchaseResponse(row, items.get(row.id) ?? [])) });
});

productPurchaseRoutes.get("/purchases/stats", async (c) => {
  const principal = await principalFor(c);
  if (principal instanceof Response) return principal;
  const institution = await institutionContext(c, principal.institutionId);
  const period = parsePurchasePeriod(c, institution.timezone);
  if (period instanceof Response) return period;
  const today = localDateKey(institution.timezone);

  const [summary, topProducts, topCategories] = await Promise.all([
    c.env.DB.prepare(
      `SELECT
         COALESCE(SUM(CASE WHEN p.purchase_date = ? THEN p.total_amount_minor ELSE 0 END), 0) AS today_minor,
         COALESCE(SUM(p.total_amount_minor), 0) AS month_minor,
         COUNT(*) AS month_count
       FROM purchases p
       JOIN expenses e ON e.id = p.expense_id AND e.institution_id = p.institution_id
       WHERE p.institution_id = ? AND p.purchase_date >= ? AND p.purchase_date < ?
         AND e.status = 'APPROVED' AND e.purged_at IS NULL`,
    ).bind(today, principal.institutionId, period.startDate, period.endDate).first<{
      today_minor: number | null; month_minor: number | null; month_count: number | null;
    }>(),
    c.env.DB.prepare(
      `SELECT pi.product_name AS name, COALESCE(SUM(pi.total_minor), 0) AS spend_minor,
              COALESCE(SUM(pi.quantity_milli), 0) AS quantity_milli
       FROM purchase_items pi
       JOIN purchases p ON p.id = pi.purchase_id AND p.institution_id = pi.institution_id
       JOIN expenses e ON e.id = p.expense_id AND e.institution_id = p.institution_id
       WHERE p.institution_id = ? AND p.purchase_date >= ? AND p.purchase_date < ?
         AND e.status = 'APPROVED' AND e.purged_at IS NULL
       GROUP BY pi.product_name
       ORDER BY spend_minor DESC, pi.product_name ASC
       LIMIT 8`,
    ).bind(principal.institutionId, period.startDate, period.endDate).all<{
      name: string; spend_minor: number; quantity_milli: number;
    }>(),
    c.env.DB.prepare(
      `SELECT pi.category, COALESCE(SUM(pi.total_minor), 0) AS spend_minor
       FROM purchase_items pi
       JOIN purchases p ON p.id = pi.purchase_id AND p.institution_id = pi.institution_id
       JOIN expenses e ON e.id = p.expense_id AND e.institution_id = p.institution_id
       WHERE p.institution_id = ? AND p.purchase_date >= ? AND p.purchase_date < ?
         AND e.status = 'APPROVED' AND e.purged_at IS NULL
       GROUP BY pi.category
       ORDER BY spend_minor DESC, pi.category ASC
       LIMIT 8`,
    ).bind(principal.institutionId, period.startDate, period.endDate).all<{
      category: string; spend_minor: number;
    }>(),
  ]);

  return c.json({ success: true, data: {
    todayTotal: minorToMajor(Number(summary?.today_minor ?? 0)),
    monthTotal: minorToMajor(Number(summary?.month_minor ?? 0)),
    monthCount: Number(summary?.month_count ?? 0),
    topProducts: topProducts.results.map((row) => ({
      name: row.name,
      totalSpend: minorToMajor(row.spend_minor),
      totalQuantity: row.quantity_milli / 1000,
    })),
    topCategories: topCategories.results.map((row) => ({
      category: row.category,
      totalSpend: minorToMajor(row.spend_minor),
    })),
  } });
});

productPurchaseRoutes.get("/purchases/:id", async (c) => {
  const principal = await principalFor(c);
  if (principal instanceof Response) return principal;
  const row = await loadPurchase(c, principal, c.req.param("id"));
  if (!row || row.purged_at) return c.json({ success: false, error: "Purchase not found" }, 404);
  return c.json({ success: true, data: purchaseResponse(row, await loadItems(c, row.id)) });
});

productPurchaseRoutes.post("/purchases", async (c) => {
  const principal = await principalFor(c);
  if (principal instanceof Response) return principal;
  const idempotencyKey = c.req.header("Idempotency-Key")?.trim();
  if (!idempotencyKey || idempotencyKey.length > 200) {
    return c.json({ success: false, error: "Idempotency-Key header is required" }, 400);
  }
  const replay = await loadPurchaseByIdempotency(c, principal, idempotencyKey);
  if (replay) return c.json({ success: true, data: purchaseResponse(replay, await loadItems(c, replay.id)) });

  const body = await readObjectBody(c);
  if (!body) return c.json({ success: false, error: "Invalid JSON body" }, 400);
  const vendor = typeof body.vendor === "string" ? body.vendor.trim() : "";
  const purchaseDate = typeof body.purchaseDate === "string" ? body.purchaseDate.trim() : "";
  const notes = optionalText(body.notes, 4000);
  const receiptUrl = optionalText(body.receiptUrl, 2000);
  const rawItems = Array.isArray(body.items) ? body.items : [];
  if (vendor.length < 2 || vendor.length > 200) return c.json({ success: false, error: "Vendor must be 2 to 200 characters" }, 422);
  if (!validDateKey(purchaseDate)) return c.json({ success: false, error: "Purchase date is invalid" }, 422);
  if (rawItems.length < 1 || rawItems.length > 100) return c.json({ success: false, error: "Purchase must contain 1 to 100 items" }, 422);

  const institution = await institutionContext(c, principal.institutionId);
  const periodError = await requireOpenPeriod(c, principal.institutionId, purchaseDate);
  if (periodError) return periodError;

  const productIds = rawItems
    .map((raw) => raw && typeof raw === "object" ? (raw as Record<string, unknown>).productId : null)
    .filter((value): value is string => typeof value === "string" && value.length > 0);
  const products = await catalogProductsByIds(c, principal, productIds);
  const units = await activeUnitNames(c, principal);
  const parsedItems: ParsedPurchaseItem[] = [];
  let totalMinor = 0;

  for (const raw of rawItems) {
    if (!raw || typeof raw !== "object") return c.json({ success: false, error: "Invalid purchase item" }, 422);
    const input = raw as Record<string, unknown>;
    const productId = typeof input.productId === "string" && input.productId ? input.productId : null;
    const product = productId ? products.get(productId) : null;
    if (productId && (!product || product.is_active !== 1)) {
      return c.json({ success: false, error: "Referenced product must be active" }, 422);
    }
    const productName = product?.name ?? (typeof input.productName === "string" ? input.productName.trim() : "");
    const category = product?.category ?? (typeof input.category === "string" ? input.category.trim() : "");
    const quantityMilli = quantityToMilli(input.quantity);
    const unit = typeof input.unit === "string" ? input.unit.trim() : "";
    const rateMinor = majorToMinor(input.rate);
    if (productName.length < 2 || productName.length > 160) return c.json({ success: false, error: "Every item needs a valid product name" }, 422);
    if (category.length < 2 || category.length > 64) return c.json({ success: false, error: "Every item needs a valid category" }, 422);
    if (quantityMilli === null) return c.json({ success: false, error: "Every item quantity must be positive with at most three decimal places" }, 422);
    if (!unit || unit.length > 32 || !units.has(unit)) return c.json({ success: false, error: "Every item must use an active unit" }, 422);
    if (rateMinor === null) return c.json({ success: false, error: "Every item rate must be positive with at most two decimal places" }, 422);
    const productValue = quantityMilli * rateMinor;
    if (!Number.isSafeInteger(productValue)) return c.json({ success: false, error: "Purchase item value is too large" }, 422);
    const itemTotalMinor = Math.round(productValue / 1000);
    if (!Number.isSafeInteger(itemTotalMinor) || itemTotalMinor <= 0) return c.json({ success: false, error: "Purchase item total is invalid" }, 422);
    totalMinor += itemTotalMinor;
    if (!Number.isSafeInteger(totalMinor)) return c.json({ success: false, error: "Purchase total is too large" }, 422);
    parsedItems.push({
      id: crypto.randomUUID(), productId, productName, category,
      quantityMilli, unit, rateMinor, totalMinor: itemTotalMinor,
    });
  }

  const purchaseId = crypto.randomUUID();
  const expenseId = crypto.randomUUID();
  const now = new Date().toISOString();
  const expenseDate = purchaseDateToExpenseIso(purchaseDate, institution.timezone);
  const expenseTitle = `Purchase · ${vendor}`.slice(0, 160);
  const statements = [
    c.env.DB.prepare(
      `INSERT INTO expenses (
         id, institution_id, title, category, quantity, unit, amount_minor,
         currency_code, description, expense_date, paid_to, idempotency_key,
         status, created_by, created_at, updated_at
       ) VALUES (?, ?, ?, 'PURCHASE', 1, 'purchase', ?, ?, ?, ?, ?, ?, 'APPROVED', ?, ?, ?)`,
    ).bind(
      expenseId, principal.institutionId, expenseTitle, totalMinor, institution.currencyCode,
      notes, expenseDate, vendor, `purchase:${idempotencyKey}`, principal.id, now, now,
    ),
    c.env.DB.prepare(
      `INSERT INTO purchases (
         id, institution_id, vendor, purchase_date, total_amount_minor, currency_code,
         item_count, receipt_url, notes, expense_id, idempotency_key, created_by, created_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      purchaseId, principal.institutionId, vendor, purchaseDate, totalMinor, institution.currencyCode,
      parsedItems.length, receiptUrl, notes, expenseId, idempotencyKey, principal.id, now,
    ),
    ...parsedItems.map((item) => c.env.DB.prepare(
      `INSERT INTO purchase_items (
         id, purchase_id, institution_id, product_id, product_name, category,
         quantity_milli, unit, rate_minor, total_minor, created_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      item.id, purchaseId, principal.institutionId, item.productId, item.productName,
      item.category, item.quantityMilli, item.unit, item.rateMinor, item.totalMinor, now,
    )),
    c.env.DB.prepare(
      `INSERT INTO audit_events
        (id, institution_id, actor_user_id, action, entity_type, entity_id,
         request_id, reason, metadata_json, created_at)
       VALUES (?, ?, ?, 'PURCHASE_CREATE', 'Purchase', ?, ?, NULL, ?, ?)`,
    ).bind(
      crypto.randomUUID(), principal.institutionId, principal.id, purchaseId, c.get("requestId"),
      JSON.stringify({ expenseId, totalMinor, itemCount: parsedItems.length, vendor, purchaseDate }), now,
    ),
  ];
  await c.env.DB.batch(statements);
  const created = await loadPurchase(c, principal, purchaseId);
  return c.json({ success: true, data: purchaseResponse(created!, await loadItems(c, purchaseId)) }, 201);
});

productPurchaseRoutes.patch("/purchases/:id", async (c) => {
  const principal = await principalFor(c);
  if (principal instanceof Response) return principal;
  const existing = await loadPurchase(c, principal, c.req.param("id"));
  if (!existing || existing.purged_at) return c.json({ success: false, error: "Purchase not found" }, 404);
  const body = await readObjectBody(c);
  if (!body) return c.json({ success: false, error: "Invalid JSON body" }, 400);
  if (body.action !== "SOFT_DELETE") return c.json({ success: false, error: "Only SOFT_DELETE is supported for immutable purchases" }, 422);
  const reason = optionalText(body.reason, 500);
  if (!reason || reason.length < 2) return c.json({ success: false, error: "Deletion reason is required" }, 422);
  if (existing.expense_status === "DELETED") {
    return c.json({ success: true, data: purchaseResponse(existing, await loadItems(c, existing.id)) });
  }
  if (existing.expense_status !== "APPROVED") return c.json({ success: false, error: "Purchase is not deletable" }, 422);
  const periodError = await requireOpenPeriod(c, principal.institutionId, existing.purchase_date);
  if (periodError) return periodError;

  const deletedOn = new Date();
  const scheduled = new Date(deletedOn.getTime() + 7 * 24 * 60 * 60 * 1000);
  const now = deletedOn.toISOString();
  await c.env.DB.batch([
    c.env.DB.prepare(
      `UPDATE expenses
          SET status = 'DELETED', status_before_delete = 'APPROVED', deleted_on = ?,
              deletion_scheduled_for = ?, deleted_by = ?, deletion_reason = ?, updated_at = ?
        WHERE id = ? AND institution_id = ? AND status = 'APPROVED'`,
    ).bind(now, scheduled.toISOString(), principal.id, reason, now, existing.expense_id, principal.institutionId),
    c.env.DB.prepare(
      `INSERT INTO audit_events
        (id, institution_id, actor_user_id, action, entity_type, entity_id,
         request_id, reason, metadata_json, created_at)
       VALUES (?, ?, ?, 'PURCHASE_SOFT_DELETE', 'Purchase', ?, ?, ?, ?, ?)`,
    ).bind(
      crypto.randomUUID(), principal.institutionId, principal.id, existing.id, c.get("requestId"),
      reason, JSON.stringify({ expenseId: existing.expense_id, deletionScheduledFor: scheduled.toISOString() }), now,
    ),
  ]);
  const deleted = await loadPurchase(c, principal, existing.id);
  return c.json({ success: true, data: purchaseResponse(deleted!, await loadItems(c, existing.id)) });
});

productPurchaseRoutes.post("/purchases/:id/restore", async (c) => {
  const principal = await principalFor(c);
  if (principal instanceof Response) return principal;
  const existing = await loadPurchase(c, principal, c.req.param("id"));
  if (!existing) return c.json({ success: false, error: "Purchase not found" }, 404);
  if (existing.expense_status === "APPROVED" && !existing.purged_at) {
    return c.json({ success: true, data: purchaseResponse(existing, await loadItems(c, existing.id)) });
  }
  if (existing.expense_status !== "DELETED") return c.json({ success: false, error: "Purchase is not restorable" }, 422);
  if (existing.purged_at || !existing.deletion_scheduled_for || existing.deletion_scheduled_for <= new Date().toISOString()) {
    return c.json({ success: false, error: "Purchase recovery window has expired" }, 410);
  }
  const periodError = await requireOpenPeriod(c, principal.institutionId, existing.purchase_date);
  if (periodError) return periodError;
  const now = new Date().toISOString();
  await c.env.DB.batch([
    c.env.DB.prepare(
      `UPDATE expenses
          SET status = 'APPROVED', status_before_delete = NULL, deleted_on = NULL,
              deletion_scheduled_for = NULL, deleted_by = NULL, deletion_reason = NULL,
              updated_at = ?
        WHERE id = ? AND institution_id = ? AND status = 'DELETED' AND purged_at IS NULL`,
    ).bind(now, existing.expense_id, principal.institutionId),
    c.env.DB.prepare(
      `INSERT INTO audit_events
        (id, institution_id, actor_user_id, action, entity_type, entity_id,
         request_id, reason, metadata_json, created_at)
       VALUES (?, ?, ?, 'PURCHASE_RESTORE', 'Purchase', ?, ?, NULL, ?, ?)`,
    ).bind(
      crypto.randomUUID(), principal.institutionId, principal.id, existing.id, c.get("requestId"),
      JSON.stringify({ expenseId: existing.expense_id }), now,
    ),
  ]);
  const restored = await loadPurchase(c, principal, existing.id);
  return c.json({ success: true, data: purchaseResponse(restored!, await loadItems(c, existing.id)) });
});
