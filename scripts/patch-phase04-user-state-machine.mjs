import { readFileSync, writeFileSync } from "node:fs";

function patchFile(path, patches) {
  let source = readFileSync(path, "utf8");
  for (const [label, before, after] of patches) {
    const count = source.split(before).length - 1;
    if (count !== 1) throw new Error(`${path} ${label}: expected exactly one match, found ${count}`);
    source = source.replace(before, after);
  }
  writeFileSync(path, source);
}

patchFile("services/api/src/routes/users.ts", [
  [
    "strict-user-status-transitions",
    `  } else if (action === "SUSPEND") {\n    if (reason.length < 3) return c.json({ success: false, error: "A reason is required" }, 400);\n    nextStatus = "SUSPENDED";\n  } else if (action === "ACTIVATE" || action === "RESTORE") {\n    nextStatus = "ACTIVE";\n  } else if (action === "DEACTIVATE") {\n    if (reason.length < 3) return c.json({ success: false, error: "A reason is required" }, 400);\n    nextStatus = "INACTIVE";\n  } else if (action === "ARCHIVE") {\n    if (reason.length < 3) return c.json({ success: false, error: "A reason is required" }, 400);\n    nextStatus = "ARCHIVED";\n  } else if (action === "ASSIGN_ROLE") {\n    const role = typeof body.role === "string" ? body.role : "";`,
    `  } else if (action === "SUSPEND") {\n    if (user.status !== "ACTIVE") return c.json({ success: false, error: "Only active users can be suspended" }, 422);\n    if (reason.length < 3) return c.json({ success: false, error: "A reason is required" }, 400);\n    nextStatus = "SUSPENDED";\n  } else if (action === "ACTIVATE") {\n    if (user.status !== "SUSPENDED" && user.status !== "INACTIVE") {\n      return c.json({ success: false, error: "Only suspended or inactive users can be activated" }, 422);\n    }\n    nextStatus = "ACTIVE";\n  } else if (action === "RESTORE") {\n    if (user.status !== "ARCHIVED" || user.deleted_at !== null) {\n      return c.json({ success: false, error: "Only non-deleted archived users can be restored here" }, 422);\n    }\n    nextStatus = "ACTIVE";\n  } else if (action === "DEACTIVATE") {\n    if (user.status !== "ACTIVE") return c.json({ success: false, error: "Only active users can be deactivated" }, 422);\n    if (reason.length < 3) return c.json({ success: false, error: "A reason is required" }, 400);\n    nextStatus = "INACTIVE";\n  } else if (action === "ARCHIVE") {\n    if (!["ACTIVE", "SUSPENDED", "INACTIVE"].includes(user.status)) {\n      return c.json({ success: false, error: "Only active, suspended, or inactive users can be archived" }, 422);\n    }\n    if (reason.length < 3) return c.json({ success: false, error: "A reason is required" }, 400);\n    nextStatus = "ARCHIVED";\n  } else if (action === "ASSIGN_ROLE") {\n    if (user.status !== "ACTIVE") return c.json({ success: false, error: "Roles can only be assigned to active users" }, 422);\n    const role = typeof body.role === "string" ? body.role : "";`,
  ],
  [
    "rejected-registration-cannot-bypass-review-through-deletion-restore",
    `userRoutes.post("/users/:id/restore", async (c) => {\n  const admin = await currentAdmin(c);\n  if (!admin) return c.json({ success: false, error: "Administrator access required" }, 403);\n  const user = await targetUser(c, admin, c.req.param("id"));\n  if (!user) return c.json({ success: false, error: "User not found" }, 404);\n  if (!user.deleted_at) return c.json({ success: false, error: "User is not in the deletion queue" }, 422);\n  const now = new Date().toISOString();`,
    `userRoutes.post("/users/:id/restore", async (c) => {\n  const admin = await currentAdmin(c);\n  if (!admin) return c.json({ success: false, error: "Administrator access required" }, 403);\n  const user = await targetUser(c, admin, c.req.param("id"));\n  if (!user) return c.json({ success: false, error: "User not found" }, 404);\n  if (!user.deleted_at) return c.json({ success: false, error: "User is not in the deletion queue" }, 422);\n  const registration = await latestRegistration(c, user.id);\n  if (registration?.status === "REJECTED") {\n    return c.json({ success: false, error: "Rejected registrations cannot be restored directly" }, 422);\n  }\n  const now = new Date().toISOString();`,
  ],
]);

console.log("[BoardOps] Phase 04 user state machine hardening applied.");
