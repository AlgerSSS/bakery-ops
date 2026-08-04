# Hot Crush HBTI

Mobile-first, three-language HBTI experience for Hot Crush members. Visitors
sign in with the verified RES H5 phone/OTP flow; an existing member continues
immediately, while a new customer explicitly accepts membership before RES
creates the account. The application then runs the thirteen-question HBTI flow
and safely requests the configured physical-gift coupon after completion.

## Customer journey

1. A visitor opens `/` and enters a phone number.
2. RES sends an OTP. The server verifies the code and resolves the existing
   member or, with explicit consent, creates the RES membership.
3. The member completes all thirteen questions in English, Simplified Chinese,
   or Malay.
4. The member sees one of 16 HBTI results, chooses one of nine colours, and may
   save or share a token-free result card.
5. The server issues at most one configured coupon per member and campaign.
6. Every terminal result includes a link back to the verified RES member wallet.

Legacy `/t/<token>` URLs redirect to `/`; private invitation tokens are retired.

## Local verification

Install dependencies and run the complete release gate:

```bash
npm ci
npm run typecheck
npm run lint
npm test
npm run build
npm run test:e2e
```

Start the local site with `npm run dev`.

To print the canonical member sign-in and no-coupon demo URLs:

```bash
node scripts/print-hbti-urls.mjs
```

## Environment

Copy `.env.example` to `.env.local` and supply the values through an approved
secret store. Never commit RES credentials or secret-bearing environment files.

- `HBTI_AUTH_SECRET`: independent key for encrypted OTP challenges and member
  sessions; at least 32 bytes.
- `HBTI_CAMPAIGN_VERSION`: stable campaign idempotency identifier.
- `HBTI_LINK_BASE_URL`: canonical HTTPS origin.
- `DATABASE_URL`: the shared Supabase Postgres transaction pooler (`:6543` on
  Vercel). Completion/profile state lives on `pos_member.hbti_*`; authentication
  and rate-limit state uses the HBTI tables; inventory uses `hbti_gift_stock`.
- `HBTI_MEMBER_STORE`: the store name half of `pos_member`'s composite key. It
  must match `MEMBER_STORE` in `~/hot/res_api`, or the same member is written
  twice instead of being enriched. Defaults to `吉隆坡Pavilion门店`.
- `CRON_SECRET`: protects the reconciliation endpoint; at least 32 characters.
- `ALERT_WEBHOOK`: required production destination for durable review alerts.
  Missing configuration makes `/api/health` return 503.
- `RES_VULCAN_TOKEN`: HBTI-specific RES service credential, scoped to member
  lookup, coupon readback/template lookup, and one-coupon issuance.
- `RES_*`: tenant, organisation, brand, shop, coupon-template, member-wallet,
  and verified H5 member-auth configuration.

Local secret-bearing files should be mode `0600`.

## Operations

- `GET /api/health` performs a read-only Postgres check, an authenticated
  read-only RES coupon-template lookup, and verifies that the alert destination
  is configured. HTTP 200 means all launch dependencies are ready; HTTP 503
  means the site must not send a new campaign batch.
- `GET /api/cron/reconcile` is protected by `CRON_SECRET`. Vercel invokes it
  daily at `19:00 UTC` (`03:00 Asia/Kuala_Lumpur`) to retry durable review
  alerts, reconcile ambiguous completions, and purge expired operational rows.
- Records in `review` require an operator to check the member wallet before any
  manual action. Never retry a real coupon mutation merely because the browser
  timed out.
- Rate limiting stores only HMAC fingerprints of phone and IP identities, not
  their plaintext values.

Before a customer SMS batch:

1. Confirm the production deployment is Ready and the custom domain aliases it.
2. Send a non-sensitive alert canary and confirm the destination receives it.
3. Confirm `/api/health` returns 200 with `alert`, `db`, and `res` all `ok`.
4. Run the authenticated reconciliation endpoint and confirm `ok: true`.
5. Confirm there are no unresolved `processing`, `prepared`, or `review`
   completion records.
6. Open `/` in a real mobile browser and complete an approved test-member flow.
7. Start the campaign only for the intended audience and campaign version.

## Deployment and rollback

The Vercel project is `hotcrush-hbti`, with
`https://hbti-test.hotcrush.net` as its canonical domain. Deploy only after the
full release gate passes. Save the resulting deployment ID in `HANDOFF.md`.

For rollback, promote the last verified Vercel deployment and re-run the health
check. A rollback does not reverse coupons already issued in RES, inventory
already drawn, or completion/profile records already written to `pos_member`.
The 066/077/078 database cutover is forward-compatible with application
rollback; do not roll back shared production tables during an application
rollback.

## Safety boundary

This repository does not send campaign invitations or replace the RES member
system. It orchestrates the verified RES H5 OTP/member-registration APIs, owns
the public HBTI result experience and physical-gift coupon request, and links
members back to the official RES wallet/profile surfaces.
