import { afterEach, describe, expect, it, vi } from "vitest";
import { api, apiFetch } from "./api-client";

function installBrowserFetchStub() {
  vi.stubGlobal("window", {
    location: { origin: "http://boardops.test" },
  });

  const fetchMock = vi.fn(async () =>
    new Response(JSON.stringify({ success: true, data: { ok: true } }), {
      status: 200,
      headers: { "content-type": "application/json" },
    }),
  );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("apiFetch browser credential policy", () => {
  it("always uses cookies and strips caller-provided bearer headers", async () => {
    const fetchMock = installBrowserFetchStub();

    await apiFetch("/auth/me", {
      method: "GET",
      headers: { Authorization: "Bearer stale-local-storage-token" },
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    const headers = init.headers as Headers;

    expect(url).toBe("http://boardops.test/api/auth/me");
    expect(init.credentials).toBe("include");
    expect(headers.has("Authorization")).toBe(false);
    expect(headers.get("Accept")).toBe("application/json");
  });

  it("lets the browser own multipart boundaries for FormData uploads", async () => {
    const fetchMock = installBrowserFetchStub();
    const formData = new FormData();
    formData.append(
      "avatar",
      new Blob(["avatar"], { type: "image/png" }),
      "avatar.png",
    );

    await api.postForm("/auth/avatar", formData);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    const headers = init.headers as Headers;

    expect(init.credentials).toBe("include");
    expect(headers.has("Authorization")).toBe(false);
    expect(headers.has("Content-Type")).toBe(false);
    expect(init.body).toBe(formData);
  });

  it("sets JSON content type only for serialized JSON bodies", async () => {
    const fetchMock = installBrowserFetchStub();

    await api.post("/probe", { value: 1 });

    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    const headers = init.headers as Headers;
    expect(headers.get("Content-Type")).toBe("application/json");
    expect(init.body).toBe(JSON.stringify({ value: 1 }));
  });

  it("routes the legacy body-less Billing Void action to the explicit void endpoint", async () => {
    const fetchMock = installBrowserFetchStub();

    await api.delete("/bills/bill-123");

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("http://boardops.test/api/bills/bill-123/void");
    expect(init.method).toBe("POST");
    expect(init.body).toBe("{}");
  });

  it("keeps Billing soft deletion as DELETE when the caller supplies a deletion body", async () => {
    const fetchMock = installBrowserFetchStub();

    await api.delete("/bills/bill-123", {
      body: JSON.stringify({ reason: "Duplicate bill" }),
    });

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("http://boardops.test/api/bills/bill-123");
    expect(init.method).toBe("DELETE");
    expect(init.body).toBe(JSON.stringify({ reason: "Duplicate bill" }));
  });
});
