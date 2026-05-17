import "dotenv/config";

async function main() {
  console.log("[1] Importing logger...");
  await import("./src/modules/shared/logger");
  console.log("[2] logger OK");

  console.log("[3] Importing ai-provider...");
  await import("./src/modules/domain/ai/ai-provider");
  console.log("[4] ai-provider OK");

  console.log("[5] Importing supabase...");
  await import("./src/modules/data/supabase");
  console.log("[6] supabase OK");

  console.log("[7] Importing employee repository...");
  await import("./src/modules/data/repositories/employee.repository");
  console.log("[8] employee repository OK");

  console.log("[9] Importing resume types...");
  await import("./src/modules/domain/resume/types");
  console.log("[10] resume types OK");

  console.log("[11] Importing resume parser...");
  await import("./src/modules/domain/resume/resume-parser");
  console.log("[12] resume parser OK");

  console.log("All imports done!");
}

main().catch((err) => {
  console.error("[ERROR]", err);
  process.exit(1);
});
