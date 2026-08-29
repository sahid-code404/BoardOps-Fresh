"use client";

import { Bell, Search, Sun, Moon, Menu, Monitor, Check } from "lucide-react";
import { useTheme } from "next-themes";
import { motion, AnimatePresence } from "framer-motion";
import { useQuery } from "@tanstack/react-query";
import { useAppStore } from "@/stores/use-app-store";
import { useAuthStore } from "@/stores/use-auth-store";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { NAV_LABELS } from "./nav-config";
import { api } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import { useState, useRef, useEffect } from "react";

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
    .map((p) => p[0]?.toUpperCase() ?? "")
    .join("");
}

function formatBadge(count: number): string {
  if (count > 99) return "99+";
  return String(count);
}

export function TopBar() {
  const { resolvedTheme, theme, setTheme } = useTheme();
  const view = useAppStore((s) => s.view);
  const setView = useAppStore((s) => s.setView);
  const setCommandOpen = useAppStore((s) => s.setCommandOpen);
  const setSidebarOpen = useAppStore((s) => s.setSidebarOpen);
  const user = useAuthStore((s) => s.user);
  const setUser = useAuthStore((s) => s.setUser);
  const token = useAuthStore((s) => s.token);
  const isDark = resolvedTheme === "dark";

  const handleThemeChange = (t: string) => {
    setTheme(t);
    if (user) {
      setUser({ ...user, theme: t });
      api.put("/auth/profile", { theme: t }).catch(() => {});
    }
  };

  const { data: unreadCount } = useQuery({
    queryKey: ["notifications", "unread-count"],
    queryFn: async () => {
      const res = await api.get<{
        success: boolean;
        data: {
          unreadCount: number;
          notifications: Array<{
            id: string;
            title: string;
            description: string | null;
            type: string;
            priority: string;
            route: string | null;
            readAt: string | null;
            createdAt: string;
          }>;
        };
      }>("/notifications?unread=true");
      return res.data;
    },
    enabled: !!token,
    refetchInterval: 30_000,
    staleTime: 10_000,
  });

  const unreadNum = unreadCount?.unreadCount ?? 0;
  const recentNotifs = unreadCount?.notifications ?? [];
  const [notifPanelOpen, setNotifPanelOpen] = useState(false);
  const notifRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!notifPanelOpen) return;

    const handlePointer = (event: MouseEvent) => {
      if (notifRef.current && !notifRef.current.contains(event.target as Node)) {
        setNotifPanelOpen(false);
      }
    };
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setNotifPanelOpen(false);
    };

    document.addEventListener("mousedown", handlePointer);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handlePointer);
      document.removeEventListener("keydown", handleKey);
    };
  }, [notifPanelOpen]);

  const label = NAV_LABELS[view] ?? "BoardOps";
  const showBadge = unreadNum > 0;

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

        <div className="relative shrink-0" ref={notifRef}>
          <motion.button
            whileTap={{ scale: 0.9 }}
            onClick={() => setNotifPanelOpen((open) => !open)}
            aria-label={`Notifications${showBadge ? ` (${formatBadge(unreadNum)} unread)` : ""}`}
            aria-expanded={notifPanelOpen}
            aria-haspopup="dialog"
            aria-controls="topbar-notifications-panel"
            className={cn(
              "relative grid place-items-center h-10 w-10 rounded-2xl glass-soft transition-colors",
              view === "notifications" || notifPanelOpen
                ? "text-primary ring-2 ring-primary/50"
                : "text-foreground"
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

          <AnimatePresence>
            {notifPanelOpen && (
              <motion.div
                id="topbar-notifications-panel"
                role="dialog"
                aria-label="Recent notifications"
                initial={{ opacity: 0, y: -8, scale: 0.96 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: -8, scale: 0.96 }}
                transition={{ duration: 0.15 }}
                className="absolute right-0 top-12 w-80 max-w-[calc(100vw-1.5rem)] glass rounded-3xl shadow-xl overflow-hidden z-50"
              >
                <div className="p-3 border-b border-border/50 flex items-center justify-between">
                  <p className="text-sm font-semibold">
                    Notifications {unreadNum > 0 && <span className="text-destructive">({unreadNum} unread)</span>}
                  </p>
                  <button
                    onClick={() => {
                      setNotifPanelOpen(false);
                      setView("notifications");
                    }}
                    className="text-[10px] text-primary hover:underline"
                  >
                    View all
                  </button>
                </div>
                <div className="max-h-80 overflow-y-auto">
                  {recentNotifs.length === 0 ? (
                    <div className="p-6 text-center">
                      <Check className="h-8 w-8 text-muted-foreground/40 mx-auto mb-2" />
                      <p className="text-xs text-muted-foreground">You're all caught up</p>
                    </div>
                  ) : (
                    recentNotifs.slice(0, 8).map((notification) => (
                      <button
                        key={notification.id}
                        onClick={() => {
                          setNotifPanelOpen(false);
                          if (notification.route) {
                            const viewKey = notification.route.replace(/^\//, "").split("/")[0] as never;
                            setView(viewKey);
                          } else {
                            setView("notifications");
                          }
                        }}
                        className="w-full text-left p-3 hover:bg-secondary/50 transition-colors border-b border-border/30 last:border-0 flex items-start gap-2"
                      >
                        <span
                          className={cn(
                            "h-2 w-2 rounded-full shrink-0 mt-1.5",
                            notification.priority === "URGENT"
                              ? "bg-destructive"
                              : notification.priority === "HIGH"
                                ? "bg-warning"
                                : "bg-primary"
                          )}
                        />
                        <div className="min-w-0 flex-1">
                          <p className="text-xs font-medium truncate">{notification.title}</p>
                          {notification.description && (
                            <p className="text-[10px] text-muted-foreground truncate">
                              {notification.description}
                            </p>
                          )}
                          <p className="text-[9px] text-muted-foreground mt-0.5">
                            {new Date(notification.createdAt).toLocaleString("en-US", {
                              month: "short",
                              day: "numeric",
                              hour: "2-digit",
                              minute: "2-digit",
                            })}
                          </p>
                        </div>
                      </button>
                    ))
                  )}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

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
  onThemeChange: (t: string) => void;
  currentTheme: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
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
        onClick={() => setOpen(!open)}
        aria-label="Theme switcher"
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
          <div className="absolute right-0 top-12 z-50 glass-strong rounded-2xl p-1.5 min-w-[150px] shadow-xl">
            {options.map((option) => {
              const active = currentTheme === option.value;
              const Icon = option.icon;
              return (
                <button
                  key={option.value}
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
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
