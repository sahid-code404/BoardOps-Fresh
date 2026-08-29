# Frontend component inventory

## Layout/navigation
`app-shell.tsx`, `top-bar.tsx`, `desktop-sidebar.tsx`, `mobile-sidebar.tsx`, `mobile-bottom-nav.tsx`, `command-palette.tsx`, `nav-config.ts`, `nav-groups.ts`, `lazy-view-router.tsx`.

## Major feature views observed
Audit, auth/profile, billing, expenses, funds, monthly closing, payments, products, purchases, calendar, dashboard, kitchen, meal configuration, resident meals, announcements, notifications, personalization, reports, holidays, policies, settings and system views.

Several source feature components are very large: payments (~64 KB), profile (~56 KB), billing (~54 KB), auth (~47 KB), resident meals (~48 KB), expenses (~46 KB), kitchen (~46 KB), meal configuration (~45 KB), calendar (~40 KB). Preserve their rendered behavior, but split implementation by responsibility during porting.

## Porting rule
Reuse/refactor source component structure and actual visual semantics. Do not rebuild a lookalike from memory.
