import { Hono, type Context } from "hono";
import { authenticatedPrincipal, type AuthPrincipal } from "../auth/authorization";
import type { AppEnv } from "../types";

type CycleStatus = "OPEN" | "PREPARING" | "SNAPSHOT_CREATED" | "BILLS_GENERATED" | "SETTLED" | "CLOSED" | "FAILED";
type CycleRow = {
  id: string; institution_id: string; period_month: number; period_year: number; status: CycleStatus;
  attempt_count: number; draft_snapshot_json: string | null; published_snapshot_id: string | null;
  total_expenses_minor: number; total_resident_meals: number; total_guest_meals: number;
  guest_revenue_minor: number; meal_charge_minor: number; bills_generated: number;
  refund_queue_total_minor: number; outstanding_due_minor: number; due_date: string | null;
  started_by: string | null; started_at: string | null; closed_by: string | null; closed_at: string | null;
  error_message: string | null; created_at: string; updated_at: string;
};
type ResidentRow = { id: string; name: string; email: string; room: string | null };
type MealRow = { id: string; name: string; display_name: string; pricing_mode: string; fixed_price_minor: number | null };
type SettingRow = { key: string; value: string };
type ReadinessItem = { key: string; label: string; status: "ready" | "warning" | "error"; detail: string; count?: number; amount?: number };
type DraftResidentLine = {
  userId: string; name: string; room: string | null; mealCounts: Record<string, number>; mealCount: number;
  mealChargesMinor: number; otherChargesMinor: number; adjustmentsMinor: number; totalAmountMinor: number;
};
type ClosingDraft = {
  version: 3;
  currency: "INR";
  period: { month: number; year: number; startsOn: string; endsOn: string };
  frozenAt: string;
  pricing: { roomRentMinor: number; cleaningChargesMinor: number };
  mealPricing: Array<{ mealId: string; name: string; displayName: string; fixedPriceMinor: number }>;
  inputs: { totalExpensesMinor: number; totalResidentMeals: number; totalGuestMeals: number; guestRevenueMinor: number; totalMealChargesMinor: number };
  residents: DraftResidentLine[];
  guestMeals: Array<{ mealId: string; mealName: string; count: number; revenueMinor: number }>;
};
type ReadinessData = {
  month: number; year: number; periodLabel: string; items: ReadinessItem[]; canClose: boolean;
  existingCycle: { id: string; status: string } | null;
};
type ReadinessInternal = {
  response: ReadinessData; periodId: string | null; startsOn: string; endsOn: string;
  residents: ResidentRow[]; meals: MealRow[]; roomRentMinor: number | null; cleaningChargesMinor: number | null;
};

export const monthlyClosingRoutes = new Hono<AppEnv>();

async function principalFor(c: Context<AppEnv>): Promise<AuthPrincipal | Response> {
  const principal = await authenticatedPrincipal(c);
  return principal ?? c.json({ success: false, error: "Authentication required" }, 401);
}

function isValidPeriod(month: number, year: number) {
  return Number.isInteger(month) && month >= 0 && month <= 11 && Number.isInteger(year) && year >= 2000 && year <= 9999;
}
function parsePeriodInput(value: Record<string, unknown>) {
  const month = Number(value.month); const year = Number(value.year);
  return isValidPeriod(month, year) ? { month, year } : null;
}
function periodLabel(month: number, year: number) {
  return new Date(Date.UTC(year, month, 1)).toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
}
function periodBounds(month: number, year: number) {
  const startsOn = `${year}-${String(month + 1).padStart(2, "0")}-01`;
  const endsOn = new Date(Date.UTC(year, month + 1, 0)).toISOString().slice(0, 10);
  return { startsOn, endsOn, key: startsOn.slice(0, 7) };
}
async function institutionTimezone(c: Context<AppEnv>, institutionId: string) {
  const row = await c.env.DB.prepare("SELECT timezone FROM institutions WHERE id=? LIMIT 1").bind(institutionId).first<{ timezone: string }>();
  return row?.timezone || "UTC";
}
function currentPeriod(timeZone: string) {
  const now = new Date();
  const parts = new Intl.DateTimeFormat("en-US", { timeZone, year: "numeric", month: "2-digit" }).formatToParts(now);
  return {
    year: Number(parts.find((p) => p.type === "year")?.value ?? now.getUTCFullYear()),
    month: Number(parts.find((p) => p.type === "month")?.value ?? now.getUTCMonth() + 1) - 1,
  };
}
function exactMajorToMinor(raw: string | undefined): number | null {
  if (raw === undefined) return null;
  const match = /^(\d+)(?:\.(\d{1,2}))?$/u.exec(raw.trim());
  if (!match?.[1]) return null;
  const whole = Number(match[1]);
  const fraction = Number((match[2] ?? "").padEnd(2, "0"));
  const result = whole * 100 + fraction;
  return Number.isSafeInteger(result) && result >= 0 ? result : null;
}
function minorToMajor(value: number) { return Number(value || 0) / 100; }
function defaultDueDate(month: number, year: number) { return new Date(Date.UTC(year, month + 1, 10)).toISOString(); }
function parseDueDate(value: unknown, month: number, year: number): string | null {
  if (value === undefined || value === null || value === "") return defaultDueDate(month, year);
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/u.test(value)) return null;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) return null;
  const firstAllowed = new Date(Date.UTC(year, month + 1, 1)).toISOString().slice(0, 10);
  return value >= firstAllowed ? parsed.toISOString() : null;
}
function cycleResponse(row: CycleRow) {
  return {
    id: row.id, periodMonth: row.period_month, periodYear: row.period_year, status: row.status,
    totalExpenses: minorToMajor(row.total_expenses_minor), totalMeals: row.total_resident_meals,
    totalGuestMeals: row.total_guest_meals, mealCharge: minorToMajor(row.meal_charge_minor),
    billsGenerated: row.bills_generated, refundQueueTotal: minorToMajor(row.refund_queue_total_minor),
    outstandingDue: minorToMajor(row.outstanding_due_minor), closedBy: row.closed_by, closedAt: row.closed_at,
    startedAt: row.started_at, errorMessage: row.error_message, createdAt: row.created_at,
  };
}
function closingResult(row: CycleRow, success: boolean, error?: string) {
  return {
    success, cycleId: row.id, status: row.status,
    summary: {
      totalExpenses: minorToMajor(row.total_expenses_minor), totalResidentMeals: row.total_resident_meals,
      totalGuestMeals: row.total_guest_meals, guestRevenue: minorToMajor(row.guest_revenue_minor),
      mealCharge: minorToMajor(row.meal_charge_minor), billsGenerated: row.bills_generated,
      refundQueueTotal: minorToMajor(row.refund_queue_total_minor), outstandingDue: minorToMajor(row.outstanding_due_minor),
    },
    ...(error ? { error } : {}),
  };
}
async function loadCycle(c: Context<AppEnv>, institutionId: string, month: number, year: number) {
  return c.env.DB.prepare("SELECT * FROM billing_cycles WHERE institution_id=? AND period_month=? AND period_year=? LIMIT 1")
    .bind(institutionId, month, year).first<CycleRow>();
}
async function addCycleEvent(c: Context<AppEnv>, principal: AuthPrincipal, cycleId: string, fromStatus: CycleStatus | null, toStatus: CycleStatus, reason: string | null, metadata: Record<string, unknown>) {
  await c.env.DB.prepare(
    `INSERT INTO billing_cycle_events (id,institution_id,billing_cycle_id,from_status,to_status,actor_user_id,reason,metadata_json,created_at)
     VALUES (?,?,?,?,?,?,?,?,?)`,
  ).bind(crypto.randomUUID(), principal.institutionId, cycleId, fromStatus, toStatus, principal.id, reason, JSON.stringify(metadata), new Date().toISOString()).run();
}

async function computeReadiness(c: Context<AppEnv>, principal: AuthPrincipal, month: number, year: number): Promise<ReadinessInternal> {
  const label = periodLabel(month, year);
  const bounds = periodBounds(month, year);
  const items: ReadinessItem[] = [];
  const current = currentPeriod(await institutionTimezone(c, principal.institutionId));
  if (year * 12 + month >= current.year * 12 + current.month) {
    items.push({ key: "period", label: "Billing Period", status: "error", detail: `${label} is not a completed past month. Closing is blocked.` });
  } else items.push({ key: "period", label: "Billing Period", status: "ready", detail: `${label} is complete.` });

  const accounting = await c.env.DB.prepare("SELECT id,status FROM accounting_periods WHERE institution_id=? AND period_key=? LIMIT 1")
    .bind(principal.institutionId, bounds.key).first<{ id: string; status: string }>();
  const existingCycle = await loadCycle(c, principal.institutionId, month, year);
  if (!accounting) items.push({ key: "cycle", label: "Accounting Period", status: "error", detail: `${label} has no canonical accounting period.` });
  else if (accounting.status === "CLOSED") items.push({ key: "cycle", label: "Accounting Period", status: "error", detail: `${label} is already CLOSED. Corrections must use adjustments.` });
  else if (accounting.status === "CLOSING" && !existingCycle) items.push({ key: "cycle", label: "Accounting Period", status: "error", detail: `${label} is CLOSING without a canonical billing-cycle owner.` });
  else items.push({ key: "cycle", label: "Accounting Period", status: "ready", detail: accounting.status === "CLOSING" ? `${label} is locked for this resumable closing workflow.` : `${label} is OPEN and can enter closing.` });

  const snapshot = await c.env.DB.prepare("SELECT id FROM billing_snapshots WHERE institution_id=? AND period_month=? AND period_year=? LIMIT 1")
    .bind(principal.institutionId, month, year).first<{ id: string }>();
  if (snapshot && existingCycle?.published_snapshot_id !== snapshot.id && existingCycle?.status !== "CLOSED") {
    items.push({ key: "snapshot", label: "Published Snapshot", status: "error", detail: "An immutable snapshot already exists outside this closing workflow; automatic repricing is forbidden." });
  } else items.push({ key: "snapshot", label: "Published Snapshot", status: "ready", detail: snapshot ? "The workflow already owns the immutable published snapshot and may resume." : "No immutable snapshot has been published yet." });

  const residentsResult = await c.env.DB.prepare(
    "SELECT id,name,email,room FROM users WHERE institution_id=? AND role='USER' AND status='ACTIVE' AND deleted_at IS NULL ORDER BY id",
  ).bind(principal.institutionId).all<ResidentRow>();
  const residents = residentsResult.results;
  items.push({ key: "residents", label: "Active Residents", status: residents.length ? "ready" : "error", detail: residents.length ? `${residents.length} active resident(s) will be frozen.` : "No active residents are available to bill.", count: residents.length });

  const mealsResult = await c.env.DB.prepare(
    "SELECT id,lower(name) AS name,display_name,pricing_mode,fixed_price_minor FROM meal_configurations WHERE institution_id=? AND status='ACTIVE' AND deletion_finalized_at IS NULL ORDER BY display_order,id",
  ).bind(principal.institutionId).all<MealRow>();
  const meals = mealsResult.results;
  const invalidPricing = meals.filter((meal) => meal.pricing_mode !== "FIXED" || !Number.isSafeInteger(meal.fixed_price_minor) || Number(meal.fixed_price_minor) <= 0);
  if (!meals.length) items.push({ key: "pricing", label: "Fixed Billing Pricing", status: "error", detail: "No active meal configuration exists." });
  else if (invalidPricing.length) items.push({ key: "pricing", label: "Fixed Billing Pricing", status: "error", detail: `${invalidPricing.length} active meal(s) do not have a valid fixed price.` });

  const ambiguous = await c.env.DB.prepare("SELECT COUNT(*) AS count FROM meal_entries WHERE institution_id=? AND service_date BETWEEN ? AND ? AND status='LOCKED'")
    .bind(principal.institutionId, bounds.startsOn, bounds.endsOn).first<{ count: number }>();
  const mealCount = await c.env.DB.prepare("SELECT COUNT(*) AS count FROM meal_entries WHERE institution_id=? AND service_date BETWEEN ? AND ? AND status='ON'")
    .bind(principal.institutionId, bounds.startsOn, bounds.endsOn).first<{ count: number }>();
  if (Number(ambiguous?.count ?? 0) > 0) items.push({ key: "meals", label: "Meal Records", status: "error", detail: `${Number(ambiguous?.count ?? 0)} legacy LOCKED meal row(s) have ambiguous ON/OFF state.`, count: Number(ambiguous?.count ?? 0) });
  else items.push({ key: "meals", label: "Meal Records", status: "ready", detail: `${Number(mealCount?.count ?? 0)} confirmed resident meal(s) are available across ${meals.length} active meal type(s).`, count: Number(mealCount?.count ?? 0) });

  const expense = await c.env.DB.prepare("SELECT COUNT(*) AS count,COALESCE(SUM(amount_minor),0) AS total FROM expenses WHERE institution_id=? AND status='APPROVED' AND deleted_on IS NULL AND expense_date BETWEEN ? AND ?")
    .bind(principal.institutionId,bounds.startsOn,bounds.endsOn).first<{ count: number; total: number }>();
  items.push({ key: "expenses", label: "Approved Expenses", status: "ready", detail: `${Number(expense?.count ?? 0)} approved expense(s) totaling INR ${minorToMajor(Number(expense?.total ?? 0)).toFixed(2)} will be frozen.`, count: Number(expense?.count ?? 0), amount: minorToMajor(Number(expense?.total ?? 0)) });

  const pending = await c.env.DB.prepare(
    `SELECT COUNT(*) AS count FROM payments p WHERE p.institution_id=? AND p.status='PENDING' AND p.deleted_on IS NULL
      AND ((p.effective_month=? AND p.effective_year=?) OR p.bill_id IN (SELECT b.id FROM bills b WHERE b.institution_id=p.institution_id AND b.period_month=? AND b.period_year=?))`,
  ).bind(principal.institutionId,month,year,month,year).first<{ count: number }>();
  const pendingCount = Number(pending?.count ?? 0);
  items.push({ key: "payments", label: "Pending Payments", status: pendingCount ? "error" : "ready", detail: pendingCount ? `${pendingCount} pending payment(s) must be resolved before closing.` : "No unresolved payment is assigned to this billing period.", count: pendingCount });

  const settingsResult = await c.env.DB.prepare(
    "SELECT key,value FROM settings WHERE institution_id=? AND key IN ('billing.roomRent','billing.cleaningCharges')",
  ).bind(principal.institutionId).all<SettingRow>();
  const settingMap = new Map(settingsResult.results.map((row) => [row.key,row.value]));
  const roomRentMinor = exactMajorToMinor(settingMap.get("billing.roomRent"));
  const cleaningChargesMinor = exactMajorToMinor(settingMap.get("billing.cleaningCharges"));
  if (roomRentMinor === null || cleaningChargesMinor === null || invalidPricing.length) {
    items.push({ key: "pricing", label: "Fixed Billing Pricing", status: "error", detail: roomRentMinor === null || cleaningChargesMinor === null ? "Billing room rent and cleaning charges must be valid numeric Settings." : `${invalidPricing.length} active meal(s) do not have valid fixed prices.` });
  } else {
    items.push({ key: "pricing", label: "Fixed Billing Pricing", status: "ready", detail: `All ${meals.length} active meal prices plus room rent and cleaning charges are fixed and dependency-free.` });
  }

  return {
    response: { month,year,periodLabel:label,items,canClose:items.every((item)=>item.status==="ready"),existingCycle:existingCycle?{id:existingCycle.id,status:existingCycle.status}:null },
    periodId: accounting?.id ?? null, startsOn: bounds.startsOn, endsOn: bounds.endsOn, residents, meals, roomRentMinor, cleaningChargesMinor,
  };
}

async function createDraft(c: Context<AppEnv>, principal: AuthPrincipal, month: number, year: number, readiness: ReadinessInternal): Promise<ClosingDraft> {
  if (readiness.roomRentMinor === null || readiness.cleaningChargesMinor === null) throw new Error("Fixed billing Settings are unavailable");
  const mealById = new Map(readiness.meals.map((meal)=>[meal.id,meal]));
  for (const meal of readiness.meals) {
    if (meal.pricing_mode !== "FIXED" || !Number.isSafeInteger(meal.fixed_price_minor) || Number(meal.fixed_price_minor) <= 0) throw new Error(`Meal ${meal.name} requires a valid fixed price`);
  }

  const counts = await c.env.DB.prepare(
    `SELECT e.user_id,e.meal_id,COUNT(*) AS count FROM meal_entries e JOIN users u ON u.id=e.user_id
      WHERE e.institution_id=? AND e.service_date BETWEEN ? AND ? AND e.status='ON'
        AND u.institution_id=e.institution_id AND u.role='USER' AND u.status='ACTIVE' AND u.deleted_at IS NULL
      GROUP BY e.user_id,e.meal_id`,
  ).bind(principal.institutionId,readiness.startsOn,readiness.endsOn).all<{ user_id: string; meal_id: string; count: number }>();
  const byUser = new Map<string,Map<string,number>>();
  for (const row of counts.results) {
    const current = byUser.get(row.user_id) ?? new Map<string,number>(); current.set(row.meal_id,Number(row.count||0)); byUser.set(row.user_id,current);
  }

  const residents: DraftResidentLine[] = [];
  let totalResidentMeals=0; let totalMealChargesMinor=0;
  for (const resident of readiness.residents) {
    const residentCounts = byUser.get(resident.id) ?? new Map<string,number>();
    const mealCounts: Record<string,number> = {}; let mealCount=0; let mealChargesMinor=0;
    for (const meal of readiness.meals) {
      const count=residentCounts.get(meal.id)??0; mealCounts[meal.name]=count; mealCount+=count;
      mealChargesMinor += count * Number(meal.fixed_price_minor);
    }
    const otherChargesMinor = readiness.roomRentMinor + readiness.cleaningChargesMinor;
    const totalAmountMinor = mealChargesMinor + otherChargesMinor;
    if (![mealChargesMinor,otherChargesMinor,totalAmountMinor].every(Number.isSafeInteger)) throw new Error(`Billing amount overflow for resident ${resident.id}`);
    residents.push({ userId:resident.id,name:resident.name,room:resident.room,mealCounts,mealCount,mealChargesMinor,otherChargesMinor,adjustmentsMinor:0,totalAmountMinor });
    totalResidentMeals+=mealCount; totalMealChargesMinor+=mealChargesMinor;
  }

  const guestRows = await c.env.DB.prepare("SELECT meal_id,COALESCE(SUM(guest_count),0) AS count FROM guest_meals WHERE institution_id=? AND service_date BETWEEN ? AND ? GROUP BY meal_id")
    .bind(principal.institutionId,readiness.startsOn,readiness.endsOn).all<{ meal_id: string; count: number }>();
  const guestMeals: ClosingDraft["guestMeals"] = []; let totalGuestMeals=0; let guestRevenueMinor=0;
  for (const row of guestRows.results) {
    const meal=mealById.get(row.meal_id); if (!meal || !meal.fixed_price_minor) throw new Error(`Guest meal references unknown/unpriced meal ${row.meal_id}`);
    const count=Number(row.count||0); const revenueMinor=count*meal.fixed_price_minor;
    guestMeals.push({mealId:meal.id,mealName:meal.name,count,revenueMinor}); totalGuestMeals+=count; guestRevenueMinor+=revenueMinor;
  }
  const expense = await c.env.DB.prepare("SELECT COALESCE(SUM(amount_minor),0) AS total FROM expenses WHERE institution_id=? AND status='APPROVED' AND deleted_on IS NULL AND expense_date BETWEEN ? AND ?")
    .bind(principal.institutionId,readiness.startsOn,readiness.endsOn).first<{ total: number }>();
  const totalExpensesMinor=Number(expense?.total??0);

  return {
    version:3,currency:"INR",period:{month,year,startsOn:readiness.startsOn,endsOn:readiness.endsOn},frozenAt:new Date().toISOString(),
    pricing:{roomRentMinor:readiness.roomRentMinor,cleaningChargesMinor:readiness.cleaningChargesMinor},
    mealPricing:readiness.meals.map((meal)=>({mealId:meal.id,name:meal.name,displayName:meal.display_name,fixedPriceMinor:Number(meal.fixed_price_minor)})),
    inputs:{totalExpensesMinor,totalResidentMeals,totalGuestMeals,guestRevenueMinor,totalMealChargesMinor},residents,guestMeals,
  };
}
function parseDraft(raw: string | null): ClosingDraft | null {
  if (!raw) return null; try { const parsed=JSON.parse(raw) as ClosingDraft; return parsed?.version===3 && Array.isArray(parsed.residents) ? parsed : null; } catch { return null; }
}

monthlyClosingRoutes.get("/billing-cycles/readiness", async (c) => {
  const auth=await principalFor(c); if (auth instanceof Response) return auth;
  const month=Number(c.req.query("month")); const year=Number(c.req.query("year"));
  if (!isValidPeriod(month,year)) return c.json({success:false,error:"month/year must identify a valid billing period"},400);
  return c.json({success:true,data:(await computeReadiness(c,auth,month,year)).response});
});
monthlyClosingRoutes.get("/billing-cycles", async (c) => {
  const auth=await principalFor(c); if (auth instanceof Response) return auth;
  const rows=await c.env.DB.prepare("SELECT * FROM billing_cycles WHERE institution_id=? ORDER BY period_year DESC,period_month DESC,created_at DESC LIMIT 120").bind(auth.institutionId).all<CycleRow>();
  return c.json({success:true,data:rows.results.map(cycleResponse)});
});

monthlyClosingRoutes.post("/billing-cycles", async (c) => {
  const auth=await principalFor(c); if (auth instanceof Response) return auth; const principal=auth;
  let body: Record<string,unknown>; try { body=await c.req.json<Record<string,unknown>>(); } catch { return c.json({success:false,error:"Invalid JSON body"},400); }
  const period=parsePeriodInput(body); if (!period) return c.json({success:false,error:"month/year must identify a valid billing period"},400);
  const {month,year}=period; const dueDate=parseDueDate(body.dueDate,month,year);
  if (!dueDate) return c.json({success:false,error:"dueDate must be a valid date on/after the first day of the next month"},400);
  let cycle=await loadCycle(c,principal.institutionId,month,year);
  if (cycle?.status==="CLOSED") return c.json({success:true,data:closingResult(cycle,true)});

  if (!cycle?.published_snapshot_id) {
    const readiness=await computeReadiness(c,principal,month,year);
    if (!readiness.response.canClose || !readiness.periodId) {
      return c.json({success:false,error:"Monthly closing readiness failed",details:cycle?closingResult(cycle,false):undefined,readiness:readiness.response},422);
    }
    const now=new Date().toISOString();
    if (!cycle) {
      const id=crypto.randomUUID();
      await c.env.DB.batch([
        c.env.DB.prepare("INSERT INTO billing_cycles (id,institution_id,period_month,period_year,status,attempt_count,due_date,started_by,started_at,created_at,updated_at) VALUES (?,?,?,?,'PREPARING',1,?,?,?,?,?)").bind(id,principal.institutionId,month,year,dueDate,principal.id,now,now,now),
        c.env.DB.prepare("UPDATE accounting_periods SET status='CLOSING',closing_started_at=COALESCE(closing_started_at,?),updated_at=? WHERE id=? AND institution_id=? AND status='OPEN'").bind(now,now,readiness.periodId,principal.institutionId),
      ]);
      await addCycleEvent(c,principal,id,"OPEN","PREPARING",null,{month,year}); cycle=await loadCycle(c,principal.institutionId,month,year);
    } else if (["OPEN","FAILED"].includes(cycle.status)) {
      const previous=cycle.status;
      await c.env.DB.prepare("UPDATE billing_cycles SET status='PREPARING',attempt_count=attempt_count+1,draft_snapshot_json=NULL,due_date=?,error_message=NULL,started_by=?,started_at=COALESCE(started_at,?),updated_at=? WHERE id=? AND institution_id=?")
        .bind(dueDate,principal.id,now,now,cycle.id,principal.institutionId).run();
      await c.env.DB.prepare("UPDATE accounting_periods SET status='CLOSING',closing_started_at=COALESCE(closing_started_at,?),updated_at=? WHERE id=? AND institution_id=? AND status IN ('OPEN','CLOSING')")
        .bind(now,now,readiness.periodId,principal.institutionId).run();
      await addCycleEvent(c,principal,cycle.id,previous,"PREPARING",null,{month,year}); cycle=await loadCycle(c,principal.institutionId,month,year);
    }
    if (!cycle) return c.json({success:false,error:"Unable to establish billing cycle"},500);

    if (cycle.status==="PREPARING") {
      try {
        const draft=await createDraft(c,principal,month,year,readiness); const timestamp=new Date().toISOString();
        await c.env.DB.prepare("UPDATE billing_cycles SET status='SNAPSHOT_CREATED',draft_snapshot_json=?,total_expenses_minor=?,total_resident_meals=?,total_guest_meals=?,guest_revenue_minor=?,meal_charge_minor=?,error_message=NULL,updated_at=? WHERE id=? AND institution_id=? AND status='PREPARING'")
          .bind(JSON.stringify(draft),draft.inputs.totalExpensesMinor,draft.inputs.totalResidentMeals,draft.inputs.totalGuestMeals,draft.inputs.guestRevenueMinor,draft.inputs.totalMealChargesMinor,timestamp,cycle.id,principal.institutionId).run();
        await addCycleEvent(c,principal,cycle.id,"PREPARING","SNAPSHOT_CREATED",null,{residentCount:draft.residents.length,pricing:"FIXED"}); cycle=await loadCycle(c,principal.institutionId,month,year);
      } catch (error) {
        const message=error instanceof Error?error.message:String(error); const timestamp=new Date().toISOString();
        await c.env.DB.prepare("UPDATE billing_cycles SET status='FAILED',error_message=?,updated_at=? WHERE id=? AND institution_id=? AND published_snapshot_id IS NULL").bind(message.slice(0,2000),timestamp,cycle.id,principal.institutionId).run();
        await addCycleEvent(c,principal,cycle.id,"PREPARING","FAILED",message,{}); const failed=await loadCycle(c,principal.institutionId,month,year);
        return c.json({success:false,error:message,details:failed?closingResult(failed,false,message):undefined},422);
      }
    }

    if (cycle?.status==="SNAPSHOT_CREATED") {
      const draft=parseDraft(cycle.draft_snapshot_json); if (!draft) return c.json({success:false,error:"Closing draft snapshot is invalid; publication blocked"},422);
      const pending=await c.env.DB.prepare("SELECT COUNT(*) AS count FROM payments WHERE institution_id=? AND status='PENDING' AND deleted_on IS NULL AND effective_month=? AND effective_year=?")
        .bind(principal.institutionId,month,year).first<{count:number}>();
      if (Number(pending?.count??0)>0) return c.json({success:false,error:"Pending payments appeared before publication; closing remains unpublished and rollbackable"},422);
      const publishedAt=new Date().toISOString(); const snapshotId=crypto.randomUUID(); const statements:D1PreparedStatement[]=[];
      statements.push(c.env.DB.prepare("INSERT INTO billing_snapshots (id,institution_id,period_month,period_year,currency_code,snapshot_version,resident_count,total_resident_meals,total_guest_meals,total_expenses_minor,guest_revenue_minor,per_meal_charge_minor,snapshot_json,created_by,created_at) VALUES (?,?,?,?,'INR',3,?,?,?,?,?,0,?,?,?)")
        .bind(snapshotId,principal.institutionId,month,year,draft.residents.length,draft.inputs.totalResidentMeals,draft.inputs.totalGuestMeals,draft.inputs.totalExpensesMinor,draft.inputs.guestRevenueMinor,JSON.stringify(draft),principal.id,publishedAt));
      for (const line of draft.residents) statements.push(c.env.DB.prepare("INSERT INTO bills (id,institution_id,user_id,snapshot_id,source,period_month,period_year,meal_charges_minor,other_charges_minor,adjustments_minor,total_amount_minor,paid_amount_minor,due_amount_minor,status,due_date,generated_at,created_at,updated_at) VALUES (?,?,?,?,'SNAPSHOT',?,?,?,?,?,?,0,?,'GENERATED',?,?,?,?)")
        .bind(crypto.randomUUID(),principal.institutionId,line.userId,snapshotId,month,year,line.mealChargesMinor,line.otherChargesMinor,line.adjustmentsMinor,line.totalAmountMinor,line.totalAmountMinor,dueDate,publishedAt,publishedAt,publishedAt));
      statements.push(c.env.DB.prepare("UPDATE billing_cycles SET status='BILLS_GENERATED',published_snapshot_id=?,bills_generated=?,error_message=NULL,updated_at=? WHERE id=? AND institution_id=? AND status='SNAPSHOT_CREATED'").bind(snapshotId,draft.residents.length,publishedAt,cycle.id,principal.institutionId));
      await c.env.DB.batch(statements); await addCycleEvent(c,principal,cycle.id,"SNAPSHOT_CREATED","BILLS_GENERATED",null,{snapshotId,billsGenerated:draft.residents.length}); cycle=await loadCycle(c,principal.institutionId,month,year);
    }
  }

  if (!cycle) return c.json({success:false,error:"Billing cycle disappeared"},500);
  if (cycle.status==="BILLS_GENERATED" || (cycle.status==="FAILED" && cycle.published_snapshot_id)) {
    const totals=await c.env.DB.prepare("SELECT COUNT(*) AS count,COALESCE(SUM(due_amount_minor),0) AS due FROM bills WHERE institution_id=? AND snapshot_id=? AND deleted_on IS NULL").bind(principal.institutionId,cycle.published_snapshot_id).first<{count:number;due:number}>();
    const refunds=await c.env.DB.prepare("SELECT COALESCE(SUM(remaining_amount_minor),0) AS total FROM refunds WHERE institution_id=? AND status IN ('PENDING','PARTIALLY_PAID')").bind(principal.institutionId).first<{total:number}>();
    const timestamp=new Date().toISOString(); const from=cycle.status;
    await c.env.DB.prepare("UPDATE billing_cycles SET status='SETTLED',bills_generated=?,outstanding_due_minor=?,refund_queue_total_minor=?,error_message=NULL,updated_at=? WHERE id=? AND institution_id=? AND published_snapshot_id IS NOT NULL")
      .bind(Number(totals?.count??0),Number(totals?.due??0),Number(refunds?.total??0),timestamp,cycle.id,principal.institutionId).run();
    await addCycleEvent(c,principal,cycle.id,from,"SETTLED",null,{fundsAuthority:"derived"}); cycle=await loadCycle(c,principal.institutionId,month,year);
  }
  if (!cycle) return c.json({success:false,error:"Billing cycle disappeared"},500);
  if (cycle.status==="SETTLED") {
    const timestamp=new Date().toISOString(); const bounds=periodBounds(month,year);
    await c.env.DB.batch([
      c.env.DB.prepare("UPDATE accounting_periods SET status='CLOSED',closed_at=?,updated_at=? WHERE institution_id=? AND period_key=? AND status='CLOSING'").bind(timestamp,timestamp,principal.institutionId,bounds.key),
      c.env.DB.prepare("UPDATE billing_cycles SET status='CLOSED',closed_by=?,closed_at=?,updated_at=? WHERE id=? AND institution_id=? AND status='SETTLED'").bind(principal.id,timestamp,timestamp,cycle.id,principal.institutionId),
      c.env.DB.prepare("INSERT INTO audit_events (id,institution_id,actor_user_id,action,entity_type,entity_id,request_id,reason,metadata_json,created_at) VALUES (?,?,?,'MONTHLY_CLOSING_COMPLETED','BillingCycle',?,?,NULL,?,?)").bind(crypto.randomUUID(),principal.institutionId,principal.id,cycle.id,c.get("requestId"),JSON.stringify({month,year,snapshotId:cycle.published_snapshot_id}),timestamp),
    ]);
    await addCycleEvent(c,principal,cycle.id,"SETTLED","CLOSED",null,{publishedSnapshotId:cycle.published_snapshot_id}); cycle=await loadCycle(c,principal.institutionId,month,year);
  }
  if (!cycle) return c.json({success:false,error:"Billing cycle disappeared"},500);
  if (cycle.status!=="CLOSED") return c.json({success:false,error:`Monthly closing paused at ${cycle.status}; retry to resume`,details:closingResult(cycle,false)},409);
  return c.json({success:true,data:closingResult(cycle,true)});
});

monthlyClosingRoutes.post("/billing-cycles/:id/rollback", async (c) => {
  const auth=await principalFor(c); if (auth instanceof Response) return auth; const principal=auth;
  let body:Record<string,unknown>; try { body=await c.req.json<Record<string,unknown>>(); } catch { return c.json({success:false,error:"Invalid JSON body"},400); }
  const reason=typeof body.reason==="string"?body.reason.trim():""; if (reason.length<3||reason.length>1000) return c.json({success:false,error:"Rollback reason must be 3-1000 characters"},400);
  const cycle=await c.env.DB.prepare("SELECT * FROM billing_cycles WHERE id=? AND institution_id=? LIMIT 1").bind(c.req.param("id"),principal.institutionId).first<CycleRow>();
  if (!cycle) return c.json({success:false,error:"Billing cycle not found"},404);
  if (cycle.published_snapshot_id || !["PREPARING","SNAPSHOT_CREATED","FAILED"].includes(cycle.status)) return c.json({success:false,error:"Rollback is only allowed before immutable snapshot/bill publication"},422);
  const now=new Date().toISOString(); const bounds=periodBounds(cycle.period_month,cycle.period_year);
  await c.env.DB.batch([
    c.env.DB.prepare("UPDATE billing_cycles SET status='OPEN',draft_snapshot_json=NULL,error_message=NULL,due_date=NULL,updated_at=? WHERE id=? AND institution_id=? AND published_snapshot_id IS NULL").bind(now,cycle.id,principal.institutionId),
    c.env.DB.prepare("UPDATE accounting_periods SET status='OPEN',closing_started_at=NULL,updated_at=? WHERE institution_id=? AND period_key=? AND status='CLOSING'").bind(now,principal.institutionId,bounds.key),
    c.env.DB.prepare("INSERT INTO billing_cycle_events (id,institution_id,billing_cycle_id,from_status,to_status,actor_user_id,reason,metadata_json,created_at) VALUES (?,?,?,?,'OPEN',?,?,?,?)").bind(crypto.randomUUID(),principal.institutionId,cycle.id,cycle.status,principal.id,reason,JSON.stringify({rollback:true}),now),
    c.env.DB.prepare("INSERT INTO audit_events (id,institution_id,actor_user_id,action,entity_type,entity_id,request_id,reason,metadata_json,created_at) VALUES (?,?,?,'MONTHLY_CLOSING_ROLLED_BACK','BillingCycle',?,?,?,?,?)").bind(crypto.randomUUID(),principal.institutionId,principal.id,cycle.id,c.get("requestId"),reason,JSON.stringify({month:cycle.period_month,year:cycle.period_year}),now),
  ]);
  const rolled=await loadCycle(c,principal.institutionId,cycle.period_month,cycle.period_year); return c.json({success:true,data:rolled?cycleResponse(rolled):null});
});
