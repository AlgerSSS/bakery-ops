# Hot Crush Sales API

A read-only HTTP API that exposes Restosuite back-office sales data as JSON or CSV.
Data is scraped from `bo.sea.restosuite.ai` and refreshed on demand.

- **Base URL (same machine):** `http://localhost:8787`
- **Base URL (another machine):** `http://<HOST_IP_OR_DOMAIN>:8787`
- **Time zone:** all dates are in `Asia/Kuala_Lumpur` (the shop's local time).
- **Window:** every endpoint returns the last 30 days, ending at the most recent refresh.
- **Currency:** MYR (RM). All money values are plain numbers, no currency prefix.
- **Shop:** `HOT CRUSH BAKERY` (id `406994127`), brand `HOT CRUSH BAKERY`, corp `Yuns & hot crush sdn bhd`.

---

## 1. Auth

Every `/v1/*` endpoint except `/v1/status` requires an API key. Two ways to send it:

```http
Authorization: Bearer <API_KEY>
```

or as a query string:

```
?key=<API_KEY>
```

Failed auth returns `401 {"error":"unauthorized","hint":"..."}`.

> Get the key from the operator. Treat it like a password — anyone with the key can read all sales data and trigger refreshes.

---

## 2. Quick start

Use `localhost` only when the client runs on the same machine as this API server.
If you call the API from another device or service, replace `localhost` with the server machine's reachable LAN IP, public IP, or domain.

```bash
BASE=http://localhost:8787
# From another machine, use for example:
# BASE=http://192.168.1.23:8787

# JSON
curl -H "Authorization: Bearer $KEY" "$BASE/v1/sales/overview"

# CSV (two ways)
curl -H "Authorization: Bearer $KEY" "$BASE/v1/sales/by-date?format=csv"
curl -H "Authorization: Bearer $KEY" -H "Accept: text/csv" "$BASE/v1/items/by-hour-qty"

# Trigger a fresh scrape (takes 1-2 min). Returns 202 immediately.
curl -X POST -H "Authorization: Bearer $KEY" "$BASE/v1/refresh"

# Poll until done
curl "$BASE/v1/status"
```

JSON responses always look like:

```json
{
  "route": "/v1/sales/overview",
  "modified": "2026-05-13T08:42:11.000Z",
  "count": 1,
  "rows": [ { "Net Sales": "1276146.65", "...": "..." } ]
}
```

`modified` is when the underlying CSV was last refreshed.
Numbers come back as **strings** (preserving the back-office's formatting). Convert with `Number()` on the client.

---

## 3. Endpoints

All endpoints support both `application/json` (default) and `text/csv` (via `?format=csv` or `Accept: text/csv`).

### Public

| Method | Path           | Description                              |
| ------ | -------------- | ---------------------------------------- |
| GET    | `/`            | API catalog + shop metadata              |
| GET    | `/v1`          | Same as `/`                              |
| GET    | `/v1/status`   | File freshness + last refresh status     |

### Sales (authenticated)

| Method | Path                          | Rows | Description                                                |
| ------ | ----------------------------- | ---- | ---------------------------------------------------------- |
| GET    | `/v1/sales/overview`          | 1    | Headline KPIs: Net Sales, Item Sale, Bill Count, Guests    |
| GET    | `/v1/sales/totals`            | 1    | Full Sales Breakdown totals (32+ metrics, single row)      |
| GET    | `/v1/sales/by-date`           | 30   | Daily breakdown for the last 30 days, all 32+ metrics      |
| GET    | `/v1/sales/by-dining-option`  | 2    | Bill count split by Dine-in / Takeaway                     |
| GET    | `/v1/sales/by-payment`        | 7    | Net Sales split by payment method (Cash / Bank Card / ...) |

### Items (authenticated)

| Method | Path                          | Rows  | Description                                                                            |
| ------ | ----------------------------- | ----- | -------------------------------------------------------------------------------------- |
| GET    | `/v1/items/totals`            | 1     | Item-level totals (qty, gross, net, refund, discount)                                  |
| GET    | `/v1/items/by-category`       | ~10   | Sales rolled up by dish parent + sub category                                          |
| GET    | `/v1/items/by-dish`           | ~80   | Per-SKU 30-day totals (rank by netQty)                                                 |
| GET    | `/v1/items/by-hour`           | ~800  | Long form: one row per (dish, hour) with qty + net/gross sales + refunds + discount    |
| GET    | `/v1/items/by-hour-qty`       | ~80   | Pivot: rows = dishes, columns = `H00`..`H23` + `Total Qty` (sorted by total)           |
| GET    | `/v1/items/by-hour-sales`     | ~80   | Pivot: rows = dishes, columns = `H00`..`H23` + `Total Net Sales` (sorted by total)     |

### Operations (authenticated)

| Method | Path                | Description                                                                  |
| ------ | ------------------- | ---------------------------------------------------------------------------- |
| POST   | `/v1/refresh`       | Triggers full re-scrape (30-day + daily). Returns `202`. Poll `/v1/status`.  |
| POST   | `/v1/refresh-daily` | Triggers daily-only re-scrape (~30s). Returns `202`. Poll `/v1/status`.      |

### Daily Analysis (authenticated, JSON only)

| Method | Path                       | Description                                                                 |
| ------ | -------------------------- | --------------------------------------------------------------------------- |
| GET    | `/v1/daily/summary`        | Today's KPIs: bill count, avg ticket, gross/net sales, discount rate, member ratio, payment channels |
| GET    | `/v1/daily/hourly`         | Per-hour breakdown: bill count, guests, avg ticket, gross/net sales         |
| GET    | `/v1/daily/items`          | Top items sold today (qty, net/gross sales, discount)                       |
| GET    | `/v1/daily/items-by-hour`  | Items × hour detail for today                                               |
| GET    | `/v1/daily/payment`        | Payment channel breakdown (Bank Card, Cash, Membership, Touch 'n Go, etc.) |
| GET    | `/v1/daily/dining`         | Dining option split (Dine-in / Takeaway)                                    |
| GET    | `/v1/daily/analysis`       | Combined analysis: peak hours, customer segments, payment mix, strategy insights |

### Advanced

| Method | Path                                        | Description                                            |
| ------ | ------------------------------------------- | ------------------------------------------------------ |
| GET    | `/v1/raw/<slug>/<file>.csv`                 | Direct access to per-page CSVs (see `/v1/status`)      |

---

## 4. Field reference

Field names in the response are already translated to human-readable English/Chinese where the back office provided one. A few you'll see often:

| Field                 | Meaning                                                        |
| --------------------- | -------------------------------------------------------------- |
| `Business Date`       | Local business day (`YYYY-MM-DD`, Asia/Kuala_Lumpur)           |
| `Net Sales`           | After tax-incl deduction, before surcharge                     |
| `Item Sale` / `Gross Sales` | Pre-discount total (label depends on report)             |
| `Bill Count`          | Number of completed orders                                     |
| `Num Of Guests`       | Reported guest count                                           |
| `Tax (Incl)`          | Tax already inside Gross Sales                                 |
| `Total Tax`           | Tax computed on top                                            |
| `Surcharge (Actual)`  | Surcharges that increase merchant revenue                      |
| `Avg Order Net Sales` | Net Sales / Bill Count                                         |
| `Avg Guest Net Sales` | Net Sales / Num Of Guests                                      |
| `Dish Name` / `Unit`  | Item name + spec name (Unit is `-` when no spec)               |
| `Hour`                | 0..23, business-day hour in the shop's local timezone          |

For payment and dining-option breakdown, codes are translated:

- `Cash`, `ExternalBankCard`, `Membership card balance`, ...
- `Dine-in`, `Takeaway`, ...

---

## 5. Daily Analysis response format

### `/v1/daily/summary`

```json
{
  "date": "2026-05-18",
  "scrapedAt": "2026-05-18T14:30:00Z",
  "billCount": 856,
  "guestCount": 860,
  "avgTicket": 52.30,
  "avgPerGuest": 52.10,
  "grossSales": 46800.00,
  "netSales": 44769.80,
  "totalDiscount": 2030.20,
  "discountRate": 4.34,
  "tax": 2686.19,
  "totalPaymentReceived": 47456.00,
  "paymentChannels": [
    { "channel": "Bank Card", "amount": 38500.00, "pct": 81.12 },
    { "channel": "Membership Card", "amount": 5200.00, "pct": 10.96 },
    { "channel": "Cash", "amount": 3756.00, "pct": 7.92 }
  ],
  "memberSalesRatio": 10.96
}
```

### `/v1/daily/analysis`

```json
{
  "date": "2026-05-18",
  "kpi": { "billCount": 856, "avgTicket": 52.3, "grossSales": 46800, "netSales": 44769.8, "discountRate": 4.34, "memberSalesRatio": 10.96 },
  "peakHours": [ { "hour": "12", "billCount": 120, "avgTicket": 55.0, ... } ],
  "customerSegments": [ { "segment": "Dine-in", "billCount": 740, "pct": 86.4, "netSales": 38700 } ],
  "paymentMix": {
    "bankCard": { "amount": 38500, "pct": 81.1 },
    "touchNGo": { "amount": 0, "pct": 0 },
    "membership": { "amount": 5200, "pct": 11.0 },
    "cash": { "amount": 3756, "pct": 7.9 }
  },
  "strategies": [
    { "type": "discount_ok", "msg": "Discount rate 4.34% is healthy (<5%)." },
    { "type": "member_growth", "msg": "Member payment ratio 10.96% is low. Push membership sign-ups." },
    { "type": "peak_hours", "msg": "Peak hours: 12:00, 13:00, 14:00. Focus staffing and prep here." },
    { "type": "top_seller", "msg": "Top seller: Signature Black Truffle Wellington Steak Croissant (280 units, RM7560.00)." }
  ]
}
```

---

## 6. Refresh & freshness

- Calling `POST /v1/refresh` runs: `login → scrape → scrape-items-by-hour → scrape-daily → translate → apply`.
- Calling `POST /v1/refresh-daily` runs: `login → scrape-daily` (faster, ~30s).
- One refresh takes about 60–120 seconds.
- Only one refresh runs at a time. A second concurrent call returns `409`.
- Call `GET /v1/status` to check `refreshRunning`, `lastRefresh`, and per-file `modified` timestamps.
- The 30-day window automatically rolls forward each refresh — there is no date parameter to pass.

---

## 7. Errors

| Code  | Meaning                                                |
| ----- | ------------------------------------------------------ |
| 200   | OK                                                     |
| 202   | Refresh accepted, running in background                |
| 401   | Missing or wrong API key                               |
| 404   | Unknown path                                           |
| 409   | Refresh already running                                |
| 503   | Data file not yet available — call `/v1/refresh` first |

Error bodies look like `{"error":"...","hint":"..."}`.

---

## 8. CORS

The server sends `Access-Control-Allow-Origin: *` and supports `OPTIONS` preflight. Browsers can call it directly from any origin.

---

## 9. Code samples

### JavaScript (browser or Node)

```js
const KEY = '...';
const BASE = 'http://localhost:8787'; // replace localhost when calling from another machine

async function get(path) {
  const r = await fetch(`${BASE}${path}`, { headers: { Authorization: `Bearer ${KEY}` } });
  if (!r.ok) throw new Error(`${r.status} ${await r.text()}`);
  return r.json();
}

const { rows } = await get('/v1/items/by-hour-qty');
const top5 = rows.slice(0, 5).map(r => ({ name: r['Dish Name'], total: Number(r['Total Qty']) }));
console.log(top5);
```

### Python

```python
import requests
KEY = '...'
BASE = 'http://localhost:8787'  # replace localhost when calling from another machine
S = requests.Session()
S.headers['Authorization'] = f'Bearer {KEY}'

r = S.get(f'{BASE}/v1/sales/by-date')
r.raise_for_status()
for row in r.json()['rows']:
    print(row['Business Date'], row['Net Sales'], row['Bill Count'])
```

### Pandas (CSV → DataFrame)

```python
import pandas as pd
df = pd.read_csv(f'{BASE}/v1/items/by-hour-qty?format=csv',
                 storage_options={'Authorization': f'Bearer {KEY}'})
print(df.set_index('Dish Name').loc[:, 'H10':'H22'].head())
```

---

## 10. Running the server

```bash
git clone <repo>
cd hr
npm install
npx playwright install chromium
cp .env.example .env
# fill in RESTOSUITE_EMAIL, RESTOSUITE_PASSWORD, API_KEY
npm run login        # one-off, saves a session
npm run refresh      # first scrape
npm start            # serve on $PORT (default 8787)
npm test             # smoke test all endpoints
```

`.env` keys:

| Key                  | Required | Default   |
| -------------------- | -------- | --------- |
| `RESTOSUITE_EMAIL`   | yes      |           |
| `RESTOSUITE_PASSWORD`| yes      |           |
| `API_KEY`            | yes      | generated |
| `PORT`               | no       | 8787      |
