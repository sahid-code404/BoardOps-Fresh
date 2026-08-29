import type { AnchorHTMLAttributes, ReactNode } from "react";

type Href = string | { pathname?: string; query?: Record<string, string | number | boolean | undefined> };

function hrefToString(href: Href) {
  if (typeof href === "string") return href;
  const pathname = href.pathname ?? "/";
  const qs = new URLSearchParams();
  for (const [key, value] of Object.entries(href.query ?? {})) {
    if (value !== undefined) qs.set(key, String(value));
  }
  const query = qs.toString();
  return query ? pathname + "?" + query : pathname;
}

export default function Link({ href, children, ...props }: Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "href"> & { href: Href; children?: ReactNode }) {
  return <a href={hrefToString(href)} {...props}>{children}</a>;
}
