import { Hono, type Context } from "hono";
import { authenticatedPrincipal, type AuthPrincipal } from "../auth/authorization";
import { evaluateFormula } from "../domain/formula-engine";
import type { AppEnv } from "../types";

type CycleStatus =
  | "OPEN"
  | "PREPARING"
  | "SNAPSHOT_CREATED"
  | "BILLS_GENERATED"
  | "SETTLED"
  | "CLOSED"
  | "FAILED";

type CycleRow = {
  id: string;
  institution_id: string;
  period_month: number;
  period_year: number;
  status: CycleStatus;
  attempt_count: number;
  draft_snapshot_json: string | null;
  published_snapshot_id: string | null;
  total_expenses_minor: number;
  total_resident_meals: number;
  total_guest_meals: number;
  guest_revenue_minor: number;
  meal_charge_minor: number;
  bills_generated: number;
  refund_queue_total_minor: number;
  outstanding_due_minor: number;
  due_date: string | null;
  started_by: string | null;
  started_at: string | null;
  closed_by: string | null;
  closed_at: string | null;
  error_message: string | null;
  created_at: string;
  updated_at: string;
};

type FormulaRow = {
  id: string;
  key: string;
  name: string;
  expression: string;
  return_type: string;
  version: number;
  version_id: string;
  referenced_variables_json: string;
  referenced_context_json: string;
};

type VariableRow = {
  id: string;
  key: string;
  name: string;
  variable_type: string;
  value_text: string;
  unit: string | null;
  version: number;
  version_id: string;
};

type ResidentRow = {
  id: string;
  name: string;
  email: string;
  room: string | null;
};

type MealRow = {
  id: string;
  name: string;
  display_name: string;
  pricing_mode: "FORMULA" | "FIXED";
  fixed_price_minor: number | null;
};

type MealCountRow = {
  user_id: string;
  meal_id: string;
  count: number;
};

type GuestCountRow = {
  meal_id: string;
  count: number;
};

type ReadinessItem = {
  key: string;
  label: string;
  status: "ready" | "warning" | "error";
  detail: string;
  count?: number;
  amount?: number;
};

type FrozenFormula = {
  id: string;
  versionId: string;
  key: string;
  name: string;
  version: number;
  expression: string;
  returnType: string;
};

type FrozenVariable = {
  id: string;
  versionId: string;
  key: string;
  name: string;
  version: number;
  type: string;
  value: string;
  unit: string | null;
};

type DraftResidentLine = {
  userId: string;
  name: string;
  room: string | null;
  mealCounts: Record<string, number>;
  mealCount: number;
  mealChargesMinor: number;
  otherChargesMinor: number;
  adjustmentsMinor: number;
  totalAmountMinor: number;
};

type ClosingDraft = {
  version: 2;
  currency: "INR";
  period: { month: number; year: number; startsOn: string; endsOn: string };
  frozenAt: string;
  formulas: {
    mealCharges: FrozenFormula;
    totalBill: FrozenFormula;
  };
  variables: FrozenVariable[];
  mealPricing: Array<{
    mealId: string;
    name: string;
    displayName: string;
    pricingMode: "FORMULA" | "FIXED";
    fixedPriceMinor: number | null;
  }>;
  inputs: {
    totalExpensesMinor: number;
    totalResidentMeals: number;
    totalGuestMeals: number;
    guestRevenueMinor: number;
    totalMealChargesMinor: number;
  };
  residents: DraftResidentLine[];
  guestMeals: Array<{ mealId: string; mealName: string; count: number; revenueMinor: number }>;
};

type ReadinessData = {
  month: number;
  year: number;
  periodLabel: string;
  items: ReadinessItem[];
  canClose: boolean;
  existingCycle: { id: string; status: string } | null;
};

type ReadinessInternal = {
  response: ReadinessData;
  periodId: string | null;
  startsOn: string;
  endsOn: string;
  formulas: { mealCharges: FormulaRow; totalBill: FormulaRow } | null;
  variables: VariableRow[];
  residents: ResidentRow[];
  meals: MealRow[];
};

export const monthlyClosingRoutes = new Hono<AppEnv>();

async function principalFor(c: Context<AppEnv>): Promise<AuthPrincipal | Response> {
  const principal = await authenticatedPrincipal(c);
  return principal ?? c.json({ success: false, error: "Authentication required" }, 401);
}

function isValidPeriod(month: number, year: number): boolean {
  return Number.isInteger(month) && month >= 0 && month <= 11 && Number.isInteger(year) && year >= 2000 && year <= 9999;
}

function parsePeriodInput(value: Record<string, unknown>): { month: number; year: number } | null {
  const month = Number(value.month);
  const year = Number(value.year);
  return isValidPeriod(month, year) ? { month, year } : null;
}

function periodLabel(month: number, year: number): string {
  return new Date(Date.UTC(year, month, 1)).toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

function periodBounds(month: number, year: number): { startsOn: string; endsOn: string; key: string } {
  const startsOn = `${year}-${String(month + 1).padStart(2, "0")}-01`;
  const end = new Date(Date.UTC(year, month + 1, 0));
  const endsOn = end.toISOString().slice(0, 10);
  return { startsOn, endsOn, key: startsOn.slice(0, 7) };
}

async function institutionTimezone(c: Context<AppEnv>, institutionId: string): Promise<string> {
  const row = await c.env.DB.prepare("SELECT timezone FROM institutions WHERE id = ? LIMIT 1")
    .bind(institutionId)
    .first<{ timezone: string }>();
  return row?.timezone || "UTC";
}

function currentPeriodInTimeZone(timeZone: string, now = new Date()): { month: number; year: number } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
  }).formatToParts(now);
  const year = Number(parts.find((part) => part.type === "year")?.value ?? now.getUTCFullYear());
  const month = Number(parts.find((part) => part.type === "month")?.value ?? now.getUTCMonth() + 1) - 1;
  return { month, year };
}

function parseJsonStringArray(value: string): string[] | null {
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) && parsed.every((item) => typeof item === "string") ? parsed : null;
  } catch {
    return null;
  }
}

function exactMajorToMinor(valueExact: string): number | null {
  const match = /^([+-])?(\d+)(?:\.(\d+))?$/u.exec(valueExact.trim());
  if (!match || !match[2]) return null;
  const negative = match[1] === "-";
  const whole = BigInt(match[2]);
  const fraction = (match[3] ?? "").padEnd(3, "0");
  const cents = BigInt(fraction.slice(0, 2) || "0");
  const roundDigit = Number(fraction.charAt(2) || "0");
  let minor = whole * 100n + cents;
  if (roundDigit >= 5) minor += 1n;
  if (negative) minor = -minor;
  if (minor > BigInt(Number.MAX_SAFE_INTEGER) || minor < BigInt(Number.MIN_SAFE_INTEGER)) return null;
  return Number(minor);
}

function minorToMajor(value: number): number {
  return Number(value || 0) / 100;
}

function minorToExactMajor(value: number): string {
  const sign = value < 0 ? "-" : "";
  const absolute = Math.abs(value);
  return `${sign}${Math.floor(absolute / 100)}.${String(absolute % 100).padStart(2, "0")}`;
}

function defaultDueDate(month: number, year: number): string {
  return new Date(Date.UTC(year, month + 1, 10, 0, 0, 0, 0)).toISOString();
}

function parseDueDate(value: unknown, month: number, year: number): string | null {
  if (value === undefined || value === null || value === "") return defaultDueDate(month, year);
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/u.test(value)) return null;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) return null;
  const firstAllowed = `${year}-${String(month + 2).padStart(2, "0")}-01`;
  // December rolls into January of the next year.
  const actualFirstAllowed = new Date(Date.UTC(year, month + 1, 1)).toISOString().slice(0, 10);
  if (value < actualFirstAllowed) return null;
  void firstAllowed;
  return parsed.toISOString();
}

function cycleResponse(row: CycleRow) {
  return {
    id: row.id,
    periodMonth: row.period_month,
    periodYear: row.period_year,
    status: row.status,
    totalExpenses: minorToMajor(row.total_expenses_minor),
    totalMeals: row.total_resident_meals,
    totalGuestMeals: row.total_guest_meals,
    mealCharge: minorToMajor(row.meal_charge_minor),
    billsGenerated: row.bills_generated,
    refundQueueTotal: minorToMajor(row.refund_queue_total_minor),
    outstandingDue: minorToMajor(row.outstanding_due_minor),
    closedBy: row.closed_by,
    closedAt: row.closed_at,
    startedAt: row.started_at,
    errorMessage: row.error_message,
    createdAt: row.created_at,
  };
}

function closingResult(row: CycleRow, success: boolean, error?: string) {
  return {
    success,
    cycleId: row.id,
    status: row.status,
    summary: {
      totalExpenses: minorToMajor(row.total_expenses_minor),
      totalResidentMeals: row.total_resident_meals,
      totalGuestMeals: row.total_guest_meals,
      guestRevenue: minorToMajor(row.guest_revenue_minor),
      mealCharge: minorToMajor(row.meal_charge_minor),
      billsGenerated: row.bills_generated,
      refundQueueTotal: minorToMajor(row.refund_queue_total_minor),
      outstandingDue: minorToMajor(row.outstanding_due_minor),
    },
    ...(error ? { error } : {}),
  };
}

async function loadCycle(c: Context<AppEnv>, institutionId: string, month: number, year: number): Promise<CycleRow | null> {
  return c.env.DB.prepare(
    `SELECT * FROM billing_cycles
      WHERE institution_id = ? AND period_month = ? AND period_year = ?
      LIMIT 1`,
  )
    .bind(institutionId, month, year)
    .first<CycleRow>();
}

async function loadFormula(c: Context<AppEnv>, institutionId: string, key: string): Promise<FormulaRow | null> {
  return c.env.DB.prepare(
    `SELECT f.id, f.key, f.name, f.expression, f.return_type, f.version,
            fv.id AS version_id, fv.referenced_variables_json, fv.referenced_context_json
       FROM formulas f
       JOIN formula_versions fv
         ON fv.formula_id = f.id AND fv.version = f.version AND fv.institution_id = f.institution_id
      WHERE f.institution_id = ? AND f.key = ? AND f.status = 'ACTIVE'
      LIMIT 1`,
  )
    .bind(institutionId, key)
    .first<FormulaRow>();
}

async function loadVariables(
  c: Context<AppEnv>,
  institutionId: string,
  keys: string[],
): Promise<VariableRow[]> {
  const unique = [...new Set(keys)].sort();
  if (unique.length === 0) return [];
  const placeholders = unique.map(() => "?").join(", ");
  const result = await c.env.DB.prepare(
    `SELECT v.id, v.key, v.name, v.variable_type, v.value_text, v.unit, v.version,
            vv.id AS version_id
       FROM variables v
       JOIN variable_versions vv
         ON vv.variable_id = v.id AND vv.version = v.version AND vv.institution_id = v.institution_id
      WHERE v.institution_id = ? AND v.status = 'ACTIVE' AND v.key IN (${placeholders})
      ORDER BY v.key`,
  )
    .bind(institutionId, ...unique)
    .all<VariableRow>();
  return result.results;
}

async function computeReadiness(
  c: Context<AppEnv>,
  principal: AuthPrincipal,
  month: number,
  year: number,
): Promise<ReadinessInternal> {
  const label = periodLabel(month, year);
  const bounds = periodBounds(month, year);
  const items: ReadinessItem[] = [];
  const timeZone = await institutionTimezone(c, principal.institutionId);
  const current = currentPeriodInTimeZone(timeZone);
  const selectedKey = year * 12 + month;
  const currentKey = current.year * 12 + current.month;

  if (selectedKey >= currentKey) {
    items.push({
      key: "period",
      label: "Billing Period",
      status: "error",
      detail: `${label} is not a completed past month. Closing is blocked.`,
    });
  } else {
    items.push({ key: "period", label: "Billing Period", status: "ready", detail: `${label} is complete.` });
  }

  const accountingPeriod = await c.env.DB.prepare(
    `SELECT id, status FROM accounting_periods
      WHERE institution_id = ? AND period_key = ? LIMIT 1`,
  )
    .bind(principal.institutionId, bounds.key)
    .first<{ id: string; status: string }>();
  const existingCycle = await loadCycle(c, principal.institutionId, month, year);

  if (!accountingPeriod) {
    items.push({
      key: "cycle",
      label: "Accounting Period",
      status: "error",
      detail: `${label} has no canonical accounting period.`,
    });
  } else if (accountingPeriod.status === "CLOSED") {
    items.push({
      key: "cycle",
      label: "Accounting Period",
      status: "error",
      detail: `${label} is already CLOSED. Corrections must use adjustments.`,
    });
  } else if (accountingPeriod.status === "CLOSING" && !existingCycle) {
    items.push({
      key: "cycle",
      label: "Accounting Period",
      status: "error",
      detail: `${label} is CLOSING without a canonical billing-cycle owner.`,
    });
  } else {
    items.push({
      key: "cycle",
      label: "Accounting Period",
      status: "ready",
      detail: accountingPeriod.status === "CLOSING"
        ? `${label} is locked for this resumable closing workflow.`
        : `${label} is OPEN and can enter closing.`,
    });
  }

  const publishedSnapshot = await c.env.DB.prepare(
    `SELECT id FROM billing_snapshots
      WHERE institution_id = ? AND period_month = ? AND period_year = ? LIMIT 1`,
  )
    .bind(principal.institutionId, month, year)
    .first<{ id: string }>();
  if (publishedSnapshot && existingCycle?.published_snapshot_id !== publishedSnapshot.id && existingCycle?.status !== "CLOSED") {
    items.push({
      key: "snapshot",
      label: "Published Snapshot",
      status: "error",
      detail: "An immutable snapshot already exists outside this closing workflow; automatic repricing is forbidden.",
    });
  } else {
    items.push({
      key: "snapshot",
      label: "Published Snapshot",
      status: "ready",
      detail: publishedSnapshot
        ? "The workflow already owns the immutable published snapshot and may resume."
        : "No immutable snapshot has been published yet; a rollbackable draft can be prepared.",
    });
  }

  const residentsResult = await c.env.DB.prepare(
    `SELECT id, name, email, room
       FROM users
      WHERE institution_id = ? AND role = 'USER' AND status = 'ACTIVE' AND deleted_at IS NULL
      ORDER BY id`,
  )
    .bind(principal.institutionId)
    .all<ResidentRow>();
  const residents = residentsResult.results;
  items.push({
    key: "residents",
    label: "Active Residents",
    status: residents.length > 0 ? "ready" : "error",
    detail: residents.length > 0 ? `${residents.length} active resident(s) will be frozen.` : "No active residents are available to bill.",
    count: residents.length,
  });

  const mealsResult = await c.env.DB.prepare(
    `SELECT id, lower(name) AS name, display_name, pricing_mode, fixed_price_minor
       FROM meal_configurations
      WHERE institution_id = ? AND status = 'ACTIVE' AND deletion_finalized_at IS NULL
      ORDER BY display_order, id`,
  )
    .bind(principal.institutionId)
    .all<MealRow>();
  const meals = mealsResult.results;
  const ambiguous = await c.env.DB.prepare(
    `SELECT COUNT(*) AS count
       FROM meal_entries
      WHERE institution_id = ? AND service_date BETWEEN ? AND ? AND status = 'LOCKED'`,
  )
    .bind(principal.institutionId, bounds.startsOn, bounds.endsOn)
    .first<{ count: number }>();
  if (Number(ambiguous?.count ?? 0) > 0) {
    items.push({
      key: "meals",
      label: "Meal Records",
      status: "error",
      detail: `${Number(ambiguous?.count ?? 0)} legacy LOCKED meal row(s) have ambiguous ON/OFF state. Normalize them before closing.`,
      count: Number(ambiguous?.count ?? 0),
    });
  } else if (meals.length === 0) {
    items.push({ key: "meals", label: "Meal Records", status: "error", detail: "No active meal configuration exists." });
  } else {
    const mealCount = await c.env.DB.prepare(
      `SELECT COUNT(*) AS count
         FROM meal_entries
        WHERE institution_id = ? AND service_date BETWEEN ? AND ? AND status = 'ON'`,
    )
      .bind(principal.institutionId, bounds.startsOn, bounds.endsOn)
      .first<{ count: number }>();
    items.push({
      key: "meals",
      label: "Meal Records",
      status: "ready",
      detail: `${Number(mealCount?.count ?? 0)} confirmed resident meal(s) are available across ${meals.length} active meal type(s).`,
      count: Number(mealCount?.count ?? 0),
    });
  }

  const expense = await c.env.DB.prepare(
    `SELECT COUNT(*) AS count, COALESCE(SUM(amount_minor), 0) AS total
       FROM expenses
      WHERE institution_id = ? AND status = 'APPROVED'
        AND deleted_on IS NULL AND expense_date BETWEEN ? AND ?`,
  )
    .bind(principal.institutionId, bounds.startsOn, bounds.endsOn)
    .first<{ count: number; total: number }>();
  items.push({
    key: "expenses",
    label: "Approved Expenses",
    status: "ready",
    detail: `${Number(expense?.count ?? 0)} approved expense(s) totaling INR ${minorToMajor(Number(expense?.total ?? 0)).toFixed(2)} will be frozen.`,
    count: Number(expense?.count ?? 0),
    amount: minorToMajor(Number(expense?.total ?? 0)),
  });

  const pendingPayments = await c.env.DB.prepare(
    `SELECT COUNT(*) AS count
       FROM payments p
      WHERE p.institution_id = ? AND p.status = 'PENDING'
        AND p.deleted_on IS NULL
        AND (
          (p.effective_month = ? AND p.effective_year = ?)
          OR p.bill_id IN (
            SELECT b.id FROM bills b
             WHERE b.institution_id = p.institution_id AND b.period_month = ? AND b.period_year = ?
          )
        )`,
  )
    .bind(principal.institutionId, month, year, month, year)
    .first<{ count: number }>();
  const pendingCount = Number(pendingPayments?.count ?? 0);
  items.push({
    key: "payments",
    label: "Pending Payments",
    status: pendingCount === 0 ? "ready" : "error",
    detail: pendingCount === 0
      ? "No unresolved payment is assigned to this billing period."
      : `${pendingCount} pending payment(s) must be approved or rejected before closing.`,
    count: pendingCount,
  });

  const mealFormula = await loadFormula(c, principal.institutionId, "formula.mealCharges");
  const totalFormula = await loadFormula(c, principal.institutionId, "formula.totalBill");
  let formulas: ReadinessInternal["formulas"] = null;
  let variables: VariableRow[] = [];

  if (!mealFormula || !totalFormula) {
    const missing = [!mealFormula ? "formula.mealCharges" : null, !totalFormula ? "formula.totalBill" : null].filter(Boolean).join(", ");
    items.push({
      key: "formula",
      label: "Canonical Formulas",
      status: "error",
      detail: `Missing or inactive canonical formula: ${missing}. Closing is blocked with no fallback.`,
    });
  } else {
    const mealVars = parseJsonStringArray(mealFormula.referenced_variables_json);
    const mealContext = parseJsonStringArray(mealFormula.referenced_context_json);
    const totalVars = parseJsonStringArray(totalFormula.referenced_variables_json);
    const totalContext = parseJsonStringArray(totalFormula.referenced_context_json);
    const allowedTotalContext = new Set(["meal_charges", "adjustments"]);
    const invalidMealContext = mealContext?.filter((key) => !key.endsWith("_count")) ?? ["invalid"];
    const mealNames = new Set(meals.map((meal) => meal.name));
    const missingMealContexts = (mealContext ?? []).filter((key) => !mealNames.has(key.slice(0, -"_count".length).toLowerCase()));
    const unsupportedTotal = (totalContext ?? []).filter((key) => !allowedTotalContext.has(key));

    if (!mealVars || !mealContext || !totalVars || !totalContext || invalidMealContext.length > 0 || missingMealContexts.length > 0 || unsupportedTotal.length > 0) {
      items.push({
        key: "formula",
        label: "Canonical Formulas",
        status: "error",
        detail: "Canonical formula dependency metadata cannot be resolved by Monthly Closing.",
      });
    } else {
      const requiredVariableKeys = [...new Set([...mealVars, ...totalVars])];
      variables = await loadVariables(c, principal.institutionId, requiredVariableKeys);
      const found = new Set(variables.map((variable) => variable.key));
      const missingVariables = requiredVariableKeys.filter((key) => !found.has(key));
      const numericVariables = Object.fromEntries(
        variables
          .filter((variable) => ["NUMBER", "CURRENCY", "PERCENTAGE"].includes(variable.variable_type))
          .map((variable) => [variable.key, variable.value_text]),
      );
      const sampleMealContext = Object.fromEntries(mealContext.map((key) => [key, "0"]));
      const mealProbe = evaluateFormula(mealFormula.expression, {
        variables: numericVariables,
        context: sampleMealContext,
        strictMissing: true,
      });
      const totalProbe = evaluateFormula(totalFormula.expression, {
        variables: numericVariables,
        context: { meal_charges: "0", adjustments: "0" },
        strictMissing: true,
      });
      if (
        missingVariables.length > 0
        || !mealProbe.valid
        || mealProbe.missingVariables.length > 0
        || mealProbe.missingContext.length > 0
        || !totalProbe.valid
        || totalProbe.missingVariables.length > 0
        || totalProbe.missingContext.length > 0
      ) {
        items.push({
          key: "formula",
          label: "Canonical Formulas",
          status: "error",
          detail: missingVariables.length > 0
            ? `Missing/archived Variable dependency: ${missingVariables.join(", ")}.`
            : `Canonical formula validation failed: ${mealProbe.error ?? totalProbe.error ?? "unresolved dependency"}.`,
        });
      } else {
        formulas = { mealCharges: mealFormula, totalBill: totalFormula };
        items.push({
          key: "formula",
          label: "Canonical Formulas",
          status: "ready",
          detail: `formula.mealCharges v${mealFormula.version} and formula.totalBill v${totalFormula.version} are valid and dependency-complete.`,
        });
        items.push({
          key: "variables",
          label: "Formula Variables",
          status: "ready",
          detail: `${variables.length} exact active Variable version(s) will be frozen with the snapshot.`,
          count: variables.length,
        });
      }
    }
  }

  return {
    response: {
      month,
      year,
      periodLabel: label,
      items,
      canClose: items.every((item) => item.status === "ready"),
      existingCycle: existingCycle ? { id: existingCycle.id, status: existingCycle.status } : null,
    },
    periodId: accountingPeriod?.id ?? null,
    startsOn: bounds.startsOn,
    endsOn: bounds.endsOn,
    formulas,
    variables,
    residents,
    meals,
  };
}

async function createDraft(
  c: Context<AppEnv>,
  principal: AuthPrincipal,
  month: number,
  year: number,
  readiness: ReadinessInternal,
): Promise<ClosingDraft> {
  if (!readiness.formulas) throw new Error("Canonical formulas are unavailable");
  const mealFormula = readiness.formulas.mealCharges;
  const totalFormula = readiness.formulas.totalBill;
  const mealContextKeys = parseJsonStringArray(mealFormula.referenced_context_json);
  if (!mealContextKeys) throw new Error("Meal formula context metadata is invalid");

  const numericVariables = Object.fromEntries(
    readiness.variables
      .filter((variable) => ["NUMBER", "CURRENCY", "PERCENTAGE"].includes(variable.variable_type))
      .map((variable) => [variable.key, variable.value_text]),
  );

  const mealCountsResult = await c.env.DB.prepare(
    `SELECT e.user_id, e.meal_id, COUNT(*) AS count
       FROM meal_entries e
       JOIN users u ON u.id = e.user_id
      WHERE e.institution_id = ?
        AND e.service_date BETWEEN ? AND ?
        AND e.status = 'ON'
        AND u.institution_id = e.institution_id
        AND u.role = 'USER' AND u.status = 'ACTIVE' AND u.deleted_at IS NULL
      GROUP BY e.user_id, e.meal_id`,
  )
    .bind(principal.institutionId, readiness.startsOn, readiness.endsOn)
    .all<MealCountRow>();

  const mealById = new Map(readiness.meals.map((meal) => [meal.id, meal]));
  const mealByName = new Map(readiness.meals.map((meal) => [meal.name, meal]));
  const countsByResident = new Map<string, Map<string, number>>();
  for (const row of mealCountsResult.results) {
    const meal = mealById.get(row.meal_id);
    if (!meal) continue;
    const current = countsByResident.get(row.user_id) ?? new Map<string, number>();
    current.set(meal.name, Number(row.count || 0));
    countsByResident.set(row.user_id, current);
  }

  const residentLines: DraftResidentLine[] = [];
  let totalResidentMeals = 0;
  let totalMealChargesMinor = 0;

  for (const resident of readiness.residents) {
    const residentCounts = countsByResident.get(resident.id) ?? new Map<string, number>();
    const mealCounts: Record<string, number> = {};
    let fixedMealChargesMinor = 0;
    for (const meal of readiness.meals) {
      const count = residentCounts.get(meal.name) ?? 0;
      mealCounts[meal.name] = count;
      if (meal.pricing_mode === "FIXED") {
        if (meal.fixed_price_minor === null || meal.fixed_price_minor <= 0) {
          throw new Error(`Fixed-price meal ${meal.name} has no valid fixed price`);
        }
        const charge = count * meal.fixed_price_minor;
        if (!Number.isSafeInteger(charge)) throw new Error(`Fixed meal charge overflow for ${meal.name}`);
        fixedMealChargesMinor += charge;
      }
    }

    const formulaContext: Record<string, string> = {};
    for (const contextKey of mealContextKeys) {
      const mealName = contextKey.slice(0, -"_count".length).toLowerCase();
      const meal = mealByName.get(mealName);
      const count = residentCounts.get(mealName) ?? 0;
      formulaContext[contextKey] = String(meal?.pricing_mode === "FIXED" ? 0 : count);
    }
    const mealCount = Object.values(mealCounts).reduce((sum, count) => sum + count, 0);
    const mealResult = evaluateFormula(mealFormula.expression, {
      variables: numericVariables,
      context: formulaContext,
      strictMissing: true,
    });
    if (!mealResult.valid || mealResult.missingVariables.length > 0 || mealResult.missingContext.length > 0) {
      throw new Error(`Meal formula failed for resident ${resident.id}: ${mealResult.error ?? "missing dependency"}`);
    }
    const formulaMealChargesMinor = exactMajorToMinor(mealResult.valueExact);
    if (formulaMealChargesMinor === null || formulaMealChargesMinor < 0) {
      throw new Error(`Meal formula produced invalid currency for resident ${resident.id}`);
    }
    const mealChargesMinor = formulaMealChargesMinor + fixedMealChargesMinor;
    if (!Number.isSafeInteger(mealChargesMinor)) throw new Error(`Meal charge overflow for resident ${resident.id}`);

    const totalResult = evaluateFormula(totalFormula.expression, {
      variables: numericVariables,
      context: { meal_charges: minorToExactMajor(mealChargesMinor), adjustments: "0" },
      strictMissing: true,
    });
    if (!totalResult.valid || totalResult.missingVariables.length > 0 || totalResult.missingContext.length > 0) {
      throw new Error(`Total-bill formula failed for resident ${resident.id}: ${totalResult.error ?? "missing dependency"}`);
    }
    const totalAmountMinor = exactMajorToMinor(totalResult.valueExact);
    if (totalAmountMinor === null || totalAmountMinor < mealChargesMinor) {
      throw new Error(`Total-bill formula produced invalid currency for resident ${resident.id}`);
    }

    const line: DraftResidentLine = {
      userId: resident.id,
      name: resident.name,
      room: resident.room,
      mealCounts,
      mealCount,
      mealChargesMinor,
      otherChargesMinor: totalAmountMinor - mealChargesMinor,
      adjustmentsMinor: 0,
      totalAmountMinor,
    };
    residentLines.push(line);
    totalResidentMeals += mealCount;
    totalMealChargesMinor += mealChargesMinor;
  }

  const guestCountsResult = await c.env.DB.prepare(
    `SELECT meal_id, COALESCE(SUM(guest_count), 0) AS count
       FROM guest_meals
      WHERE institution_id = ? AND service_date BETWEEN ? AND ?
      GROUP BY meal_id`,
  )
    .bind(principal.institutionId, readiness.startsOn, readiness.endsOn)
    .all<GuestCountRow>();

  const variableByKey = new Map(readiness.variables.map((variable) => [variable.key, variable]));
  const guestMeals: ClosingDraft["guestMeals"] = [];
  let totalGuestMeals = 0;
  let guestRevenueMinor = 0;
  for (const row of guestCountsResult.results) {
    const meal = mealById.get(row.meal_id);
    if (!meal) throw new Error(`Guest meals reference inactive/unknown meal ${row.meal_id}`);
    let rateMinor: number;
    if (meal.pricing_mode === "FIXED") {
      if (meal.fixed_price_minor === null || meal.fixed_price_minor <= 0) {
        throw new Error(`Fixed-price guest meal ${meal.name} has no valid fixed price`);
      }
      rateMinor = meal.fixed_price_minor;
    } else {
      const rate = variableByKey.get(`meal.rate.${meal.name}`);
      if (!rate) throw new Error(`Missing active guest meal rate variable meal.rate.${meal.name}`);
      const formulaRateMinor = exactMajorToMinor(rate.value_text);
      if (formulaRateMinor === null || formulaRateMinor < 0) throw new Error(`Invalid guest meal rate for ${meal.name}`);
      rateMinor = formulaRateMinor;
    }
    const count = Number(row.count || 0);
    const revenueMinor = rateMinor * count;
    if (!Number.isSafeInteger(revenueMinor)) throw new Error("Guest meal revenue exceeds safe integer range");
    guestMeals.push({ mealId: meal.id, mealName: meal.name, count, revenueMinor });
    totalGuestMeals += count;
    guestRevenueMinor += revenueMinor;
  }

  const expense = await c.env.DB.prepare(
    `SELECT COALESCE(SUM(amount_minor), 0) AS total
       FROM expenses
      WHERE institution_id = ? AND status = 'APPROVED'
        AND deleted_on IS NULL AND expense_date BETWEEN ? AND ?`,
  )
    .bind(principal.institutionId, readiness.startsOn, readiness.endsOn)
    .first<{ total: number }>();
  const totalExpensesMinor = Number(expense?.total ?? 0);
  if (!Number.isSafeInteger(totalExpensesMinor) || totalExpensesMinor < 0) {
    throw new Error("Approved expense total is not safe integer minor-unit money");
  }

  return {
    version: 2,
    currency: "INR",
    period: { month, year, startsOn: readiness.startsOn, endsOn: readiness.endsOn },
    frozenAt: new Date().toISOString(),
    formulas: {
      mealCharges: {
        id: mealFormula.id,
        versionId: mealFormula.version_id,
        key: mealFormula.key,
        name: mealFormula.name,
        version: mealFormula.version,
        expression: mealFormula.expression,
        returnType: mealFormula.return_type,
      },
      totalBill: {
        id: totalFormula.id,
        versionId: totalFormula.version_id,
        key: totalFormula.key,
        name: totalFormula.name,
        version: totalFormula.version,
        expression: totalFormula.expression,
        returnType: totalFormula.return_type,
      },
    },
    variables: readiness.variables.map((variable) => ({
      id: variable.id,
      versionId: variable.version_id,
      key: variable.key,
      name: variable.name,
      version: variable.version,
      type: variable.variable_type,
      value: variable.value_text,
      unit: variable.unit,
    })),
    mealPricing: readiness.meals.map((meal) => ({
      mealId: meal.id,
      name: meal.name,
      displayName: meal.display_name,
      pricingMode: meal.pricing_mode,
      fixedPriceMinor: meal.fixed_price_minor,
    })),
    inputs: {
      totalExpensesMinor,
      totalResidentMeals,
      totalGuestMeals,
      guestRevenueMinor,
      totalMealChargesMinor,
    },
    residents: residentLines,
    guestMeals,
  };
}

function parseDraft(value: string | null): ClosingDraft | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as ClosingDraft;
    if (parsed?.version !== 2 || !Array.isArray(parsed.residents) || !Array.isArray(parsed.variables)) return null;
    return parsed;
  } catch {
    return null;
  }
}

async function addCycleEvent(
  c: Context<AppEnv>,
  principal: AuthPrincipal,
  cycleId: string,
  fromStatus: CycleStatus | null,
  toStatus: CycleStatus,
  reason: string | null,
  metadata: Record<string, unknown>,
): Promise<void> {
  await c.env.DB.prepare(
    `INSERT INTO billing_cycle_events
      (id, institution_id, billing_cycle_id, from_status, to_status,
       actor_user_id, reason, metadata_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      crypto.randomUUID(),
      principal.institutionId,
      cycleId,
      fromStatus,
      toStatus,
      principal.id,
      reason,
      JSON.stringify(metadata),
      new Date().toISOString(),
    )
    .run();
}

async function audit(
  c: Context<AppEnv>,
  principal: AuthPrincipal,
  action: string,
  cycleId: string,
  reason: string | null,
  metadata: Record<string, unknown>,
): Promise<void> {
  await c.env.DB.prepare(
    `INSERT INTO audit_events
      (id, institution_id, actor_user_id, action, entity_type, entity_id,
       request_id, reason, metadata_json, created_at)
     VALUES (?, ?, ?, ?, 'BillingCycle', ?, ?, ?, ?, ?)`,
  )
    .bind(
      crypto.randomUUID(),
      principal.institutionId,
      principal.id,
      action,
      cycleId,
      c.get("requestId"),
      reason,
      JSON.stringify(metadata),
      new Date().toISOString(),
    )
    .run();
}

monthlyClosingRoutes.get("/billing-cycles/readiness", async (c) => {
  const auth = await principalFor(c);
  if (auth instanceof Response) return auth;
  const rawMonth = Number(c.req.query("month"));
  const rawYear = Number(c.req.query("year"));
  if (!isValidPeriod(rawMonth, rawYear)) {
    return c.json({ success: false, error: "month/year must identify a valid billing period" }, 400);
  }
  const readiness = await computeReadiness(c, auth, rawMonth, rawYear);
  return c.json({ success: true, data: readiness.response });
});

monthlyClosingRoutes.get("/billing-cycles", async (c) => {
  const auth = await principalFor(c);
  if (auth instanceof Response) return auth;
  const rows = await c.env.DB.prepare(
    `SELECT * FROM billing_cycles
      WHERE institution_id = ?
      ORDER BY period_year DESC, period_month DESC, created_at DESC
      LIMIT 120`,
  )
    .bind(auth.institutionId)
    .all<CycleRow>();
  return c.json({ success: true, data: rows.results.map(cycleResponse) });
});

monthlyClosingRoutes.post("/billing-cycles", async (c) => {
  const auth = await principalFor(c);
  if (auth instanceof Response) return auth;
  const principal = auth;

  let body: Record<string, unknown>;
  try {
    body = await c.req.json<Record<string, unknown>>();
  } catch {
    return c.json({ success: false, error: "Invalid JSON body" }, 400);
  }
  const period = parsePeriodInput(body);
  if (!period) return c.json({ success: false, error: "month/year must identify a valid billing period" }, 400);
  const { month, year } = period;
  const dueDate = parseDueDate(body.dueDate, month, year);
  if (!dueDate) return c.json({ success: false, error: "dueDate must be a valid date on/after the first day of the next month" }, 400);

  let cycle = await loadCycle(c, principal.institutionId, month, year);
  if (cycle?.status === "CLOSED") {
    return c.json({ success: true, data: closingResult(cycle, true) });
  }

  // Once publication happened we do not read mutable live inputs again. Resume
  // settlement/closure strictly from the immutable published evidence.
  if (!cycle?.published_snapshot_id) {
    const readiness = await computeReadiness(c, principal, month, year);
    if (!readiness.response.canClose || !readiness.periodId || !readiness.formulas) {
      return c.json({
        success: false,
        error: "Monthly closing readiness failed",
        details: {
          success: false,
          cycleId: cycle?.id ?? "",
          status: cycle?.status ?? "OPEN",
          summary: {
            totalExpenses: cycle ? minorToMajor(cycle.total_expenses_minor) : 0,
            totalResidentMeals: cycle?.total_resident_meals ?? 0,
            totalGuestMeals: cycle?.total_guest_meals ?? 0,
            guestRevenue: cycle ? minorToMajor(cycle.guest_revenue_minor) : 0,
            mealCharge: cycle ? minorToMajor(cycle.meal_charge_minor) : 0,
            billsGenerated: cycle?.bills_generated ?? 0,
            refundQueueTotal: cycle ? minorToMajor(cycle.refund_queue_total_minor) : 0,
            outstandingDue: cycle ? minorToMajor(cycle.outstanding_due_minor) : 0,
          },
          error: readiness.response.items.filter((item) => item.status !== "ready").map((item) => item.detail).join(" "),
        },
        readiness: readiness.response,
      }, 422);
    }

    const now = new Date().toISOString();
    if (!cycle) {
      const cycleId = crypto.randomUUID();
      await c.env.DB.batch([
        c.env.DB.prepare(
          `INSERT INTO billing_cycles
            (id, institution_id, period_month, period_year, status, attempt_count,
             due_date, started_by, started_at, created_at, updated_at)
           VALUES (?, ?, ?, ?, 'PREPARING', 1, ?, ?, ?, ?, ?)`,
        ).bind(cycleId, principal.institutionId, month, year, dueDate, principal.id, now, now, now),
        c.env.DB.prepare(
          `UPDATE accounting_periods
              SET status = 'CLOSING', closing_started_at = COALESCE(closing_started_at, ?), updated_at = ?
            WHERE id = ? AND institution_id = ? AND status = 'OPEN'`,
        ).bind(now, now, readiness.periodId, principal.institutionId),
        c.env.DB.prepare(
          `INSERT INTO billing_cycle_events
            (id, institution_id, billing_cycle_id, from_status, to_status,
             actor_user_id, metadata_json, created_at)
           VALUES (?, ?, ?, 'OPEN', 'PREPARING', ?, ?, ?)`,
        ).bind(crypto.randomUUID(), principal.institutionId, cycleId, principal.id, JSON.stringify({ month, year }), now),
      ]);
      cycle = await loadCycle(c, principal.institutionId, month, year);
    } else if (["OPEN", "FAILED"].includes(cycle.status)) {
      const previous = cycle.status;
      await c.env.DB.batch([
        c.env.DB.prepare(
          `UPDATE billing_cycles
              SET status = 'PREPARING', attempt_count = attempt_count + 1,
                  draft_snapshot_json = NULL, due_date = ?, error_message = NULL,
                  started_by = ?, started_at = COALESCE(started_at, ?), updated_at = ?
            WHERE id = ? AND institution_id = ?`,
        ).bind(dueDate, principal.id, now, now, cycle.id, principal.institutionId),
        c.env.DB.prepare(
          `UPDATE accounting_periods
              SET status = 'CLOSING', closing_started_at = COALESCE(closing_started_at, ?), updated_at = ?
            WHERE id = ? AND institution_id = ? AND status IN ('OPEN', 'CLOSING')`,
        ).bind(now, now, readiness.periodId, principal.institutionId),
      ]);
      await addCycleEvent(c, principal, cycle.id, previous, "PREPARING", null, { month, year, resumed: previous === "FAILED" });
      cycle = await loadCycle(c, principal.institutionId, month, year);
    }

    if (!cycle) return c.json({ success: false, error: "Unable to establish billing cycle" }, 500);

    if (cycle.status === "PREPARING") {
      const preparingCycleId = cycle.id;
      try {
        const draft = await createDraft(c, principal, month, year, readiness);
        const draftJson = JSON.stringify(draft);
        const draftNow = new Date().toISOString();
        await c.env.DB.prepare(
          `UPDATE billing_cycles
              SET status = 'SNAPSHOT_CREATED', draft_snapshot_json = ?,
                  total_expenses_minor = ?, total_resident_meals = ?, total_guest_meals = ?,
                  guest_revenue_minor = ?, meal_charge_minor = ?, error_message = NULL, updated_at = ?
            WHERE id = ? AND institution_id = ? AND status = 'PREPARING'`,
        )
          .bind(
            draftJson,
            draft.inputs.totalExpensesMinor,
            draft.inputs.totalResidentMeals,
            draft.inputs.totalGuestMeals,
            draft.inputs.guestRevenueMinor,
            draft.inputs.totalMealChargesMinor,
            draftNow,
            preparingCycleId,
            principal.institutionId,
          )
          .run();
        await addCycleEvent(c, principal, preparingCycleId, "PREPARING", "SNAPSHOT_CREATED", null, {
          residentCount: draft.residents.length,
          variableVersions: draft.variables.map((variable) => variable.versionId),
          formulaVersions: [draft.formulas.mealCharges.versionId, draft.formulas.totalBill.versionId],
        });
        cycle = await loadCycle(c, principal.institutionId, month, year);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const failedAt = new Date().toISOString();
        await c.env.DB.prepare(
          `UPDATE billing_cycles SET status = 'FAILED', error_message = ?, updated_at = ?
            WHERE id = ? AND institution_id = ? AND published_snapshot_id IS NULL`,
        ).bind(message.slice(0, 2000), failedAt, preparingCycleId, principal.institutionId).run();
        await addCycleEvent(c, principal, preparingCycleId, "PREPARING", "FAILED", message, {});
        cycle = await loadCycle(c, principal.institutionId, month, year);
        if (!cycle) return c.json({ success: false, error: message }, 500);
        return c.json({ success: false, error: message, details: closingResult(cycle, false, message) }, 422);
      }
    }

    if (cycle?.status === "SNAPSHOT_CREATED") {
      const draft = parseDraft(cycle.draft_snapshot_json);
      if (!draft) {
        const message = "Closing draft snapshot is invalid; publication blocked";
        await c.env.DB.prepare(
          `UPDATE billing_cycles SET status = 'FAILED', error_message = ?, updated_at = ?
            WHERE id = ? AND institution_id = ? AND published_snapshot_id IS NULL`,
        ).bind(message, new Date().toISOString(), cycle.id, principal.institutionId).run();
        await addCycleEvent(c, principal, cycle.id, "SNAPSHOT_CREATED", "FAILED", message, {});
        const failed = await loadCycle(c, principal.institutionId, month, year);
        if (!failed) return c.json({ success: false, error: message }, 500);
        return c.json({ success: false, error: message, details: closingResult(failed, false, message) }, 422);
      }

      // Re-check the period-scoped pending-payment blocker immediately before
      // publication. The accounting period is already CLOSING, so financial
      // inputs should otherwise be frozen by their owning domain gates.
      const pendingPayments = await c.env.DB.prepare(
        `SELECT COUNT(*) AS count
           FROM payments p
          WHERE p.institution_id = ? AND p.status = 'PENDING' AND p.deleted_on IS NULL
            AND (
              (p.effective_month = ? AND p.effective_year = ?)
              OR p.bill_id IN (
                SELECT b.id FROM bills b
                 WHERE b.institution_id = p.institution_id AND b.period_month = ? AND b.period_year = ?
              )
            )`,
      )
        .bind(principal.institutionId, month, year, month, year)
        .first<{ count: number }>();
      if (Number(pendingPayments?.count ?? 0) > 0) {
        const message = "Pending payments appeared before publication; closing remains unpublished and rollbackable";
        await c.env.DB.prepare(
          `UPDATE billing_cycles SET status = 'FAILED', error_message = ?, updated_at = ?
            WHERE id = ? AND institution_id = ? AND published_snapshot_id IS NULL`,
        ).bind(message, new Date().toISOString(), cycle.id, principal.institutionId).run();
        await addCycleEvent(c, principal, cycle.id, "SNAPSHOT_CREATED", "FAILED", message, {});
        const failed = await loadCycle(c, principal.institutionId, month, year);
        if (!failed) return c.json({ success: false, error: message }, 500);
        return c.json({ success: false, error: message, details: closingResult(failed, false, message) }, 422);
      }

      const publishedAt = new Date().toISOString();
      const snapshotId = crypto.randomUUID();
      const statements = [
        c.env.DB.prepare(
          `INSERT INTO billing_snapshots
            (id, institution_id, period_month, period_year, currency_code, snapshot_version,
             resident_count, total_resident_meals, total_guest_meals,
             total_expenses_minor, guest_revenue_minor, per_meal_charge_minor,
             snapshot_json, created_by, created_at)
           VALUES (?, ?, ?, ?, 'INR', 2, ?, ?, ?, ?, ?, 0, ?, ?, ?)`,
        ).bind(
          snapshotId,
          principal.institutionId,
          month,
          year,
          draft.residents.length,
          draft.inputs.totalResidentMeals,
          draft.inputs.totalGuestMeals,
          draft.inputs.totalExpensesMinor,
          draft.inputs.guestRevenueMinor,
          JSON.stringify(draft),
          principal.id,
          publishedAt,
        ),
      ];

      for (const line of draft.residents) {
        statements.push(
          c.env.DB.prepare(
            `INSERT INTO bills
              (id, institution_id, user_id, snapshot_id, source,
               period_month, period_year, meal_charges_minor, other_charges_minor,
               adjustments_minor, total_amount_minor, paid_amount_minor, due_amount_minor,
               status, due_date, generated_at, created_at, updated_at)
             VALUES (?, ?, ?, ?, 'SNAPSHOT', ?, ?, ?, ?, ?, ?, 0, ?, 'GENERATED', ?, ?, ?, ?)`,
          ).bind(
            crypto.randomUUID(),
            principal.institutionId,
            line.userId,
            snapshotId,
            month,
            year,
            line.mealChargesMinor,
            line.otherChargesMinor,
            line.adjustmentsMinor,
            line.totalAmountMinor,
            line.totalAmountMinor,
            dueDate,
            publishedAt,
            publishedAt,
            publishedAt,
          ),
        );
      }
      statements.push(
        c.env.DB.prepare(
          `UPDATE billing_cycles
              SET status = 'BILLS_GENERATED', published_snapshot_id = ?,
                  bills_generated = ?, error_message = NULL, updated_at = ?
            WHERE id = ? AND institution_id = ? AND status = 'SNAPSHOT_CREATED'`,
        ).bind(snapshotId, draft.residents.length, publishedAt, cycle.id, principal.institutionId),
      );
      statements.push(
        c.env.DB.prepare(
          `INSERT INTO billing_cycle_events
            (id, institution_id, billing_cycle_id, from_status, to_status,
             actor_user_id, metadata_json, created_at)
           VALUES (?, ?, ?, 'SNAPSHOT_CREATED', 'BILLS_GENERATED', ?, ?, ?)`,
        ).bind(
          crypto.randomUUID(),
          principal.institutionId,
          cycle.id,
          principal.id,
          JSON.stringify({ snapshotId, billsGenerated: draft.residents.length }),
          publishedAt,
        ),
      );

      try {
        await c.env.DB.batch(statements);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        await c.env.DB.prepare(
          `UPDATE billing_cycles SET status = 'FAILED', error_message = ?, updated_at = ?
            WHERE id = ? AND institution_id = ? AND published_snapshot_id IS NULL`,
        ).bind(message.slice(0, 2000), new Date().toISOString(), cycle.id, principal.institutionId).run();
        await addCycleEvent(c, principal, cycle.id, "SNAPSHOT_CREATED", "FAILED", message, {});
        const failed = await loadCycle(c, principal.institutionId, month, year);
        if (!failed) return c.json({ success: false, error: message }, 500);
        return c.json({ success: false, error: message, details: closingResult(failed, false, message) }, 422);
      }
      cycle = await loadCycle(c, principal.institutionId, month, year);
    }
  }

  if (!cycle) return c.json({ success: false, error: "Billing cycle disappeared" }, 500);

  // Settlement is derivation-only: Funds is already canonical and derived from
  // immutable bills/payments/refunds/adjustments. Monthly Closing must not create
  // a second mutable resident balance ledger.
  if (cycle.status === "BILLS_GENERATED" || (cycle.status === "FAILED" && cycle.published_snapshot_id)) {
    const totals = await c.env.DB.prepare(
      `SELECT COUNT(*) AS bills_generated, COALESCE(SUM(due_amount_minor), 0) AS outstanding_due_minor
         FROM bills
        WHERE institution_id = ? AND snapshot_id = ? AND deleted_on IS NULL`,
    )
      .bind(principal.institutionId, cycle.published_snapshot_id)
      .first<{ bills_generated: number; outstanding_due_minor: number }>();
    const refunds = await c.env.DB.prepare(
      `SELECT COALESCE(SUM(remaining_amount_minor), 0) AS total
         FROM refunds
        WHERE institution_id = ? AND status IN ('PENDING', 'PARTIALLY_PAID')`,
    )
      .bind(principal.institutionId)
      .first<{ total: number }>();
    const settledAt = new Date().toISOString();
    const fromStatus = cycle.status;
    await c.env.DB.prepare(
      `UPDATE billing_cycles
          SET status = 'SETTLED', bills_generated = ?, outstanding_due_minor = ?,
              refund_queue_total_minor = ?, error_message = NULL, updated_at = ?
        WHERE id = ? AND institution_id = ? AND status IN ('BILLS_GENERATED', 'FAILED')
          AND published_snapshot_id IS NOT NULL`,
    )
      .bind(
        Number(totals?.bills_generated ?? 0),
        Number(totals?.outstanding_due_minor ?? 0),
        Number(refunds?.total ?? 0),
        settledAt,
        cycle.id,
        principal.institutionId,
      )
      .run();
    await addCycleEvent(c, principal, cycle.id, fromStatus, "SETTLED", null, {
      fundsAuthority: "derived",
      outstandingDueMinor: Number(totals?.outstanding_due_minor ?? 0),
      refundQueueTotalMinor: Number(refunds?.total ?? 0),
    });
    cycle = await loadCycle(c, principal.institutionId, month, year);
  }

  if (!cycle) return c.json({ success: false, error: "Billing cycle disappeared" }, 500);
  if (cycle.status === "SETTLED") {
    const closedAt = new Date().toISOString();
    const bounds = periodBounds(month, year);
    const period = await c.env.DB.prepare(
      `SELECT id FROM accounting_periods WHERE institution_id = ? AND period_key = ? LIMIT 1`,
    ).bind(principal.institutionId, bounds.key).first<{ id: string }>();
    if (!period) return c.json({ success: false, error: "Accounting period disappeared during closing" }, 500);

    await c.env.DB.batch([
      c.env.DB.prepare(
        `UPDATE accounting_periods
            SET status = 'CLOSED', closed_at = ?, updated_at = ?
          WHERE id = ? AND institution_id = ? AND status = 'CLOSING'`,
      ).bind(closedAt, closedAt, period.id, principal.institutionId),
      c.env.DB.prepare(
        `UPDATE billing_cycles
            SET status = 'CLOSED', closed_by = ?, closed_at = ?, updated_at = ?
          WHERE id = ? AND institution_id = ? AND status = 'SETTLED'`,
      ).bind(principal.id, closedAt, closedAt, cycle.id, principal.institutionId),
      c.env.DB.prepare(
        `INSERT INTO billing_cycle_events
          (id, institution_id, billing_cycle_id, from_status, to_status,
           actor_user_id, metadata_json, created_at)
         VALUES (?, ?, ?, 'SETTLED', 'CLOSED', ?, ?, ?)`,
      ).bind(
        crypto.randomUUID(),
        principal.institutionId,
        cycle.id,
        principal.id,
        JSON.stringify({ publishedSnapshotId: cycle.published_snapshot_id }),
        closedAt,
      ),
      c.env.DB.prepare(
        `INSERT INTO audit_events
          (id, institution_id, actor_user_id, action, entity_type, entity_id,
           request_id, reason, metadata_json, created_at)
         VALUES (?, ?, ?, 'MONTHLY_CLOSING_COMPLETED', 'BillingCycle', ?, ?, NULL, ?, ?)`,
      ).bind(
        crypto.randomUUID(),
        principal.institutionId,
        principal.id,
        cycle.id,
        c.get("requestId"),
        JSON.stringify({ month, year, snapshotId: cycle.published_snapshot_id }),
        closedAt,
      ),
    ]);
    cycle = await loadCycle(c, principal.institutionId, month, year);
  }

  if (!cycle) return c.json({ success: false, error: "Billing cycle disappeared" }, 500);
  if (cycle.status !== "CLOSED") {
    const message = `Monthly closing paused at ${cycle.status}; retry to resume`;
    return c.json({ success: false, error: message, details: closingResult(cycle, false, message) }, 409);
  }
  return c.json({ success: true, data: closingResult(cycle, true) });
});

monthlyClosingRoutes.post("/billing-cycles/:id/rollback", async (c) => {
  const auth = await principalFor(c);
  if (auth instanceof Response) return auth;
  const principal = auth;
  let body: Record<string, unknown>;
  try {
    body = await c.req.json<Record<string, unknown>>();
  } catch {
    return c.json({ success: false, error: "Invalid JSON body" }, 400);
  }
  const reason = typeof body.reason === "string" ? body.reason.trim() : "";
  if (reason.length < 3 || reason.length > 1000) {
    return c.json({ success: false, error: "Rollback reason must be 3-1000 characters" }, 400);
  }

  const cycle = await c.env.DB.prepare(
    `SELECT * FROM billing_cycles WHERE id = ? AND institution_id = ? LIMIT 1`,
  ).bind(c.req.param("id"), principal.institutionId).first<CycleRow>();
  if (!cycle) return c.json({ success: false, error: "Billing cycle not found" }, 404);
  if (cycle.published_snapshot_id || !["PREPARING", "SNAPSHOT_CREATED", "FAILED"].includes(cycle.status)) {
    return c.json({
      success: false,
      error: "Rollback is only allowed before immutable snapshot/bill publication",
    }, 422);
  }

  const bounds = periodBounds(cycle.period_month, cycle.period_year);
  const now = new Date().toISOString();
  await c.env.DB.batch([
    c.env.DB.prepare(
      `UPDATE billing_cycles
          SET status = 'OPEN', draft_snapshot_json = NULL, error_message = NULL,
              due_date = NULL, updated_at = ?
        WHERE id = ? AND institution_id = ? AND published_snapshot_id IS NULL`,
    ).bind(now, cycle.id, principal.institutionId),
    c.env.DB.prepare(
      `UPDATE accounting_periods
          SET status = 'OPEN', closing_started_at = NULL, updated_at = ?
        WHERE institution_id = ? AND period_key = ? AND status = 'CLOSING'`,
    ).bind(now, principal.institutionId, bounds.key),
    c.env.DB.prepare(
      `INSERT INTO billing_cycle_events
        (id, institution_id, billing_cycle_id, from_status, to_status,
         actor_user_id, reason, metadata_json, created_at)
       VALUES (?, ?, ?, ?, 'OPEN', ?, ?, ?, ?)`,
    ).bind(
      crypto.randomUUID(),
      principal.institutionId,
      cycle.id,
      cycle.status,
      principal.id,
      reason,
      JSON.stringify({ rollback: true }),
      now,
    ),
    c.env.DB.prepare(
      `INSERT INTO audit_events
        (id, institution_id, actor_user_id, action, entity_type, entity_id,
         request_id, reason, metadata_json, created_at)
       VALUES (?, ?, ?, 'MONTHLY_CLOSING_ROLLED_BACK', 'BillingCycle', ?, ?, ?, ?, ?)`,
    ).bind(
      crypto.randomUUID(),
      principal.institutionId,
      principal.id,
      cycle.id,
      c.get("requestId"),
      reason,
      JSON.stringify({ month: cycle.period_month, year: cycle.period_year }),
      now,
    ),
  ]);

  const rolledBack = await loadCycle(c, principal.institutionId, cycle.period_month, cycle.period_year);
  return c.json({ success: true, data: rolledBack ? cycleResponse(rolledBack) : null });
});
