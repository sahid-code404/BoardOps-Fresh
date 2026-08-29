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

  // First paint must never wait for a route import. Core authenticated views are
  // eager and secondary routes are warmed in the background after React mounts.
  // A persisted session can therefore be validated immediately instead of
  // staring at a blank document while a chunk is downloaded.
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

  if (useAuthStore.getState().token) {
    void preloadView(useAppStore.getState().view).catch((error) => {
      console.error("Failed to warm initial BoardOps route", error);
    });
  }
}

bootstrap();
