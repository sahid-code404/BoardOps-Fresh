export const VIEW_PATHS = {
  dashboard: "/dashboard",
  meals: "/meals",
  "user-meals": "/user-meals",
  kitchen: "/kitchen",
  billing: "/billing",
  payments: "/payments",
  expenses: "/expenses",
  funds: "/funds",
  "monthly-closing": "/monthly-closing",
  "formula-engine": "/formula-engine",
  users: "/users",
  notifications: "/notifications",
  settings: "/settings",
  system: "/system",
  profile: "/profile",
} as const;

export type ViewKey = keyof typeof VIEW_PATHS;

const VIEW_KEYS = Object.keys(VIEW_PATHS) as ViewKey[];
const PATH_TO_VIEW = new Map<string, ViewKey>(
  VIEW_KEYS.map((view) => [VIEW_PATHS[view], view]),
);

function normalizePathname(pathname: string): string {
  if (!pathname || pathname === "/") return "/";
  const normalized = pathname.replace(/\/+$/, "");
  return normalized || "/";
}

export function isViewKey(value: string | null | undefined): value is ViewKey {
  return !!value && VIEW_KEYS.includes(value as ViewKey);
}

export function viewFromPathname(pathname: string): ViewKey | null {
  const normalized = normalizePathname(pathname);
  if (normalized === "/") return "dashboard";
  return PATH_TO_VIEW.get(normalized) ?? null;
}

export function pathForView(view: ViewKey): string {
  return VIEW_PATHS[view];
}

export function viewFromLocation(location: Pick<Location, "pathname" | "search">): ViewKey | null {
  const legacyView = new URLSearchParams(location.search).get("view");
  if (isViewKey(legacyView)) return legacyView;
  return viewFromPathname(location.pathname);
}

export function browserUrlForView(view: ViewKey): string {
  if (typeof window === "undefined") return pathForView(view);

  const url = new URL(window.location.href);
  url.pathname = pathForView(view);
  url.searchParams.delete("view");
  return `${url.pathname}${url.search}${url.hash}`;
}
