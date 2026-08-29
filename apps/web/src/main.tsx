import { createRoot } from "react-dom/client";
import "./styles/golden.css";
import "./styles/runtime-visibility.css";
import BoardOpsApp from "./BoardOpsApp";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as SonnerToaster } from "@/components/ui/sonner";
import { ThemeProvider } from "@/providers/theme-provider";
import { QueryProvider } from "@/providers/query-provider";
import { ThemeConfigProvider } from "@/providers/theme-config-provider";
import { installVisualFixtureSession } from "@/lib/visual-fixtures";
import { preloadView } from "@/lib/view-loaders";
import { installViewRouteSync, useAppStore } from "@/stores/use-app-store";
import { useAuthStore } from "@/stores/use-auth-store";

const removeRouteSync = installViewRouteSync();
installVisualFixtureSession();

if (import.meta.hot) {
  import.meta.hot.dispose(removeRouteSync);
}

function bootstrap() {
  const root = document.getElementById("root");
  if (!root) throw new Error("Missing #root element");

  // Start the direct-route chunk request before React begins rendering, but do
  // not await it. This preserves an immediate first paint while giving a cold
  // /settings, /profile, /system, etc. load the entire auth-validation window
  // to download its feature chunk. Normal in-app navigation still preloads the
  // destination before switching views, so Suspense remains an edge-case safety
  // net instead of a routine user-visible transition.
  if (useAuthStore.getState().token) {
    void preloadView(useAppStore.getState().view).catch((error) => {
      console.error("Failed to warm initial BoardOps route", error);
    });
  }

  createRoot(root).render(
    <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange={false}>
      <QueryProvider>
        <ThemeConfigProvider>
          <BoardOpsApp />
          <Toaster />
          <SonnerToaster position="top-center" />
        </ThemeConfigProvider>
      </QueryProvider>
    </ThemeProvider>,
  );
}

bootstrap();