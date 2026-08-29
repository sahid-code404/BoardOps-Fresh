import { spawn } from "node:child_process";

const children = new Set();
let stopping = false;

function start(command, args, label) {
  const child = spawn(command, args, {
    stdio: "inherit",
    shell: process.platform === "win32",
  });
  children.add(child);
  child.on("exit", (code, signal) => {
    children.delete(child);
    if (!stopping && code !== 0) {
      console.error(`[BoardOps] ${label} exited unexpectedly (${signal ?? code}).`);
      stopAll(code ?? 1);
    }
  });
  return child;
}

function stopAll(exitCode = 0) {
  if (stopping) return;
  stopping = true;
  for (const child of children) child.kill("SIGTERM");
  setTimeout(() => process.exit(exitCode), 150).unref();
}

async function waitFor(url, timeoutMs = 45_000) {
  const started = Date.now();
  let lastError = "not ready";
  while (Date.now() - started < timeoutMs) {
    try {
      const response = await fetch(url, { cache: "no-store" });
      if (response.ok) return;
      lastError = `HTTP ${response.status}`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Timed out waiting for ${url}: ${lastError}`);
}

process.on("SIGINT", () => stopAll(0));
process.on("SIGTERM", () => stopAll(0));

console.log("[BoardOps] Starting API first...");
start("pnpm", ["--filter", "@boardops/api", "dev"], "API");

try {
  await waitFor("http://127.0.0.1:8787/api/health");
  console.log("[BoardOps] API is healthy; starting web app...");
  start("pnpm", ["--filter", "@boardops/web", "dev"], "web app");
} catch (error) {
  console.error("[BoardOps] API failed to become healthy.", error);
  stopAll(1);
}
