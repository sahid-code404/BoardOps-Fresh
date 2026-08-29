import { useMemo } from "react";

export function useRouter() {
  return useMemo(() => ({
    push: (href: string) => { window.location.href = href; },
    replace: (href: string) => { window.location.replace(href); },
    back: () => window.history.back(),
    forward: () => window.history.forward(),
    refresh: () => window.location.reload(),
    prefetch: async (_href: string) => undefined,
  }), []);
}

export function usePathname() { return window.location.pathname; }
export function useSearchParams() { return new URLSearchParams(window.location.search); }
export function redirect(href: string): never { window.location.replace(href); throw new Error("Redirecting to " + href); }
