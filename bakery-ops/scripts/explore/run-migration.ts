import "dotenv/config";
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "fs";
import { resolve } from "path";

const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_KEY!);

// Supabase REST API can't run DDL directly.
// But we can use the /pg endpoint or the Management API.
// Let's try the Supabase Management API with the service role key.

const PROJECT_REF = "zpplbzrtdenvpfhaysij";
const DB_PASSWORD = "Shaoweiliang88";

async function execViaManagementAPI(sql: string): Promise<any> {
  // Supabase Management API: POST /v1/projects/{ref}/database/query
  // Requires a management API key (personal access token), not service role key.
  // Let's try another approach: use the pg wire protocol over WebSocket if available.

  // Actually, let's just use fetch to the Supabase edge function or
  // try the newer /sql endpoint
  const endpoints = [
    `https://${PROJECT_REF}.supabase.co/pg/query`,
    `https://${PROJECT_REF}.supabase.co/database/query`,
  ];

  for (const endpoint of endpoints) {
    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "apikey": process.env.SUPABASE_SERVICE_KEY!,
          "Authorization": `Bearer ${process.env.SUPABASE_SERVICE_KEY!}`,
        },
        body: JSON.stringify({ query: sql }),
      });
      if (res.ok) {
        return await res.json();
      }
    } catch {}
  }
  return null;
}

// Alternative: Create tables one by one using Supabase's auto-schema detection
// by inserting data. This won't work for complex schemas.

// Best approach: Use the Supabase CLI or SQL Editor.
// Since direct DB connection is blocked, let's generate a single SQL block
// the user can paste into the SQL Editor.

async function run() {
  console.log("Direct DB connection is blocked from your network.");
  console.log("Generating SQL for Supabase SQL Editor...\n");

  const migrationPath = resolve(__dirname, "../modules/data/migrations/001_core_tables.sql");
  const sql = readFileSync(migrationPath, "utf-8");

  console.log("=== COPY EVERYTHING BELOW THIS LINE ===\n");
  console.log(sql);
  console.log("\n=== COPY EVERYTHING ABOVE THIS LINE ===");
  console.log("\nPaste into: https://supabase.com/dashboard/project/" + PROJECT_REF + "/sql/new");
}

run();
