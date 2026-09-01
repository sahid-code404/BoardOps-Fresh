import net from "node:net";

const ports = [5173, 8787];

async function assertPortFree(port) {
  await new Promise((resolve, reject) => {
    const server = net.createServer();

    server.unref();
    server.once("error", (error) => {
      if (error && typeof error === "object" && "code" in error && error.code === "EADDRINUSE") {
        reject(new Error(
          `[BoardOps] Runtime E2E requires port ${port} to be free. Stop any existing pnpm dev/workerd process, then rerun pnpm test:e2e:runtime.`,
        ));
        return;
      }
      reject(error);
    });

    server.listen({ host: "127.0.0.1", port }, () => {
      server.close((error) => {
        if (error) reject(error);
        else resolve();
      });
    });
  });
}

for (const port of ports) {
  await assertPortFree(port);
}

console.log("[BoardOps] Runtime E2E ports are free.");
