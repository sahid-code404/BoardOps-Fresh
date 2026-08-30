"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";

export type Role = "SUPER_ADMIN" | "ADMIN" | "MANAGER" | "USER";

export type CurrentUser = {
  id: string;
  name: string;
  email: string;
  phone?: string;
  role: Role;
  status: "ACTIVE" | "PENDING" | "SUSPENDED" | "ARCHIVED" | "INACTIVE";
  avatarUrl?: string;
  room?: string;
  gender?: string | null;
  emergencyContact?: string | null;
  theme?: string;
  language?: string;
  timezone?: string;
  twoFactorEnabled?: boolean;
  createdAt?: string;
  lastLoginAt?: string | null;
};

type AuthState = {
  user: CurrentUser | null;
  token: string | null;
  permissions: string[];
  setUser: (u: CurrentUser | null) => void;
  setToken: (t: string | null) => void;
  setPermissions: (permissions: string[]) => void;
  logout: () => void;
  isAuthenticated: () => boolean;
};

/**
 * Phase 04 security model:
 * - The real session credential lives only in an HttpOnly server-managed cookie.
 * - `token` is now only a client-side session hint (`cookie-session`) used to
 *   decide whether to preload authenticated UI. It is not a secret.
 * - A stale legacy token may still exist in older localStorage; `/auth/me`
 *   validates it server-side and the app clears it immediately on failure.
 *
 * Roles / Permissions checkpoint:
 * - `permissions` is presentation state only. The Worker remains authoritative.
 * - The list is refreshed from the authenticated dashboard principal before the
 *   shell is allowed to make capability-shaped navigation decisions.
 */
export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      user: null,
      token: null,
      permissions: [],
      setUser: (u) => set({ user: u }),
      setToken: (t) => set({ token: t }),
      setPermissions: (permissions) => set({ permissions: [...new Set(permissions)].sort() }),
      logout: () => {
        // Clear the UI immediately, but also revoke the real server session.
        // `keepalive` prevents a route change/tab close immediately after the
        // click from cancelling the small revocation request.
        const token = get().token;
        if (typeof window !== "undefined" && token) {
          const headers: Record<string, string> = { Accept: "application/json" };
          // `cookie-session` is only a client-side hint. Older development
          // sessions may still contain the actual bearer credential, so revoke
          // those explicitly while never exposing/sending the cookie sentinel.
          if (token !== "cookie-session") headers.Authorization = `Bearer ${token}`;

          void fetch("/api/auth/logout", {
            method: "POST",
            credentials: "include",
            keepalive: true,
            headers,
          }).catch(() => {
            // Local sign-out must remain usable while offline. A server-side
            // failure is intentionally best-effort here; the credential will
            // be revalidated on the next authenticated request.
          });
        }
        set({ user: null, token: null, permissions: [] });
      },
      isAuthenticated: () => !!get().token,
    }),
    { name: "boardops-auth" }
  )
);
