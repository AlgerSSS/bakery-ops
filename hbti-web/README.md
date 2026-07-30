# Hot Crush HBTI

Mobile-first, three-language HBTI experience for Hot Crush members. The RES
official H5 remains the registration, profile, RM10 reward, and member-wallet
surface. This application opens only from a personal SMS link, runs the six
question HBTI flow, and safely requests the configured physical-gift coupon
from RES after completion.

## Customer journey

1. A registered member receives a personal `/t/<token>` link by SMS.
2. The link validates the encrypted member binding without displaying the full
   phone number.
3. The member completes exactly six questions in English, Simplified Chinese,
   or Malay.
4. The member sees one of 16 HBTI results, chooses one of nine colours, and may
   save or share a token-free result card.
5. The server issues at most one configured coupon per member and campaign.
6. Every completion state includes a link back to the verified RES member
   wallet.

The public `/` page deliberately cannot start the test because it has no member
binding. It explains that a personal invitation is required.

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

To create a private test link, load the local environment and provide the test
member as a temporary environment variable. Do not paste personal links into
logs, tickets, or documentation.

```bash
HBTI_TEST_PHONE='<E.164 phone>' node scripts/create-member-link.mjs
```

## Environment

Copy `.env.example` to `.env.local` and supply the values through an approved
secret store. Never commit either the RES credential or generated member links.

- `HBTI_LINK_SECRET`: encrypts personal links; at least 32 bytes.
- `HBTI_MEMBER_HASH_SECRET`: independent HMAC secret for idempotency; at least
  32 bytes and stable for the campaign.
- `HBTI_CAMPAIGN_VERSION`: stable campaign identifier.
- `HBTI_LINK_BASE_URL`: canonical HTTPS origin.
- `HBTI_LINK_TTL_SECONDS`: personal-link lifetime.
- `MONGODB_URI`: durable completion, review, and rate-limit storage.
- `CRON_SECRET`: protects the reconciliation endpoint; at least 32 characters.
- `RES_VULCAN_TOKEN`: approved service credential for RES.
- `RES_*`: tenant, organisation, brand, shop, coupon-template, and verified
  member-wallet configuration.

Local secret-bearing files should be mode `0600`.

## Operations

- `GET /api/health` performs a read-only MongoDB check and an authenticated,
  read-only RES coupon-template lookup. HTTP 200 means both dependencies are
  ready; HTTP 503 means the site must not send a new SMS batch.
- `GET /api/cron/reconcile` is protected by `CRON_SECRET`. Vercel invokes it
  daily at `19:00 UTC` (`03:00 Asia/Kuala_Lumpur`) to reconcile ambiguous
  completions without blindly reissuing a coupon.
- Records in `review` require an operator to check the member wallet before any
  manual action. Never retry a real coupon mutation merely because the browser
  timed out.
- Rate limiting stores only a SHA-256 fingerprint of the invitation token, not
  the raw token.

Before a customer SMS batch:

1. Confirm the production deployment is Ready.
2. Confirm the custom domain resolves to that deployment.
3. Confirm `/api/health` returns 200.
4. Confirm there are no unresolved `processing`, `prepared`, or `review`
   completion records.
5. Generate links only for the intended member list and campaign version.

## Deployment and rollback

The Vercel project is `hotcrush-hbti`, with
`https://hbti-test.hotcrush.net` as its canonical domain. Deploy only after the
full release gate passes. Save the resulting deployment ID in `HANDOFF.md`.

For rollback, promote the last verified Vercel deployment and re-run the health
check. A rollback does not reverse coupons already issued in RES or completion
records already stored in MongoDB.

## Safety boundary

This repository intentionally does not implement RES registration, OTP, the
RM10 profile-completion coupon, SMS delivery, or a public anonymous HBTI start.
Those remain upstream responsibilities. The HBTI application owns only the
personal-link test, result experience, and physical-gift coupon request.
