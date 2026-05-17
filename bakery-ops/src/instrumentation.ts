import "dotenv/config";

export async function register() {
  // 只在 Node.js 服务端运行（不在 Edge Runtime）
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { bootstrap } = await import("./bootstrap");
    await bootstrap();
  }
}
