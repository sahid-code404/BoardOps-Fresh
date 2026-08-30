type VisualFetchOpts = RequestInit & { params?: Record<string, unknown> };

const VARIABLES = [
  { id: "var_meal_rate_breakfast_visual", key: "meal.rate.breakfast", name: "Breakfast Rate", description: "Per-meal breakfast rate", type: "CURRENCY", value: "40", unit: "INR", category: "MEAL_RATES", isSystem: true, isProtected: true, status: "ACTIVE", version: 1, createdAt: "2026-08-01T00:00:00.000Z", updatedAt: "2026-08-01T00:00:00.000Z" },
  { id: "var_meal_rate_lunch_visual", key: "meal.rate.lunch", name: "Lunch Rate", description: "Per-meal lunch rate", type: "CURRENCY", value: "60", unit: "INR", category: "MEAL_RATES", isSystem: true, isProtected: true, status: "ACTIVE", version: 1, createdAt: "2026-08-01T00:00:00.000Z", updatedAt: "2026-08-01T00:00:00.000Z" },
  { id: "var_meal_rate_dinner_visual", key: "meal.rate.dinner", name: "Dinner Rate", description: "Per-meal dinner rate", type: "CURRENCY", value: "70", unit: "INR", category: "MEAL_RATES", isSystem: true, isProtected: true, status: "ACTIVE", version: 1, createdAt: "2026-08-01T00:00:00.000Z", updatedAt: "2026-08-01T00:00:00.000Z" },
  { id: "var_meal_rate_snacks_visual", key: "meal.rate.snacks", name: "Snacks Rate", description: "Optional snacks rate", type: "CURRENCY", value: "20", unit: "INR", category: "MEAL_RATES", isSystem: true, isProtected: true, status: "ACTIVE", version: 1, createdAt: "2026-08-01T00:00:00.000Z", updatedAt: "2026-08-01T00:00:00.000Z" },
  { id: "var_meal_rate_festival_visual", key: "meal.rate.festival", name: "Festival Meal Rate", description: "Optional festival meal rate", type: "CURRENCY", value: "120", unit: "INR", category: "MEAL_RATES", isSystem: true, isProtected: true, status: "ACTIVE", version: 1, createdAt: "2026-08-01T00:00:00.000Z", updatedAt: "2026-08-01T00:00:00.000Z" },
  { id: "var_room_rent_visual", key: "billing.roomRent", name: "Monthly Room Rent", description: "Monthly room rent", type: "CURRENCY", value: "4500", unit: "INR", category: "BILLING", isSystem: true, isProtected: true, status: "ACTIVE", version: 1, createdAt: "2026-08-01T00:00:00.000Z", updatedAt: "2026-08-01T00:00:00.000Z" },
  { id: "var_security_visual", key: "billing.securityDeposit", name: "Security Deposit", description: "Refundable security deposit", type: "CURRENCY", value: "5000", unit: "INR", category: "BILLING", isSystem: true, isProtected: true, status: "ACTIVE", version: 1, createdAt: "2026-08-01T00:00:00.000Z", updatedAt: "2026-08-01T00:00:00.000Z" },
  { id: "var_late_fee_visual", key: "billing.lateFeePercent", name: "Late Fee %", description: "Late fee percentage", type: "PERCENTAGE", value: "2", unit: "%", category: "BILLING", isSystem: true, isProtected: true, status: "ACTIVE", version: 1, createdAt: "2026-08-01T00:00:00.000Z", updatedAt: "2026-08-01T00:00:00.000Z" },
  { id: "var_cleaning_visual", key: "billing.cleaningCharges", name: "Cleaning Charges", description: "Monthly cleaning charge", type: "CURRENCY", value: "150", unit: "INR", category: "BILLING", isSystem: false, isProtected: false, status: "ACTIVE", version: 1, createdAt: "2026-08-01T00:00:00.000Z", updatedAt: "2026-08-01T00:00:00.000Z" },
  { id: "var_electricity_visual", key: "billing.electricityPerUnit", name: "Electricity Rate / Unit", description: "Electricity rate per unit", type: "CURRENCY", value: "8", unit: "INR", category: "BILLING", isSystem: false, isProtected: false, status: "ACTIVE", version: 1, createdAt: "2026-08-01T00:00:00.000Z", updatedAt: "2026-08-01T00:00:00.000Z" },
];

const version = (formulaId: string, expression: string, referencedSlugs: string[], referencedContext: string[]) => ({
  id: `${formulaId}-v1`,
  version: 1,
  expression,
  returnType: "CURRENCY",
  referencedSlugs,
  referencedContext,
  changedBy: "visual-admin",
  changeNote: "Initial version",
  createdAt: "2026-08-01T00:00:00.000Z",
  user: { name: "Aarav Sharma", email: "admin@boardops.local" },
});

const FORMULAS = [
  {
    id: "formula_meal_charges_visual",
    name: "Meal Charges",
    key: "formula.mealCharges",
    description: "Canonical configurable meal charge formula",
    expression: "breakfast_count * var('meal.rate.breakfast') + lunch_count * var('meal.rate.lunch') + dinner_count * var('meal.rate.dinner')",
    returnType: "CURRENCY",
    category: "BILLING",
    version: 1,
    status: "ACTIVE",
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
    versions: [version("formula_meal_charges_visual", "breakfast_count * var('meal.rate.breakfast') + lunch_count * var('meal.rate.lunch') + dinner_count * var('meal.rate.dinner')", ["meal.rate.breakfast", "meal.rate.lunch", "meal.rate.dinner"], ["breakfast_count", "lunch_count", "dinner_count"])],
  },
  {
    id: "formula_total_bill_visual",
    name: "Total Bill",
    key: "formula.totalBill",
    description: "Canonical total bill composition",
    expression: "meal_charges + var('billing.roomRent') + var('billing.cleaningCharges') + adjustments",
    returnType: "CURRENCY",
    category: "BILLING",
    version: 1,
    status: "ACTIVE",
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
    versions: [version("formula_total_bill_visual", "meal_charges + var('billing.roomRent') + var('billing.cleaningCharges') + adjustments", ["billing.roomRent", "billing.cleaningCharges"], ["meal_charges", "adjustments"])],
  },
  {
    id: "formula_due_visual",
    name: "Due Amount",
    key: "formula.dueAmount",
    description: "Outstanding amount after approved payments",
    expression: "total_amount - paid_amount",
    returnType: "CURRENCY",
    category: "BILLING",
    version: 1,
    status: "ACTIVE",
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
    versions: [version("formula_due_visual", "total_amount - paid_amount", [], ["total_amount", "paid_amount"])],
  },
  {
    id: "formula_late_fee_visual",
    name: "Late Fee",
    key: "formula.lateFee",
    description: "Configured late fee calculation",
    expression: "due_amount * (var('billing.lateFeePercent') / 100)",
    returnType: "CURRENCY",
    category: "BILLING",
    version: 1,
    status: "ACTIVE",
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
    versions: [version("formula_late_fee_visual", "due_amount * (var('billing.lateFeePercent') / 100)", ["billing.lateFeePercent"], ["due_amount"])],
  },
];

function envelope<T>(data: T) {
  return { success: true, data };
}

export function visualFormulaEngineFixtureResponse<T>(path: string, opts: VisualFetchOpts = {}): T | undefined {
  const url = new URL(path, "https://boardops.visual.local");
  const method = (opts.method ?? "GET").toUpperCase();

  if (method === "GET" && url.pathname === "/variables") return envelope(VARIABLES) as T;
  if (method === "GET" && url.pathname === "/formulas") return envelope(FORMULAS) as T;
  if (method === "POST" && url.pathname === "/formulas/test") {
    return envelope({
      value: 310,
      valueExact: "310",
      valid: true,
      referencedSlugs: ["meal.rate.breakfast", "meal.rate.lunch", "meal.rate.dinner"],
      referencedContext: ["breakfast_count", "lunch_count", "dinner_count"],
      missingVariables: [],
      missingContext: [],
      resolvedValues: {
        "meal.rate.breakfast": "40",
        "meal.rate.lunch": "60",
        "meal.rate.dinner": "70",
      },
    }) as T;
  }

  return undefined;
}
