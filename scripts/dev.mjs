import { spawn } from "node:child_process";

const children = new Set();
let stopping = false;
let stopTimer;

function terminateTree(child, signal) {
  if (!child.pid) return;

  try {
    if (process.platform === "win32") {
      child.kill(signal);
    } else {
      // Each dev command runs in its own process group. Killing the group also
      // terminates grandchildren such as Cloudflare's workerd process instead
      // of leaving an orphan bound to port 8787 after Ctrl+C/HMR failures.
      process.kill(-child.pid, signal);
    }
  } catch (error) {
    // ESRCH means the process/group is already gone, which is the desired state.
    if (!(error instanceof Error && "code" in error && error.code === "ESRCH")) {
      console.error(`[BoardOps] Failed to stop process tree ${child.pid}:`, error);
    }
  }
}

function start(command, args, label) {
  const child = spawn(command, args, {
    stdio: "inherit",
    shell: process.platform === "win32",
    detached: process.platform !== "win32",
  });

  child.boardOpsLabel = label;
  children.add(child);

  child.on("exit", (code, signal) => {
    if (!stopping) {
      console.error(`[BoardOps] ${label} exited unexpectedly (${signal ?? code ?? "unknown"}).`);
      // Keep this child in the set until stopAll has killed its process group;
      // the pnpm wrapper may have exited while workerd/vite descendants remain.
      stopAll(code && code !== 0 ? code : 1);
    }
    children.delete(child);
  });

  return child;
}

function stopAll(exitCode = 0) {
  if (stopping) return;
  stopping = true;

  for (const child of children) terminateTree(child, "SIGTERM");

  stopTimer = setTimeout(() => {
    for (const child of children) terminateTree(child, "SIGKILL");
    process.exit(exitCode);
  }, 1_500);
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
process.on("exit", () => {
  if (stopTimer) clearTimeout(stopTimer);
});

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
