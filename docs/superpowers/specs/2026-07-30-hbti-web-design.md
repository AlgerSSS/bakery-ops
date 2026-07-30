# HOT CRUSH HBTI Web Experience Design

## Goal

Build and deploy a mobile-first, trilingual HBTI experience at
`https://hbti-test.hotcrush.net`. The site must visually match the existing
See You Often RES H5, calculate all 16 HBTI types, and issue one real
`Pistachio Green Jewel` physical-gift coupon to the same RES member account
after a valid member completes the experience.

## Scope

The first release includes:

- English as the default language.
- Simplified Chinese and Bahasa Melayu language switching.
- A six-question, one-question-per-screen HBTI flow.
- Automatic progress persistence in the browser.
- Six-answer scoring across the I/H, L/S, B/D and A/T axes.
- All 16 result types with localized names, descriptions and product matches.
- A required result-card colour choice from nine branded options.
- Token-free PNG download and native share/clipboard fallback for the result
  card.
- Optional gender and age-range questions after the result is known.
- A signed personal link that binds the session to one RES member.
- Server-side RES lookup and coupon issuance.
- Persistent idempotency: one member receives at most one coupon for one
  HBTI campaign version.
- A verified reward state only after RES readback confirms the coupon.
- A production Vercel deployment and the custom domain
  `hbti-test.hotcrush.net`.

The first release does not include:

- SMS scheduling or delivery.
- A public phone-number lookup form.
- A second member account or password.
- Changes to the published RES H5.
- Creation or modification of RES coupon templates.
- Automated campaign analytics or CRM segmentation beyond storing the HBTI
  completion record.

## User Experience

### Personal-link entry

An opaque, signed URL identifies the member without exposing their phone
number. A valid link opens the branded landing screen. An invalid or expired
link shows a localized recovery message and cannot trigger coupon issuance.

### Landing screen

The first screen communicates three things without scrolling:

1. This is an official HOT CRUSH member experience.
2. It takes six questions and about 40 seconds.
3. Completion unlocks one merchandise coupon in the member's RES account.

Primary English copy:

> Your coffee personality might know you better than you do.
>
> 6 questions · About 40 seconds
>
> Finish the experience and your merchandise coupon will be added to your
> HOT CRUSH member account.

Primary action: `Start my HBTI`

### Question flow

- Exactly one question is visible at a time.
- The header shows `n / 6` and a smooth progress rail.
- Every answer uses a large touch target and requires no typing.
- Selecting an answer transitions to the next question after a short visual
  confirmation.
- A Back control allows previous answers to be changed.
- Refreshing or reopening the same link restores the local answer state.
- Completing question six moves directly to result generation.

### Result and reward

The result screen presents:

- Four-letter HBTI code.
- Localized personality name and short behavioural description.
- The four preference labels.
- A localized "signature order" recommendation.
- A required colour selection that changes the result card.
- Save and share actions that never include the personal invitation token.
- Optional gender and age-range controls.
- A reward-status panel.

The reward panel starts in a neutral state. Submitting the required result
data calls the server once. It shows success only after RES confirms that the
coupon is present in the member account. Network or RES errors leave the
result card visible and offer a safe retry without creating duplicate coupons.

## Visual System

The site reuses the existing RES H5 design language:

| Token | Value | Use |
|---|---|---|
| Cream | `#F9F2E3` | Page background |
| Flesh pink | `#EFCBC6` | Hero and result surfaces |
| Blush | `#FAE9E6` | Secondary cards |
| Cocoa | `#84534D` | Secondary text and outlines |
| Dark cocoa | `#59231B` | Primary text |
| Pistachio | `#B4C876` | Primary action and progress |
| Walnut | `#806D5E` | Quiet supporting surfaces |
| White | `#FFFFFF` | Question cards |

English and Bahasa Melayu headings use NeutraTextDemiAlt where available.
Body copy uses OPPOSans. Chinese uses the same rounded Chinese display style
as the RES H5 with OPPOSans as the safe fallback.

Cards use 18–28 px radii, restrained one-pixel cocoa borders and almost no
drop shadow. The signature visual gesture is a soft card-to-card movement:
the selected answer settles inward, the old question fades and moves left,
and the next question rises from the right.

Motion uses a shared `cubic-bezier(.22, 1, .36, 1)` curve:

- 180 ms answer press.
- 360 ms question transition.
- 500 ms result reveal.
- CSS-only ambient colour breathing on the result card.

All non-essential motion is removed when `prefers-reduced-motion` is enabled.

## Architecture

The project is an isolated Next.js TypeScript application under `hbti-web/`.
The browser renders the experience and calculates the result locally. Server
routes validate the signed member link, persist idempotency state in a
dedicated MongoDB Atlas collection, and call RES with server-only credentials.

### Routes

- `/` — branded explanation for visitors without a personal link.
- `/t/[token]` — the complete member-bound HBTI flow.
- `/api/session` — validate the personal token and return a masked session.
- `/api/complete` — validate answers, calculate the type independently,
  acquire the idempotency lock, issue the coupon and read back the result.
- `/api/health` — provide a secret-free application liveness check.

### Personal token

The token is an authenticated encrypted payload containing:

- RES member lookup identity.
- Campaign version.
- Expiry timestamp.
- Random token identifier.

The browser never receives RES credentials. A command-line script creates the
first token for the test member using an environment variable, so the phone
number is not committed or printed in build logs.

### Idempotency record

MongoDB document `_id`:

`<campaignVersion>:<memberIdentityHash>`

States:

- `processing` — short lock while RES is being called.
- `issued` — permanent completion receipt with non-sensitive RES evidence.
- `review` — RES may have accepted the request but readback was inconclusive;
  retries are blocked until the server can reconcile safely.

If an `issued` record exists, `/api/complete` returns the existing success
receipt and never calls the RES give endpoint again.

### RES connector

The connector:

1. Resolves the signed identity to exactly one RES member.
2. Resolves the enabled `Pistachio Green Jewel` physical-gift template.
3. Reads the member's matching coupon state before mutation.
4. Calls the RES give endpoint for quantity one.
5. Reads the member coupon state again.
6. Treats the operation as successful only when the expected new coupon is
   confirmed.

RES cookies, tokens and credentials are Vercel encrypted environment
variables and are never returned to the client or written to logs. A failed or
expired RES session produces a retryable service error, not a browser-side
credential flow.

## Security and Privacy

- No public phone-number search endpoint.
- No RES credentials or raw response payloads in the browser.
- No raw phone number in URLs, analytics, MongoDB documents or application
  logs.
- Strict input schemas for token, answers, locale, colour, gender and age.
- Origin validation on the completion endpoint.
- Per-token, Mongo-backed rate limiting on session and completion endpoints.
- Atomic per-campaign/per-member completion acquisition before any RES write.
- `Cache-Control: no-store` on member-bound and API responses.
- Referrer policy prevents the personal token leaking to third-party sites.
- Result sharing produces a token-free visual card.

## Failure Behaviour

- Invalid/expired link: localized link-expired screen; no RES call.
- Offline during questions: progress remains local; submission waits.
- MongoDB unavailable: fail closed; do not issue.
- RES member not unique: fail closed; do not issue.
- Coupon template unavailable or archived: fail closed; do not issue.
- RES give rejected: retain result, show retryable reward state.
- Give response ambiguous: store `review`, query RES, and do not blind retry.
- Coupon confirmed: store `issued` and show the member-wallet confirmation.

## Verification

Automated checks cover:

- All HBTI scoring combinations and 16 valid result codes.
- English, Chinese and Bahasa Melayu content completeness.
- Token encryption, expiry and tamper rejection.
- Request validation and server/client scoring agreement.
- Idempotency under sequential and concurrent completion requests.
- RES connector success, rejection and ambiguous-response reconciliation.
- Accessibility labels and reduced-motion behaviour.
- Mobile layouts at 320, 375 and 430 px widths.

Production acceptance requires:

1. Vercel production deployment is `READY`.
2. `hbti-test.hotcrush.net` serves the deployment over HTTPS.
3. The public page defaults to English and all three languages render.
4. The signed test link resolves only the member
   the authorized masked test member `+86 186****6817`.
5. Completing the flow increases that member's usable
   `Pistachio Green Jewel` coupon count by exactly one.
6. Repeating the submission does not increase the count again.
7. No RES credential appears in shipped JavaScript, HTML, logs or responses.
8. Nine colour choices and token-free result download/share work at mobile
   widths.
9. The health route proves both MongoDB access and an authenticated,
   read-only RES template lookup before a customer SMS batch.
