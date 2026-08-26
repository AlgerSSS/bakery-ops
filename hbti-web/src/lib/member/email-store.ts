import { getDb, memberStore, type SqlRunner } from "@/lib/db/postgres";
import {
  isValidMemberEmail,
  normalizeMemberEmail,
} from "@/lib/member/email-address";

export async function hasMemberEmail(
  memberId: string,
  sql: SqlRunner = getDb(),
): Promise<boolean> {
  const rows = await sql<Array<{ collected: boolean }>>`
    SELECT EXISTS (
      SELECT 1
        FROM public.mkt_member_contact
       WHERE store = ${memberStore()}
         AND member_id = ${memberId}
         AND email IS NOT NULL
    ) AS collected
  `;
  return rows[0]?.collected === true;
}

export async function saveMemberEmail(
  memberId: string,
  email: string,
  sql: SqlRunner = getDb(),
): Promise<void> {
  const normalized = normalizeMemberEmail(email);
  if (!isValidMemberEmail(normalized)) {
    throw new InvalidMemberEmailError();
  }

  await sql`
    INSERT INTO public.mkt_member_contact AS contact (
      store, member_id, email, source
    ) VALUES (
      ${memberStore()}, ${memberId}, ${normalized}, 'hbti'
    )
    ON CONFLICT (store, member_id) DO UPDATE SET
      email = EXCLUDED.email,
      source = EXCLUDED.source,
      email_marketing_opt_in = CASE
        WHEN contact.email IS DISTINCT FROM EXCLUDED.email THEN false
        ELSE contact.email_marketing_opt_in
      END,
      email_marketing_opt_in_at = CASE
        WHEN contact.email IS DISTINCT FROM EXCLUDED.email THEN NULL
        ELSE contact.email_marketing_opt_in_at
      END,
      updated_at = now()
  `;
}

export class InvalidMemberEmailError extends Error {
  constructor() {
    super("Invalid member email address.");
    this.name = "InvalidMemberEmailError";
  }
}
