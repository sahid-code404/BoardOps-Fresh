"use client";

import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAuthStore, type CurrentUser } from "@/stores/use-auth-store";
import { AuthScreen } from "@/components/features/auth/auth-screen";
import { AppShell } from "@/components/layout/app-shell";
import { LazyViewRouter } from "@/components/layout/lazy-view-router";
import { AnimatedBackground } from "@/components/glass/animated-background";
import { GlassButton } from "@/components/glass/glass-button";
import { api, ApiError } from "@/lib/api-client";
import { VISUAL_FIXTURES_ENABLED } from "@/lib/visual-fixtures";
import { preloadAllViews } from "@/lib/view-loaders";
import { ShieldX } from "lucide-react";
import { useAppStore } from "@/stores/use-app-store";
import { CommandPalette } from "@/components/layout/command-palette";
import { ShimmerSkeleton } from "@/components/glass/shimmer-skeleton";

type IdleCapableWindow = Window & {
  requestIdleCallback?: (callback: () => void, options?: { timeout?: number }) => number;
  cancelIdleCallback?: (handle: number) => void;
};

export default function BoardOpsApp() {
  const token = useAuthStore((s) => s.token);
  const user = useAuthStore((s) => s.user);
  const setUser = useAuthStore((s) => s.setUser);
  const clearAuth = useAuthStore((s) => s.logout);
  const view = useAppStore((s) => s.view);
  const forceAuthPreview =
    VISUAL_FIXTURES_ENABLED &&
    typeof window !== "undefined" &&
    new URLSearchParams(window.location.search).get("auth") === "1";

  const { isLoading, isError } = useQuery({
    queryKey: ["auth-me", token],
    queryFn: async () => {
      const r = await api.get<{ success: boolean; data: CurrentUser }>("/auth/me");
      setUser(r.data);
      return r.data;
    },
    enabled: !!token && !forceAuthPreview,
    retry: (failureCount, error) => {
      if (failureCount >= 3) return false;
      return !(error instanceof ApiError) || error.status >= 500;
    },
    retryDelay: (attempt) => Math.min(250 * 2 ** attempt, 1500),
    staleTime: 60 * 1000,
  });

  // Once the authenticated shell has painted, warm the remaining section
  // chunks during idle time. Initial render stays light, while later navigation
  // is effectively instant without making route downloads block first paint.
  useEffect(() => {
    if (!token || !user || forceAuthPreview) return;

    const idleWindow = window as IdleCapableWindow;
    let timeoutId: ReturnType<typeof globalThis.setTimeout> | undefined;
    let idleId: number | undefined;
    const warm = () => void preloadAllViews();

    if (idleWindow.requestIdleCallback) {
      idleId = idleWindow.requestIdleCallback(warm, { timeout: 1500 });
    } else {
      timeoutId = globalThis.setTimeout(warm, 250);
    }

    return () => {
      if (idleId !== undefined) idleWindow.cancelIdleCallback?.(idleId);
      if (timeoutId !== undefined) globalThis.clearTimeout(timeoutId);
    };
  }, [token, user?.id, forceAuthPreview]);

  // Visual CI needs a deterministic way to exercise the unauthenticated
  // golden-master surface even though fixture mode normally injects an admin
  // session before React mounts. This branch is compiled out of normal runtime
  // behavior because VISUAL_FIXTURES_ENABLED is false outside visual mode.
  if (forceAuthPreview) {
    return <AuthScreen />;
  }

  // Never trust a persisted user until the server has validated the session.
  // This prevents a stale localStorage snapshot from mounting the whole shell
  // while `/auth/me` is still failing during a cold local startup.
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

  if (isError && token) {
    queueMicrotask(() => clearAuth());
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
