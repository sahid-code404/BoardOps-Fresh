import { describe, expect, it } from "vitest";
import app from "./index";

describe("health endpoint", () => {
  it("returns an explicit healthy response", async () => {
    const response = await app.request("http://boardops.local/api/health");
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ status: "ok", service: "boardops-api" });
    expect(response.headers.get("x-request-id")).toBeTruthy();
  });
});
