import "dotenv/config";
import { JobStreetConnector } from "../modules/domain/recruitment/connectors/jobstreet.connector";
import type { ParsedJD } from "../modules/domain/recruitment/types";

async function main() {
  const connector = new JobStreetConnector();

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

  console.log("=== Testing Talent Search connector ===");
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
    console.log(`  Skills: ${c.skills.join(", ") || "none"}`);
    console.log(`  Languages: ${c.languages.join(", ") || "none"}`);
    console.log(`  Education: ${c.education || "none"}`);
    console.log(`  Experience: ${(c.experience || "").slice(0, 200)}`);
    console.log(`  Profile: ${c.sourceUrl}`);
  }

  console.log("\nDone!");
}

main().catch(console.error);
