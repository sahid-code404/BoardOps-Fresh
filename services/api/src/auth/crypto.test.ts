import { describe, expect, it } from "vitest";
import { hashPassword, tokenDigest, verifyPassword } from "./crypto";

const SEEDED_ADMIN_HASH =
  "pbkdf2_sha256$600000$Ym9hcmRvcHMtbG9jYWwtYWRtaW4tdjE=$xbrxH9D7NtxPtPFYnR1NeUEdZ7jQhPC01btucnPNrJI=";

describe("authentication crypto", () => {
  it("verifies the deterministic local administrator password", async () => {
    await expect(verifyPassword("BoardOps@Fresh#2026!A7", SEEDED_ADMIN_HASH)).resolves.toBe(true);
    await expect(verifyPassword("wrong-password", SEEDED_ADMIN_HASH)).resolves.toBe(false);
  });

  it("round-trips newly hashed passwords", async () => {
    const hash = await hashPassword("A-new-password-42!");
    await expect(verifyPassword("A-new-password-42!", hash)).resolves.toBe(true);
    await expect(verifyPassword("different", hash)).resolves.toBe(false);
  });

  it("produces stable token digests without storing the raw token", async () => {
    const first = await tokenDigest("opaque-session-token");
    const second = await tokenDigest("opaque-session-token");
    expect(first).toBe(second);
    expect(first).not.toContain("opaque-session-token");
  });
});
