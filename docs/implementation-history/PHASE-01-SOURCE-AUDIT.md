# PHASE 01 — Complete source-audit baseline

Objective: inspect the read-only golden master before any product frontend migration.

Source baseline: `sahid-code404/BoardOpsv2rewrite`, main tree `77f3dec3b264c42904207f27c5f008b33c03b868`.

Reviewed areas include package/runtime architecture, complete top-level source structure, app/API families, layout/navigation, UI store, global design tokens/effects, major feature tree, Prisma schema, session/auth helpers, formula engine and monthly closing.

Confirmed high-priority findings:
- source is Next/Prisma/SQLite while target is React/Vite + Worker/D1;
- exact glass/OKLCH/mesh/dark-light token system and Lucide navigation must be preserved;
- large feature files should be responsibility-split without changing rendered behavior;
- financial data uses Float/number paths and must move to integer minor units;
- monthly close contains an explicit legacy formula fallback that must be removed and changed to a blocking validation error;
- role-string authorization must become explicit backend permissions;
- session tokens should be digest-stored instead of raw DB bearer values;
- committed env/db/backup/log/agent/tool artifacts are excluded from the clean target.

Outputs: all documents under `docs/source-audit/`, visual-parity plan, ADRs and migration map.

No Phase 02 UI implementation has started.

Status: AUDITED BASELINE — findings recorded; implementation verification occurs in owning phases.

NOT READY — CONTINUE FIXING
