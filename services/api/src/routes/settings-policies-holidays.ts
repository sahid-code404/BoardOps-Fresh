import { Hono, type Context } from "hono";
import { authenticatedPrincipal, hasPermission, PERMISSIONS, type AuthPrincipal } from "../auth/authorization";
import { isDateString } from "../meals/engine";
import type { AppEnv } from "../types";

const SETTING_CATEGORIES = new Set([
  "INSTITUTION",
  "FEATURE_FLAG",
  "BILLING",
  "NOTIFICATIONS",
  "SECURITY",
  "UI",
  "GENERAL",
]);
const SETTING_TYPES = new Set(["TEXT", "NUMBER", "BOOLEAN", "JSON"]);
const POLICY_CATEGORIES = ["FINANCIAL", "MEAL", "BILLING", "PAYMENT", "NOTIFICATION", "AUTH"] as const;
const POLICY_LABELS: Record<(typeof POLICY_CATEGORIES)[number], string> = {
  FINANCIAL: "Financial Policies",
  MEAL: "Meal Policies",
  BILLING: "Billing Policies",
  PAYMENT: "Payment Policies",
  NOTIFICATION: "Notification Policies",
  AUTH: "Authentication Policies",
};
const INSTITUTION_TYPES = new Set([
  "HOSTEL",
  "PG",
  "COLLEGE",
  "COMPANY_ACCOMMODATION",
  "NGO",
  "TRAINING_INSTITUTE",
  "RESIDENTIAL_SCHOOL",
  "BOARDING_HOUSE",
  "UNIVERSITY",
]);
const HOLIDAY_TYPES = new Set([
  "HOLIDAY",
  "FESTIVAL",
  "SPECIAL_MEAL",
  "BILLING_DAY",
  "REFUND_DAY",
  "MAINTENANCE",
]);
const HOLIDAY_STATUSES = new Set(["ACTIVE", "ARCHIVED"]);
const SETTING_KEY_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{1,119}$/u;
const POLICY_KEY_RE = /^policy\.[A-Za-z0-9][A-Za-z0-9._-]{1,112}$/u;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/u;
const CURRENCY_RE = /^[A-Z]{3}$/u;

type SettingRow = {
  id: string;
  key: string;
  value: string;
  category: string;
  type: string;
  description: string | null;
  is_public: number;
};

type InstitutionRow = {
  id: string;
  name: string;
  type: string;
  address: string | null;
  contact_email: string | null;
  contact_phone: string | null;
  currency_code: string;
  timezone: string;
  logo_url: string | null;
};

type PolicyRow = {
  id: string;
  key: string;
  category: (typeof POLICY_CATEGORIES)[number];
  value: string;
  type: string;
  description: string;
};

type HolidayRow = {
  id: string;
  institution_id: string;
  name: string;
  description: string | null;
  type: string;
  start_date: string;
  end_date: string;
  meals_disabled: number;
  status: string;
  created_by: string | null;
  archived_by: string | null;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
};

type HolidayValues = {
  name: string;
  description: string | null;
  type: string;
  startDate: string;
  endDate: string;
  mealsDisabled: boolean;
};

export const settingsPoliciesHolidaysRoutes = new Hono<AppEnv>();

async function readBody(c: Context<AppEnv>): Promise<Record<string, unknown> | null> {
  try {
    const value: unknown = await c.req.json();
    return typeof value === "object" && value !== null ? value as Record<string, unknown> : {};
  } catch {
    return null;
  }
}

function stringValue(body: Record<string, unknown>, key: string): string | undefined {
  return typeof body[key] === "string" ? String(body[key]).trim() : undefined;
}

function nullableString(body: Record<string, unknown>, key: string): string | null | undefined {
  if (!(key in body)) return undefined;
  if (body[key] == null || body[key] === "") return null;
  return typeof body[key] === "string" ? String(body[key]).trim() || null : undefined;
}

function mappedSetting(row: SettingRow) {
  return {
    id: row.id,
    key: row.key,
    value: row.value,
    category: row.category,
    type: row.type,
    description: row.description,
    isPublic: row.is_public === 1,
  };
}

function mappedInstitution(row: InstitutionRow) {
  return {
    id: row.id,
    name: row.name,
    type: row.type,
    address: row.address,
    contactEmail: row.contact_email,
    contactPhone: row.contact_phone,
    currency: row.currency_code,
    timezone: row.timezone,
    logoUrl: row.logo_url,
  };
}

function mappedHoliday(row: HolidayRow) {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    type: row.type,
    startDate: row.start_date,
    endDate: row.end_date,
    mealsDisabled: row.meals_disabled === 1,
    status: row.status,
    createdBy: row.created_by,
    createdAt: row.created_at,
  };
}

async function writeAudit(
  c: Context<AppEnv>,
  principal: AuthPrincipal,
  action: string,
  entityType: string,
  entityId: string,
  metadata: Record<string, unknown>,
) {
  await c.env.DB.prepare(
    `INSERT INTO audit_events
      (id, institution_id, actor_user_id, action, entity_type, entity_id,
       request_id, reason, metadata_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)`,
  )
    .bind(
      crypto.randomUUID(),
      principal.institutionId,
      principal.id,
      action,
      entityType,
      entityId,
      c.get("requestId"),
      JSON.stringify(metadata),
      new Date().toISOString(),
    )
    .run();
}

function validateTypedValue(type: string, value: string): string | null {
  if (value.length > 20_000) return "Setting value is too long";
  if (type === "BOOLEAN" && value !== "true" && value !== "false") {
    return "Boolean settings must be true or false";
  }
  if (type === "NUMBER") {
    const parsed = Number(value);
    if (!value || !Number.isFinite(parsed)) return "Number settings must contain a finite number";
  }
  if (type === "JSON") {
    try {
      JSON.parse(value);
    } catch {
      return "JSON settings must contain valid JSON";
    }
  }
  return null;
}

async function settingByKey(c: Context<AppEnv>, principal: AuthPrincipal, key: string) {
  return c.env.DB.prepare(
    `SELECT id, key, value, category, type, description, is_public
       FROM settings WHERE institution_id = ? AND key = ? LIMIT 1`,
  ).bind(principal.institutionId, key).first<SettingRow>();
}

settingsPoliciesHolidaysRoutes.get("/settings", async (c) => {
  const principal = await authenticatedPrincipal(c);
  if (!principal) return c.json({ success: false, error: "Authentication required" }, 401);

  const canSeePrivate = hasPermission(principal, PERMISSIONS.SETTINGS_WRITE);
  const rows = await c.env.DB.prepare(
    `SELECT id, key, value, category, type, description, is_public
       FROM settings
      WHERE institution_id = ? AND (? = 1 OR is_public = 1)
      ORDER BY category, key`,
  ).bind(principal.institutionId, canSeePrivate ? 1 : 0).all<SettingRow>();

  return c.json({ success: true, data: rows.results.map(mappedSetting) });
});

// The golden Settings surface intentionally uses one upsert route for both create
// and edit. RBAC therefore treats this endpoint as one explicit settings.write action.
settingsPoliciesHolidaysRoutes.post("/settings", async (c) => {
  const principal = await authenticatedPrincipal(c);
  if (!principal) return c.json({ success: false, error: "Authentication required" }, 401);
  const body = await readBody(c);
  if (!body) return c.json({ success: false, error: "Invalid JSON body" }, 400);

  const key = stringValue(body, "key") ?? "";
  const value = typeof body.value === "string" ? body.value : "";
  const category = stringValue(body, "category") ?? "";
  const type = stringValue(body, "type") ?? "";
  const description = nullableString(body, "description");
  const isPublic = typeof body.isPublic === "boolean" ? body.isPublic : false;

  if (!SETTING_KEY_RE.test(key)) return c.json({ success: false, error: "Invalid setting key" }, 400);
  if (!SETTING_CATEGORIES.has(category)) return c.json({ success: false, error: "Invalid setting category" }, 400);
  if (!SETTING_TYPES.has(type)) return c.json({ success: false, error: "Invalid setting type" }, 400);
  if ((description?.length ?? 0) > 1000) return c.json({ success: false, error: "Setting description is too long" }, 400);
  const valueError = validateTypedValue(type, value);
  if (valueError) return c.json({ success: false, error: valueError }, 400);

  const existing = await settingByKey(c, principal, key);
  const id = existing?.id ?? crypto.randomUUID();
  const now = new Date().toISOString();
  await c.env.DB.prepare(
    `INSERT INTO settings
      (id, institution_id, key, value, category, type, description, is_public,
       created_by, updated_by, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(institution_id, key) DO UPDATE SET
       value = excluded.value,
       category = excluded.category,
       type = excluded.type,
       description = excluded.description,
       is_public = excluded.is_public,
       updated_by = excluded.updated_by,
       updated_at = excluded.updated_at`,
  ).bind(
    id,
    principal.institutionId,
    key,
    value,
    category,
    type,
    description ?? null,
    isPublic ? 1 : 0,
    principal.id,
    principal.id,
    now,
    now,
  ).run();

  const updated = await settingByKey(c, principal, key);
  if (!updated) return c.json({ success: false, error: "Setting could not be loaded after save" }, 500);
  await writeAudit(c, principal, existing ? "SETTING_UPDATED" : "SETTING_CREATED", "Setting", id, {
    before: existing ? mappedSetting(existing) : null,
    after: mappedSetting(updated),
  });
  return c.json({ success: true, data: mappedSetting(updated) }, existing ? 200 : 201);
});

settingsPoliciesHolidaysRoutes.delete("/settings/:key", async (c) => {
  const principal = await authenticatedPrincipal(c);
  if (!principal) return c.json({ success: false, error: "Authentication required" }, 401);
  const key = c.req.param("key").trim();
  const existing = await settingByKey(c, principal, key);
  if (!existing) return c.json({ success: false, error: "Setting not found" }, 404);

  await c.env.DB.prepare(`DELETE FROM settings WHERE id = ? AND institution_id = ?`)
    .bind(existing.id, principal.institutionId).run();
  await writeAudit(c, principal, "SETTING_DELETED", "Setting", existing.id, { before: mappedSetting(existing) });
  return c.json({ success: true, data: { deleted: true } });
});

async function institutionFor(c: Context<AppEnv>, institutionId: string) {
  return c.env.DB.prepare(
    `SELECT id, name, type, address, contact_email, contact_phone,
            currency_code, timezone, logo_url
       FROM institutions WHERE id = ? LIMIT 1`,
  ).bind(institutionId).first<InstitutionRow>();
}

settingsPoliciesHolidaysRoutes.get("/institution", async (c) => {
  const principal = await authenticatedPrincipal(c);
  if (!principal) return c.json({ success: false, error: "Authentication required" }, 401);
  const row = await institutionFor(c, principal.institutionId);
  if (!row) return c.json({ success: false, error: "Institution not found" }, 404);
  return c.json({ success: true, data: mappedInstitution(row) });
});

function isValidTimeZone(value: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value }).format(new Date());
    return true;
  } catch {
    return false;
  }
}

settingsPoliciesHolidaysRoutes.put("/institution", async (c) => {
  const principal = await authenticatedPrincipal(c);
  if (!principal) return c.json({ success: false, error: "Authentication required" }, 401);
  const existing = await institutionFor(c, principal.institutionId);
  if (!existing) return c.json({ success: false, error: "Institution not found" }, 404);
  const body = await readBody(c);
  if (!body) return c.json({ success: false, error: "Invalid JSON body" }, 400);

  const name = "name" in body ? stringValue(body, "name") : existing.name;
  const type = "type" in body ? stringValue(body, "type") : existing.type;
  const address = "address" in body ? nullableString(body, "address") : existing.address;
  const contactEmail = "contactEmail" in body ? nullableString(body, "contactEmail") : existing.contact_email;
  const contactPhone = "contactPhone" in body ? nullableString(body, "contactPhone") : existing.contact_phone;
  const currency = "currency" in body ? (stringValue(body, "currency") ?? "").toUpperCase() : existing.currency_code;
  const timezone = "timezone" in body ? stringValue(body, "timezone") : existing.timezone;
  const logoUrl = "logoUrl" in body ? nullableString(body, "logoUrl") : existing.logo_url;

  if (!name || name.length < 2 || name.length > 120) return c.json({ success: false, error: "Institution name must be 2–120 characters" }, 400);
  if (!type || !INSTITUTION_TYPES.has(type)) return c.json({ success: false, error: "Invalid institution type" }, 400);
  if ((address?.length ?? 0) > 500) return c.json({ success: false, error: "Institution address is too long" }, 400);
  if (contactEmail && (contactEmail.length > 254 || !EMAIL_RE.test(contactEmail))) return c.json({ success: false, error: "Invalid contact email" }, 400);
  if ((contactPhone?.length ?? 0) > 32) return c.json({ success: false, error: "Contact phone is too long" }, 400);
  if (!CURRENCY_RE.test(currency)) return c.json({ success: false, error: "Currency must be a three-letter code" }, 400);
  if (!timezone || timezone.length > 64 || !isValidTimeZone(timezone)) return c.json({ success: false, error: "Invalid IANA timezone" }, 400);
  if (logoUrl && logoUrl.length > 2048) return c.json({ success: false, error: "Logo URL is too long" }, 400);
  if (logoUrl) {
    try {
      const parsed = new URL(logoUrl);
      if (parsed.protocol !== "https:" && parsed.protocol !== "http:") throw new Error("unsupported protocol");
    } catch {
      return c.json({ success: false, error: "Logo URL must be an http(s) URL" }, 400);
    }
  }

  if (currency !== existing.currency_code) {
    const history = await c.env.DB.prepare(
      `SELECT
         (SELECT COUNT(*) FROM bills WHERE institution_id = ?) +
         (SELECT COUNT(*) FROM payments WHERE institution_id = ?) +
         (SELECT COUNT(*) FROM expenses WHERE institution_id = ?) +
         (SELECT COUNT(*) FROM refunds WHERE institution_id = ?) +
         (SELECT COUNT(*) FROM adjustments WHERE institution_id = ?) AS evidence_count`,
    ).bind(
      principal.institutionId,
      principal.institutionId,
      principal.institutionId,
      principal.institutionId,
      principal.institutionId,
    ).first<{ evidence_count: number }>();
    if (Number(history?.evidence_count ?? 0) > 0) {
      return c.json({
        success: false,
        error: "Currency cannot be changed after financial history exists",
      }, 409);
    }
  }

  const now = new Date().toISOString();
  await c.env.DB.prepare(
    `UPDATE institutions
        SET name = ?, type = ?, address = ?, contact_email = ?, contact_phone = ?,
            currency_code = ?, timezone = ?, logo_url = ?, updated_at = ?
      WHERE id = ?`,
  ).bind(
    name,
    type,
    address ?? null,
    contactEmail ?? null,
    contactPhone ?? null,
    currency,
    timezone,
    logoUrl ?? null,
    now,
    principal.institutionId,
  ).run();

  const updated = await institutionFor(c, principal.institutionId);
  if (!updated) return c.json({ success: false, error: "Institution could not be loaded after update" }, 500);
  await writeAudit(c, principal, "INSTITUTION_UPDATED", "Institution", principal.institutionId, {
    before: mappedInstitution(existing),
    after: mappedInstitution(updated),
  });
  return c.json({ success: true, data: mappedInstitution(updated) });
});

settingsPoliciesHolidaysRoutes.get("/policies", async (c) => {
  const principal = await authenticatedPrincipal(c);
  if (!principal) return c.json({ success: false, error: "Authentication required" }, 401);
  const rows = await c.env.DB.prepare(
    `SELECT id, key, category, value, type, description
       FROM policies
      WHERE institution_id = ?
      ORDER BY CASE category
        WHEN 'FINANCIAL' THEN 1 WHEN 'MEAL' THEN 2 WHEN 'BILLING' THEN 3
        WHEN 'PAYMENT' THEN 4 WHEN 'NOTIFICATION' THEN 5 ELSE 6 END, key`,
  ).bind(principal.institutionId).all<PolicyRow>();

  const grouped = POLICY_CATEGORIES
    .map((category) => ({
      category,
      label: POLICY_LABELS[category],
      policies: rows.results
        .filter((row) => row.category === category)
        .map((row) => ({
          key: row.key,
          value: row.value,
          type: row.type,
          description: row.description,
        })),
    }))
    .filter((group) => group.policies.length > 0);

  return c.json({ success: true, data: { categories: grouped } });
});

settingsPoliciesHolidaysRoutes.put("/policies", async (c) => {
  const principal = await authenticatedPrincipal(c);
  if (!principal) return c.json({ success: false, error: "Authentication required" }, 401);
  const body = await readBody(c);
  if (!body) return c.json({ success: false, error: "Invalid JSON body" }, 400);
  const key = stringValue(body, "key") ?? "";
  const value = typeof body.value === "string" ? body.value : "";
  if (!POLICY_KEY_RE.test(key)) return c.json({ success: false, error: "Invalid policy key" }, 400);

  const existing = await c.env.DB.prepare(
    `SELECT id, key, category, value, type, description
       FROM policies WHERE institution_id = ? AND key = ? LIMIT 1`,
  ).bind(principal.institutionId, key).first<PolicyRow>();
  if (!existing) return c.json({ success: false, error: "Policy not found" }, 404);
  const valueError = validateTypedValue(existing.type, value);
  if (valueError) return c.json({ success: false, error: valueError.replace("Setting", "Policy").replace("settings", "policies") }, 400);
  if (value.length > 2000) return c.json({ success: false, error: "Policy value is too long" }, 400);

  const now = new Date().toISOString();
  await c.env.DB.prepare(
    `UPDATE policies SET value = ?, updated_by = ?, updated_at = ?
      WHERE id = ? AND institution_id = ?`,
  ).bind(value, principal.id, now, existing.id, principal.institutionId).run();
  await writeAudit(c, principal, "POLICY_UPDATED", "Policy", existing.id, {
    key,
    before: existing.value,
    after: value,
  });
  return c.json({
    success: true,
    data: { key, value, type: existing.type, description: existing.description },
  });
});

async function holidayById(c: Context<AppEnv>, principal: AuthPrincipal, id: string) {
  return c.env.DB.prepare(
    `SELECT id, institution_id, name, description, type, start_date, end_date,
            meals_disabled, status, created_by, archived_by, archived_at, created_at, updated_at
       FROM holidays WHERE id = ? AND institution_id = ? LIMIT 1`,
  ).bind(id, principal.institutionId).first<HolidayRow>();
}

function validateHoliday(
  body: Record<string, unknown>,
  existing?: HolidayRow,
): { values?: HolidayValues; error?: string } {
  const name = "name" in body ? stringValue(body, "name") : existing?.name;
  const description = "description" in body ? nullableString(body, "description") : existing?.description ?? null;
  const type = "type" in body ? stringValue(body, "type") : existing?.type;
  const startDate = "startDate" in body ? stringValue(body, "startDate") : existing?.start_date;
  const endDate = "endDate" in body ? stringValue(body, "endDate") : existing?.end_date;
  const mealsDisabled = "mealsDisabled" in body
    ? (typeof body.mealsDisabled === "boolean" ? body.mealsDisabled : undefined)
    : existing?.meals_disabled === 1;

  if (!name || name.length < 2 || name.length > 120) return { error: "Holiday name must be 2–120 characters" };
  if ((description?.length ?? 0) > 1000) return { error: "Holiday description is too long" };
  if (!type || !HOLIDAY_TYPES.has(type)) return { error: "Invalid holiday type" };
  if (!startDate || !endDate || !isDateString(startDate) || !isDateString(endDate)) return { error: "Holiday dates must use valid YYYY-MM-DD values" };
  if (endDate < startDate) return { error: "Holiday end date cannot be before its start date" };
  if (mealsDisabled === undefined) return { error: "mealsDisabled must be a boolean" };
  return { values: { name, description: description ?? null, type, startDate, endDate, mealsDisabled } };
}

settingsPoliciesHolidaysRoutes.get("/holidays", async (c) => {
  const principal = await authenticatedPrincipal(c);
  if (!principal) return c.json({ success: false, error: "Authentication required" }, 401);
  const status = (c.req.query("status") ?? "ACTIVE").toUpperCase();
  if (!HOLIDAY_STATUSES.has(status)) return c.json({ success: false, error: "Invalid holiday status" }, 400);

  const rows = await c.env.DB.prepare(
    `SELECT id, institution_id, name, description, type, start_date, end_date,
            meals_disabled, status, created_by, archived_by, archived_at, created_at, updated_at
       FROM holidays
      WHERE institution_id = ? AND status = ?
      ORDER BY start_date ASC, created_at ASC`,
  ).bind(principal.institutionId, status).all<HolidayRow>();
  return c.json({ success: true, data: rows.results.map(mappedHoliday) });
});

settingsPoliciesHolidaysRoutes.post("/holidays", async (c) => {
  const principal = await authenticatedPrincipal(c);
  if (!principal) return c.json({ success: false, error: "Authentication required" }, 401);
  const body = await readBody(c);
  if (!body) return c.json({ success: false, error: "Invalid JSON body" }, 400);
  const parsed = validateHoliday(body);
  if (!parsed.values) return c.json({ success: false, error: parsed.error ?? "Invalid holiday" }, 400);
  const value = parsed.values;
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  await c.env.DB.prepare(
    `INSERT INTO holidays
      (id, institution_id, name, description, type, start_date, end_date,
       meals_disabled, status, created_by, archived_by, archived_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'ACTIVE', ?, NULL, NULL, ?, ?)`,
  ).bind(
    id,
    principal.institutionId,
    value.name,
    value.description,
    value.type,
    value.startDate,
    value.endDate,
    value.mealsDisabled ? 1 : 0,
    principal.id,
    now,
    now,
  ).run();

  const created = await holidayById(c, principal, id);
  if (!created) return c.json({ success: false, error: "Holiday could not be loaded after creation" }, 500);
  await writeAudit(c, principal, "HOLIDAY_CREATED", "Holiday", id, { after: mappedHoliday(created) });
  return c.json({ success: true, data: mappedHoliday(created) }, 201);
});

settingsPoliciesHolidaysRoutes.patch("/holidays/:id", async (c) => {
  const principal = await authenticatedPrincipal(c);
  if (!principal) return c.json({ success: false, error: "Authentication required" }, 401);
  const id = c.req.param("id");
  const existing = await holidayById(c, principal, id);
  if (!existing) return c.json({ success: false, error: "Holiday not found" }, 404);
  const body = await readBody(c);
  if (!body) return c.json({ success: false, error: "Invalid JSON body" }, 400);
  const parsed = validateHoliday(body, existing);
  if (!parsed.values) return c.json({ success: false, error: parsed.error ?? "Invalid holiday" }, 400);
  const value = parsed.values;
  const now = new Date().toISOString();

  await c.env.DB.prepare(
    `UPDATE holidays
        SET name = ?, description = ?, type = ?, start_date = ?, end_date = ?,
            meals_disabled = ?, updated_at = ?
      WHERE id = ? AND institution_id = ?`,
  ).bind(
    value.name,
    value.description,
    value.type,
    value.startDate,
    value.endDate,
    value.mealsDisabled ? 1 : 0,
    now,
    id,
    principal.institutionId,
  ).run();
  const updated = await holidayById(c, principal, id);
  if (!updated) return c.json({ success: false, error: "Holiday could not be loaded after update" }, 500);
  await writeAudit(c, principal, "HOLIDAY_UPDATED", "Holiday", id, {
    before: mappedHoliday(existing),
    after: mappedHoliday(updated),
  });
  return c.json({ success: true, data: mappedHoliday(updated) });
});

settingsPoliciesHolidaysRoutes.delete("/holidays/:id", async (c) => {
  const principal = await authenticatedPrincipal(c);
  if (!principal) return c.json({ success: false, error: "Authentication required" }, 401);
  const id = c.req.param("id");
  const existing = await holidayById(c, principal, id);
  if (!existing) return c.json({ success: false, error: "Holiday not found" }, 404);
  if (existing.status === "ARCHIVED") return c.json({ success: true, data: mappedHoliday(existing) });

  const now = new Date().toISOString();
  await c.env.DB.prepare(
    `UPDATE holidays
        SET status = 'ARCHIVED', archived_by = ?, archived_at = ?, updated_at = ?
      WHERE id = ? AND institution_id = ?`,
  ).bind(principal.id, now, now, id, principal.institutionId).run();
  const archived = await holidayById(c, principal, id);
  if (!archived) return c.json({ success: false, error: "Holiday could not be loaded after archive" }, 500);
  await writeAudit(c, principal, "HOLIDAY_ARCHIVED", "Holiday", id, { before: mappedHoliday(existing), after: mappedHoliday(archived) });
  return c.json({ success: true, data: mappedHoliday(archived) });
});
