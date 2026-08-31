type VisualFetchOpts = RequestInit & { params?: Record<string, unknown> };

const UNITS = [
  { id: "unit-kg", name: "kg", category: "WEIGHT", isActive: true },
  { id: "unit-litre", name: "litre", category: "VOLUME", isActive: true },
  { id: "unit-piece", name: "piece", category: "QUANTITY", isActive: true },
];

const PRODUCTS = [
  {
    id: "product-rice",
    name: "Rice",
    slug: "rice",
    category: "GRAINS",
    defaultUnitId: "unit-kg",
    defaultUnit: UNITS[0],
    isActive: true,
    archivedAt: null,
    createdAt: "2026-08-01T00:00:00.000Z",
  },
  {
    id: "product-oil",
    name: "Cooking Oil",
    slug: "cooking-oil",
    category: "OIL",
    defaultUnitId: "unit-litre",
    defaultUnit: UNITS[1],
    isActive: true,
    archivedAt: null,
    createdAt: "2026-08-01T00:00:00.000Z",
  },
  {
    id: "product-eggs",
    name: "Eggs",
    slug: "eggs",
    category: "PROTEIN",
    defaultUnitId: "unit-piece",
    defaultUnit: UNITS[2],
    isActive: true,
    archivedAt: null,
    createdAt: "2026-08-01T00:00:00.000Z",
  },
];

const PURCHASES = [
  {
    id: "purchase-visual-1",
    vendor: "Local Market",
    purchaseDate: "2026-08-15",
    totalAmount: 600,
    receiptUrl: null,
    notes: "Weekly kitchen procurement",
    status: "APPROVED",
    deletedAt: null,
    deletionReason: null,
    createdBy: "visual-admin",
    createdAt: "2026-08-15T04:30:00.000Z",
    expenseId: "expense-purchase-visual-1",
    user: { name: "Aarav Sharma", email: "admin@boardops.local" },
    items: [
      {
        id: "purchase-item-rice",
        productId: "product-rice",
        productName: "Rice",
        category: "GRAINS",
        quantity: 5,
        unit: "kg",
        rate: 60,
        total: 300,
        notes: null,
      },
      {
        id: "purchase-item-oil",
        productId: "product-oil",
        productName: "Cooking Oil",
        category: "OIL",
        quantity: 2,
        unit: "litre",
        rate: 150,
        total: 300,
        notes: null,
      },
    ],
  },
];

function envelope<T>(data: T) {
  return { success: true, data };
}

export function visualProcurementFixtureResponse<T>(path: string, opts: VisualFetchOpts = {}): T | undefined {
  const url = new URL(path, "https://boardops.visual.local");
  const method = (opts.method || "GET").toUpperCase();
  if (method !== "GET") return undefined;

  if (url.pathname === "/units") return envelope(UNITS) as T;
  if (url.pathname === "/products") return envelope(PRODUCTS) as T;
  if (url.pathname === "/purchases") return envelope(PURCHASES) as T;
  if (url.pathname === "/purchases/stats") {
    return envelope({
      todayTotal: 0,
      monthTotal: 600,
      monthCount: 1,
      topProducts: [
        { name: "Rice", totalSpend: 300, totalQuantity: 5 },
        { name: "Cooking Oil", totalSpend: 300, totalQuantity: 2 },
      ],
      topCategories: [
        { category: "GRAINS", totalSpend: 300 },
        { category: "OIL", totalSpend: 300 },
      ],
    }) as T;
  }
  if (/^\/purchases\/[^/]+$/u.test(url.pathname)) return envelope(PURCHASES[0]) as T;
  return undefined;
}
