import "dotenv/config";
import { createServer } from "http";
import next from "next";

process.on("unhandledRejection", (reason) => {
  console.error("[unhandledRejection]", reason);
});

// 记录后退出（不吞异常）；由 launchd KeepAlive 负责拉起 — IMPROVEMENT-PLAN.md A2
process.on("uncaughtException", (err) => {
  console.error("[uncaughtException]", err);
  process.exit(1);
});

const dev = process.env.NODE_ENV !== "production";
const hostname = "localhost";
const port = parseInt(process.env.PORT || "3000");
// listen() 之前一直只传 port，等于绑到 0.0.0.0/:: —— hostname 只传给了 next()，
// 对监听地址没有影响。对外只靠 ufw 挡着，规则一旦有闪失整个内部面板就暴露了。
// 默认改为回环；SSH 隧道（-L 3000:localhost:3000）连的就是服务器回环，不受影响。
// 确需对外监听时用 HOST=0.0.0.0 覆盖。
const bindHost = process.env.HOST || "127.0.0.1";

const app = next({ dev, hostname, port });
const handle = app.getRequestHandler();

async function main() {
  const { bootstrap } = await import("./src/bootstrap");
  await bootstrap();

  await app.prepare();

  const server = createServer((req, res) => {
    handle(req, res);
  }).listen(port, bindHost, () => {
    console.log(`> Ready on http://${bindHost}:${port} (NODE_ENV=${process.env.NODE_ENV ?? "unset"}, next dev=${dev})`);
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
