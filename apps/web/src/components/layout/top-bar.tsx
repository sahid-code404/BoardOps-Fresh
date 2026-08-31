"use client";

import { Bell, Check, Menu, Monitor, Moon, Search, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import { AnimatePresence, motion } from "framer-motion";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { api } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import { useAppStore } from "@/stores/use-app-store";
import { useAuthStore } from "@/stores/use-auth-store";
import { NAV_LABELS } from "./nav-config";

const AVATAR_GRADIENTS = [
  "from-violet-500 to-fuchsia-500",
  "from-emerald-500 to-teal-500",
  "from-amber-500 to-orange-500",
  "from-rose-500 to-pink-500",
  "from-cyan-500 to-blue-500",
  "from-indigo-500 to-purple-500",
];

function gradientFor(name: string) {
  const idx = name.split("").reduce((acc, c) => acc + c.charCodeAt(0), 0) % AVATAR_GRADIENTS.length;
  return AVATAR_GRADIENTS[idx];
}

function initials(name: string) {
  return name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}

function formatBadge(count: number): string {
  if (count > 99) return "99+";
  return String(count);
}

export function TopBar() {
  const { resolvedTheme, theme, setTheme } = useTheme();
  const view = useAppStore((state) => state.view);
  const setView = useAppStore((state) => state.setView);
  const setCommandOpen = useAppStore((state) => state.setCommandOpen);
  const setSidebarOpen = useAppStore((state) => state.setSidebarOpen);
  const user = useAuthStore((state) => state.user);
  const setUser = useAuthStore((state) => state.setUser);
  const token = useAuthStore((state) => state.token);
  const isDark = resolvedTheme === "dark";

  const handleThemeChange = (nextTheme: string) => {
    setTheme(nextTheme);
    if (user) {
      setUser({ ...user, theme: nextTheme });
      api.put("/auth/profile", { theme: nextTheme }).catch(() => {});
    }
  };

  const { data: unreadCount } = useQuery({
    queryKey: ["notifications", "unread-count"],
    queryFn: async () => {
      const response = await api.get<{
        success: boolean;
        data: { unreadCount: number };
      }>("/notifications?unread=true");
      return response.data;
    },
    enabled: !!token,
    refetchInterval: 30_000,
    staleTime: 10_000,
  });

  const unreadNum = unreadCount?.unreadCount ?? 0;
  const showBadge = unreadNum > 0;
  const label = NAV_LABELS[view] ?? "BoardOps";

  return (
    <header className="sticky top-0 z-30 safe-top px-3 sm:px-4 lg:px-6 pt-3">
      <div className="mx-auto max-w-6xl glass rounded-3xl px-3 py-2.5 flex items-center gap-1.5 sm:gap-2">
        <motion.button
          whileTap={{ scale: 0.9 }}
          onClick={() => setSidebarOpen(true)}
          aria-label="Open menu"
          className="grid place-items-center h-10 w-10 rounded-2xl glass-soft text-foreground shrink-0"
        >
          <Menu className="h-5 w-5" />
        </motion.button>

        <div className="flex-1 min-w-0">
          <motion.p
            key={view}
            initial={{ opacity: 0, x: -8 }}
            animate={{ opacity: 1, x: 0 }}
            className="text-[10px] text-muted-foreground leading-tight truncate"
          >
            {user?.role === "ADMIN" || user?.role === "SUPER_ADMIN" ? "Admin Console" : "Workspace"}
          </motion.p>
          <motion.h1
            key={`${view}-title`}
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            className="text-sm font-semibold leading-tight truncate"
          >
            {label}
          </motion.h1>
        </div>

        <motion.button
          whileTap={{ scale: 0.9 }}
          onClick={() => setCommandOpen(true)}
          aria-label="Search"
          className="hidden sm:grid place-items-center h-10 w-10 rounded-2xl glass-soft text-muted-foreground hover:text-foreground shrink-0"
        >
          <Search className="h-[18px] w-[18px]" />
        </motion.button>

        <ThemeSwitcher
          isDark={isDark}
          onThemeChange={handleThemeChange}
          currentTheme={user?.theme || theme || "system"}
        />

        <motion.button
          whileTap={{ scale: 0.9 }}
          onClick={() => setView("notifications")}
          aria-label={`Notifications${showBadge ? ` (${formatBadge(unreadNum)} unread)` : ""}`}
          className={cn(
            "relative grid place-items-center h-10 w-10 rounded-2xl glass-soft transition-colors shrink-0",
            view === "notifications" ? "text-primary ring-2 ring-primary/50" : "text-foreground"
          )}
        >
          <Bell className="h-[18px] w-[18px]" />
          <AnimatePresence>
            {showBadge && (
              <motion.span
                key={unreadNum}
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                exit={{ scale: 0 }}
                transition={{ type: "spring", stiffness: 500, damping: 25 }}
                className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 rounded-full bg-destructive text-white text-[10px] font-bold grid place-items-center ring-2 ring-background"
              >
                {formatBadge(unreadNum)}
              </motion.span>
            )}
          </AnimatePresence>
        </motion.button>

        <motion.button
          whileTap={{ scale: 0.9 }}
          whileHover={{ scale: 1.06 }}
          onClick={() => setView("profile")}
          aria-label="Open profile"
          className={cn(
            "relative grid place-items-center h-10 w-10 rounded-2xl overflow-hidden shrink-0",
            "ring-2 ring-border/50 hover:ring-primary/60 transition-all",
            view === "profile" && "ring-primary"
          )}
        >
          {user?.avatarUrl ? (
            <Avatar className="h-full w-full rounded-2xl">
              <AvatarImage src={user.avatarUrl} alt={user?.name || "Profile"} />
            </Avatar>
          ) : (
            <Avatar className="h-full w-full rounded-2xl">
              <AvatarFallback
                className={cn(
                  "rounded-2xl bg-gradient-to-br text-white font-bold text-xs h-full w-full grid place-items-center",
                  gradientFor(user?.name || "U")
                )}
              >
                {user?.name ? initials(user.name) || "U" : "U"}
              </AvatarFallback>
            </Avatar>
          )}
          {view === "profile" && (
            <span className="absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full bg-primary ring-2 ring-background" />
          )}
        </motion.button>
      </div>
    </header>
  );
}

function ThemeSwitcher({
  isDark,
  onThemeChange,
  currentTheme,
}: {
  isDark: boolean;
  onThemeChange: (theme: string) => void;
  currentTheme: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClick(event: MouseEvent) {
      if (ref.current && !ref.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }

    if (open) {
      document.addEventListener("mousedown", handleClick);
      return () => document.removeEventListener("mousedown", handleClick);
    }
  }, [open]);

  const options = [
    { value: "light", label: "Light", icon: Sun },
    { value: "dark", label: "Dark", icon: Moon },
    { value: "system", label: "System", icon: Monitor },
  ];

  return (
    <div ref={ref} className="relative shrink-0">
      <motion.button
        whileTap={{ scale: 0.9 }}
        whileHover={{ scale: 1.05 }}
        onClick={() => setOpen((value) => !value)}
        aria-label="Theme switcher"
        aria-expanded={open}
        suppressHydrationWarning
        className="grid place-items-center h-10 w-10 rounded-2xl glass-soft text-foreground hover:text-primary transition-colors"
      >
        <AnimatePresence mode="wait">
          <motion.div
            key={isDark ? "sun" : "moon"}
            initial={{ rotate: -90, opacity: 0, scale: 0.5 }}
            animate={{ rotate: 0, opacity: 1, scale: 1 }}
            exit={{ rotate: 90, opacity: 0, scale: 0.5 }}
            transition={{ duration: 0.2 }}
          >
            {isDark ? <Sun className="h-[18px] w-[18px]" /> : <Moon className="h-[18px] w-[18px]" />}
          </motion.div>
        </AnimatePresence>
      </motion.button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -6, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -6, scale: 0.96 }}
            transition={{ duration: 0.15 }}
            className="absolute right-0 top-12 z-50 glass-strong rounded-2xl p-1.5 min-w-[150px] shadow-xl"
          >
            {options.map((option) => {
              const active = currentTheme === option.value;
              const Icon = option.icon;
              return (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => {
                    onThemeChange(option.value);
                    setOpen(false);
                  }}
                  className={cn(
                    "w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-sm font-medium transition-colors",
                    active
                      ? "bg-primary text-primary-foreground shadow-md shadow-primary/30"
                      : "text-muted-foreground hover:text-foreground hover:bg-secondary/40"
                  )}
                >
                  <Icon className="h-4 w-4" />
                  <span className="flex-1 text-left">{option.label}</span>
                  <AnimatePresence>
                    {active && (
                      <motion.div
                        initial={{ scale: 0, rotate: -180 }}
                        animate={{ scale: 1, rotate: 0 }}
                        exit={{ scale: 0, rotate: 180 }}
                        transition={{ type: "spring", stiffness: 500, damping: 20 }}
                      >
                        <Check className="h-5 w-5" strokeWidth={3} />
                      </motion.div>
                    )}
                  </AnimatePresence>
                </button>
              );
            })}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
