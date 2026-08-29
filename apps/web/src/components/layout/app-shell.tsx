"use client";

import { motion } from "framer-motion";
import { useAppStore } from "@/stores/use-app-store";
import { MobileBottomNav } from "./mobile-bottom-nav";
import { MobileSidebar } from "./mobile-sidebar";
import { TopBar } from "./top-bar";
import type { ReactNode } from "react";

export function AppShell({ children }: { children: ReactNode }) {
  const view = useAppStore((s) => s.view);

  return (
    <div className="min-h-screen flex flex-col">
      <MobileSidebar />

      <div className="flex-1 flex flex-col min-w-0">
        <TopBar />
        <main className="flex-1 px-3 sm:px-4 lg:px-6 pb-28 pt-4 min-w-0">
          {/*
            Visibility safety: the old shell used AnimatePresence + opacity: 0
            as the initial state for the entire page. On some cold browser
            loads Motion can fail to advance that entrance animation, leaving
            a fully interactive header/nav around an invisible page. Keep the
            lightweight vertical entrance motion, but never make the whole
            route depend on an opacity animation completing.
          */}
          <motion.div
            key={view}
            initial={{ y: 8 }}
            animate={{ y: 0 }}
            transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
            className="mx-auto w-full max-w-6xl"
          >
            {children}
          </motion.div>
        </main>
      </div>

      <MobileBottomNav />
    </div>
  );
}
