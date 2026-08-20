import { SupabaseKnowledgeClient } from "../src/modules/domain/knowledge/knowledge-client";

const EXPECTED_TITLE = "JobStreet_AJobThing_职位发布价格对比";
const EXPECTED_PAGE = "第 1 页";

async function main(): Promise<void> {
  const client = new SupabaseKnowledgeClient();
  if (!(await client.isAvailable())) {
    throw new Error("R6 Supabase knowledge endpoint is unavailable or credentials are missing");
  }

  const result = await client.query("JobStreet Advanced RM 975 posting price", "hybrid");
  if (!result?.includes(EXPECTED_TITLE) || !result.includes(EXPECTED_PAGE)) {
    throw new Error("R6 application query did not return the expected document and page citation");
  }

  process.stdout.write(
    `${JSON.stringify({ ok: true, backend: "r6-supabase", title: EXPECTED_TITLE, page: 1 })}\n`,
  );
}

main().catch((error) => {
  process.stderr.write(
    `${JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) })}\n`,
  );
  process.exitCode = 1;
});
