import { useAppStore, type ViewKey } from "@/stores/use-app-store";
import { useAuthStore, type CurrentUser } from "@/stores/use-auth-store";

export const VISUAL_FIXTURES_ENABLED = import.meta.env.VITE_BOARDOPS_VISUAL_FIXTURES === "1";

const nowIso = () => new Date().toISOString();
const dateKey = (date: Date) => {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
};

export const VISUAL_ADMIN: CurrentUser = {
  id: "visual-admin",
  name: "Aarav Sharma",
  email: "admin@boardops.local",
  phone: "+91 98765 43210",
  role: "ADMIN",
  status: "ACTIVE",
  room: "A-101",
  gender: "Male",
  emergencyContact: "+91 90000 00000",
  theme: "system",
  language: "en",
  timezone: "Asia/Kolkata",
  twoFactorEnabled: false,
  createdAt: "2026-01-15T08:30:00.000Z",
  lastLoginAt: nowIso(),
};

export const VISUAL_USER: CurrentUser = {
  id: "visual-user",
  name: "Riya Sen",
  email: "resident@boardops.local",
  phone: "+91 91234 56789",
  role: "USER",
  status: "ACTIVE",
  room: "B-204",
  gender: "Female",
  emergencyContact: "+91 91111 11111",
  theme: "system",
  language: "en",
  timezone: "Asia/Kolkata",
  twoFactorEnabled: false,
  createdAt: "2026-02-11T10:00:00.000Z",
  lastLoginAt: nowIso(),
};

const VALID_VIEWS: ViewKey[] = [
  "dashboard",
  "meals",
  "user-meals",
  "kitchen",
  "billing",
  "payments",
  "expenses",
  "funds",
  "monthly-closing",
  "formula-engine",
  "users",
  "notifications",
  "settings",
  "system",
  "profile",
];

export function installVisualFixtureSession() {
  if (!VISUAL_FIXTURES_ENABLED || typeof window === "undefined") return;

  const params = new URLSearchParams(window.location.search);
  const user = params.get("role") === "user" ? VISUAL_USER : VISUAL_ADMIN;
  useAuthStore.setState({ user, token: `visual-fixture-${user.role.toLowerCase()}` });

  const requestedView = params.get("view") as ViewKey | null;
  if (requestedView && VALID_VIEWS.includes(requestedView)) {
    useAppStore.setState({ view: requestedView });
  }
}

type VisualFetchOpts = RequestInit & { params?: Record<string, unknown> };

type FixtureMeal = {
  id: string;
  name: string;
  displayName: string;
  description: string;
  icon: string;
  color: string;
  mealType: string;
  status: string;
  displayOrder: number;
  defaultState: string;
  defaultVisibility: string;
  cutoffStrategy: string;
  cutoffOffsetMinutes: number;
  cutoffTime: string;
  startTime: string;
  endTime: string;
  notes: string;
  createdAt: string;
  updatedAt: string;
};

const MEALS: FixtureMeal[] = [
  {
    id: "meal-breakfast",
    name: "breakfast",
    displayName: "Breakfast",
    description: "Fresh morning meal",
    icon: "🍳",
    color: "#f59e0b",
    mealType: "REGULAR",
    status: "ACTIVE",
    displayOrder: 1,
    defaultState: "ON",
    defaultVisibility: "VISIBLE",
    cutoffStrategy: "PREVIOUS_DAY",
    cutoffOffsetMinutes: 0,
    cutoffTime: "22:00",
    startTime: "07:30",
    endTime: "09:30",
    notes: "",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-08-20T00:00:00.000Z",
  },
  {
    id: "meal-lunch",
    name: "lunch",
    displayName: "Lunch",
    description: "Daily lunch service",
    icon: "🍛",
    color: "#10b981",
    mealType: "REGULAR",
    status: "ACTIVE",
    displayOrder: 2,
    defaultState: "ON",
    defaultVisibility: "VISIBLE",
    cutoffStrategy: "SAME_DAY",
    cutoffOffsetMinutes: 0,
    cutoffTime: "09:30",
    startTime: "12:30",
    endTime: "14:30",
    notes: "",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-08-20T00:00:00.000Z",
  },
  {
    id: "meal-dinner",
    name: "dinner",
    displayName: "Dinner",
    description: "Evening meal service",
    icon: "🍲",
    color: "#8b5cf6",
    mealType: "REGULAR",
    status: "ACTIVE",
    displayOrder: 3,
    defaultState: "ON",
    defaultVisibility: "VISIBLE",
    cutoffStrategy: "SAME_DAY",
    cutoffOffsetMinutes: 0,
    cutoffTime: "16:00",
    startTime: "19:30",
    endTime: "21:30",
    notes: "",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-08-20T00:00:00.000Z",
  },
];

const USERS = [
  { ...VISUAL_ADMIN, id: "visual-admin", status: "ACTIVE", institutionName: "BoardOps Residence", institutionUserId: "ADM-001", emailVerified: true },
  { ...VISUAL_USER, id: "visual-user", status: "ACTIVE", institutionName: "BoardOps Residence", institutionUserId: "RES-204", emailVerified: true },
  {
    id: "visual-pending",
    name: "Kabir Mehta",
    email: "kabir@example.test",
    phone: "+91 90000 12345",
    role: "USER",
    status: "PENDING",
    room: "C-305",
    gender: "Male",
    emergencyContact: "+91 90000 54321",
    createdAt: "2026-08-28T09:00:00.000Z",
    lastLoginAt: null,
    deletedAt: null,
    deletionReason: null,
    emailVerified: true,
    institutionName: "BoardOps Residence",
    institutionUserId: "RES-305",
  },
];

const NOTIFICATIONS = [
  {
    id: "notif-1",
    title: "Monthly statement is ready",
    description: "Your August statement is available for review.",
    type: "INFO",
    priority: "NORMAL",
    route: "billing",
    readAt: null,
    createdAt: new Date(Date.now() - 12 * 60 * 1000).toISOString(),
  },
  {
    id: "notif-2",
    title: "Payment recorded",
    description: "A payment of ₹2,500 was recorded successfully.",
    type: "SUCCESS",
    priority: "NORMAL",
    route: "payments",
    readAt: null,
    createdAt: new Date(Date.now() - 70 * 60 * 1000).toISOString(),
  },
  {
    id: "notif-3",
    title: "Dinner cutoff approaching",
    description: "Update tonight's dinner preference before the cutoff.",
    type: "WARNING",
    priority: "HIGH",
    route: "user-meals",
    readAt: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
    createdAt: new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString(),
  },
];

const THEME = {
  primary: "#8b5cf6",
  primaryForeground: "#ffffff",
  accent: "#10b981",
  radius: "1.25rem",
  mode: "system",
  preset: "violet",
  glassMode: "on",
  blurIntensity: "normal",
  transparency: "medium",
};

function mealEntries(params?: Record<string, unknown>) {
  const requested = typeof params?.date === "string" ? params.date : null;
  const keys = requested
    ? [requested]
    : Array.from({ length: 7 }, (_, i) => {
        const d = new Date();
        d.setDate(d.getDate() + i);
        return dateKey(d);
      });

  const byDate: Record<string, unknown[]> = {};
  for (const [dayIndex, key] of keys.entries()) {
    byDate[key] = MEALS.map((meal, mealIndex) => ({
      id: `${key}-${meal.id}`,
      mealId: meal.id,
      mealName: meal.name,
      mealDisplayName: meal.displayName,
      mealIcon: meal.icon,
      mealColor: meal.color,
      serviceDate: key,
      status: mealIndex === 2 && dayIndex % 3 === 1 ? "OFF" : "ON",
      originalState: "ON",
      overridden: mealIndex === 2 && dayIndex % 3 === 1,
      editableUntil: `${key}T16:00:00.000Z`,
      locked: dayIndex === 0 && mealIndex === 0,
      preRegistration: false,
      startTime: meal.startTime,
      endTime: meal.endTime,
      mealType: meal.mealType,
    }));
  }
  return { meals: MEALS, byDate, registrationDate: dateKey(new Date()) };
}

function dashboard() {
  return {
    todayMeals: MEALS.map((meal, index) => ({
      id: meal.id,
      name: meal.name,
      displayName: meal.displayName,
      icon: meal.icon,
      color: meal.color,
      startTime: meal.startTime,
      endTime: meal.endTime,
      status: index === 2 ? "OFF" : "ON",
      locked: index === 0,
      editableUntil: new Date(Date.now() + 4 * 60 * 60 * 1000).toISOString(),
    })),
    kpis: {
      totalUsers: 48,
      pendingUsers: 3,
      todayOnCount: 41,
      todayOffCount: 7,
      currentMealCharge: 74,
      totalResidentMeals: 1182,
      totalExpenses: 86420,
      pendingBills: 2,
    },
    trend: Array.from({ length: 7 }, (_, i) => ({ date: `Day ${i + 1}`, on: 35 + i, off: 8 - Math.min(i, 5) })),
    expenseBreakdown: [
      { category: "Groceries", amount: 48200 },
      { category: "Utilities", amount: 22100 },
      { category: "Maintenance", amount: 16120 },
    ],
    unreadNotifications: 2,
    recentActivity: [
      { id: "activity-1", action: "PAYMENT_RECORDED", createdAt: new Date(Date.now() - 25 * 60 * 1000).toISOString(), actor: { name: "Aarav Sharma" } },
      { id: "activity-2", action: "MEAL_UPDATED", createdAt: new Date(Date.now() - 90 * 60 * 1000).toISOString(), actor: { name: "Riya Sen" } },
    ],
    isAdmin: true,
  };
}

function parseBody(body: BodyInit | null | undefined): Record<string, unknown> {
  if (typeof body !== "string") return {};
  try {
    const value = JSON.parse(body);
    return value && typeof value === "object" ? value : {};
  } catch {
    return {};
  }
}

function envelope<T>(data: T) {
  return { success: true, data };
}

export async function visualFixtureApiFetch<T>(path: string, opts: VisualFetchOpts = {}): Promise<T> {
  const url = new URL(path, "https://boardops.visual.local");
  const pathname = url.pathname;
  const method = (opts.method || "GET").toUpperCase();
  const params = { ...Object.fromEntries(url.searchParams.entries()), ...(opts.params || {}) };
  const currentUser = useAuthStore.getState().user ?? VISUAL_ADMIN;

  if (pathname === "/auth/me") return envelope(currentUser) as T;
  if (pathname === "/auth/sessions") return envelope([]) as T;
  if (pathname === "/auth/profile") {
    const next = { ...currentUser, ...parseBody(opts.body) } as CurrentUser;
    useAuthStore.setState({ user: next });
    return envelope(next) as T;
  }
  if (pathname === "/auth/logout") return envelope({ ok: true }) as T;
  if (pathname === "/theme") return envelope(THEME) as T;
  if (pathname === "/dashboard") return envelope(dashboard()) as T;
  if (pathname === "/notifications") {
    return envelope({ notifications: NOTIFICATIONS, unreadCount: NOTIFICATIONS.filter((n) => !n.readAt).length }) as T;
  }
  if (pathname === "/meals/entries") return envelope(mealEntries(params)) as T;
  if (pathname === "/meals/config") return envelope(MEALS) as T;
  if (pathname === "/meals") return envelope(MEALS) as T;
  if (pathname === "/users") return envelope(USERS) as T;
  if (pathname.startsWith("/users/")) return envelope(USERS[1]) as T;
  if (pathname === "/leave" || pathname.startsWith("/leave/")) return envelope([]) as T;

  // Mutations are intentionally side-effect free in visual mode. They resolve
  // successfully so dialogs, optimistic states and interaction animations can
  // be exercised without touching a real database.
  if (method !== "GET") return envelope({ ok: true }) as T;

  // Unimplemented Phase-02 data domains intentionally fall back to an empty
  // collection. The production client never uses this branch because visual
  // fixtures are only enabled by the dedicated Vite visual mode.
  return envelope([]) as T;
}
