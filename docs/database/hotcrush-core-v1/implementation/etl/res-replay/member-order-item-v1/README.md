# Report211 member order-item encrypted raw replay v1

## Status

- implementation: `IMPLEMENTED_NOT_EXECUTED`
- physical data: `PHYSICAL_BACKFILL_NOT_STARTED`
- live replay: `NOT_APPROVED_NOT_EXECUTED`
- database writes: no connector, adapter, SQL, or DML path exists in this package

Running `node cli.mjs` only prints the status above. Any argument is rejected.
The package has no bundled browser, session, token, Keychain, network, or
database adapter. Tests inject a synthetic transport and synthetic keys.

Do **not** run `res_api/scrape-member-order-item.mjs`. It writes the legacy
database table, drops every `qty <= 0` line, and predates the stable raw-line
identity proof.

## Frozen read contract

Every request is one page for exactly one Kuala Lumpur business date:

- endpoint: `POST https://bo.sea.restosuite.ai/api/report/data/queryData`
- report: `211`
- shop: `406994127`
- currency: `MYR`
- `D_isMemberConsume=true`
- page: exactly `pageNo=1`, `pageSize=2000`
- completion: response row count must equal the reported total and total must
  be strictly below the page size

The selected row fields include `D_itemId` and `D_reversal_order`. Customer
name, phone, email, member-card number, cookies, authorization data, and
session tokens are neither requested nor accepted. Unexpected sensitive keys
abort before artifact publication. The transport closure owns authentication;
the replay package never receives or persists request headers.

Deep pagination is forbidden. The old 4,457-row full-store sample contained
1,088 completely repeated response rows while still looking count-complete.
If a future daily result reaches the 2,000 upper bound, the run fails and must
be redesigned as smaller, independently proven single-page chunks;
it must not fetch page 2.

The required non-null row contract covers the business date, shop, currency,
order ID, item ID, exact item-name key, reversal code, member flag, order
status, and all seven raw/net metrics. Order status is restricted to
`10|20|30`; reversal is restricted to `0|1|2|3`; metrics are never defaulted
from null to zero. POS order ID, menu item ID, unit fields, and the three time
fields may be null or empty, but remain encrypted verbatim and increment
quality-warning counts. Business date is never inferred from a timestamp.

## Approved source-line identity

`D_itemId` alone is not stable: cancellation/refund orders reuse it. The
approved source-line key is:

```text
(D_shopId, D_orderId, D_itemId, D_reversal_order)
```

`D_businessDate`, `D_currency`, and `D_isMemberConsume` are mandatory row
assertions, not extra identity fields. `source_row_count` is
`COUNT(DISTINCT approved composite line key)`. Exact repeated response rows
are retained in the encrypted raw body but contribute only once to aggregates.
A repeated composite key with different payload is a hard identity collision.

The approval evidence covers the combined 220-day member-only Report211 range
from 2026-01-01 through 2026-08-08: 46,662 response rows in total, 46,142 distinct `D_itemId`, 46,662
distinct composite keys, zero duplicate/conflicting/null composite keys, and
canonical row digest
`2dcffa1fad936678d3ddc460d1d7289c23615d5cc2b4c39c8229ad961f0a20b0`.
The equivalent daily probes also total 46,662 rows, have no total mismatch,
and peak at 947 rows/day.

## Reconciliation boundary

Unique source lines aggregate by `(D_orderId, D_itemName)` to 44,484 groups.
The `source_row_count` distribution is 1:42,660; 2:1,573; 3:179; 4:60; 5:5;
6:5; 12:2. No group crosses a business date.

- 43,997 positive-quantity groups exactly reproduce the legacy key set,
  quantity, and net sales: 55,974 units / MYR 438,756.90.
- 485 negative-quantity groups were wrongly omitted by the legacy
  `qty <= 0` filter and must be restored. They are not discarded here.
- 2 zero-quantity groups are encrypted and preserved but carry
  `ZERO_QUANTITY_REQUIRES_QUARANTINE`, because the current target quantity
  check rejects zero.
- all 44,484 groups total 55,331 units / MYR 433,247.43. The omitted
  non-positive delta is -643 units / MYR -5,509.47.
- 2 of 99 source item keys (3 raw rows) are absent from the current product
  catalog. They require a historical listing seed; fuzzy, normalized, or
  guessed name matching is forbidden.

## Missing-listing catalog supplement

The caller supplies the approved listing item-key set. Only when an order-row
`D_itemName` is absent does the replay issue a second, independent Report211
query for the same day/shop/currency/member scope. It selects exactly
`D_itemName,D_menuItemId,D_itemCode,D_baseItemName,D_category,D_unitId,D_unit,D_itemType`,
uses `pageNo=1,pageSize=2000`, and still requires `rows=total<2000`.

No `D_itemName` API filter is added because its RES semantics have not been
proven. The complete daily supplement is filtered locally by exact
`D_itemName`; all eight fields must be non-null for a selected historical seed.
Unresolved or conflicting keys receive
`CATALOG_SUPPLEMENT_UNRESOLVED_LISTING_KEYS` and cannot enter the target. The
supplement response, request, watermark, digest, and selected seeds are stored
inside the same encrypted artifact, but its rows never contribute to order
`source_row_count`.

## Artifact and idempotency

The only output is an owner-only mode-0600 AES-256-GCM envelope. Its
authenticated plaintext contains the exact order and, when needed, catalog
supplement HTTP response bytes as base64, their independent canonical requests,
source parameters, watermarks, page statistics, approved line-key contract,
exact aggregate reconciliation, and both release statuses. No plaintext
response file is created.

The content hash determines the filename. Replaying identical parameters,
watermark, and response three times publishes once and returns `NOOP` twice;
a same-name content mismatch fails closed. Verification authenticates the
envelope, raw/request hashes, fixed query contract, row assertions, composite
identity, aggregate conservation, and zero-quantity blocker.

Synthetic verification only:

```sh
node --test tests/test_phase1_res_member_order_item_replay*.mjs
```

Passing these tests does not authorize or prove a real RES read, historical
capture, S0 conversion, target write, catch-up, or physical backfill.
