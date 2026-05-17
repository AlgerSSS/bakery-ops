import "dotenv/config";
import { AJobThingConnector } from "../modules/domain/recruitment/connectors/ajobthing.connector";
import type { ParsedJD } from "../modules/domain/recruitment/types";

async function main() {
  const connector = new AJobThingConnector();

  const jd: ParsedJD = {
    jobTitle: "Cashier",
    location: "Kuala Lumpur",
    requirements: ["customer service", "cash handling"],
    preferredSkills: ["POS system", "inventory"],
    experienceYears: 1,
    languageRequirements: ["English", "Mandarin"],
    jobType: "full_time",
    rawText: "招收银员，中英文都会，吉隆坡",
  };

  console.log("=== Testing AJobThing connector ===");
  console.log(`Query: ${jd.jobTitle} in ${jd.location}`);
  console.time("search");

  const result = await connector.search(jd, 5);

  console.timeEnd("search");
  console.log(`\nSource: ${result.source}`);
  console.log(`Total found: ${result.totalFound}`);
  console.log(`Errors: ${result.errors?.join("; ") || "none"}`);

  for (const c of result.candidates) {
    console.log(`\n--- ${c.name} ---`);
    console.log(`  Title: ${c.currentTitle}`);
    console.log(`  Location: ${c.location}`);
    console.log(`  Phone: ${c.phone || "未解锁"}`);
    console.log(`  Email: ${c.email || "未解锁"}`);
    console.log(`  Skills: ${c.skills.join(", ") || "none"}`);
    console.log(`  Languages: ${c.languages.join(", ") || "none"}`);
    console.log(`  Education: ${c.education || "none"}`);
    console.log(`  Experience: ${(c.experience || "").slice(0, 200)}`);
    console.log(`  Summary: ${c.summary || "none"}`);
    console.log(`  Profile: ${c.sourceUrl}`);
  }

  console.log("\nDone!");
}

main().catch(console.error);
