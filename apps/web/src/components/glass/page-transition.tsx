"use client";

import { motion } from "framer-motion";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/** Wrap a page to animate it in with staggered children. */
export function PageTransition({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <motion.div
      // Critical page content must remain visible even if an entrance
      // animation is interrupted during a cold browser load. Movement remains
      // animated; visibility no longer depends on Motion reaching opacity 1.
      initial={{ y: 12 }}
      animate={{ y: 0 }}
      exit={{ y: -8 }}
      transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
      className={cn("w-full", className)}
    >
      {children}
    </motion.div>
  );
}

const container = {
  hidden: {},
  show: {
    transition: {
      staggerChildren: 0.06,
      delayChildren: 0.05,
    },
  },
};

const item = {
  hidden: { y: 16, scale: 0.97 },
  show: {
    y: 0,
    scale: 1,
    transition: { type: "spring" as const, stiffness: 280, damping: 24 },
  },
};

export function StaggerGroup({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <motion.div
      variants={container}
      initial="hidden"
      animate="show"
      className={className}
    >
      {children}
    </motion.div>
  );
}

export function StaggerItem({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <motion.div variants={item} className={className}>
      {children}
    </motion.div>
  );
}
