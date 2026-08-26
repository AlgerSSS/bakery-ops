#!/usr/bin/env node
import postgres from "postgres";

import {
  entitlementsForLevel,
  levelKeyFromResName,
  periodKeyForEntitlement,
} from "../lib/level-entitlements.js";

const databaseUrl = process.env.DATABASE_URL?.trim();
if (!databaseUrl) throw new Error("DATABASE_URL is required.");
const sql = postgres(databaseUrl, { max: 1, prepare: false, ssl: "require" });

try {
  const members = await sql`
    SELECT DISTINCT ON (member_id) member_id, level_name
      FROM public.pos_member
     WHERE has_card = true AND level_name IS NOT NULL
     ORDER BY member_id, snapshot_date DESC
  `;
  let created = 0;
  let unknown = 0;
  await sql.begin(async (tx) => {
    for (const member of members) {
      const levelKey = levelKeyFromResName(member.level_name);
      if (!levelKey) {
        unknown += 1;
        continue;
      }
      for (const benefitCode of entitlementsForLevel(levelKey)) {
        const periodKey = periodKeyForEntitlement(benefitCode);
        const quarterly = periodKey.includes("-Q");
        const rows = await tx`
          INSERT INTO public.mkt_member_entitlement
            (member_id, benefit_code, period_key, source_level,
             eligible_from, eligible_until, source_ref)
          VALUES
            (${member.member_id}, ${benefitCode}, ${periodKey}, ${levelKey},
             (CASE WHEN ${quarterly}
               THEN date_trunc('quarter', now() AT TIME ZONE 'Asia/Kuala_Lumpur')
               ELSE date_trunc('year', now() AT TIME ZONE 'Asia/Kuala_Lumpur')
              END) AT TIME ZONE 'Asia/Kuala_Lumpur',
             (CASE WHEN ${quarterly}
               THEN date_trunc('quarter', now() AT TIME ZONE 'Asia/Kuala_Lumpur') + interval '3 months'
               ELSE date_trunc('year', now() AT TIME ZONE 'Asia/Kuala_Lumpur') + interval '1 year'
              END) AT TIME ZONE 'Asia/Kuala_Lumpur',
             'res-level-catalog-v2')
          ON CONFLICT (member_id, benefit_code, period_key) DO UPDATE SET
            source_level = CASE
              WHEN excluded.source_level > mkt_member_entitlement.source_level
              THEN excluded.source_level ELSE mkt_member_entitlement.source_level END,
            updated_at = now()
          RETURNING entitlement_id
        `;
        created += rows.length;
      }
    }
  });
  console.log(`[level-entitlements] members=${members.length} upserted=${created} unknown=${unknown}`);
  if (unknown > 0) process.exitCode = 3;
} finally {
  await sql.end({ timeout: 5 });
}
