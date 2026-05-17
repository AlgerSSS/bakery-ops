import "dotenv/config";
import { JobStreetConnector } from "../modules/domain/recruitment/connectors/jobstreet.connector";
import type { ParsedJD } from "../modules/domain/recruitment/types";

async function main() {
  const connector = new JobStreetConnector();

  const jd: ParsedJD = {
    jobTitle: "Store Operations Management Trainee",
    location: "Kuala Lumpur",
    requirements: ["customer service", "sales experience"],
    preferredSkills: ["English", "Mandarin"],
    experienceYears: 0,
    languageRequirements: ["English", "Bahasa Malaysia"],
    jobType: "full_time",
    rawText: "Store Operations Management Trainee in Kuala Lumpur",
  };

  console.log("=== Running JobStreet connector search ===");
  console.log(`Job title: ${jd.jobTitle}`);
  console.log(`Max results: 3`);
  console.time("search");

  const result = await connector.search(jd, 3);

  console.timeEnd("search");
  console.log(`\n=== Results ===`);
  console.log(`Source: ${result.source}`);
  console.log(`Total found: ${result.totalFound}`);
  console.log(`Errors: ${result.errors?.join("; ") || "none"}`);

  for (const c of result.candidates) {
    console.log(`\n--- ${c.name} ---`);
    console.log(`  Email: ${c.email}`);
    console.log(`  Phone: ${c.phone}`);
    console.log(`  Location: ${c.location}`);
    console.log(`  Current title: ${c.currentTitle}`);
    console.log(`  Skills: ${c.skills.join(", ")}`);
    console.log(`  Languages: ${c.languages.join(", ")}`);
    console.log(`  Education: ${c.education}`);
    console.log(`  Resume file: ${c.resumeFileName || "none"}`);
    console.log(`  Resume ID: ${c.resumeFileId || "none"}`);
    console.log(`  Source URL: ${c.sourceUrl}`);
  }

  console.log("\nDone!");
}

main().catch(console.error);
