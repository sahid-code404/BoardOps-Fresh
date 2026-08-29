"use client";

import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api-client";
import { GlassCard } from "@/components/glass/glass-card";
import { AnimatedCounter } from "@/components/glass/animated-counter";
import { StaggerGroup, StaggerItem } from "@/components/glass/page-transition";
import { ShimmerSkeleton } from "@/components/glass/shimmer-skeleton";
import { useAppStore } from "@/stores/use-app-store";
import { useAuthStore } from "@/stores/use-auth-store";
import { Users, Utensils, Wallet, Receipt, TrendingUp, Bell, ArrowUpRight, Activity, Clock } from "lucide-react";
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
  recentActivity: Array<any>;
  isAdmin: boolean;
};


export function DashboardView() {
  const user = useAuthStore((s) => s.user);
  const setView = useAppStore((s) => s.setView);
  const { data, isLoading } = useQuery({
    queryKey: ["dashboard"],
    queryFn: async () => {
      const r = await api.get<{ success: boolean; data: DashboardData }>("/dashboard");
      return r.data;
    },
    refetchInterval: 30000,
    // Keep previous data visible while a refetch is in flight (every 30s) so
    // the dashboard doesn't flash empty during background refreshes.
    placeholderData: (prev) => prev,
  });

  if (isLoading || !data) {
    return (
      <div className="space-y-4">
        <div className="grid-kpi gap-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <ShimmerSkeleton key={i} className="h-32" />
          ))}
        </div>
      </div>
    );
  }

  const kpis = data.isAdmin
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
      ];

  return (
    <StaggerGroup className="space-y-4">
      {/* Time-based greeting with gradient name */}
      <StaggerItem>
        <GlassCard className="p-5" hover={false} glow="primary">
          <p className="text-sm text-muted-foreground mb-2">
            {new Date().toLocaleDateString("en-US", { weekday: "long", day: "numeric", month: "long" })}
          </p>
          <h2 className="text-2xl font-bold flex items-baseline gap-1.5 flex-wrap">
            <span>{getTimeGreeting().greeting},</span>
            {((user?.role === "ADMIN" || user?.role === "SUPER_ADMIN") && (
              <span className={cn("bg-gradient-to-r bg-clip-text text-transparent", getGradientForName(user?.name || "User"))}>
                Admin
              </span>
            ))}
            <span className={cn("bg-gradient-to-r bg-clip-text text-transparent", getGradientForName(user?.name || "User"))}>
              {user?.name.split(" ")[0]}
            </span>
            <span className="text-3xl">{getTimeGreeting().emoji}</span>
          </h2>
        </GlassCard>
      </StaggerItem>

      {/* KPIs */}
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

      {/* Recent Activity (admin only) */}
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
    </StaggerGroup>
  );
}
