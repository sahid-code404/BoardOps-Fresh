"use client";

import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api-client";
import { GlassCard } from "@/components/glass/glass-card";
import { AnimatedCounter } from "@/components/glass/animated-counter";
import { StaggerGroup, StaggerItem } from "@/components/glass/page-transition";
import { ShimmerSkeleton } from "@/components/glass/shimmer-skeleton";
import { useAppStore } from "@/stores/use-app-store";
import { useAuthStore } from "@/stores/use-auth-store";
import {
  Users,
  Utensils,
  Wallet,
  Receipt,
  TrendingUp,
  Bell,
  ArrowUpRight,
  Activity,
  Clock,
  ShieldCheck,
  Mail,
  Phone,
} from "lucide-react";
import { motion } from "framer-motion";
import { getTimeGreeting, getGradientForName } from "@/lib/greetings";
import { cn } from "@/lib/utils";

type DashboardData = {
  todayMeals: Array<{
    id: string;
    name: string;
    displayName: string;
    icon: string;
    color: string;
    startTime: string;
    endTime: string;
    status: string;
    locked: boolean;
    editableUntil: string;
  }>;
  kpis: {
    totalUsers: number;
    pendingUsers: number;
    todayOnCount: number;
    todayOffCount: number;
    currentMealCharge: number;
    totalResidentMeals: number;
    totalExpenses: number;
    pendingBills: number;
  };
  trend: Array<{ date: string; on: number; off: number }>;
  expenseBreakdown: Array<{ category: string; amount: number }>;
  unreadNotifications: number;
  recentActivity: Array<{
    id: string;
    action: string;
    createdAt: string;
    actor?: { name: string; email?: string } | null;
  }>;
  isAdmin: boolean;
};

function AccountSummary() {
  const user = useAuthStore((s) => s.user);
  const setView = useAppStore((s) => s.setView);
  if (!user || (user.role !== "ADMIN" && user.role !== "SUPER_ADMIN")) return null;

  const lastLogin = user.lastLoginAt
    ? new Date(user.lastLoginAt).toLocaleString("en-IN", {
        day: "2-digit",
        month: "short",
        hour: "2-digit",
        minute: "2-digit",
      })
    : "Current session";

  return (
    <StaggerItem>
      <GlassCard className="p-4 overflow-hidden" hover={false} glow="primary">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <div className="grid place-items-center h-8 w-8 rounded-xl bg-primary/15 text-primary shrink-0">
                <ShieldCheck className="h-4 w-4" />
              </div>
              <div className="min-w-0">
                <p className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground">Signed in administrator</p>
                <p className="font-semibold truncate">{user.name}</p>
              </div>
            </div>
            <div className="mt-3 flex flex-wrap gap-x-4 gap-y-2 text-xs text-muted-foreground">
              <span className="inline-flex items-center gap-1.5 min-w-0">
                <Mail className="h-3.5 w-3.5 shrink-0" />
                <span className="truncate">{user.email}</span>
              </span>
              {user.phone && (
                <span className="inline-flex items-center gap-1.5">
                  <Phone className="h-3.5 w-3.5" />
                  {user.phone}
                </span>
              )}
              <span className="inline-flex items-center gap-1.5">
                <Clock className="h-3.5 w-3.5" />
                Last login {lastLogin}
              </span>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <span className="rounded-full bg-success/15 px-2.5 py-1 text-[11px] font-medium text-success">
              {user.status}
            </span>
            <span className="rounded-full bg-primary/15 px-2.5 py-1 text-[11px] font-medium text-primary">
              {user.role === "SUPER_ADMIN" ? "Super Admin" : "Admin"}
            </span>
            <button
              type="button"
              onClick={() => setView("profile")}
              className="rounded-xl bg-secondary/60 px-3 py-2 text-xs font-medium hover:bg-secondary transition-colors"
            >
              View profile
            </button>
          </div>
        </div>
      </GlassCard>
    </StaggerItem>
  );
}

function GreetingCard() {
  const user = useAuthStore((s) => s.user);
  return (
    <StaggerItem>
      <GlassCard className="p-5" hover={false} glow="primary">
        <p className="text-sm text-muted-foreground mb-2">
          {new Date().toLocaleDateString("en-US", { weekday: "long", day: "numeric", month: "long" })}
        </p>
        <h2 className="text-2xl font-bold flex items-baseline gap-1.5 flex-wrap">
          <span>{getTimeGreeting().greeting},</span>
          {(user?.role === "ADMIN" || user?.role === "SUPER_ADMIN") && (
            <span className={cn("bg-gradient-to-r bg-clip-text text-transparent", getGradientForName(user?.name || "User"))}>
              Admin
            </span>
          )}
          <span className={cn("bg-gradient-to-r bg-clip-text text-transparent", getGradientForName(user?.name || "User"))}>
            {user?.name.split(" ")[0] || "User"}
          </span>
          <span className="text-3xl">{getTimeGreeting().emoji}</span>
        </h2>
      </GlassCard>
    </StaggerItem>
  );
}

export function DashboardView() {
  const setView = useAppStore((s) => s.setView);
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["dashboard"],
    queryFn: async () => {
      const r = await api.get<{ success: boolean; data: DashboardData }>("/dashboard");
      return r.data;
    },
    refetchInterval: 30_000,
    staleTime: 10_000,
    retry: 1,
    placeholderData: (prev) => prev,
  });

  const kpis = data
    ? data.isAdmin
      ? [
          { label: "Total Users", value: data.kpis.totalUsers, icon: Users, color: "primary", change: "active members", route: "users" as const },
          { label: "Meals ON Today", value: data.kpis.todayOnCount, icon: Utensils, color: "success", change: `${data.kpis.todayOffCount} OFF`, route: "kitchen" as const },
          { label: "Expenses (Month)", value: data.kpis.totalExpenses, icon: Wallet, color: "warning", change: `₹${data.kpis.totalExpenses.toLocaleString("en-IN")}`, prefix: "₹", route: "expenses" as const },
          { label: "Meal Charge", value: data.kpis.currentMealCharge, icon: TrendingUp, color: "info", change: `${data.kpis.totalResidentMeals} meals`, prefix: "₹", route: "billing" as const },
        ]
      : [
          { label: "Meals ON Today", value: data.todayMeals.filter((m) => m.status === "ON").length, icon: Utensils, color: "success", change: `${data.todayMeals.filter((m) => m.status === "OFF").length} OFF`, route: "billing" as const },
          { label: "Pending Bills", value: data.kpis.pendingBills, icon: Receipt, color: "warning", change: "view billing", route: "billing" as const },
          { label: "Notifications", value: data.unreadNotifications, icon: Bell, color: "primary", change: "unread", route: "notifications" as const },
          { label: "Meals This Week", value: data.trend.reduce((s, t) => s + t.on, 0), icon: Activity, color: "info", change: "7-day total", route: "billing" as const },
        ]
    : [];

  return (
    <StaggerGroup className="space-y-4">
      <GreetingCard />
      <AccountSummary />

      {isLoading && !data && (
        <StaggerItem>
          <div className="grid-kpi gap-3" aria-label="Loading dashboard data">
            {Array.from({ length: 4 }).map((_, i) => (
              <ShimmerSkeleton key={i} className="h-32" />
            ))}
          </div>
        </StaggerItem>
      )}

      {isError && !data && (
        <StaggerItem>
          <GlassCard className="p-6 text-center" hover={false}>
            <h2 className="text-lg font-semibold">Dashboard data unavailable</h2>
            <p className="mt-2 text-sm text-muted-foreground">
              Your account is loaded, but the dashboard summary could not be fetched.
            </p>
            <button
              type="button"
              onClick={() => void refetch()}
              className="mt-4 inline-flex items-center justify-center rounded-2xl bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
            >
              Retry
            </button>
          </GlassCard>
        </StaggerItem>
      )}

      {data && (
        <>
          <StaggerItem>
            <div className="grid-kpi gap-3">
              {kpis.map((kpi) => {
                const Icon = kpi.icon;
                return (
                  <motion.button
                    key={kpi.label}
                    whileHover={{ scale: 1.02, y: -2 }}
                    whileTap={{ scale: 0.98 }}
                    onClick={() => setView(kpi.route)}
                    className="text-left w-full"
                  >
                    <GlassCard className="p-4 cursor-pointer" glow={kpi.color as never}>
                      <div className="flex items-start justify-between mb-3">
                        <div
                          className="grid place-items-center h-10 w-10 rounded-2xl"
                          style={{
                            background: `color-mix(in oklch, var(--${kpi.color === "primary" ? "primary" : kpi.color === "success" ? "success" : kpi.color === "warning" ? "warning" : "info"}) 15%, transparent)`,
                          }}
                        >
                          <Icon className="h-5 w-5" style={{ color: `var(--${kpi.color === "primary" ? "primary" : kpi.color === "success" ? "success" : kpi.color === "warning" ? "warning" : "info"})` }} />
                        </div>
                        <ArrowUpRight className="h-4 w-4 text-muted-foreground" />
                      </div>
                      <p className="text-xs text-muted-foreground">{kpi.label}</p>
                      <div className="text-2xl font-bold tracking-tight">
                        <AnimatedCounter
                          value={kpi.value}
                          prefix={"prefix" in kpi ? kpi.prefix ?? "" : ""}
                        />
                      </div>
                      <p className="text-[11px] text-muted-foreground mt-1">{kpi.change}</p>
                    </GlassCard>
                  </motion.button>
                );
              })}
            </div>
          </StaggerItem>

          {data.isAdmin && data.recentActivity.length > 0 && (
            <StaggerItem>
              <GlassCard className="p-4" hover={false}>
                <h3 className="font-semibold mb-4">Recent Activity</h3>
                <div className="space-y-2">
                  {data.recentActivity.map((a) => (
                    <div key={a.id} className="glass-soft rounded-2xl p-3 flex items-start gap-3">
                      <div className="grid place-items-center h-8 w-8 rounded-xl bg-primary/15 shrink-0">
                        <Clock className="h-4 w-4 text-primary" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm">
                          <span className="font-medium">{a.actor?.name || "System"}</span>{" "}
                          <span className="text-muted-foreground">{a.action.toLowerCase().replace(/_/g, " ")}</span>
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {(() => {
                            const d = new Date(a.createdAt);
                            const datePart = d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
                            const timePart = d.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: true });
                            return `${datePart}, ${timePart}`;
                          })()}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              </GlassCard>
            </StaggerItem>
          )}
        </>
      )}
    </StaggerGroup>
  );
}
