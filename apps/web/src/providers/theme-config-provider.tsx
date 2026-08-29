"use client";

import { createContext, useContext, useEffect, useLayoutEffect, useState, useCallback, type ReactNode } from "react";
import { api } from "@/lib/api-client";

type ThemeConfig = {
  primary: string;
  primaryForeground: string;
  accent: string;
  radius: string;
  mode: "system" | "light" | "dark";
  preset: string;
  glassMode: "on" | "off";
  blurIntensity: "light" | "normal" | "heavy";
  transparency: "low" | "medium" | "high";
};

const DEFAULT_THEME: ThemeConfig = {
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

type ThemeContextValue = {
  theme: ThemeConfig;
  setTheme: (t: ThemeConfig) => void;
  previewTheme: (t: ThemeConfig) => void;
  refresh: () => Promise<void>;
};

const ThemeContext = createContext<ThemeContextValue>({
  theme: DEFAULT_THEME,
  setTheme: () => {},
  previewTheme: () => {},
  refresh: async () => {},
});

function hexToOklch(hex: string): string {
  return hex;
}

function readableForeground(hex: string): string {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  const luminance = 0.299 * r + 0.587 * g + 0.114 * b;
  return luminance > 0.6 ? "#0a0a0f" : "#ffffff";
}

export function ThemeConfigProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<ThemeConfig>(DEFAULT_THEME);

  const applyTheme = useCallback((config: ThemeConfig) => {
    if (typeof document === "undefined") return;
    const root = document.documentElement;
    root.style.setProperty("--primary", hexToOklch(config.primary));
    root.style.setProperty("--primary-foreground", config.primaryForeground || readableForeground(config.primary));
    root.style.setProperty("--accent", hexToOklch(config.accent));
    root.style.setProperty("--accent-foreground", readableForeground(config.accent));
    root.style.setProperty("--ring", hexToOklch(config.primary));
    root.style.setProperty("--sidebar-primary", hexToOklch(config.primary));
    root.style.setProperty("--sidebar-ring", hexToOklch(config.primary));
    root.style.setProperty("--radius", config.radius);
    root.style.setProperty("--chart-1", hexToOklch(config.primary));
    root.setAttribute("data-glass-mode", config.glassMode || "on");
    root.setAttribute("data-blur-intensity", config.blurIntensity || "normal");
    root.setAttribute("data-transparency", config.transparency || "medium");
  }, []);

  // Apply deterministic defaults before the browser paints the authenticated
  // shell. Previously these data attributes only appeared after /api/theme
  // succeeded, which made glass/background layers visibly pop in or disappear
  // when the endpoint was unavailable.
  useLayoutEffect(() => {
    applyTheme(DEFAULT_THEME);
  }, [applyTheme]);

  const refresh = useCallback(async () => {
    try {
      const res = await api.get<{ success: boolean; data: ThemeConfig }>("/theme");
      const config = { ...DEFAULT_THEME, ...res.data };
      setThemeState(config);
      applyTheme(config);
    } catch {
      applyTheme(DEFAULT_THEME);
    }
  }, [applyTheme]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await api.get<{ success: boolean; data: ThemeConfig }>("/theme");
        if (cancelled) return;
        const config = { ...DEFAULT_THEME, ...res.data };
        setThemeState(config);
        applyTheme(config);
      } catch {
        if (!cancelled) applyTheme(DEFAULT_THEME);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [applyTheme]);

  const setTheme = useCallback(
    (config: ThemeConfig) => {
      setThemeState(config);
      applyTheme(config);
    },
    [applyTheme]
  );

  const previewTheme = useCallback(
    (config: ThemeConfig) => {
      applyTheme(config);
    },
    [applyTheme]
  );

  return (
    <ThemeContext.Provider value={{ theme, setTheme, previewTheme, refresh }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useThemeConfig() {
  return useContext(ThemeContext);
}

export { readableForeground, DEFAULT_THEME };
export type { ThemeConfig };
