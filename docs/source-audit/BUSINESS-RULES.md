# Business rules discovered

- Users have lifecycle/status and registration-review workflows rather than instant unrestricted activation.
- Meal configuration controls active meals, ordering, cutoff strategy/time, visibility/default state and service times.
- Meal entries are per user/meal/service date and preserve an `originalState`; history/override records exist.
- Leave can target all or specific meals.
- Billing is period based; the source closing flow checks residents, meals, expenses, variables, formula status and pending payments before generating bills.
- Source monthly closing already intends to freeze data into a snapshot before bill generation.
- Published/closed financial history is intended to require corrections rather than rewriting history; the rewrite strengthens and consistently enforces that rule.
- UI role visibility currently depends heavily on ADMIN/USER role strings; target behavior must be mapped to explicit permissions without changing recognizable navigation for equivalent permissions.
