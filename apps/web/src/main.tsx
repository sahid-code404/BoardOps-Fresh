import { createRoot } from "react-dom/client";
import "./styles/golden.css";
import BoardOpsApp from "./BoardOpsApp";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as SonnerToaster } from "@/components/ui/sonner";
import { ThemeProvider } from "@/providers/theme-provider";
import { QueryProvider } from "@/providers/query-provider";
import { ThemeConfigProvider } from "@/providers/theme-config-provider";

const root = document.getElementById("root");
if (!root) throw new Error("Missing #root element");

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
