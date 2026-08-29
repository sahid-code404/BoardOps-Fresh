"use client";

import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTheme } from "next-themes";
import { useAuthStore, type CurrentUser } from "@/stores/use-auth-store";
import { AuthScreen } from "@/components/features/auth/auth-screen";
import { AppShell } from "@/components/layout/app-shell";
import { LazyViewRouter } from "@/components/layout/lazy-view-router";
import { AnimatedBackground } from "@/components/glass/animated-background";
import { GlassButton } from "@/components/glass/glass-button";
import { api, ApiError } from "@/lib/api-client";
import { VISUAL_FIXTURES_ENABLED } from "@/lib/visual-fixtures";
import { preloadAllViews, preloadPriorityViews } from "@/lib/view-loaders";
import { RefreshCw, ShieldX, WifiOff } from "lucide-react";
import { useAppStore } from "@/stores/use-app-store";
import { CommandPalette } from "@/components/layout/command-palette";
import { ShimmerSkeleton } from "@/components/glass/shimmer-skeleton";

type IdleCapableWindow = Window & {
  requestIdleCallback?: (callback: () => void, options?: { timeout?: number }) => number;
  cancelIdleCallback?: (handle: number) => void;
};

const ACCOUNT_THEMES = new Set(["light", "dark", "system"]);

export default function BoardOpsApp() {
  const token = useAuthStore((s) => s.token);
  const user = useAuthStore((s) => s.user);
  const setUser = useAuthStore((s) => s.setUser);
  const clearAuth = useAuthStore((s) => s.logout);
  const view = useAppStore((s) => s.view);
  const { theme, setTheme } = useTheme();
  const forceAuthPreview =
    VISUAL_FIXTURES_ENABLED &&
    typeof window !== "undefined" &&
    new URLSearchParams(window.location.search).get("auth") === "1";
  const authenticatedAdmin = user?.role === "ADMIN" || user?.role === "SUPER_ADMIN";

  const { isLoading, isError, error, refetch, isFetching } = useQuery({
    queryKey: ["auth-me", token],
    queryFn: async () => {
      const response = await api.get<{ success: boolean; data: CurrentUser }>("/auth/me");
      setUser(response.data);
      return response.data;
    },
    enabled: !!token && !forceAuthPreview,
    retry: (failureCount, queryError) => {
      if (failureCount >= 3) return false;
      return !(queryError instanceof ApiError) || queryError.status >= 500;
    },
    retryDelay: (attempt) => Math.min(250 * 2 ** attempt, 1500),
    staleTime: 60 * 1000,
  });

  const authRejected =
    error instanceof ApiError && (error.status === 401 || error.status === 403);

  // Only an explicit authentication rejection clears the local session hint.
  // A temporary Worker/network/5xx failure must not sign a valid user out or
  // replace the entire app with a misleading login screen.
  useEffect(() => {
    if (authRejected && token && !forceAuthPreview) clearAuth();
  }, [authRejected, token, forceAuthPreview, clearAuth]);

  // The account profile is authoritative for the user's appearance preference.
  // Without this sync, a browser-local next-themes value could disagree with
  // Profile/TopBar after login on another device (for example the UI renders
  // dark while the menu says System). Visual fixture mode deliberately keeps
  // its test-controlled local theme instead of applying fixture profile data.
  useEffect(() => {
    if (VISUAL_FIXTURES_ENABLED || !token || !user?.theme) return;
    if (!ACCOUNT_THEMES.has(user.theme) || user.theme === theme) return;
    setTheme(user.theme);
  }, [token, user?.theme, theme, setTheme]);

  // Warm high-probability navigation immediately after the authenticated shell
  // paints, then fill the remaining route cache during idle time. This keeps
  // first paint lean while removing the "click, wait for a large Vite chunk"
  // feeling from Profile / Counts / Payments / Users / Notifications.
  useEffect(() => {
    if (!token || !user || forceAuthPreview) return;

    void preloadPriorityViews(authenticatedAdmin);

    const idleWindow = window as IdleCapableWindow;
    let timeoutId: ReturnType<typeof globalThis.setTimeout> | undefined;
    let idleId: number | undefined;
    const warmRest = () => void preloadAllViews();

    if (idleWindow.requestIdleCallback) {
      idleId = idleWindow.requestIdleCallback(warmRest, { timeout: 900 });
    } else {
      timeoutId = globalThis.setTimeout(warmRest, 120);
    }

    return () => {
      if (idleId !== undefined) idleWindow.cancelIdleCallback?.(idleId);
      if (timeoutId !== undefined) globalThis.clearTimeout(timeoutId);
    };
  }, [token, user?.id, authenticatedAdmin, forceAuthPreview]);

  // Visual CI needs a deterministic way to exercise the unauthenticated
  // golden-master surface even though fixture mode normally injects an admin
  // session before React mounts. This branch is compiled out of normal runtime
  // behavior because VISUAL_FIXTURES_ENABLED is false outside visual mode.
  if (forceAuthPreview) {
    return <AuthScreen />;
  }

  // Never trust a persisted user until the server has validated the session.
  // This prevents a stale localStorage snapshot from mounting the whole shell
  // while `/auth/me` is still pending during a cold local startup.
  if (token && isLoading) {
    return (
      <div className="min-h-screen grid place-items-center safe-top safe-bottom">
        <AnimatedBackground />
        <div className="space-y-3 w-72">
          <ShimmerSkeleton className="h-12 w-12 rounded-3xl mx-auto" />
          <ShimmerSkeleton className="h-4 w-3/4 mx-auto" />
          <ShimmerSkeleton className="h-3 w-1/2 mx-auto" />
        </div>
      </div>
    );
  }

  if (isError && token && !authRejected) {
    return (
      <div className="min-h-screen grid place-items-center safe-top safe-bottom px-4">
        <AnimatedBackground />
        <div className="relative z-10 glass-strong rounded-3xl p-6 w-full max-w-sm text-center space-y-4">
          <div className="grid place-items-center h-14 w-14 rounded-3xl bg-warning/15 text-warning mx-auto">
            <WifiOff className="h-6 w-6" />
          </div>
          <div className="space-y-1.5">
            <h1 className="text-lg font-semibold">Unable to verify your session</h1>
            <p className="text-sm text-muted-foreground">
              BoardOps could not reach the session service. Your sign-in state has been kept so a temporary outage does not log you out.
            </p>
          </div>
          <GlassButton className="w-full" onClick={() => void refetch()} loading={isFetching}>
            <RefreshCw className="h-4 w-4" />
            Try Again
          </GlassButton>
        </div>
      </div>
    );
  }

  if (authRejected && token) {
    return <AuthScreen />;
  }

  if (!token || !user) {
    return <AuthScreen />;
  }

  const userRole = user.role || "USER";
  const isAdmin = userRole === "ADMIN" || userRole === "SUPER_ADMIN";

  // Permission guard: residents can only access their allowed views.
  // Phase 05 replaces this compatibility guard with backend-enforced RBAC.
  const adminOnlyViews = ["meals", "kitchen", "expenses", "funds", "monthly-closing", "formula-engine", "users", "settings", "system"];
  const isForbidden = !isAdmin && adminOnlyViews.includes(view);

  if (isForbidden) {
    return (
      <>
        <AnimatedBackground />
        <AppShell>
          <div className="min-h-[60vh] grid place-items-center">
            <div className="text-center space-y-3">
              <div className="grid place-items-center h-16 w-16 rounded-3xl bg-destructive/10 mx-auto">
                <ShieldX className="h-8 w-8 text-destructive" />
              </div>
              <h2 className="text-xl font-bold">Access Restricted</h2>
              <p className="text-sm text-muted-foreground max-w-xs">
                You don&apos;t have permission to access this section. Contact your administrator if you believe this is incorrect.
              </p>
              <GlassButton size="sm" onClick={() => useAppStore.getState().setView("dashboard")}>
                Back to Dashboard
              </GlassButton>
            </div>
          </div>
        </AppShell>
      </>
    );
  }

  return (
    <>
      <AnimatedBackground />
      <AppShell>
        <LazyViewRouter view={view} isAdmin={isAdmin} />
      </AppShell>
      <CommandPalette />
    </>
  );
}
