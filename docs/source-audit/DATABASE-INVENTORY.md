# Database inventory

Source persistence is Prisma over SQLite. Confirmed model families include User, RegistrationRequest, UserSession, TrustedDevice, LoginHistory, Role, Permission, RolePermission, MealConfiguration, MealEntry, MealHistory, MealOverride, MealPreset/Item, LeaveApplication, GuestMeal, Variable, Formula, FormulaVersion, BillingCycle, MonthlySnapshot, Bill, Payment, Expense, Purchase, Refund, Adjustment, LedgerEntry, Restriction, Announcement, Notification, BackgroundTask and AuditLog.

## Critical migration observations

1. Money and accounting summaries currently include `Float` fields. D1 schema must replace authoritative currency values with integer minor-unit columns.
2. Source role/status values are mainly application-level strings. D1 migrations should add explicit constraints/indexes where practical.
3. Historical snapshot concepts already exist and should be preserved, but immutability and reproducibility must be enforced at the new domain/database boundary.
4. D1 becomes authoritative. Old `.db` files and backups are not migrated into source control.
