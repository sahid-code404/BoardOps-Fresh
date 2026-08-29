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

async function bootstrap() {
  const root = document.getElementById("root");
  if (!root) throw new Error("Missing #root element");

  // When a session already exists (including visual fixture mode), resolve the
  // current route chunk before mounting the shell. The application remains
  // code-split, but a normal direct route does not begin with a full-page
  // Suspense flash.
  if (useAuthStore.getState().token) {
    await preloadView(useAppStore.getState().view).catch((error) => {
      console.error("Failed to preload initial BoardOps route", error);
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

void bootstrap();
