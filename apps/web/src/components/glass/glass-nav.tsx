"use client";

import { cn } from "@/lib/utils";
import type { ReactNode } from "react";

export function GlassNav<T extends string>({
  items,
  value,
  onChange,
  className,
  size = "md",
}: {
  items: { value: T; label: ReactNode; icon?: ReactNode }[];
  value: T;
  onChange: (v: T) => void;
  className?: string;
  size?: "sm" | "md";
}) {
  return (
    <div
      role="tablist"
      aria-label="Section navigation"
      className={cn(
        "flex w-fit max-w-full items-center justify-center gap-1 overflow-x-auto no-scrollbar rounded-2xl border border-border/50 bg-card/45 p-1 shadow-sm backdrop-blur-md relative",
        className
      )}
    >
      {items.map((item) => {
        const active = item.value === value;
        return (
          <button
            key={item.value}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(item.value)}
            className={cn(
              "relative z-10 inline-flex items-center justify-center rounded-xl font-medium transition-colors whitespace-nowrap",
              size === "sm" ? "px-3 py-1.5 text-xs" : "px-4 py-2 text-sm",
              active
                ? "text-primary-foreground"
                : "text-muted-foreground hover:text-foreground hover:bg-secondary/50"
            )}
          >
            {active && (
              <div
                aria-hidden="true"
                className="absolute inset-0 rounded-xl bg-primary shadow-lg shadow-primary/35"
              />
            )}
            <span className="relative z-10 flex items-center gap-1.5">
              {item.icon}
              {item.label}
            </span>
          </button>
        );
      })}
    </div>
  );
}
