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
  setUser: (u: CurrentUser | null) => void;
  setToken: (t: string | null) => void;
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
 */
export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      user: null,
      token: null,
      setUser: (u) => set({ user: u }),
      setToken: (t) => set({ token: t }),
      logout: () => {
        // Clear the UI immediately, but also revoke the real HttpOnly server
        // session. `keepalive` prevents a route change/tab close immediately
        // after the click from cancelling the small revocation request.
        if (typeof window !== "undefined" && get().token) {
          void fetch("/api/auth/logout", {
            method: "POST",
            credentials: "include",
            keepalive: true,
            headers: { Accept: "application/json" },
          }).catch(() => {
            // Local sign-out must remain usable while offline. A server-side
            // failure is intentionally best-effort here; the credential is not
            // exposed to JavaScript and will be revalidated on the next login.
          });
        }
        set({ user: null, token: null });
      },
      isAuthenticated: () => !!get().token,
    }),
    { name: "boardops-auth" }
  )
);
