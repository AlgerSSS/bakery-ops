import "dotenv/config";

process.env.BUNDLED = "true";

process.on("unhandledRejection", (reason) => {
  console.error("[unhandledRejection]", reason);
});

async function main() {
  console.log("[0] Starting...");
  console.time("bootstrap");

  console.log("[1] Importing bootstrap...");
  console.time("import");
  const { bootstrap } = await import("./src/bootstrap");
  console.timeEnd("import");

  console.log("[2] Calling bootstrap...");
  console.time("call");
  await bootstrap();
  console.timeEnd("call");

  console.timeEnd("bootstrap");
  console.log("> WhatsApp bot ready!");
}

main().catch((err) => {
  console.error("[ERROR]", err);
  process.exit(1);
});
