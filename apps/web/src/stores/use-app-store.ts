"use client";

import { create } from "zustand";
import { preloadView } from "@/lib/view-loaders";
import {
  browserUrlForView,
  isViewKey,
  viewFromLocation,
  type ViewKey,
} from "@/lib/view-routes";

export type { ViewKey } from "@/lib/view-routes";

type NavigationOptions = {
  replace?: boolean;
  syncUrl?: boolean;
};

type AppState = {
  view: ViewKey;
  setView: (v: ViewKey, options?: NavigationOptions) => void;
  sidebarOpen: boolean;
  setSidebarOpen: (v: boolean) => void;
  commandOpen: boolean;
  setCommandOpen: (v: boolean) => void;
  notificationsOpen: boolean;
  setNotificationsOpen: (v: boolean) => void;
  pendingAction: { label: string; description?: string } | null;
  setPendingAction: (a: { label: string; description?: string } | null) => void;
};

let navigationSequence = 0;

function currentView(): ViewKey {
  if (typeof window === "undefined") return "dashboard";
  return viewFromLocation(window.location) ?? "dashboard";
}

function writeViewUrl(view: ViewKey, replace = false) {
  if (typeof window === "undefined") return;

  const next = browserUrlForView(view);
  const current = `${window.location.pathname}${window.location.search}${window.location.hash}`;
  if (next === current) return;

  const method = replace ? "replaceState" : "pushState";
  window.history[method]({ boardopsView: view }, "", next);
}

export const useAppStore = create<AppState>()((set) => ({
  // The browser URL is the canonical navigation state. Do not persist `view`
  // in localStorage; stale persisted views were fighting direct URLs on reload.
  view: currentView(),
  setView: (v, options = {}) => {
    // `ViewKey` protects normal TypeScript callers, but server-provided routes
    // (notifications/activity) are runtime strings and older ported components
    // can still reach this boundary through a cast. Never let an unknown value
    // index the route-loader table or corrupt browser navigation.
    const requested = v as unknown as string;
    if (!isViewKey(requested)) {
      console.warn(`Ignored invalid BoardOps navigation target: ${requested}`);
      return;
    }

    const safeView = requested;
    const requestId = ++navigationSequence;

    // Keep the current screen mounted until the requested route chunk is ready.
    // This preserves code splitting without flashing a full-page Suspense
    // skeleton every time the user changes sections.
    void preloadView(safeView)
      .then(() => {
        if (requestId !== navigationSequence) return;
        set({ view: safeView });
        if (options.syncUrl !== false) writeViewUrl(safeView, options.replace);
      })
      .catch((error) => {
        console.error(`Failed to preload BoardOps view: ${safeView}`, error);
      });
  },
  sidebarOpen: false,
  setSidebarOpen: (v) => set({ sidebarOpen: v }),
  commandOpen: false,
  setCommandOpen: (v) => set({ commandOpen: v }),
  notificationsOpen: false,
  setNotificationsOpen: (v) => set({ notificationsOpen: v }),
  pendingAction: null,
  setPendingAction: (a) => set({ pendingAction: a }),
}));

export function installViewRouteSync(): () => void {
  if (typeof window === "undefined") return () => {};

  const initial = viewFromLocation(window.location) ?? "dashboard";
  useAppStore.setState({ view: initial });

  // Canonicalize `/`, unknown paths, and the old `?view=` test URLs to stable
  // browser routes while preserving unrelated query parameters (for example
  // the visual fixture `role=user` switch).
  writeViewUrl(initial, true);

  const onPopState = () => {
    const next = viewFromLocation(window.location) ?? "dashboard";
    useAppStore.getState().setView(next, { syncUrl: false });
  };

  window.addEventListener("popstate", onPopState);
  return () => window.removeEventListener("popstate", onPopState);
}
