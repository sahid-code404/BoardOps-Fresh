# Visual parity plan

Phase 02 must capture and compare the golden master before changing product UI.

Viewports: 360×800, 390×844, 430×932, 768×1024, 1024×768, 1366×768, 1440×900, 1920×1080.

Required stable states include Login, Registration, Dashboard, Sidebar open, Bottom navigation, Theme selector, Meals, Payments, Expenses, Billing, Users, Settings, Profile, Notifications, Monthly Closing and Formula Engine, in dark/light where applicable.

Playwright visual tests should detect meaningful drift while tolerating normal font-rasterization differences. No approximate replacement dashboard may be used as a baseline.
