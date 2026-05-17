import "dotenv/config";
import { createServer } from "http";
import next from "next";

process.on("unhandledRejection", (reason) => {
  console.error("[unhandledRejection]", reason);
});

const dev = process.env.NODE_ENV !== "production";
const hostname = "localhost";
const port = parseInt(process.env.PORT || "3000");

const app = next({ dev, hostname, port });
const handle = app.getRequestHandler();

async function main() {
  const { bootstrap } = await import("./src/bootstrap");
  await bootstrap();

  await app.prepare();

  const server = createServer((req, res) => {
    handle(req, res);
  }).listen(port, () => {
    console.log(`> Ready on http://${hostname}:${port}`);
  });

  // 确保 Ctrl+C 时清理干净，不留僵尸进程
  const cleanup = () => {
    server.close();
    app.close().then(() => process.exit(0));
  };
  process.on("SIGINT", cleanup);
  process.on("SIGTERM", cleanup);
}

main().catch((err) => {
  console.error("Failed to start:", err);
  process.exit(1);
});
