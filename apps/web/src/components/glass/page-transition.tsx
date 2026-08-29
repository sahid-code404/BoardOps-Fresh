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
      initial={{ y: 8 }}
      animate={{ y: 0 }}
      exit={{ y: -6 }}
      transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
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
      staggerChildren: 0.02,
      delayChildren: 0,
    },
  },
};

const item = {
  hidden: { y: 8, scale: 0.99 },
  show: {
    y: 0,
    scale: 1,
    transition: { type: "spring" as const, stiffness: 360, damping: 30 },
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
    <motion.div variants={container} initial="hidden" animate="show" className={className}>
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
  return <motion.div variants={item} className={className}>{children}</motion.div>;
}
