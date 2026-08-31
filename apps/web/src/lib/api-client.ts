"use client";

import { VISUAL_FIXTURES_ENABLED, visualFixtureApiFetch } from "@/lib/visual-fixtures";
import { visualFormulaEngineFixtureResponse } from "@/lib/visual-formula-engine-fixture";
import { visualFundsFixtureResponse } from "@/lib/visual-funds-fixture";
import { visualReportsFixtureResponse } from "@/lib/visual-reports-fixture";
import { visualUser360FixtureResponse } from "@/lib/visual-user-360-fixture";

const API_BASE = "/api";

export class ApiError extends Error {
  status: number;
  details?: unknown;
  constructor(message: string, status: number, details?: unknown) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

type FetchOpts = RequestInit & {
  params?: Record<string, unknown>;
};

export async function apiFetch<T>(path: string, opts: FetchOpts = {}): Promise<T> {
  if (VISUAL_FIXTURES_ENABLED) {
    // Composite response contracts are routed before the generic fixture switch
    // so visual mode cannot hide frontend/backend drift behind an empty fallback
    // or a simpler resource shape.
    const user360 = visualUser360FixtureResponse<T>(path);
    if (user360 !== undefined) return user360;
    const funds = visualFundsFixtureResponse<T>(path, opts);
    if (funds !== undefined) return funds;
    const formulas = visualFormulaEngineFixtureResponse<T>(path, opts);
    if (formulas !== undefined) return formulas;
    const reports = visualReportsFixtureResponse<T>(path);
    if (reports !== undefined) return reports;
    return visualFixtureApiFetch<T>(path, opts);
  }

  const { params, headers, ...rest } = opts;
  const url = new URL(`${API_BASE}${path}`, window.location.origin);
  if (params) {
    Object.entries(params).forEach(([k, v]) => {
      if (v !== undefined && v !== null && v !== "") url.searchParams.set(k, String(v));
    });
  }

  const requestHeaders = new Headers(headers);
  if (!requestHeaders.has("Accept")) requestHeaders.set("Accept", "application/json");

  // JSON helpers below serialize their payloads to strings. Multipart/FormData
  // requests must not receive a manual Content-Type header because the browser
  // owns the multipart boundary. Keeping that distinction here lets uploads use
  // the same credential/error path as every other authenticated API request.
  if (typeof rest.body === "string" && !requestHeaders.has("Content-Type")) {
    requestHeaders.set("Content-Type", "application/json");
  }

  // Browser authentication is cookie-only. The non-secret `cookie-session`
  // value persisted by the auth store is a UI/session-presence hint, not a
  // credential. Legacy localStorage bearer values are deliberately never
  // forwarded by the Vite client; a stale browser without a valid HttpOnly
  // cookie fails closed through `/auth/me` and must sign in again once.
  // Also strip a caller-provided Authorization header so old ported code cannot
  // accidentally re-introduce browser bearer authentication through this API.
  requestHeaders.delete("Authorization");

  const res = await fetch(url.toString(), {
    ...rest,
    headers: requestHeaders,
    credentials: "include",
  });
  const isJson = res.headers.get("content-type")?.includes("application/json");
  const body = isJson ? await res.json().catch(() => null) : null;
  if (!res.ok) {
    const message =
      body?.error || body?.message || (typeof body?.details === "string" ? body.details : `Request failed (${res.status})`);
    throw new ApiError(message, res.status, body);
  }
  return body as T;
}

function accountingWriteOpts(path: string, method: "POST" | "PUT", opts?: FetchOpts): FetchOpts | undefined {
  const isExpenseCreate = method === "POST" && path === "/expenses";
  const isExpenseReplacement = method === "PUT" && /^\/expenses\/[^/]+$/u.test(path);
  const isPurchaseCreate = method === "POST" && path === "/purchases";
  if (!isExpenseCreate && !isExpenseReplacement && !isPurchaseCreate) return opts;

  const headers = new Headers(opts?.headers);
  if (!headers.has("Idempotency-Key")) headers.set("Idempotency-Key", crypto.randomUUID());
  return { ...opts, headers };
}

function deleteRequest<T>(path: string, opts?: FetchOpts): Promise<T> {
  // The imported golden Billing screen contains one legacy ambiguity: its Void
  // action calls DELETE /bills/:id with no request options, while its real
  // soft-delete action calls the same endpoint with a JSON body. The source
  // backend only implemented deletion, so the old Void button actually deleted
  // bills. Keep the golden component untouched while routing that one body-less
  // legacy call to the new explicit financial void endpoint. New code should
  // call POST /bills/:id/void directly; this shim can disappear when the golden
  // Billing component is rewritten rather than patched.
  if (
    !VISUAL_FIXTURES_ENABLED &&
    opts === undefined &&
    /^\/bills\/[^/]+$/u.test(path)
  ) {
    return apiFetch<T>(`${path}/void`, { method: "POST", body: "{}" });
  }
  return apiFetch<T>(path, { ...opts, method: "DELETE" });
}

export const api = {
  get: <T>(path: string, opts?: FetchOpts) => apiFetch<T>(path, { ...opts, method: "GET" }),
  post: <T>(path: string, data?: unknown, opts?: FetchOpts) => {
    const writeOpts = accountingWriteOpts(path, "POST", opts);
    return apiFetch<T>(path, {
      ...writeOpts,
      method: "POST",
      body: data ? JSON.stringify(data) : undefined,
    });
  },
  postForm: <T>(path: string, data: FormData, opts?: FetchOpts) =>
    apiFetch<T>(path, { ...opts, method: "POST", body: data }),
  put: <T>(path: string, data?: unknown, opts?: FetchOpts) => {
    const writeOpts = accountingWriteOpts(path, "PUT", opts);
    return apiFetch<T>(path, {
      ...writeOpts,
      method: "PUT",
      body: data ? JSON.stringify(data) : undefined,
    });
  },
  patch: <T>(path: string, data?: unknown, opts?: FetchOpts) =>
    apiFetch<T>(path, { ...opts, method: "PATCH", body: data ? JSON.stringify(data) : undefined }),
  delete: deleteRequest,
};