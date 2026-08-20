import { SupabaseKnowledgeClient } from "../src/modules/domain/knowledge/knowledge-client";

const query =
  process.env.R6_VERIFY_QUERY?.trim() || "JobStreet Advanced RM 975 posting price";
const expectedTitle =
  process.env.R6_VERIFY_EXPECTED_TITLE?.trim() || "JobStreet_AJobThing_职位发布价格对比";
const expectedPage = process.env.R6_VERIFY_EXPECTED_PAGE?.trim() || "第 1 页";

async function main(): Promise<void> {
  const client = new SupabaseKnowledgeClient();
  if (!(await client.isAvailable())) {
    throw new Error("R6 Supabase knowledge endpoint is unavailable or credentials are missing");
  }

  const result = await client.query(query, "hybrid");
  if (!result?.includes(expectedTitle) || !result.includes(expectedPage)) {
    throw new Error("R6 application query did not return the expected document and page citation");
  }

  process.stdout.write(
    `${JSON.stringify({ ok: true, backend: "r6-supabase", title: expectedTitle, page: expectedPage })}\n`,
  );
}

main().catch((error) => {
  process.stderr.write(
    `${JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) })}\n`,
  );
  process.exitCode = 1;
});
