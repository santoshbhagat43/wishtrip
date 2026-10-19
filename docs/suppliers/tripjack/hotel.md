# TripJack Hotel API: knowledge base

| | |
| --- | --- |
| **Source** | https://tripjack.com/page/api-doc (the "Hotels API v3.0" tab) |
| **Version documented** | v3.0 (Aug 2026) |
| **Captured** | 2026-10-19: re-capture when TripJack changes the page |
| **Scope** | Everything on the page for this product, in full (Part 2), with a verified summary (Part 1) |
| **Secrets** | No API key appears in this file. Keys go in the environment (`TRIPJACK_API_KEY`), never in the repo. |

TripJack's page has three products, each in its own file here: `hotel.md`, `flight.md`, `tripsafe.md`.
An older "Api Doc 2.0" page also exists at https://tripjack.com/page/api-doc-v2 (not captured).

---

# Part 1: Quick reference

## What it is
Hotel API **v3.0** (status "Active"; v3.0 released Feb 2026, Booking List added Aug 2026). Partners search TripJack's
hotel inventory, price it live, review, then book (instantly, or as a hold confirmed later), and manage cancellation.
Marked "API-OUT · PARTNER REFERENCE": it is the API TripJack gives to partners who resell its stock.

## Hosts
| Purpose | UAT (test) | Production |
| --- | --- | --- |
| Search side: listing, pricing, review, static detail, content/mapping APIs | `https://apitest-hms.tripjack.com` | `https://hms-search.tripjack.com` |
| Booking side: book, confirm-book, booking-details, booking list, cancel | `https://apitest-hotel-booker.tripjack.com` | `https://hms-booker.tripjack.com` |
| Nationalities and the two older static endpoints | `https://apitest.tripjack.com` | (production search host) |

Keep the same path suffixes in production. **Do not use production until certification is approved.**

## Authentication
- Header `apikey: <key>` on every request, plus `Content-Type: application/json`. (v2's Bearer token is gone.)
- Keys are issued per partner during onboarding and scoped to the integration. Never put one in client code.
- After certification you give TripJack your **IPv4 ranges to whitelist**.

## The booking flow (4 steps)
1. **Listing**: `POST /hms/v3/hotel/listing`. Returns hotels with their cheapest option(s). Search is by `hids` (TripJack hotel IDs, max 100), not by city.
2. **Pricing** (called "Detail"): `POST /hms/v3/hotel/pricing`. All bookable options for one hotel, live. Returns `reviewHash`.
3. **Review**: `POST /hms/v3/hotel/review`. Re-validates price and availability, returns the **`bookingId`** and `onholdAllowed`. Call it immediately before Book.
4. **Book**: `POST /oms/v3/hotel/book`. With `paymentInfos` it is an **instant** booking; without it, a **hold** until `deadlineDateTime` (`ddt`). Then `POST /oms/v3/hotel/confirm-book` with the amount before the deadline, or it auto-cancels.
5. **Poll** `POST /oms/v3/hotel/booking-details` every **5 s for up to 180 s** until a terminal status.

The same `correlationId` (client-generated, required on every call) must be used across Listing, Pricing and Review.
Session lifetime: about **15 minutes** (`searchId`); the review window is shorter. Show a countdown; re-search after ~12 minutes idle.

## Every endpoint
| Method | Path (UAT host) | Purpose |
| --- | --- | --- |
| GET | `apitest.tripjack.com/hms/v3/nationality-info` | Nationalities with `countryId` (needed in search and review) |
| GET | `/hms/v3/content/fetch-countries` | Countries that have hotel data |
| GET | `/hms/v3/content/fetch-city-regionIds?limit=&cursor=` | City and region IDs (max 2000 per page) |
| POST | `/hms/v3/content/fetch-hotel-mapping` | `tjHotelId` to `unicaId` by `countryName` or `regionIds` (page, size up to 2000) |
| POST | `/hms/v3/content/fetch-hotel-content` | Full static content for up to 100 hotel IDs |
| POST | `/hms/v3/content/fetch-hotel-mapping-sync?page=` | Incremental NEW / UPDATE mappings since `lastUpdateTime` |
| POST | `/hms/v3/content/fetch-deleted-hotel-mapping?page=` | Incremental DELETE mappings |
| POST | `/hms/v3/hotel/static-detail` | Static detail for one hotel (cache up to 24 h) |
| POST | `/hms/v3/hotel/listing` | Search: hotels with cheapest options |
| POST | `/hms/v3/hotel/pricing` | All options for one hotel (live) |
| POST | `/hms/v3/hotel/review` | Re-validate and get `bookingId` |
| POST | `/oms/v3/hotel/book` | Instant booking, or hold if no payment |
| POST | `/oms/v3/hotel/confirm-book` | Confirm a hold (body: `bookingId`, `paymentInfos[].amount`) |
| POST | `/oms/v3/hotel/booking-details` | Status and full booking |
| POST | `/oms/v1/hotel/bookings` | Bookings in a date range (`startDate`, `endDate`) |
| POST | `/oms/v3/hotel/cancel-booking/{bookingId}` | Cancel (no body) |
| (deprecated) | `apitest.tripjack.com/hms/v3/fetch-static-hotels` and `/deleted` | Old static sync; use the content APIs instead |
| (removed) | `GET /v2/hotel/cancel-policy` | Cancellation policy is now inside every option |

## The data model you will use
- **Option** (`options[]`): one bookable combination of room type, meal plan and rate plan. Fields: `optionId`, `optionType`, `roomInfo[]`, `inclusions[]`, `mealBasis`, `bookingNotes`, `pricing`, `commercial`, `compliance`, `cancellation`.
- **Price formula:** `totalPrice = basePrice + taxes + mf + mft`. Show **mf (management fee) and mft (its tax) as separate line items** to the traveller. `strikethrough` is display-only and exists only on commissionable plans.
- **Rate plans in Listing:** Cheapest, Free Cancellation, GST Inclusive, PAN Not Required, Breakfast Inclusive.
- **`optionType`:** SRSM / SRCM / CRSM / CRCM = Same or Cross **R**oom x Same or Cross **M**ealplan (Cross means rooms differ).
- **`commercial.type`:** NET (we pay net, TripJack absorbs commission), COMMISSIONABLE (commission passed through), EXTRANET (directly contracted).
- **`supplyModel`:** RESELLER (TripJack is merchant of record) or PASSTHROUGH (supplier rate, margin is ours).
- **Compliance flags per option:** `gstType` (NA / PASSTHROUGH / RESELLER), `panRequired`, `passportRequired`. In Booking Details these appear as `ipr`, `ipm`.
- **Cancellation:** `isRefundable`, ordered `penalties[]` slabs (`from`, `to`, `amount`), **times in IST (GMT+5:30)**. Free now means the slab containing today has `amount` 0. Review adds `deadlineDateTime`.
- **Static vs dynamic:** read prices, availability, rooms and policies **only** from Pricing/Review. Static content is catalogue metadata and can be stale.
- Filter out options where `inventory.available = false` before showing them.

## Request limits (search)
Check-in must be future, check-out after it; 1 to 9 rooms; adults 1 to 6 per room (the error table says 9); children 0 to 4 with one age each (0 to 17);
`hids` up to 100; ISO currency code; `nationality` = TripJack `countryId`; optional `timeoutMs`.

## Book request essentials
`bookingId` (from Review), `type: "HOTEL"`, `roomTravellerInfo[]` (one entry per room, same order as the search, one traveller per guest:
`ti` title, `pt` ADULT/CHILD, `fN`, `lN`, plus `pan` if `ipr`, `pNum` if `ipm`), `deliveryInfo` (`emails`, `contacts`, `code`),
`paymentInfos[].amount` (omit for hold), and `gstInfo` (`gstNumber`, `registeredName`) when Pricing returned reseller or pass-through GST details.
Lead guest names must be unique across rooms.

## Booking statuses
Pending (poll again): `IN_PROGRESS`, `PAYMENT_SUCCESS`, `PAYMENT_PENDING`, `PENDING`.
Terminal: `SUCCESS` (confirmed), `ON_HOLD` (confirm before `ddt` or it auto-cancels), `ABORTED` and `FAILED` (no charge), `CANCELLED`.
Post-booking: `CANCELLATION_PENDING` (TripJack Ops handles it offline; **poll once a day** until `CANCELLED`).

## Errors: read the body, not the HTTP status
Most business errors come back as **HTTP 200** with `error.code` (numeric 6502 to 6540) in an envelope `{ "status": {"success": false}, "error": {"code", "message", "requestId"} }`.
Retry rules from the docs: `SUPPLIER_UNAVAILABLE` retry with 1 s, 2 s, 4 s backoff (max 3); `RATE_LIMITED` (429) wait the `Retry-After` header;
`OPTION_SOLD_OUT` and `SEARCH_SESSION_EXPIRED` are **not** retried (new search or another option; never call Book after sold-out).
Notable codes: 6535 `PRICE_CHANGED` (re-confirm the price with the traveller), 6537 `HOLD_NOT_ALLOWED`, 6539 `INSUFFICIENT_BALANCE`,
6540 `HOLD_PAYMENT_NOT_ALLOWED` (hold requests must not carry payment), 6510 `DUPLICATE_BOOKING_REQUEST`, 6534 `NATIONALITY_RESTRICTED`.

## Money
We pay TripJack from a **wallet or credit line** on our account (`paymentInfos.amount`); the traveller pays us separately.
There is no card handling in this API. A duplicate booking for the same itinerary on credit line or wallet is refused (6538).

## SLA
Search under 3 s (P95), Detail under 5 s (real-time supplier call), Review under 3 s; 100 static hotels within 5 s.

## Going live (certification)
Partners must pass **14 self-certification cases** in UAT (listed in Part 2): auto-cancel of an unconfirmed hold; instant bookings (domestic and international, up to 5 rooms);
hold then confirm; cancel inside and outside the deadline; cancel a hold; show the cancellation policy in the app; same PAN for all rooms and all guests; passport booking for non-Indians;
corporate PAN; and cancel all test bookings afterwards. Send the JSON request and response for every method plus confirmation numbers.
TripJack verifies in **1 to 4 working days**, signs off, gives live access, and you provide IPv4 ranges to whitelist.

## Pitfalls and inconsistencies we noticed in the page (ask TripJack if they matter)
- The header is `apikey`, but the 401 error text says "Missing or invalid Authorization token".
- Pricing and Review error codes mention `searchId`, but the request bodies use `correlationId` and `reviewHash`; there is no `searchId` field in them.
- The nav marks Static Detail as GET; the page documents it as POST. Per-room adults: 6 in the request table, 9 in error 6532.
- Error 6515 is named `SUPPLIER_TIMEOUT` but its message reads "Option Sold Out"; 6514's message is "Option Not available".
- `ddt` in the Booking Details field table is described confusingly; it is the hold deadline (it equals Review's `deadlineDateTime`).
- Certification case 6 lists a child count of `2001` (almost certainly a typo for `2, 0, 1`).
- Search text says `cityCode` is "optional if hids given" but `cityCode` was removed in v3: send `hids`.
- No rate-limit numbers are published for hotels (only the 429 behaviour).


## Links on the page
The hotel page links no Postman collection or sample folder. Request and response samples are inline in Part 2.


---

# Part 2: Full reference, as published

The text below is TripJack's page for this product, converted to markdown with its tables and code
samples intact. Diagrams are reduced to their labels. Where it disagrees with Part 1's
"Pitfalls", the pitfalls are things we noticed while reading, not TripJack's wording.

Hotel APIs · API-OUT · Partner Reference

## Hotel API v3 Reference

The v3 Hotel APIs introduce a cleaner separation between static and dynamic data, multi-type rate plan listing, management fees, embedded cancellation policies, and a standardised error model. Three endpoints cover the complete booking funnel — Listing, Detail, and Review.

Base URLapitest-hms.tripjack.com

Versionv3.0

Status● Active

Release Notes

### What's New in v3

v3 is a significant revision of the Hotel API surface. Below is a concise changelog of all breaking and non-breaking changes — including the latest updates.

| Area | Before | v3 (Current) | Type |
| --- | --- | --- | --- |
| **Authentication** | Bearer token in Authorization header | `apikey` header — pass your API key directly | Breaking |
| **Listing Endpoint** | /v3/hotel/search | /hms/v3/hotel/listing | Breaking |
| **Detail Endpoint** | /v3/hotel/detail | /hms/v3/hotel/pricing | Breaking |
| **correlationId** | Not supported | Required on all requests — client-generated tracking ID for end-to-end tracing | Breaking |
| **cityCode (Search)** | Required or conditional field in search | Removed — use `hids` (hotel IDs) only | Breaking |
| **pageSize (Search)** | Configurable pagination via pageSize field | Removed — page size is fixed server-side | Breaking |
| **Rate Plans in Listing** | Only cheapest rate returned per hotel | 5 rate plan types: Cheapest, Free Cancellation, GST Inclusive, PAN Not Required, Breakfast Inclusive | Enhanced |
| **mf / mft** | Not exposed | Management Fee and Management Fee Tax added to all pricing objects (Listing + Detail + Review) | New |
| **optionType** | SINGLE / CROSS only | 4-code system: SRSM / SRCM / CRSM / CRCM (Same/Cross Room × Same/Cross Mealplan) | Changed |
| **amenities field name** | `amenitiesHighlight` | `amenities` — corrected field name in listing response | Breaking |
| **Cancellation Policy** | Separate GET /v2/hotel/cancel-policy endpoint | Embedded inside every `optionId` in the Detail response | Breaking |
| **Compliance Flags** | Not available in API-OUT | GST type, PAN required, passport required per option | New |

Sequence

### Booking Flow

Every hotel booking follows this four-step sequence. The `searchId` from Step 1 is required in Steps 2 and 3. The `reviewId` from Step 3 is required in Step 4.

Step 1

POST

Search

Returns searchId + hotel listing

Step 2

POST

Detail

All options for one hotel

Step 3

POST

Review

Re-validates price + availability

Step 4

POST

Book

Commits the booking

ℹ️

The `searchId` is valid for approximately **15 minutes**. Implement a session countdown on the UI and prompt users to re-search on expiry. The `reviewId` is valid for a shorter window — call Book immediately after a successful Review.

Security

### Authentication & Request Headers

All v3 endpoints require an API key passed as the `apikey` request header. API keys are issued per partner and scoped to your API-OUT integration.

HTTP · Required Headers

```
POST /hms/v3/hotel/listing HTTP/1.1
Host: apitest.tripjack.com
apikey: <your_api_key>
Content-Type: application/json
Accept: application/json
```

#### Request Headers

| Header | Required | Description |
| --- | --- | --- |
| apikey | Required | Your partner API key. Issued by TripJack during onboarding. Must be sent on every request. |
| Content-Type | Required | Must be `application/json` for all POST endpoints. |
| Accept | Recommended | Set to `application/json`. |

⚠️

Never expose your `apikey` in client-side code or public repositories. Rotate keys immediately via the TripJack partner portal if compromised.

Booking Flow · Step 1

### Listing API

Based on search criteria, returns hotel listings with cheapest rates. Each hotel includes its cheapest available rate, hero image, amenity highlights, and tags.

POST
https://apitest-hms.tripjack.com/hms/v3/hotel/listing

#### Request

#### Headers

HTTP · Headers

```
apikey: <your_api_key>
Content-Type: application/json
```

#### Body

JSON · Request

```
{
  "checkIn": "2026-05-25",
  "checkOut": "2026-05-26",
  "rooms": [
    { "adults": 2, "children": 2, "childAge": [3, 5] },
    { "adults": 1 }
  ],
  "currency": "INR",
  "correlationId": "1p6IYhwDQ9NGwiZ8FaigQz",
  "nationality": "106",
  "timeoutMs": 13000,
  "hids": [100000224831, 100000363323]
}
```

#### Request Fields

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| checkIn | string | Required | Check-in date. Format: `YYYY-MM-DD`. Must be a future date. |
| checkOut | string | Required | Check-out date. Format: `YYYY-MM-DD`. Must be after checkIn. |
| hids | integer[] | Conditional | Array of specific TripJack hotel IDs (`tjHotelId`) to search. If provided, cityCode is optional. Max 100 IDs per request. |
| rooms | object[] | Required | Room configurations. Each object represents one room. Min 1, max 9. |
| rooms[].adults | integer | Required | Number of adults in the room. Min 1, max 6. |
| rooms[].children | integer | Optional | Number of children in the room. Min 0 (default), max 4. Omit or set to 0 if no children. |
| rooms[].childAge | integer[] | Conditional | Required when `children > 0`. Array of child ages in years (0–17), one per child. Example: `[3, 5]`. |
| currency | string | Required | 3-letter ISO 4217 currency code. Example: INR, USD, AED. |
| correlationId | string | Required | Unique identifier for this request, used for support tracing. Must use same value in detail and review also. |
| nationality | string | Required | TripJack country ID for the guest nationality. Use the `countryId` from the Nationalities endpoint. |
| timeoutMs | integer | Optional | Maximum time in milliseconds for the listing search. If omitted, the server default applies. |

#### Response Fields

| Field | Type | Description |
| --- | --- | --- |
| correlationId | string | Unique identifier for this request, used for support tracing. |
| nationality | string | TripJack country ID for the guest nationality (echoed from the request). |
| currency | string | Currency code for all prices in this response. |
| totalResults | integer | Total number of hotels matching the search (across all pages). |
| hotels | object[] | Array of hotel result objects. |
| hotels[].tjHotelId | string | TripJack hotel identifier. Example: `10000000012345`. |
| hotels[].name | string | Hotel display name. |
| hotels[].options | object[] | Top option of that hotel available. See Option Object below. |
| status.success | boolean | true if the request was processed successfully. |

#### Option Object Fields

Each element in the options array represents one bookable combination of room type, meal basis, and rate plan. This same structure is returned in Listing, Dynamic Detail, and Review.

| Field | Type | Description |
| --- | --- | --- |
| optionId | string (UUID) | Unique identifier for this option. Pass to Review API to confirm selection. |
| optionType | enum | Combination code: SRSM, SRCM, CRSM, or CRCM. See Dynamic Detail section for details. |
| roomInfo | object[] | One entry per room in the search request. Contains `id` (supplier room ID), `name` (display name), `adults` (number of adults) & `children` (number of children). |
| inclusions | string[] | List of inclusions beyond meal basis (e.g., airport transfer). Empty array if none. |
| mealBasis | string | Meal plan: Room Only, Breakfast, Dinner, Half Board, Full Board, All Inclusive. |
| pricing.totalPrice | float | Total price for all rooms and nights combined, including taxes. |
| pricing.basePrice | float | Price before applicable taxes. |
| pricing.discount | float | Discount given. |
| pricing.taxes | float | Tax amount. May be 0 for net rate plans where taxes are absorbed. |
| pricing.mf | float | Management fee. |
| pricing.mft | float | Management fee tax. |
| pricing.currency | string | Currency for this option. |
| pricing.strikethrough | float | Indicative gross price before commission. Present only for commissionable rate plans; absent for net rate plans. Use as display-only crossed-out price. |
| commercial.type | enum | NET — partner pays net; TripJack absorbs commission. COMMISSIONABLE — commission is passed through. |
| commercial.commission | float | Value of commission. |
| compliance.gstType | string | GST type applicable. Values: NA, PASSTHROUGH, RESELLER. |
| compliance.panRequired | boolean | Whether PAN card details of the primary guest are required. |
| compliance.passportRequired | boolean | Whether passport details are required (common for international hotels). |
| cancellation.isRefundable | boolean | true if a penalty-free cancellation window exists. |
| cancellation.penalties | object[] | Ordered list of penalty slabs with `from`, `to`, and `amount`. |

#### Sample Response

JSON · Sample Response

```
{
  "correlationId": "1p6IYhwDQ9NGwiZ8FaigQz",
  "nationality": "106",
  "currency": "INR",
  "totalResults": 5957,
  "hotels": [
    {
      "tjHotelId": "10000000012345",
      "name": "Pride Plaza Hotel Aerocity New Delhi",
      "options": [
        {
          "optionId": "db35a71a-4577-4740-8706-7d32e4c2ca4e",
          "optionType": "SRSM",
          "roomInfo": [
            { "id": "10019446051", "name": "Deluxe, 2 Twin" },
            { "id": "10019446051", "name": "Deluxe, 2 Twin" }
          ],
          "inclusions": ["String1", "String2"],
          "mealBasis": "Room Only",
          "pricing": {
            "totalPrice": 27806.62,
            "basePrice": 27806.62,
            "discount": 0,
            "taxes": 0,
            "mf": 0,
            "mft": 0,
            "currency": "INR"
          },
          "commercial": { "type": "NET", "commission": 0 },
          "compliance": { "gstType": "NA", "panRequired": false, "passportRequired": false },
          "cancellation": {
            "isRefundable": true,
            "penalties": [
              { "from": "2026-02-10T19:07:00", "to": "2026-05-18T23:59:59", "amount": 0 },
              { "from": "2026-05-18T23:59:59", "to": "2026-05-26T00:00:00", "amount": 27759.42 }
            ]
          },
        }
      ]
    }
  ],
  "status": { "success": true }
}
```

📐

**Pricing Formula:** `totalPrice = basePrice + taxes + mf + mft`. Always display **mf** (Management Fee) and **mft** (Management Fee Tax) as separate line items in the price breakup shown to end users.

Booking Flow · Step 2

### Detail API Dynamic

Returns all bookable options for a single hotel — real-time pricing, room configurations, meal plans, commercial indicators, GST compliance flags, and embedded cancellation policies. This is the primary API for building the Hotel Detail Page (PDP).

📝

**Note:** Always read pricing, availability, room options, meal plans, commercial flags, and cancellation policies from this Detail API response. Do not use Static Content APIs (or Static Detail) for these values — they return catalogue metadata only and can be stale or incomplete for booking.

🚫

Cancel Policy endpoint removed in v3

The separate `GET /v2/hotel/cancel-policy` endpoint is deprecated. Cancellation policies are now embedded within every `optionId` in this response under the `cancellation` object.

POST
https://apitest-hms.tripjack.com/hms/v3/hotel/pricing

#### Request

#### Headers

HTTP · Headers

```
apikey: <your_api_key>
Content-Type: application/json
```

#### Body

JSON · Request

```
{
  "correlationId": "1p6IYhwDQ9NGwiZ8FaigQz",
  "hid": "100000001897",
  "checkIn": "2026-05-25",
  "checkOut": "2026-05-26",
  "rooms": [
    { "adults": 2, "children": 1, "childAge": [5] },
    { "adults": 1 }
  ],
  "currency": "INR",
  "nationality": "106",
  "timeoutMs": 13000
}
```

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| correlationId | string | Required | Unique identifier for this request, used for support tracing. Must match the value from Listing. |
| hid | string | Required | TripJack hotel identifier (`tjHotelId`) for the hotel to retrieve options for. Example: `10000000012345`. |
| checkIn | string | Required | Check-in date. Must match the date used in the originating Listing call. |
| checkOut | string | Required | Check-out date. Must match the date used in the originating Listing call. |
| rooms | object[] | Required | Room configurations. Must match the Listing request — same count and order. Contains `adults` (number of adults) & `children` (number of children). |
| rooms[].adults | integer | Required | Number of adults per room. |
| rooms[].children | integer | Optional | Number of children in the room. Min 0 (default), max 4. Omit or set to 0 if no children. |
| rooms[].childAge | integer[] | Conditional | Required when `children > 0`. Array of child ages in years (0–17), one per child. Example: `[3, 5]`. |
| currency | string | Required | 3-letter ISO 4217 currency code. Should match Listing currency. |
| nationality | string | Required | TripJack country ID for the guest nationality. Use the `countryId` from the Nationalities endpoint. |
| timeoutMs | integer | Optional | Maximum time in milliseconds for the pricing request. If omitted, the server default applies. |

#### Response — Top-Level Fields

| Field | Type | Description |
| --- | --- | --- |
| tjHotelId | string | TripJack hotel identifier. Example: `10000000012345`. |
| hotelName | string | Hotel display name. |
| nationality | string | TripJack country ID for the guest nationality (echoed from the request). |
| options | object[] | Array of all bookable rate options for this hotel. |
| reviewHash | string | Review hash to be used in the Review API request. |
| status.success | boolean | true if the request was processed successfully. |
| correlationId | string | Unique identifier for this request, used for support tracing. |

#### Option Object Fields

Each element in the options array represents one bookable combination of room type, meal basis, and rate plan. This same structure is returned across Listing, Dynamic Detail, and Review.

| Field | Type | Description |
| --- | --- | --- |
| optionId | string (UUID) | Unique identifier for this option. Pass to Review API to confirm selection. |
| optionType | enum | Combination code: SRSM, SRCM, CRSM, or CRCM — see optionType Enums below. |
| roomInfo | object[] | One entry per room in the search request. Contains `id` (supplier room ID), `name` (display name), `adults` (number of adults) & `children` (number of children). |
| roomInfo[].id | string | Supplier-level room identifier. |
| roomInfo[].name | string | Display name of the room type for this room slot. |
| roomInfo[].adults | integer | Number of adults in this room. |
| roomInfo[].children | integer | Number of children in this room. |
| inclusions | string[] | List of inclusions beyond meal basis (e.g., airport transfer). Empty array if none. |
| mealBasis | string | Meal plan: Room Only, Breakfast, Dinner, Half Board, Full Board, All Inclusive. |
| bookingNotes | string | Rules to be displayed in rate plan details. |
| pricing.totalPrice | float | Total price for all rooms and nights combined, including taxes. |
| pricing.basePrice | float | Price before applicable taxes. |
| pricing.discount | float | Discount given. |
| pricing.taxes | float | Tax amount. May be 0 for net rate plans where taxes are absorbed. |
| pricing.mf | float | Management fee. |
| pricing.mft | float | Management fee tax. |
| pricing.currency | string | Currency for this option. |
| pricing.strikethrough | float | Indicative gross price before commission. Present only for commissionable rate plans; absent for net rate plans. Use as display-only crossed-out price. |
| commercial.type | enum | NET — partner pays net; TripJack absorbs commission. COMMISSIONABLE — commission is passed through. |
| commercial.commission | float | Value of commission. |
| compliance.gstType | string | GST type applicable. Values: NA, PASSTHROUGH, RESELLER. |
| compliance.panRequired | boolean | Whether PAN card details of the primary guest are required. |
| compliance.passportRequired | boolean | Whether passport details are required (common for international hotels). |
| cancellation.isRefundable | boolean | true if a penalty-free cancellation window exists. |
| cancellation.penalties | object[] | Ordered list of penalty slabs — see Cancellation Penalties below. |

#### optionType Enums

| Code | Full Name | Description |
| --- | --- | --- |
| SRSM | Same Room Same Mealplan | All rooms are the same room type AND all have the same meal plan. |
| SRCM | Same Room Cross Mealplan | All rooms are the same room type BUT meal plans differ across rooms. |
| CRSM | Cross Room Same Mealplan | Rooms are of different types BUT all share the same meal plan. |
| CRCM | Cross Room Cross Mealplan | Rooms differ in type AND meal plan varies per room. |

#### Cancellation Penalties

The `penalties` array is ordered chronologically. To determine whether an option is freely cancellable today, find the slab whose `from`–`to` window contains the current date and check if its `amount` is 0.00.

ℹ️

**Note:** Cancellation Policy date is in the GMT+5:30 Kolkata timezone.

JSON · Cancellation Example — Free until 18 May, full penalty after

```
"cancellation": {
  "isRefundable": true,
  "penalties": [
    {
      "from": "2026-02-10T19:07:00",
      "to": "2026-05-18T23:59:59",
      "amount": 0.0         // Free cancellation until 18 May
    },
    {
      "from": "2026-05-18T23:59:59",
      "to": "2026-05-26T00:00:00",
      "amount": 27759.42    // Full penalty after deadline
    }
  ]
}
```

#### Sample Response

JSON · Sample Response

```
{
  "tjHotelId": "10000000012345",
  "hotelName": "Pride Plaza Hotel Aerocity New Delhi",
  "nationality": "106",
  "options": [
    {
      "optionId": "db35a71a-4577-4740-8706-7d32e4c2ca4e",
      "optionType": "SRSM",
      "roomInfo": [
        { "id": "10019446051", "name": "Deluxe, 2 Twin" },
        { "id": "10019446051", "name": "Deluxe, 2 Twin" }
      ],
      "inclusions": ["String1", "String2"],
      "mealBasis": "Room Only",
      "bookingNotes": "Must print on screen.\nThese are rules to be displayed in rateplan details",
      "pricing": {
        "totalPrice": 27806.62,
        "basePrice": 27806.62,
        "discount": 0,
        "taxes": 0,
        "mf": 0,
        "mft": 0,
        "currency": "INR"
      },
      "commercial": { "type": "NET", "commission": 0 },
      "compliance": {
        "gstType": "NA",
        "panRequired": false,
        "passportRequired": false
      },
      "cancellation": {
        "isRefundable": true,
        "penalties": [
          { "from": "2026-02-10T19:07:00", "to": "2026-05-18T23:59:59", "amount": 0 },
          { "from": "2026-05-18T23:59:59", "to": "2026-05-26T00:00:00", "amount": 27759.42 }
        ]
      }
    }
  ],
  "reviewHash": "abc123def456",
  "status": { "success": true },
  "correlationId": "1p6IYhwDQ9NGwiZ8FaigQz"
}
```

Booking Flow · Step 3

### Review API

Re-validates the selected option in real-time — confirming availability and current pricing before the booking is committed. This call **must** be made immediately before the Book API call.

⚠️

Always call Review immediately before Book. Prices and availability can change between Detail and booking. If the option is sold out, Review returns `OPTION_SOLD_OUT` and the user must select another option. The sold-out rate from Detail → Review is expected to be < 1%.

POST
https://apitest-hms.tripjack.com/hms/v3/hotel/review

#### Request

#### Headers

HTTP · Headers

```
apikey: <your_api_key>
Content-Type: application/json
```

#### Body

JSON · Request

```
{
  "correlationId": "1p6IYhwDQ9NGwiZ8FaigQz",
  "optionId": "db35a71a-4577-4740-8706-7d32e4c2ca4e",
  "reviewHash": "abc123def456",
  "hid": "100000001897"
}
```

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| correlationId | string | Required | Must match the correlationId used in Listing and Detail calls. |
| optionId | string (UUID) | Required | The `optionId` selected from the Dynamic Detail response. |
| reviewHash | string | Required | Review hash from the Detail response. |
| hid | string | Required | Hotel identifier (TripJack hotel ID). |

#### Response

The Review response mirrors the Detail response structure. It confirms the `option` as at the time of the call, plus a `bookingId` (used in the Book API), and top-level hotel identifiers.

#### Response Fields

| Field | Type | Description |
| --- | --- | --- |
| correlationId | string | Echoed correlationId for tracing. |
| tjHotelId | string | TripJack hotel identifier. Example: `10000000012345`. |
| hotelName | string | Hotel display name. |
| bookingId | string | Unique booking identifier generated at Review. Pass this to the Book API. Example: `TGS208420065548`. |
| option | object | Confirmed option details. Same structure as `options[]` in the Dynamic Detail response — see Option Object Fields in that section. |
| option.optionId | string (UUID) | Confirmed optionId. |
| option.optionType | enum | SRSM / SRCM / CRSM / CRCM — same as Detail. |
| option.roomInfo | object[] | Confirmed room breakdown per room slot. Each has `id` and `name`. |
| option.inclusions | string[] | List of inclusions for this rate plan. |
| option.mealBasis | string | Confirmed meal plan. |
| option.bookingNotes | string | Rules to display to the user before booking. |
| option.pricing.totalPrice | float | Total price. |
| option.pricing.basePrice | float | Price before taxes and fees. |
| option.pricing.discount | float | Discount applied. |
| option.pricing.taxes | float | Tax amount. |
| option.pricing.mf | float | Management Fee. |
| option.pricing.mft | float | Management Fee Tax. |
| option.pricing.currency | string | Currency code. |
| option.pricing.strikethrough | float | Indicative gross price before commission. Present only for commissionable rate plans; absent for net rate plans. Use as display-only crossed-out price. |
| option.commercial.type | enum | NET / COMMISSIONABLE / EXTRANET. |
| option.commercial.commission | float | Commission value. |
| option.compliance.gstType | string | GST type: NA / PASSTHROUGH / RESELLER. |
| option.compliance.panRequired | boolean | PAN card required for this booking. |
| option.compliance.passportRequired | boolean | Passport required for this booking. |
| option.cancellation.isRefundable | boolean | true if free cancellation window exists. |
| option.cancellation.penalties | object[] | Ordered penalty slabs — same structure as Detail cancellation. |
| option.cancellation.deadlineDateTime | string | This represents the deadline date and time for booking payment, as specified in the API documentation. |
| status.success | boolean | true if the review was successful. |

JSON · Sample Response

```
{
  "correlationId": "1p6IYhwDQ9NGwiZ8FaigQz",
  "tjHotelId": "10000000012345",
  "hotelName": "Pride Plaza Hotel Aerocity New Delhi",
  "bookingId": "TGS208420065548",
  "option": {
    "optionId": "db35a71a-4577-4740-8706-7d32e4c2ca4e",
    "optionType": "SRSM",
    "roomInfo": [
      { "id": "10019446051", "name": "Deluxe, 2 Twin" },
      { "id": "10019446051", "name": "Deluxe, 2 Twin" }
    ],
    "inclusions": ["String1", "String2"],
    "mealBasis": "Room Only",
    "bookingNotes": "Must print on screen.\nThese are rules to be displayed in rateplan details",
    "pricing": {
      "totalPrice": 27806.62,
      "basePrice": 27806.62,
      "discount": 0,
      "taxes": 0,
      "mf": 0,
      "mft": 0,
      "currency": "INR"
    },
    "commercial": { "type": "NET", "commission": 0 },
    "compliance": {
      "gstType": "NA",
      "panRequired": false,
      "passportRequired": false
    },
    "cancellation": {
      "isRefundable": true,
      "penalties": [
        { "from": "2026-02-10T19:07:00", "to": "2026-05-18T23:59:59", "amount": 0 },
        { "from": "2026-05-18T23:59:59", "to": "2026-05-26T00:00:00", "amount": 27759.42 }
      ],
      "deadlineDateTime": "2026-10-20T23:59:59"
    }
  },
  "onholdAllowed": "true",
  "status": { "success": true }
}
```

📋

**Price Breakup Formula:** `totalPrice = basePrice + taxes + mf + mft`. Always display MF and MFT as separate line items in the price breakup shown to end users.

ℹ️

**Note:** Use the Review API response (Price, CNP, etc.) as the final reference for booking.

Migration

### Deprecated Endpoints

The following v2 endpoints are not available in v3. Partners must migrate before using v3.

🚫

GET /v2/hotel/cancel-policy — Removed

This endpoint no longer exists in v3. Cancellation policies are now embedded within each `optionId` under the `cancellation` object in the Detail (Pricing) API response. No separate call is needed.

| v2 Endpoint | Migration Path |
| --- | --- |
| `GET /v2/hotel/cancel-policy` | Read `options[].cancellation` from `POST /v3/hotel/detail` response |

Reference

### Error Codes

All v3 APIs return a standardised error envelope. Supplier-internal information is never exposed in error responses.

JSON · Error Response

```
{
  "status": { "success": false },
  "error": {
    "code": "INVALID_HOTEL_ID",
    "message": "The provided hotelId does not exist or is inactive.",
    "requestId": "1p6IYhwDQ9NGwiZ8FaigQz"
  }
}
```

INVALID_HOTEL_ID400Detail, Review

The `tjHotelId` is not recognised or the hotel is in an inactive state.

INVALID_SEARCH_ID400Detail, Review

The `searchId` does not match any active search session. Ensure you are passing the exact value returned from Search.

SEARCH_SESSION_EXPIRED410Detail, Review

The `searchId` has expired (sessions last ~15 min). Re-run the Search API to get a fresh session. Do not retry with the same `searchId`.

OPTION_SOLD_OUT409Review

The selected `optionId` is no longer available. The user must return to Detail and choose a different option. Do not call Book after receiving this error.

INVALID_DATE_RANGE400Search, Detail

`checkIn` is in the past, or `checkOut` is not after `checkIn`.

INVALID_ROOM_CONFIG400All

Room configuration is invalid — e.g., 0 adults, too many rooms, or rooms array is empty.

SUPPLIER_UNAVAILABLE503Detail, Review

Upstream supplier is temporarily unavailable. Retry with exponential backoff: 1s → 2s → 4s. Max 3 retries.

UNAUTHORIZED401All

Missing or invalid `Authorization` token.

RATE_LIMITED429All

Request rate limit exceeded. Check the `Retry-After` response header for the backoff duration in seconds.

#### Error Code Reference

Numeric error codes returned in the error envelope. Values in braces (e.g. `{hotelId}`) are substituted with request-specific values at runtime.

| Error Code | Error Type | Message | HTTP |
| --- | --- | --- | --- |
| 6502 | SEARCH_SESSION_EXPIRED | The searchId has expired (sessions last ~15 min). Re-run Search to get a fresh session. Do not retry with the same searchId. | 200 |
| 6503 | HOTEL_ID_MISMATCH_WITH_SESSION | hotelId `{hotelId}` was not part of the result set for searchId `{searchId}`. | 200 |
| 6504 | INVALID_HOTEL_ID | The provided hotelId does not exist or is inactive. | 200 |
| 6505 | OPTION_ID_NOT_FOUND | optionId `{optionId}` was not found in the referenced Detail response. | 200 |
| 6506 | OPTION_SOLD_OUT | The selected optionId is no longer available. Return to Detail and choose a different option. Do not call Book after receiving this error. | 200 |
| 6507 | GUEST_INFO_INCOMPLETE | One or more required guest fields are missing for traveller `{index}`. | 200 |
| 6508 | GUEST_NAME_INVALID | Guest name for traveller `{index}` is blank or contains unsupported characters. | 200 |
| 6509 | TRAVELLER_COUNT_MISMATCH | `{provided}` traveller(s) supplied but the confirmed option requires `{expected}`. | 200 |
| 6510 | DUPLICATE_BOOKING_REQUEST | A booking request with this reference is already being processed or has already completed. | 200 |
| 6511 | BOOKING_NOT_FOUND | No booking found for bookingId `{bookingId}` on this account. | 200 |
| 6512 | CANCELLATION_NOT_ALLOWED | bookingId `{bookingId}` is outside its cancellable window or is non-refundable. | 200 |
| 6513 | CANCELLATION_ALREADY_IN_PROGRESS | A cancellation request for bookingId `{bookingId}` is already pending. | 200 |
| 6514 | SUPPLIER_UNAVAILABLE | Option Not available | 200 |
| 6515 | SUPPLIER_TIMEOUT | Option Sold Out | 200 |
| 6516 | INTERNAL_ERROR | An unexpected internal error occurred. This has been logged; retry with standard backoff. | 200 |
| 6517 | RATE_LIMITED | Request rate limit exceeded. Check the Retry-After response header for the backoff duration in seconds. | 429 |
| 6518 | UNAUTHORIZED | Missing or invalid Authorization token. | 401 |
| 6519 | FORBIDDEN | This API key is not authorized for the requested product or resource. | 403 |
| 6520 | API_KEY_SUSPENDED | This API key has been suspended. Contact your TripJack account manager. | 403 |
| 6521 | INVALID_REQUEST_FORMAT | Request body is not valid JSON or does not match the expected schema. | 400 |
| 6522 | INVALID_DATE_RANGE | checkIn is in the past, or checkOut is not after checkIn. | 400 |
| 6523 | CHECKIN_DATE_IN_PAST | checkIn (`{value}`) is earlier than today. | 400 |
| 6524 | CHECKOUT_BEFORE_CHECKIN | checkOut (`{value}`) must be after checkIn (`{checkIn}`). | 400 |
| 6525 | DATE_RANGE_TOO_FAR_OUT | checkIn is beyond the supported `{maxDays}`-day advance booking window. | 400 |
| 6526 | LENGTH_OF_STAY_TOO_LONG | Length of stay (`{nights}` nights) exceeds the maximum supported (`{maxNights}`). | 400 |
| 6527 | INVALID_ROOM_CONFIG | Room configuration is invalid — rooms array is empty, or a room has 0 adults. | 400 |
| 6528 | CHILD_AGE_REQUIRED | Room `{roomIndex}` has `{children}` child(ren) but no ages were provided. Provide one age per child in childAge. | 400 |
| 6529 | CHILD_AGE_COUNT_MISMATCH | Room `{roomIndex}` declares `{children}` child(ren) but childAge has `{providedCount}` value(s). | 400 |
| 6530 | CHILD_AGE_OUT_OF_RANGE | childAge value `{value}` in room `{roomIndex}` is outside the supported range (0–17). | 400 |
| 6531 | CHILD_AGE_INVALID_FORMAT | childAge value in room `{roomIndex}` is not a valid whole number. | 400 |
| 6532 | ADULTS_PER_ROOM_EXCEEDS_MAXIMUM | Room `{roomIndex}` has `{adults}` adults, exceeding the per-room maximum of 9. | 400 |
| 6533 | CURRENCY_NOT_SUPPORTED | Currency `{currency}` is not supported for this account. | 400 |
| 6534 | NATIONALITY_RESTRICTED | Guests of nationality `{nationality}` cannot book this hotel due to a hotel- or country-level restriction. | 403 |
| 6535 | PRICE_CHANGED | The price for this option has changed since it was fetched. Re-confirm with the user before proceeding. | 200 |
| 6536 | ORDER_INVALID_ACTION | The requested action is not valid for the current order state. | 200 |
| 6537 | HOLD_NOT_ALLOWED | Hold booking is not allowed for this option. | 200 |
| 6538 | DUPLICATE_ORDER_CREDIT_LINE_OR_WALLET | Duplicate booking detected — an existing booking for this itinerary was already made using Credit Line or Wallet. | 200 |
| 6539 | INSUFFICIENT_BALANCE | Insufficient balance to complete this booking. | 200 |
| 6540 | HOLD_PAYMENT_NOT_ALLOWED | Hold bookings must not include payment information. | 200 |

Property Data

### Static Detail API

Returns static (non-real-time) property metadata for a single hotel — including location, contact info, chain/brand, star rating, policies, amenities, property images, descriptions, and full room-level static details (room types, configurations, and room-related images). Use this API for all catalogue/display content; cache responses for up to 24 hours, since this data does not change with availability or pricing.

POST
https://apitest-hms.tripjack.com/hms/v3/hotel/static-detail

#### Request

#### Headers

HTTP · Headers

```
apikey: <your_api_key>
Content-Type: application/json
```

#### Body

JSON · Request

```
{
  "hid": "10000000012345"
}
```

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| hid | string | Required | TripJack hotel identifier (`tjHotelId`). Example: `10000000012345`. |

#### Top-Level Response Fields

| Field | Type | Description |
| --- | --- | --- |
| tjHotelId | string | TripJack unique hotel identifier. Example: `10000000012345`. Same as the `hid` used in dynamic endpoints. |
| unicaId | string | TripJack internal unique content identifier. Example: `10004566`. Used for content deduplication and cross-referencing. |
| name | string | Hotel display name. |
| is_active | boolean | `false` = hotel is unlisted; do not display to users. |
| star_rating | string | Star rating as a string (e.g. `"4"`, `"5"`). |
| property_type | object | `id` (string) + `name` (string). E.g. `"1"` / `"Hotel"`. |
| chain | object | Hotel chain and brand — see Chain & Brand below. |
| locale | object | Address, coordinates, phone, fax, email. |
| policies | object | Check-in/out times, instructions, mandatory fees, house rules. |
| amenities | object | Map of amenity objects keyed by amenity ID. |
| images | array | Hotel-level images array. |
| descriptions | object | Named description strings (default, amenities, dining, rooms, etc.). |
| rooms | object | Map of room type configurations keyed by sequential index ("0", "1", …). |

#### Chain & Brand

💡

The top-level response includes `tjHotelId` (e.g. `"10000000012345"`) and `unicaId` (e.g. `"10004566"`) alongside hotel metadata. Sample envelope:

JSON · Sample Response Envelope

```
{
  "tjHotelId": "10000000012345",
  "unicaId": "10004566",
  "name": "Pride Plaza Hotel Aerocity New Delhi",
  "is_active": true,
  "star_rating": "5",
  "property_type": { "id": "1", "name": "Hotel" },
  "chain": { /* ... see Chain & Brand below */ },
  "locale": { /* ... see Locale below */ },
  "policies": { /* ... see Policies below */ },
  "amenities": { /* ... see Amenities below */ },
  "images": [ /* ... see Images below */ ],
  "descriptions": { /* ... see Descriptions below */ },
  "rooms": { /* ... see Rooms below */ },
  "status": { "success": true }
}
```

```
{
  "chain": {
    "id":   245,
    "name": "Taj"    
  }
}
```

#### Locale — Address & Coordinates

```
{
  "locale": {
    "address": {
      "fulladdr":    "4th Floor, Tripjack Office, Gopaldas Bhawan, CP, Delhi, India, 10000001",
      "line_1":      "4th Floor, Tripjack Office",
      "line_2":      "Gopaldas Bhawan",
      "region":      "Connaught Place, CP",
      "city":        "Delhi",
      "citycode":    "CTDEL",
      "statename":   "Delhi",
      "regioncode":  "RGNCR",
      "countryname": "India",
      "countrycode": "IN",
      "postal_code": "1000001"
    },
    "coordinates": { "lat": 10.203330479016, "long": 24.68516154266 },
    "phone": ["1-854-223-9494"],
    "fax":   ["99585839302"]
  }
}
```

| Field | Type | Description |
| --- | --- | --- |
| address.fulladdr | string | Single-line complete address for display. |
| address.line_1 / line_2 | string | Street address split across two lines. |
| address.city | string | City name. |
| address.citycode | string | TripJack city code (e.g. `CTDEL` for Delhi). |
| address.statename | string | State / province name. |
| address.countrycode | string | ISO 3166-1 alpha-2 country code. |
| address.postal_code | string | Postal / PIN code. |
| coordinates.lat | float | Latitude (WGS84). Use for map display and distance calculations. |
| coordinates.long | float | Longitude (WGS84). Use for map display and distance calculations. |
| phone | string[] | List of hotel phone numbers. |
| fax | string[] | List of fax numbers. |
| email | string[] | List of contact email addresses. |

#### Policies

```
{
  "policies": {
    "checkInCheckOut": {
      "checkin_from":    "13:00",
      "checkin_till":    "19:30",
      "checkout_from":   "06:00",
      "checkout_till":   "12:30",
      "checkin_min_age": "18"
    },
    "instructions":         "Extra-person charges may apply...",
    "special_instructions": "No front desk — contact property ahead of time.",
    "know_before_you_go":   "Reservations required for spa...",
    "mandatory_fees":       "Resort fee: USD 29.12 per night...",
    "optional_fees":        "In-room wireless: USD 15/hr..."    
  }
}
```

| Field | Type | Description |
| --- | --- | --- |
| checkInCheckOut.checkin_from | string | Earliest check-in time (HH:MM 24h). |
| checkInCheckOut.checkin_till | string | Latest check-in time (HH:MM 24h). |
| checkInCheckOut.checkout_from | string | Earliest check-out time (HH:MM 24h). |
| checkInCheckOut.checkout_till | string | Latest check-out time (HH:MM 24h). |
| checkInCheckOut.checkin_min_age | string | Minimum age for the primary guest to check in. |
| instructions | string | General property instructions. May contain HTML entities. |
| special_instructions | string | Special procedures (e.g. keyless entry, remote check-in). |
| know_before_you_go | string | Important pre-arrival information. May contain HTML. |
| mandatory_fees | string | Fees charged at the property not included in room rate. HTML. Must be displayed to users before booking. |
| optional_fees | string | Optional charges (e.g. parking, in-room internet). HTML. |
| houseRules | object | Key-value map of property-specific rules (pets, smoking, age restrictions, etc.). |

#### Amenities

```
{
  "amenities": {
    "9": {
      "id":   "9",
      "name": "Fitness facilities"
    },
    "2820": {
      "id":   "2820",
      "name": "Indoor Pool"
    }
  }
}
```

Map keyed by amenity ID string. Each entry has `id` (string) and `name` (display string). Use for amenity icon rendering and filtering.

#### Images

```
{
  "images": [
    {
      "caption":"Featured Image",
      "is_hero_image": true,
      "category":      3,
      "links": {
        "original":  {
          "href": "https://i.travelapi.com/lodging/2000000/1790000/1781400/1781351/e9878546_z.jpg"
        }     
      }
    }
  ]
}
```

| Field | Type | Description |
| --- | --- | --- |
| images[].caption | string | Alt text / caption for the image. |
| images[].is_hero_image | boolean | `true` = use as the primary hotel card image. |
| images[].category | integer | EPS image category ID. |
| images[].links | object | Size-keyed hrefs. Keys are pixel widths (e.g. `"70px"`, `"100px"`, `"200px"`). |

#### Descriptions

| Key | Description |
| --- | --- |
| default | General hotel overview. Use as the primary property description. |
| amenities | Prose description of recreational facilities and services. |
| dining | Restaurant and dining options at the property. |
| renovations | Active or upcoming renovation notices. May contain HTML. |
| national_ratings | Rating methodology disclosure statement. |
| business_amenities | Conference rooms, business center, parking details. |
| rooms | General room overview (count, features, bed types). |
| attractions | Nearby attractions with distances. May contain HTML. |
| location | Neighbourhood context and proximity statements. |
| headline | Short headline (e.g. "Near National Museum of Natural Science"). |

#### Rooms Object

The `rooms` field is a map keyed by sequential integers (`"0"`, `"1"`, …). Each entry represents a room type available at the property.

```
{
  "rooms": {
    "0": {
      "id":                "224829",
      "name":              "Single Room",
      "room_count":        3,
      "living_room_count": 2,
      "descriptions": {
        "overview": "**2 Twin Beds** 269 sq ft with mountain views..."
      },
      "amenities": {
        "130":  { "id": "130",  "name": "Refrigerator" },
        "1234": { "id": "1234", "name": "Warm Towels"  }
      },
      "images": [
        {
          "hero_image": true,
          "category":   21001,
          "caption":    "Guestroom",
          "links": { "70px": { "href": "https://..." } }
        }
      ],
      "bed_config": {
        "bed_count":     4,
        "bedroom_count": 3,
        "description":   "1 King Bed, 2 Twin Beds, and 1 Sofa Bed",
        "configuration": {
          "0": { "type": "KingBed",  "size": "King", "quantity": 1 },
          "1": { "type": "Twin bed", "size": "Twin", "quantity": 2 },
          "2": { "type": "Sofa Bed", "size": "sofa", "quantity": 1 }
        }
      },
      "area":      { "square_meters": 20, "square_feet": 215 },
      "views":     { "4146": { "id": "4146", "name": "Courtyard view" } },
      "occupancy": {
        "max_allowed": { "total": 5, "children": 4, "adults": 4 }
      }
    }
  }
}
```

| Field | Type | Description |
| --- | --- | --- |
| id | string | Room type ID — matches `roomInfo.id` in Dynamic Detail response. |
| name | string | Room type display name. |
| room_count | integer | Number of rooms of this type at the property. |
| living_room_count | integer | Number of separate living areas in this room type. |
| descriptions.overview | string | HTML description including bed type, room size, and features. |
| amenities | object | Room-level amenity map. Same structure as hotel-level amenities. |
| images[].hero_image | boolean | `true` = primary room display image. |
| bed_config.bed_count | integer | Total beds across all bed types in this room. |
| bed_config.bedroom_count | integer | Number of bedrooms. |
| bed_config.description | string | Human-readable bed summary (e.g. "1 King Bed, 2 Twin Beds"). |
| bed_config.configuration | object | Map of individual bed groups. Each entry has `type`, `size`, and `quantity`. |
| area.square_meters | float | Room area in m². |
| area.square_feet | float | Room area in sq ft. |
| views | object | Map of view objects (id + name). E.g. "Courtyard view". |
| occupancy.max_allowed.total | integer | Maximum total occupants (adults + children). |
| occupancy.max_allowed.adults | integer | Maximum adult occupants. |
| occupancy.max_allowed.children | integer | Maximum child occupants. |

Booking Flow — Step 4

### Book API

Creates a hotel booking using the `bookingId` returned from the Review API. Supports two modes: **Instant Booking** (confirmed immediately) and **Hold Booking** (reserves the option until the deadline without payment, then confirmed separately). Both use the same endpoint.

POST
https://apitest-hotel-booker.tripjack.com/oms/v3/hotel/book

#### Instant Booking Request

Include `paymentInfos` to trigger an instant confirmed booking.

```
curl --location 'https://apitest-hotel-booker.tripjack.com/oms/v3/hotel/book' \
  --header 'Content-Type: application/json' \
  --header 'apikey: <your_api_key>' \
  --data-raw '{
    "bookingId": "TGS208420065548",
    "roomTravellerInfo": [
      {
        "travellerInfo": [
          { "ti": "Mr",     "pt": "ADULT", "fN": "GENIUS",   "lN": "WORLD", "pan": "AAACA1111A" },
          { "ti": "Master", "pt": "CHILD", "fN": "JAPANJOT", "lN": "SINGH", "pan": "AAACA1111A" }
        ]
      },
      {
        "travellerInfo": [
          { "ti": "Mrs",  "pt": "ADULT", "fN": "MANMEET", "lN": "KAUR", "pan": "BBBCB1111B" },
          { "ti": "Miss", "pt": "CHILD", "fN": "HARLEEN", "lN": "KAUR", "pan": "BBBCB1111B" }
        ]
      }
    ],
    "deliveryInfo": {
      "emails":   ["[email protected]"],
      "contacts": ["1234567890"],
      "code":     ["+91"]
    },
    "paymentInfos": [{ "amount": 23486.76 }],
    "type": "HOTEL"
  }'
```

#### Hold Booking & Confirm

Omit `paymentInfos` to place a hold. The room is reserved until `option.cancellation.deadlineDateTime` from the Review response (returned as `ddt` in Booking Details). Confirm using the separate confirm endpoint before the deadline, otherwise the booking is auto-cancelled.

```
/* Step 1 — Hold (no paymentInfos) */
curl --location 'https://apitest-hotel-booker.tripjack.com/oms/v3/hotel/book' \
  --header 'Content-Type: application/json' \
  --header 'apikey: <your_api_key>' \
  --data-raw '{
    "bookingId": "TGS208420065548",
    "roomTravellerInfo": [ ... ],
    "deliveryInfo": { "emails": ["[email protected]"], "contacts": ["1234567890"], "code": ["+91"] },
    "type": "HOTEL"
  }'

/* Step 2 — Confirm Hold (before ddt) */
curl --location 'https://apitest-hotel-booker.tripjack.com/oms/v3/hotel/confirm-book' \
  --header 'Content-Type: application/json' \
  --header 'apikey: <your_api_key>' \
  --data '{ "bookingId": "TJ207187962918", "paymentInfos": [{ "amount": 17577.26 }] }'
```

#### GST Information Handling

When reseller/GST passthrough details are received in the detail response, the same GST details must be passed in the booking request under the `gstInfo` object.

Please refer to the sample booking request below:

```
{
  "bookingId": "TGS208420065548",
  "roomTravellerInfo": [
    {
      "travellerInfo": [
        {
          "ti": "Mr",
          "pt": "ADULT",
          "fN": "GENIUS",
          "lN": "WORLD",
          "pan": "AAACA1111A"
        },
        {
          "ti": "Master",
          "pt": "CHILD",
          "fN": "JAPANJOT",
          "lN": "SINGH",
          "pan": "AAACA1111A"
        }
      ]
    },
    {
      "travellerInfo": [
        {
          "ti": "Mrs",
          "pt": "ADULT",
          "fN": "MANMEET",
          "lN": "KAUR",
          "pan": "BBBCB1111B"
        },
        {
          "ti": "Miss",
          "pt": "CHILD",
          "fN": "HARLEEN",
          "lN": "KAUR",
          "pan": "BBBCB1111B"
        }
      ]
    }
  ],
  "deliveryInfo": {
    "emails": [
      "test@test.com"
    ],
    "contacts": [
      "1234567890"
    ],
    "code": [
      "+91"
    ]
  },
  "gstInfo": {
    "gstNumber": "29ABBCR4749R3ZF",
    "registeredName": "TRIPJACK"
  },
  "paymentInfos": [
    {
      "amount": 23486.76
    }
  ],
  "type": "HOTEL"
}
```

#### Book Response

```
{
  "bookingId": "TJ202487947162",
  "status": { "success": true },
  "metaInfo": {}
}
```

**Async Confirmation:** This response only confirms the booking request was received. Confirmation can take up to 180 seconds. Poll `Booking Details` every 5 seconds until a terminal status is returned or 180 seconds elapses.

#### Request Fields

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| bookingId | string | Required | The `bookingId` from the Review API response. |
| type | string | Required | Must be `HOTEL`. |
| roomTravellerInfo | array | Required | One entry per room, in the same order as the search request. |
| roomTravellerInfo[].travellerInfo | array | Required | One entry per guest in the room (adults + children). |
| travellerInfo[].ti | string | Required | Title: `Mr`, `Mrs`, `Ms`, `Miss`, `Master`. |
| travellerInfo[].pt | string | Required | Passenger type: `ADULT` or `CHILD`. |
| travellerInfo[].fN | string | Required | First name. Lead pax name must be unique across rooms. |
| travellerInfo[].lN | string | Required | Last name. |
| travellerInfo[].pan | string | Conditional | PAN number. Required when `ipr = true` (isPanRequired) in the Review response. |
| travellerInfo[].pNum | string | Conditional | Passport number. Required when `ipm = true` (isPassportMandatory) in the Review response. |
| deliveryInfo.emails | string[] | Required | Email addresses for booking confirmation delivery. |
| deliveryInfo.contacts | string[] | Required | Contact phone numbers. |
| deliveryInfo.code | string[] | Required | Country dialing codes (e.g. `+91`) corresponding to each contact number. |
| paymentInfos[].amount | double | Conditional | Payment amount. Include for Instant Booking; omit for Hold Booking. |

Booking Management

### Booking Details

Retrieves the current status and full details of a booking. Use this to poll for confirmation after a Book request (every 5 seconds, up to 180 seconds), and to look up booking state at any time.

POST
https://apitest-hotel-booker.tripjack.com/oms/v3/hotel/booking-details

#### Request

```
curl --location 'https://apitest-hotel-booker.tripjack.com/oms/v3/hotel/booking-details' \
  --header 'Content-Type: application/json' \
  --header 'apikey: <your_api_key>' \
  --data '{ "bookingId": "TGS207090064619" }'
```

| Field | Type | Description |
| --- | --- | --- |
| bookingId | string | The booking ID from the Review or Book API response. |

#### Response

```
{
  "order": {
    "bookingId": "TJ2040174908940",
    "amount": 6234.55,
    "markup": 20,
    "deliveryInfo": {
      "emails": [
        "test@test.com"
      ],
      "contacts": [
        "1234567890"
      ],
      "code": [
        "+91"
      ]
    },
    "status": "ON_HOLD",
    "createdOn": "2026-05-23T11:17:29.164"
  },
  "itemInfos": {
    "HOTEL": {
      "hInfo": {
        "name": "RAMEE GUESTLINE HOTEL KHAR",
        "des": "Ramee Guestline The Finest Hotel in Khar West. Our premium hotel in Khar boasts plush interiors, lavish furnishings, and unmatched hospitality services.",
        "rt": 3,
        "gl": {
          "ln": "72.84",
          "lt": "19.07"
        },
        "ad": {
          "adr": "757, SV Rd, Khar, Ram Krishna Nagar, Khar West, Mumbai",
          "adr2": "757, SV Rd, Khar, Ram Krishna Nagar, Khar West, Mumbai",
          "postalCode": "400052",
          "city": {
            "name": "MUMBAI"
          },
          "state": {
            "name": "INDIA"
          },
          "country": {
            "name": "INDIA"
          },
          "ctn": "MUMBAI",
          "sn": "INDIA",
          "cn": "INDIA"
        },
        "inst": [
          {
            "type": "BOOKING_NOTES",
            "msg": ""
          }
        ],
        "ops": [
          {
            "ris": [
              {
                "id": "10025299254_0",
                "rc": "Executive Room",
                "rt": "Executive Room",
                "srn": "Executive, Double",
                "adt": 2,
                "chd": 0,
                "cAge": [],
                "mb": "Breakfast",
                "ti": [
                  {
                    "ti": "Mr",
                    "pt": "ADULT",
                    "fN": "Aryan",
                    "lN": "Singh",
                    "gstl": [
                      {
                        "gstNumber": "27AC1Z1",
                        "registeredName": "TRI"
                      }
                    ]
                  },
                  {
                    "ti": "Mrs",
                    "pt": "ADULT",
                    "fN": "Aryan",
                    "lN": "Singh"
                  }
                ],
                "rexb": {
                  "BENEFIT": [
                    {
                      "type": "BENEFIT",
                      "values": [
                        "Air conditioning",
                        "Free toiletries",
                        "Wi-Fi",
                        "Room service",
                        "Express check-in/check-out",
                        "Shampoo",
                        "Toilet",
                        "Wake-up service",
                        "Daily housekeeping",
                        "Doctor on Call",
                        "Lift",
                        "24-hour front desk",
                        "Toilet paper",
                        "Shower",
                        "Towels",
                        "Laundry",
                        "Pillow"
                      ]
                    }
                  ]
                }
              }
            ],
            "tp": 6234.55,
            "sc": "INR",
            "cnp": {
              "ifra": true,
              "inra": false,
              "pd": [
                {
                  "fdt": "2026-05-23T05:43",
                  "tdt": "2026-11-21T00:00",
                  "am": 0
                },
                {
                  "fdt": "2026-11-21T00:00",
                  "tdt": "2026-11-24T12:00",
                  "am": 6151.95
                }
              ]
            },
            "ddt": "2026-11-21T00:00",
            "inst": [],
            "ipr": false,
            "ipm": false,
            "gst_appl_amt": 315
          }
        ],
        "tjid": "100000000059",
        "checkInTime": {
          "minAge": 18,
          "endTime": "anytime",
          "beginTime": "2:00 PM"
        },
        "checkOutTime": {
          "beginTime": "12:00 PM"
        }
      },
      "query": {
        "checkinDate": "2026-11-23",
        "checkoutDate": "2026-11-24",
        "roomInfo": [
          {
            "numberOfAdults": 2,
            "numberOfChild": 0
          }
        ],
        "searchCriteria": {
          "city": "614223",
          "countryName": "INDIA",
          "nationality": "106"
        },
        "searchPreferences": {
          "currency": "INR"
        },
        "searchId": "ui-MPHX9APK"
      }
    }
  },
  "gstInfo": {
    "gstNumber": "27875431",
    "registeredName": "TRIPJACK",
    "bookingId": "TJ2040174908940",
    "info": {}
  },
  "currentTime": "2026-05-23T11:17:39.832",
  "hotelConfirmationNumber": "TJ2040174908940",
  "status": {
    "success": true,
    "httpStatus": 200
  }
}
```

| Field | Type | Description |
| --- | --- | --- |
| order | object | Contains booking order details. |
| order.bookingId | string | Unique booking identifier. |
| order.amount | double | Total booking amount. |
| order.markup | double | Markup amount applied to booking. |
| order.deliveryInfo | object | Delivery contact information. |
| order.deliveryInfo.emails | array | Email addresses for communication. |
| order.deliveryInfo.contacts | array | Contact numbers for communication. |
| order.deliveryInfo.code | array | Country dialing codes. |
| order.status | string | Current booking status. |
| order.createdOn | string | Booking creation timestamp. |
| itemInfos | object | Contains booked item details. |
| itemInfos.HOTEL | object | Hotel booking information. |
| itemInfos.HOTEL.hInfo | object | Hotel information details. |
| itemInfos.HOTEL.hInfo.name | string | Hotel name. |
| itemInfos.HOTEL.hInfo.des | string | Hotel description. |
| itemInfos.HOTEL.hInfo.rt | integer | Hotel rating. |
| itemInfos.HOTEL.hInfo.gl | object | Geo-location information. |
| itemInfos.HOTEL.hInfo.gl.ln | string | Longitude of hotel location. |
| itemInfos.HOTEL.hInfo.gl.lt | string | Latitude of hotel location. |
| itemInfos.HOTEL.hInfo.ad | object | Hotel address information. |
| itemInfos.HOTEL.hInfo.ad.adr | string | Primary address. |
| itemInfos.HOTEL.hInfo.ad.adr2 | string | Secondary address. |
| itemInfos.HOTEL.hInfo.ad.postalCode | string | Postal code. |
| itemInfos.HOTEL.hInfo.ad.city.name | string | City name. |
| itemInfos.HOTEL.hInfo.ad.state.name | string | State name. |
| itemInfos.HOTEL.hInfo.ad.country.name | string | Country name. |
| itemInfos.HOTEL.hInfo.ad.ctn | string | City short code/name. |
| itemInfos.HOTEL.hInfo.ad.sn | string | State short code/name. |
| itemInfos.HOTEL.hInfo.ad.cn | string | Country short code/name. |
| itemInfos.HOTEL.hInfo.inst | array | Hotel instructions/notes. |
| itemInfos.HOTEL.hInfo.inst[].type | string | Instruction type. |
| itemInfos.HOTEL.hInfo.inst[].msg | string | Instruction message. |
| itemInfos.HOTEL.hInfo.ops | array | Hotel booking options. |
| itemInfos.HOTEL.hInfo.ops[].ris | array | Room information list. |
| itemInfos.HOTEL.hInfo.ops[].ris[].id | string | Internal room identifier. |
| itemInfos.HOTEL.hInfo.ops[].ris[].rc | string | Room category. |
| itemInfos.HOTEL.hInfo.ops[].ris[].rt | string | Room type. |
| itemInfos.HOTEL.hInfo.ops[].ris[].srn | string | Standard room name. |
| itemInfos.HOTEL.hInfo.ops[].ris[].adt | integer | Number of adults. |
| itemInfos.HOTEL.hInfo.ops[].ris[].chd | integer | Number of children. |
| itemInfos.HOTEL.hInfo.ops[].ris[].cAge | array | Children age details. |
| itemInfos.HOTEL.hInfo.ops[].ris[].mb | string | Meal basis. |
| itemInfos.HOTEL.hInfo.ops[].ris[].ti | array | Traveller details. |
| itemInfos.HOTEL.hInfo.ops[].ris[].ti[].ti | string | Traveller title. |
| itemInfos.HOTEL.hInfo.ops[].ris[].ti[].pt | string | Passenger type. |
| itemInfos.HOTEL.hInfo.ops[].ris[].ti[].fN | string | Traveller first name. |
| itemInfos.HOTEL.hInfo.ops[].ris[].ti[].lN | string | Traveller last name. |
| itemInfos.HOTEL.hInfo.ops[].ris[].ti[].gstl | array | Traveller GST details. |
| itemInfos.HOTEL.hInfo.ops[].ris[].ti[].gstl[].gstNumber | string | GST number. |
| itemInfos.HOTEL.hInfo.ops[].ris[].ti[].gstl[].registeredName | string | GST registered name. |
| itemInfos.HOTEL.hInfo.ops[].ris[].rexb | object | Extra room benefits. |
| itemInfos.HOTEL.hInfo.ops[].tp | double | Total option price. |
| itemInfos.HOTEL.hInfo.ops[].sc | string | Currency code. |
| itemInfos.HOTEL.hInfo.ops[].cnp | object | Cancellation policy details. |
| itemInfos.HOTEL.hInfo.ops[].cnp.ifra | boolean | Refundable booking indicator. |
| itemInfos.HOTEL.hInfo.ops[].cnp.inra | boolean | Non-refundable booking indicator. |
| itemInfos.HOTEL.hInfo.ops[].cnp.pd | array | Penalty details. |
| itemInfos.HOTEL.hInfo.ops[].cnp.pd[].fdt | string | Penalty start datetime. |
| itemInfos.HOTEL.hInfo.ops[].cnp.pd[].tdt | string | Penalty end datetime. |
| itemInfos.HOTEL.hInfo.ops[].cnp.pd[].am | double | Penalty amount. |
| itemInfos.HOTEL.hInfo.ops[].ddt | string | ddt represents the deprecated/departed flag as defined in the API documentation. |
| itemInfos.HOTEL.hInfo.ops[].inst | array | Additional option instructions. |
| itemInfos.HOTEL.hInfo.ops[].ipr | boolean | Indicates PAN requirement. |
| itemInfos.HOTEL.hInfo.ops[].ipm | boolean | Indicates passport requirement. |
| itemInfos.HOTEL.hInfo.ops[].gst_appl_amt | double | Applicable GST amount. |
| itemInfos.HOTEL.hInfo.tjid | string | TJ hotel ID. |
| itemInfos.HOTEL.hInfo.checkInTime | object | Check-in timing details. |
| itemInfos.HOTEL.hInfo.checkInTime.minAge | integer | Minimum check-in age. |
| itemInfos.HOTEL.hInfo.checkInTime.endTime | string | Latest allowed check-in time. |
| itemInfos.HOTEL.hInfo.checkInTime.beginTime | string | Standard check-in time. |
| itemInfos.HOTEL.hInfo.checkOutTime.beginTime | string | Standard check-out time. |
| itemInfos.HOTEL.query | object | Hotel search query details. |
| itemInfos.HOTEL.query.checkinDate | string | Check-in date. |
| itemInfos.HOTEL.query.checkoutDate | string | Check-out date. |
| itemInfos.HOTEL.query.roomInfo | array | Room occupancy details. |
| itemInfos.HOTEL.query.roomInfo[].numberOfAdults | integer | Number of adults requested. |
| itemInfos.HOTEL.query.roomInfo[].numberOfChild | integer | Number of children requested. |
| itemInfos.HOTEL.query.searchCriteria.city | string | City identifier. |
| itemInfos.HOTEL.query.searchCriteria.countryName | string | Country name. |
| itemInfos.HOTEL.query.searchCriteria.nationality | string | Nationality code. |
| itemInfos.HOTEL.query.searchPreferences.currency | string | Preferred currency. |
| itemInfos.HOTEL.query.searchId | string | Unique search identifier. |
| gstInfo | object | GST details associated with booking. |
| gstInfo.gstNumber | string | GST registration number. |
| gstInfo.registeredName | string | GST registered business name. |
| gstInfo.bookingId | string | Associated booking ID. |
| gstInfo.info | object | Additional GST information. |
| currentTime | string | Current server timestamp. |
| hotelConfirmationNumber | string | Hotel confirmation number. |
| status | object | API response status details. |
| status.success | boolean | Indicates successful API response. |
| status.httpStatus | integer | HTTP status code. |

#### Booking Status Values

Poll Booking Details after a Book request until a **Terminal State** is received or 180 seconds elapses (suggested interval: 5 seconds).

| Status | Type | Description |
| --- | --- | --- |
| IN_PROGRESS | Pending | Booking request is being processed by the supplier. |
| PAYMENT_SUCCESS | Pending | Payment captured; awaiting supplier confirmation. |
| PAYMENT_PENDING | Pending | Payment not yet processed. |
| PENDING | Pending | Generic pending state. |
| SUCCESS | Terminal ✓ | Booking confirmed by supplier. Booking is active. |
| ON_HOLD | Terminal ✓ | Hold booking confirmed. Must be confirmed before `ddt` or auto-cancelled. |
| ABORTED | Terminal ✗ | Booking failed at the supplier. No charge. |
| FAILED | Terminal ✗ | Booking request failed. No charge. |
| CANCELLATION_PENDING | Post-Booking | Cancellation request received but not yet processed. TripJack Ops handles offline. Poll once daily. |
| CANCELLED | Terminal | Booking successfully cancelled. |

Booking Management

### Booking List

Retrieves a list of hotel bookings created within the specified date range. The API returns booking status, total price, room details, traveller information, and cancellation policy for each booking.

POST
https://apitest-hotel-booker.tripjack.com/oms/v1/hotel/bookings

#### Request

```
curl --location 'https://apitest-hotel-booker.tripjack.com/oms/v1/hotel/bookings' \
  --header 'Content-Type: application/json' \
  --header 'apikey: <your_api_key>' \
  --data '{
  "startDate": "2026-08-14T00:00:00",
  "endDate": "2026-08-19T13:59:59"
}'
```

| Field | Type | Description |
| --- | --- | --- |
| startDate | string | Start date and time of the booking search range. |
| endDate | string | End date and time of the booking search range. |

#### Response

```
{
  "status": {
    "success": true
  },
  "bookings": [
    {
      "bookingId": "TJ208502829712",
      "status": "CANCELLED",
      "totalPrice": 2240.93,
      "options": [
        {
          "totalPrice": 2240.93,
          "cancellationPolicy": {
            "ifra": true,
            "inra": false,
            "pd": [
              {
                "fdt": "2026-08-14T12:48:00",
                "tdt": "2027-02-11T23:59:00",
                "am": 0.0
              },
              {
                "fdt": "2027-02-11T23:59:00",
                "tdt": "2027-02-15T00:00:00",
                "am": 2217.33
              }
            ]
          },
          "rooms": [
            {
              "totalPrice": 2465.02,
              "mealBasis": "Breakfast",
              "checkInDate": "2027-02-14",
              "checkOutDate": "2027-02-15",
              "numberOfAdults": 2,
              "numberOfChild": 0,
              "childAges": [],
              "travellerInfo": [
                {
                  "ti": "Mr",
                  "fN": "Anjali",
                  "lN": "Verma",
                  "pt": "ADULT"
                },
                {
                  "ti": "Mr",
                  "fN": "Michael",
                  "lN": "Verma",
                  "pt": "ADULT"
                }
              ]
            }
          ]
        }
      ]
    },
    {
      "bookingId": "TJ207502839682",
      "status": "SUCCESS",
      "totalPrice": 7260.48,
      "options": [
        {
          "totalPrice": 7260.48,
          "cancellationPolicy": {
            "ifra": true,
            "inra": false,
            "pd": [
              {
                "fdt": "2026-08-17T12:43:00",
                "tdt": "2027-02-15T23:59:00",
                "am": 0.0
              },
              {
                "fdt": "2027-02-15T23:59:00",
                "tdt": "2027-02-18T00:00:00",
                "am": 7260.48
              }
            ]
          },
          "rooms": [
            {
              "totalPrice": 7260.48,
              "mealBasis": "Room Only",
              "checkInDate": "2027-02-17",
              "checkOutDate": "2027-02-18",
              "numberOfAdults": 2,
              "numberOfChild": 0,
              "childAges": [],
              "travellerInfo": [
                {
                  "ti": "Mr",
                  "fN": "Alice",
                  "lN": "Sharma",
                  "pt": "ADULT"
                },
                {
                  "ti": "Mr",
                  "fN": "Emma",
                  "lN": "Singh",
                  "pt": "ADULT"
                }
              ]
            }
          ]
        }
      ]
    }
  ]
}
```

| Field | Type | Description |
| --- | --- | --- |
| status | object | API response status details. |
| status.success | boolean | Indicates whether the API request was successful. |
| bookings | array | List of bookings matching the specified date range. |
| bookings[].bookingId | string | Unique booking identifier. |
| bookings[].status | string | Current status of the booking, for example `SUCCESS` or `CANCELLED`. |
| bookings[].totalPrice | double | Total price of the booking. |
| bookings[].options | array | List of booking options associated with the booking. |
| bookings[].options[].totalPrice | double | Total price of the booking option. |
| bookings[].options[].cancellationPolicy | object | Cancellation policy details for the booking option. |
| bookings[].options[].cancellationPolicy.ifra | boolean | Indicates whether the booking is refundable. |
| bookings[].options[].cancellationPolicy.inra | boolean | Indicates whether the booking is non-refundable. |
| bookings[].options[].cancellationPolicy.pd | array | List of cancellation penalty details. |
| bookings[].options[].cancellationPolicy.pd[].fdt | string | Start date and time of the cancellation penalty period. |
| bookings[].options[].cancellationPolicy.pd[].tdt | string | End date and time of the cancellation penalty period. |
| bookings[].options[].cancellationPolicy.pd[].am | double | Cancellation penalty amount applicable during the specified period. |
| bookings[].options[].rooms | array | List of rooms included in the booking option. |
| bookings[].options[].rooms[].totalPrice | double | Total price of the room. |
| bookings[].options[].rooms[].mealBasis | string | Meal plan included with the room, for example Breakfast or Room Only. |
| bookings[].options[].rooms[].checkInDate | string | Room check-in date. |
| bookings[].options[].rooms[].checkOutDate | string | Room check-out date. |
| bookings[].options[].rooms[].numberOfAdults | integer | Number of adults in the room. |
| bookings[].options[].rooms[].numberOfChild | integer | Number of children in the room. |
| bookings[].options[].rooms[].childAges | array | Ages of children staying in the room. |
| bookings[].options[].rooms[].travellerInfo | array | Traveller information for the room. |
| bookings[].options[].rooms[].travellerInfo[].ti | string | Traveller title, for example Mr or Mrs. |
| bookings[].options[].rooms[].travellerInfo[].fN | string | Traveller first name. |
| bookings[].options[].rooms[].travellerInfo[].lN | string | Traveller last name. |
| bookings[].options[].rooms[].travellerInfo[].pt | string | Traveller/passenger type, for example ADULT. |

Booking Management

### Booking Cancellation

Cancels a confirmed booking. The `bookingId` from the Review response is passed as a URL path parameter. Applicable cancellation charges from the policy apply.

POST
https://apitest-hotel-booker.tripjack.com/oms/v3/hotel/cancel-booking/{bookingId}

#### Request

```
curl --location --request POST \
  'https://apitest-hotel-booker.tripjack.com/oms/v3/hotel/cancel-booking/TJS20990000003651' \
  --header 'apikey: <your_api_key>'
```

No request body is required. The `bookingId` is embedded in the URL path.

#### Success Response of Cancellation Request

If the booking is acknowledged successfully, the following response is generated.

```
{ "status": { "success": true } }
```

ℹ️

**Note:** Retrieve the final cancellation status using the Book detail API (the same one used in the book request).

**CANCELLATION_PENDING:** If the booking moves to `CANCELLATION_PENDING` status, TripJack Ops will process the cancellation offline with the supplier. Poll Booking Details once per day until the status updates to `CANCELLED`.

Static Content

### Nationalities

Returns the full list of supported nationalities with country codes, dial codes, and ISO codes. Use this to populate nationality dropdowns in search and booking forms.

GET
https://apitest.tripjack.com/hms/v3/nationality-info

#### Request

```
curl --location 'https://apitest.tripjack.com/hms/v3/nationality-info' \
  --header 'apikey: <your_api_key>'
```

#### Response

```
{
  "nationalityInfos": [
    {
      "countryName": "India",
      "name":        "India",
      "dialCode":    "91",
      "countryId":   "106",
      "code":        "IN",
      "isoCode":     "IND"
    }
  ],
  "nationalityCount": 1,
  "status": { "success": true }
}
```

| Field | Type | Description |
| --- | --- | --- |
| nationalityInfos | array | Array of nationality objects, one per supported country. |
| nationalityInfos[].countryName | string | Full display name of the country. |
| nationalityInfos[].name | string | Name of the country (same as countryName). |
| nationalityInfos[].dialCode | string | International dialling code (e.g. `91` for India). |
| nationalityInfos[].countryId | string | TripJack internal country ID. Use as `nationality` in Search requests. |
| nationalityInfos[].code | string | ISO 3166-1 alpha-2 country code (e.g. `IN`). |
| nationalityInfos[].isoCode | string | ISO 3166-1 alpha-3 country code (e.g. `IND`). |
| nationalityCount | integer | Total number of nationalities in the response. |

Static Content

### New / Updated Hotels Deprecated

Fetches the full catalogue of active hotels, or syncs updates since a given timestamp. Responses are paginated — each page contains a maximum of 100 hotels. Recommended sync schedule: every 7 days.

⚠

This endpoint is deprecated

Prefer the V3 New Static Content APIs (Hotel Mapping / Hotel Content) for catalogue sync. Keep using dynamic Detail for pricing and bookable options — never use static responses for dynamic values.

POST
https://apitest.tripjack.com/hms/v3/fetch-static-hotels

#### Request — Three Modes

```
/* Type 1 — Fetch first page of all hotels */
curl --location 'https://apitest.tripjack.com/hms/v3/fetch-static-hotels' \
  --header 'Content-Type: application/json' \
  --header 'apikey: <your_api_key>' \
  --data '{}'

/* Type 2 — Fetch next page (pass 'next' token from previous response) */
curl --location 'https://apitest.tripjack.com/hms/v3/fetch-static-hotels' \
  --header 'Content-Type: application/json' \
  --header 'apikey: <your_api_key>' \
  --data '{ "next": "MTAwIDM2MjM4" }'

/* Type 3 — Sync updates since a specific datetime */
curl --location 'https://apitest.tripjack.com/hms/v3/fetch-static-hotels' \
  --header 'Content-Type: application/json' \
  --header 'apikey: <your_api_key>' \
  --data '{ "lastUpdateTime": "2024-03-08T16:42" }'
```

| Field | Type | Description |
| --- | --- | --- |
| lastUpdateTime | string | ISO 8601 datetime. Only hotels updated after this timestamp will be returned. Used for incremental sync (Type 3). |
| next | string | Pagination cursor. Copy from the `next` field in the previous response to fetch the next page (Type 2). |

#### Response

```
{
  "hotelOpInfos": [
    {
      "tjHotelId":    "39591724",
      "unicaId":      "10004566",
      "name":         "Hotel Nele",
      "description":  "{\"amenities\":\"Pamper yourself with a visit...\"}",
      "rating":       3,
      "isDeleted":    false,
      "geolocation":  { "ln": "11.57229", "lt": "46.286575" },
      "address": {
        "adr":        "Via Roda, 3",
        "postalCode": "38030",
        "city":       { "code": "698706", "name": "Ziano Di Fiemme" },
        "state":      { "code": "TN",     "name": "Trentino-Alto Adige" },
        "country":    { "code": "IT",     "name": "Italy" }
      },
      "cityName":    "Ziano Di Fiemme",
      "countryName": "Italy",
      "propertyType": "Hotel",
      "images": [
        { "url": "https://i.travelapi.com/lodging/.../e72315af_b.jpg", "sz": "Standard" },
        { "url": "https://i.travelapi.com/lodging/.../e72315af_z.jpg", "sz": "XL" }
      ],
      "facilities": [
        { "name": "Mountain biking nearby" },
        { "type": "Hotel", "name": "Disable Friendly" }
      ],
      "contact": {
        "ph":  "39 0462 571146",
        "em":  "[[email protected]]",
        "fax": "390462571668",
        "wb":  "www.hotelnele.com"
      }
    }
  ],
  "next":   "MTAwIDMyOTI4",
  "status": { "success": true }
}
```

| Field | Type | Description |
| --- | --- | --- |
| hotelOpInfos | array | Array of hotel info objects. Max 100 per response. |
| hotelOpInfos[].tjHotelId | string | TripJack hotel identifier. Example: `10000000012345`. Use as `hid` in dynamic search endpoints. |
| hotelOpInfos[].unicaId | string | TripJack internal unique content identifier. Example: `10004566`. |
| hotelOpInfos[].name | string | Hotel display name. |
| hotelOpInfos[].description | string | JSON-encoded hotel description string including amenity prose. |
| hotelOpInfos[].rating | integer | Star rating (1–5). |
| hotelOpInfos[].isDeleted | boolean | `false` for active hotels. If `true`, remove from your local catalogue. |
| hotelOpInfos[].geolocation.ln | string | Longitude coordinate. |
| hotelOpInfos[].geolocation.lt | string | Latitude coordinate. |
| hotelOpInfos[].address | object | Street address, postal code, city, state, country objects. |
| hotelOpInfos[].address.city.code | string | City code. Optional — may be absent. |
| hotelOpInfos[].address.state.code | string | State code. Optional — may be absent. |
| hotelOpInfos[].propertyType | string | Property type (e.g. `Hotel`, `Hostel`, `Resort`). |
| hotelOpInfos[].images | array | Image objects with `url` and `sz` (size: Standard, XL, etc.). |
| hotelOpInfos[].facilities | array | Facility objects with `name` and optional `type`. |
| hotelOpInfos[].contact | object | Phone (`ph`), email (`em`), fax, website (`wb`). |
| next | string | Pagination token. Pass in the next request as `next` to get the following page. Absent when no more results. |

**Sync Schedule:** TripJack recommends syncing this endpoint at a minimum interval of 7 days. For incremental syncs, use `lastUpdateTime` (Type 3) to fetch only new or changed hotels since your last sync.

Static Content

### Deleted Hotels Deprecated

Returns hotel IDs that have been deleted (de-listed) since a given timestamp. Use this to remove hotels from your local catalogue to avoid showing unavailable properties.

⚠

This endpoint is deprecated

Prefer the V3 New Static Content APIs for keeping your local catalogue in sync. Do not use this response for pricing or other dynamic booking data.

POST
https://apitest.tripjack.com/hms/v3/fetch-static-hotels/deleted

#### Request

```
/* Type 1 — First page */
curl --location 'https://apitest.tripjack.com/hms/v3/fetch-static-hotels/deleted' \
  --header 'Content-Type: application/json' \
  --header 'apikey: <your_api_key>' \
  --data '{ "lastUpdateTime": "2024-02-21T12:42" }'

/* Type 2 — Next page */
curl --location 'https://apitest.tripjack.com/hms/v3/fetch-static-hotels/deleted' \
  --header 'Content-Type: application/json' \
  --header 'apikey: <your_api_key>' \
  --data '{ "lastUpdateTime": "2024-02-21T12:42", "next": "NSAyNjkzNQ==" }'
```

| Field | Type | Description |
| --- | --- | --- |
| lastUpdateTime | string | ISO 8601 datetime. Returns hotels deleted after this timestamp. Required. |
| next | string | Pagination cursor from the previous response (for page 2+). |

#### Response

```
{
  "hotelOpInfos": [
    { "tjHotelId": "39520963" },
    { "tjHotelId": "39460300" }
  ],
  "next":     "NSAyNjkzNQ==",
  "status":   { "success": true },
  "metaInfo": {}
}
```

| Field | Type | Description |
| --- | --- | --- |
| hotelOpInfos | array | Array of deleted hotel objects. |
| hotelOpInfos[].tjHotelId | string | The TripJack hotel identifier that has been deleted. Example: `10000000012345`. Remove this from your local catalogue. |
| next | string | Pagination cursor for the next page. Absent when no more results. |

New in v3

### V3 New Static Content APIs

The following static content APIs are newly introduced in v3. They provide hotel-to-ID mapping, full hotel content retrieval, country listings, city/region ID lookups, and incremental mapping sync. All endpoints use the `apikey` header for authentication.

🆕

These endpoints are served from a cacheable static data layer. Recommended sync schedule varies by endpoint — see individual sections. All base URLs use `apitest-hms.tripjack.com` for the test environment.

#### API Index

POST
Hotel ID Mapping
Map tjHotelId by country or region
POST
Hotel Static Content
Full property & room static content by hotel IDs
GET
Fetch Countries
List supported countries for content APIs
GET
City Region IDs
City/region identifiers for mapping filters
POST
Hotel Mapping Sync
Incremental NEW / UPDATE mapping sync
POST
Deleted Mapping Sync
Incremental DELETE mapping sync

V3 New APIs · Static Content

### Hotel ID Mapping

Fetches the mapping between `tjHotelId` and `unicaId` filtered by country name or region IDs. Use this to build or refresh your local hotel ID mapping table. Supports pagination.

⚠️

Pass either `countryName` or `regionIds` — at least one is required. Maximum `size` per request is **2000**.

POST
https://apitest-hms.tripjack.com/hms/v3/content/fetch-hotel-mapping

#### Request

JSON · Request

```
{
  "countryName": "UNITED ARAB EMIRATES",
  "regionIds": ["740217"],
  "page": 0,
  "size": 2000
}
```

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| countryName | string | Conditional | Full country name in uppercase (e.g. `UNITED ARAB EMIRATES`). Required if `regionIds` is not provided. |
| regionIds | string[] | Conditional | List of region IDs to filter results. Required if `countryName` is not provided. |
| page | integer | Required | Page number for pagination. Zero-indexed — first page is `0`. |
| size | integer | Required | Number of records per page. Maximum allowed value is `2000`. |

#### Response

JSON · Sample Response

```
{
  "status": { "success": true, "httpStatus": 200 },
  "hotels": [
    { "tjHotelId": "100001728661", "unicaId": "71354426" },
    { "tjHotelId": "100002113577", "unicaId": "72332032" },
    { "tjHotelId": "100001089815", "unicaId": "15602818" },
    { "tjHotelId": "100001395375", "unicaId": "41528647" },
    { "tjHotelId": "100001192677", "unicaId": "41362470" }
  ],
  "pageable": {
    "pageNumber": 0,
    "pageSize": 5,
    "offset": 0,
    "totalElements": 5,
    "totalPages": 1,
    "size": 5
  }
}
```

| Field | Type | Description |
| --- | --- | --- |
| status | object | Response status information |
| status.success | boolean | Indicates if the request was successful |
| status.httpStatus | integer | HTTP status code (e.g., 200) |
| hotels | array of objects | List of hotels matching the query |
| hotels[].tjHotelId | string | TravelJoy hotel identifier |
| hotels[].unicaId | string | Unica hotel identifier |
| pageable | object | Pagination metadata |
| pageable.pageNumber | integer | Current page number (0-indexed) |
| pageable.pageSize | integer | Number of items per page |
| pageable.offset | integer | Offset from the start of results |
| pageable.totalElements | integer | Total number of elements available |
| pageable.totalPages | integer | Total number of pages |
| pageable.size | integer | Size of the current page |

V3 New APIs · Static Content

### Hotel Static Content

Fetches full static content for up to 100 hotels in a single request — including name, star rating, property type, address, coordinates, policies, amenities, images, and descriptions.

⚠️

Maximum `hotelIds` per request is **100**. Passing more than 100 returns a `400` error: "Max hotel ids size passed in request should be 100".

POST
https://apitest-hms.tripjack.com/hms/v3/content/fetch-hotel-content

#### Request

JSON · Request

```
{
  "hotelIds": ["100001743803", "100001728661"]
}
```

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| hotelIds | string[] | Required | Array of TripJack hotel IDs (`tjHotelId`) to fetch content for. Maximum 100 per request. |

#### Response

JSON · Sample Response

```
{
  "status": { "success": true, "httpStatus": 200 },
  "hotels": [
    {
      "tjHotelId": "100001743803",
      "unicaId": "71799452",
      "name": "Elegant 1-Bedroom, Burj Khalifa View, Burj Crown, Dubai",
      "is_active": true,
      "star_rating": "5",
      "property_type": { "id": "Apartment", "name": "Apartment" },
      "locale": {
        "address": {
          "fulladdr": "15 Sheikh Mohammed bin Rashid Blvd, Downtown Dubai, UAE, 00000",
          "line_1": "15 Sheikh Mohammed bin Rashid Blvd",
          "line_2": "Burj Crown - Emaar",
          "city": "Dubai",
          "citycode": "2994",
          "statename": "Dubai",
          "regioncode": "697010",
          "countryname": "United Arab Emirates",
          "countrycode": "AE",
          "postal_code": "00000"
        },
        "coordinates": { "lat": 25.19403, "long": 55.269318 }
      },
      "policies": {
        "know_before_you_go": "{"Children Policy":"Age between 2 to 12 is considered children."}"
      },
      "amenities": {
        "0": { "id": "10008", "name": "Air Conditioner" },
        "1": { "id": "10029", "name": "Balcony/Terrace" }
      },
      "images": [
        {
          "caption": "CoverImage",
          "is_hero_image": true,
          "links": { "Standard": { "href": "https://pix8.agoda.net/hotelImages/..." } }
        }
      ],
      "descriptions": {
        "headline": "Experience an abundance of unparalleled facilities...",
        "default": "{"Overview":"...","Snippet":"..."}"
      }
    }
  ]
}
```

| Field | Type | Description |
| --- | --- | --- |
| hotels[].property_type | object | Property type information. |
| hotels[].locale | object | Localization information. |
| hotels[].locale.address | object | Address details. |
| hotels[].locale.address.fulladdr | string | Full address string. |
| hotels[].locale.address.line_1 | string | Address line 1. |
| hotels[].locale.address.line_2 | string | Address line 2. |
| hotels[].locale.address.region | string | Region name (e.g., "DUBAI"). |
| hotels[].locale.address.city | string | City name. |
| hotels[].locale.address.citycode | string | City code. |
| hotels[].locale.address.statename | string | State name. |
| hotels[].locale.address.regioncode | string | Region code. |
| hotels[].locale.address.countryname | string | Country name. |
| hotels[].locale.address.countrycode | string | Country code (e.g., "AE"). |
| hotels[].locale.address.postal_code | string | Postal code. |
| hotels[].locale.coordinates | object | Geographic coordinates. |
| hotels[].locale.coordinates.lat | number | Latitude. |
| hotels[].locale.coordinates.long | number | Longitude. |
| hotels[].policies | object | Hotel policies. |
| hotels[].policies.know_before_you_go | string (JSON) | JSON string of policies (e.g., children policy). |
| hotels[].amenities | object | Dictionary of amenities (numeric keys). |
| hotels[].amenities[].id | string | Amenity ID. |
| hotels[].amenities[].name | string | Amenity name. |
| hotels[].images | array of objects | List of hotel images. |
| hotels[].images[].caption | string | Image caption (optional). |
| hotels[].images[].is_hero_image | boolean | Indicates if this is the hero image. |
| hotels[].images[].links | object | Image URLs by size. |
| hotels[].images[].links.Standard | object | Standard size image (optional). |
| hotels[].images[].links.Standard.href | string | URL to standard image. |
| hotels[].images[].links.XXL | object | XXL size image (optional). |
| hotels[].images[].links.XXL.href | string | URL to XXL image. |
| hotels[].descriptions | object | Hotel descriptions. |
| hotels[].descriptions.headline | string | Short headline description. |
| hotels[].descriptions.default | string (JSON) | JSON string with detailed descriptions. |

V3 New APIs · Static Content

### Fetch Countries

Returns the list of all distinct country names for which hotel data is available. Use this to populate country filter dropdowns and to drive subsequent region and hotel mapping lookups.

GET
https://apitest-hms.tripjack.com/hms/v3/content/fetch-countries

#### Request

No request body. Send only the `apikey` header.

cURL

```
curl --location 'https://apitest-hms.tripjack.com/hms/v3/content/fetch-countries'   --header 'apikey: <your_api_key>'
```

#### Response

JSON · Sample Response

```
{
  "status": { "success": true, "httpStatus": 200 },
  "hotelCountries": [
    "AFGHANISTAN",
    "ALBANIA",
    "UNITED ARAB EMIRATES",
    "UNITED KINGDOM",
    "INDIA"
    // ... 200+ countries total
  ]
}
```

| Field | Type | Description |
| --- | --- | --- |
| status | object | Response status information. |
| status.success | boolean | true if the request was processed successfully. |
| status.httpStatus | integer | HTTP status code. |
| hotelCountries | string[] | Array of distinct country name strings in uppercase. Pass these values as `countryName` in the Hotel Mapping endpoint. |

V3 New APIs · Static Content

### City Region IDs

Returns a paginated list of city names and their corresponding region IDs. Use the returned `cityRegionId` values as `regionIds` in the Hotel Mapping endpoint to fetch hotels by city.

⚠️

Maximum `limit` per request is **2000**. Passing a higher value returns a `400` error: "Max limit allowed for to fetch hotel city region ids is 2000".

⚠️

If region Type is city, then, region name would be a city name

GET
https://apitest-hms.tripjack.com/hms/v3/content/fetch-city-regionIds?limit=100&cursor=MTAw

#### Query Parameters

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| limit | integer | Required | Number of records to return per page. Maximum is `2000`. |
| cursor | string | Optional | Base64-encoded pagination cursor. Copy from the `nextCursor` field in the previous response to fetch the next page. Omit for the first page. |

#### Request

cURL · First Page

```
curl --location 'https://apitest-hms.tripjack.com/hms/v3/content/fetch-city-regionIds?limit=100'   --header 'apikey: <your_api_key>'
```

cURL · Next Page (with cursor)

```
curl --location 'https://apitest-hms.tripjack.com/hms/v3/content/fetch-city-regionIds?limit=100&cursor=MTAw'   --header 'apikey: <your_api_key>'
```

#### Response

JSON · Sample Response

```
{
  "status": { "success": true, "httpStatus": 200 },
  "hotelCityRegionIds": [
    {
      "cityName": "ROXIE",
      "cityRegionId": 113466,
      "regionName": "ROXIE",
      "countryName": "UNITED STATES",
      "regionType": "CITY",
      "fullRegionName": "ROXIE, MISSISSIPPI, UNITED STATES OF AMERICA"
    },
    {
      "cityName": "FINLEY",
      "cityRegionId": 113467,
      "regionName": "FINLEY",
      "countryName": "UNITED STATES",
      "regionType": "CITY",
      "fullRegionName": "FINLEY, OKLAHOMA, UNITED STATES OF AMERICA"
    },
    {
      "cityName": "CHUTWĀPĪPAL",
      "cityRegionId": 113468,
      "regionName": "CHUTWĀPĪPAL",
      "countryName": "INDIA",
      "regionType": "CITY",
      "fullRegionName": "CHUTWĀPĪPAL, UTTARAKHAND, INDIA"
    },
    {
      "cityName": "ÄŪEZOV",
      "cityRegionId": 113469,
      "regionName": "ÄŪEZOV",
      "countryName": "KAZAKHSTAN",
      "regionType": "CITY",
      "fullRegionName": "ÄŪEZOV, EAST KAZAKHSTAN REGION, KAZAKHSTAN"
    },
    {
      "cityName": "MONTOSO",
      "cityRegionId": 113470,
      "regionName": "MONTOSO",
      "countryName": "ITALY",
      "regionType": "CITY",
      "fullRegionName": "MONTOSO, BAGNOLO PIEMONTE, PIEDMONT, ITALY"
    }
  ],
  "nextCursor": "MTEzNDcw",
  "hasMore": true
}
```

| Field | Type | Description |
| --- | --- | --- |
| status | object | Response status information. |
| status.success | boolean | Indicates if the request was successful. |
| status.httpStatus | integer | HTTP status code (e.g., 200). |
| hotelCityRegionIds[].cityName | string | City name in uppercase. |
| hotelCityRegionIds[].cityRegionId | integer | Unique region identifier for this city. Pass as a value in `regionIds` in the Hotel Mapping endpoint. |
| hotelCityRegionIds[].regionName | string | Region name, typically matches `cityName`. |
| hotelCityRegionIds[].countryName | string | Country name in uppercase (e.g., `"INDIA"`, `"UNITED STATES"`). |
| hotelCityRegionIds[].regionType | string | Type of region. Will be `"CITY"` for all records returned by this endpoint. |
| hotelCityRegionIds[].fullRegionName | string | Fully qualified region name including city, state/province, and country (e.g., `"ROXIE, MISSISSIPPI, UNITED STATES OF AMERICA"`). |
| nextCursor | string | Base64-encoded cursor for the next page. Pass as the `cursor` query parameter in the next request. Absent when no more results. |
| hasMore | boolean | `true` if additional pages of results are available. |

V3 New APIs · Static Content

### Hotel Mapping Sync API

These APIs allow API consumers to fetch hotel identifier mappings in paginated batches. They support incremental synchronization use cases where clients need to pull newly created, updated, or deleted hotel mappings after a known processing timestamp.

ℹ️

**Purpose:** Use these APIs to:

- fetch newly created hotel mappings
- fetch updated hotel mappings
- fetch deleted hotel mappings
- sync mappings in batches of up to 2000 records per request

POST
https://apitest-hms.tripjack.com/hms/v3/content/fetch-hotel-mapping-sync?page={pageNumber}

#### Request

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| type | string | Required | Mapping type: `NEW`, `UPDATE` |
| lastUpdateTime | ISO 8601 datetime | Required | Filter for records updated after this time. |
| cursor | string | Optional | Cursor for pagination (from previous response's `nextCursor`). |

#### Example Request (First Page)

JSON · Request

```
{
  "type": "NEW",  // "UPDATE"
  "lastUpdateTime": "2024-01-01T00:00:00Z"
}
```

#### Example Request (Subsequent Pages)

JSON · Request

```
{
  "type": "NEW",  // "UPDATE"
  "lastUpdateTime": "2024-01-01T00:00:00Z",
  "cursor": "MTcwNDA2NzIwMDAwMCxIT1RFTF8xMjM="
}
```

#### Response

JSON · Example Response

```
{
  "hotels": [
    { "tjHotelId": "TJ123" },
    { "tjHotelId": "TJ456" }
  ],
  "pageable": {
    "pageNumber": 0,
    "pageSize": 2000,
    "totalElements": 8000,
    "totalPages": 4
  },
  "nextCursor": "MTcwNDA2NzIwMDAwMCxIT1RFTF8xMjM=",
  "status": { "success": true, "httpStatus": 200 }
}
```

| Field | Type | Description |
| --- | --- | --- |
| hotels | array | List of hotel mappings. |
| pageable | object | Pagination metadata. |
| nextCursor | string | Cursor for next page (null if last page). |
| status | object | Success/error status. |

#### Pagination

📄

1. **Cursor-based pagination:** Pass the `nextCursor` from the previous response to fetch the next page.
2. **No cursor (first page):** Returns first page of results.
3. **Invalid/expired cursor:** Returns empty list.
4. **Last page:** `nextCursor` will be null.

#### Error Scenarios

400 Bad Request400

Returned when:

- `type` is missing
- `type` is not one of `NEW`, `UPDATE`, or `DELETE`
- `lastUpdateTime` is missing
- `page` is invalid
- `type=DELETE` is passed to the active mapping sync API

500 Internal Server Error500

Returned when an unexpected server-side error occurs.

#### Example API Calls

cURL · First Page

```
curl -X POST https://<HOST>/hms/v3/content/fetch-hotel-mapping-sync   -H "Content-Type: application/json"   -H "apikey: <your_api_key>"   -d '{
    "type": "NEW",
    "lastUpdateTime": "2024-01-01T00:00:00Z"
  }'
```

cURL · Next Page (with cursor)

```
curl -X POST https://<HOST>/hms/v3/content/fetch-hotel-mapping-sync   -H "Content-Type: application/json"   -H "apikey: <your_api_key>"   -d '{
    "type": "NEW",
    "lastUpdateTime": "2024-01-01T00:00:00Z",
    "cursor": "MTcwNDA2NzIwMDAwMCxIT1RFTF8xMjM="
  }'
```

cURL · With Page Number (optional, for UI display)

```
curl -X POST "https://<HOST>/hms/v3/content/fetch-hotel-mapping-sync?page=5"   -H "Content-Type: application/json"   -H "apikey: <your_api_key>"   -d '{
    "type": "UPDATE",
    "lastUpdateTime": "2024-06-01T00:00:00Z",
    "cursor": "MTcxNzIwMDAwMCxIT1RFTF84NTk="
  }'
```

V3 New APIs · Static Content

### Deleted Mapping Sync API

Fetches hotel identifier mappings for deleted hotels in paginated batches since a given timestamp. Use this to identify and remove deleted hotel mappings from your local data store.

POST
https://apitest-hms.tripjack.com/hms/v3/content/fetch-deleted-hotel-mapping?page={pageNumber}

#### Request

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| type | string | Required | Mapping type: `DELETE` |
| lastUpdateTime | ISO 8601 datetime | Required | Filter for records updated after this time. |
| cursor | string | Optional | Cursor for pagination (from previous response's `nextCursor`). |

#### Example Request (First Page)

JSON · Request

```
{
  "type": "DELETE",
  "lastUpdateTime": "2024-01-01T00:00:00Z"
}
```

#### Example Request (Subsequent Pages)

JSON · Request

```
{
  "type": "DELETE",
  "lastUpdateTime": "2024-01-01T00:00:00Z",
  "cursor": "MTcwNDA2NzIwMDAwMCxIT1RFTF8xMjM="
}
```

#### Response

JSON · Example Response

```
{
  "hotels": [
    { "tjHotelId": "TJ123" },
    { "tjHotelId": "TJ456" }
  ],
  "pageable": {
    "pageNumber": 0,
    "pageSize": 2000,
    "totalElements": 8000,
    "totalPages": 4
  },
  "nextCursor": "MTcwNDA2NzIwMDAwMCxIT1RFTF8xMjM=",
  "status": { "success": true, "httpStatus": 200 }
}
```

| Field | Type | Description |
| --- | --- | --- |
| hotels | array | List of hotel mappings. |
| pageable | object | Pagination metadata. |
| nextCursor | string | Cursor for next page (null if last page). |
| status | object | Success/error status. |

#### Error Scenarios

400 Bad Request400

Returned when:

- `type` is missing
- `type` is not one of `NEW`, `UPDATE`, or `DELETE`
- `lastUpdateTime` is missing
- `page` is invalid
- `type` other than `DELETE` is passed to the deleted mapping sync API

500 Internal Server Error500

Returned when an unexpected server-side error occurs.

#### Example API Call

cURL · Delete Mapping Sync

```
curl -X POST "https://<HOST>/hms/v3/content/fetch-deleted-hotel-mapping?page=5"   -H "Content-Type: application/json"   -H "apikey: <your_api_key>"   -d '{
    "type": "DELETE",
    "lastUpdateTime": "2024-06-01T00:00:00Z",
    "cursor": "MTcxNzIwMDAwMCxIT1RFTF84NTk="
  }'
```

Reference

### Enums & Values

#### mealBasis

Room Only

No meals included. Also known as Bed Only (BO).

Breakfast

Breakfast included for all guests.

Dinner

Dinner included for all guests.

Half Board

Breakfast + one main meal (lunch or dinner) included.

Full Board

Breakfast, lunch, and dinner included.

All Inclusive

All meals, snacks, and selected beverages included.

#### rateplanType

NET

Partner pays net. TripJack or partner applies markup. Commission embedded in the net price.

COMMISSIONABLE

Gross rate. Commission is explicitly passed through in the commercial object.

EXTRANET

Direct contracting rate via TripJack Extranet. Used for directly contracted properties.

#### supplyModel

RESELLER

TripJack is the merchant of record. Partner sells on behalf of TripJack.

PASSTHROUGH

Supplier rate passed directly without TripJack markup. Margin is at the partner level.

#### optionType

Indicates the room-type and meal-plan combination across rooms. Only **Single** and **Cross** combo types are returned.

SRSM

**Same Room Same Mealplan** — All rooms are the same type with the same meal plan. Display a single room/meal label.

SRCM

**Same Room Cross Mealplan** — All rooms are the same type but meal plans differ across rooms. Display shared room name; list meal plans per room.

CRSM

**Cross Room Same Mealplan** — Rooms differ in type but all share the same meal plan. Display per-room names with one meal plan label.

CRCM

**Cross Room Cross Mealplan** — Rooms differ in type AND meal plans differ per room. Display per-room names with individual meal labels. Label as "Mixed Rooms / Mixed Meals".

Reference

### Best Practices

#### Session Management

ℹ️

Implement a countdown timer on the UI. Prompt the user to re-search after ~12 minutes of inactivity. The `searchId` is not renewable — a new Search must be called.

#### Displaying Options

✅

Always filter out options where `inventory.available = false` before rendering. For `CROSS` options, display each room's name against its slot (Room 1: Deluxe | Room 2: Standard).

#### Compliance Collection

📋

Collect **PAN card** details if `panRequired = true`, and **passport** details if `passportRequired = true`, in the guest info step — before calling Book.

#### Retry Strategy

| Error | Retry? | Strategy |
| --- | --- | --- |
| SUPPLIER_UNAVAILABLE (503) | Yes | Exponential backoff — 1s, 2s, 4s. Max 3 retries. |
| RATE_LIMITED (429) | Yes | Wait for `Retry-After` header duration. |
| OPTION_SOLD_OUT (409) | No | Requires user action — show alternate options. |
| SEARCH_SESSION_EXPIRED (410) | No | Re-initiate full search flow. |

Reference

### SLA & Performance

Search API

< 3s

P95 response time

Detail API

< 5s

P95 — real-time supplier call

Review API

< 3s

P95 — re-validates known option

ℹ️

Static hotel data (hotel name, images, amenities) is served from a cacheable layer — 100 hotels must be returned within 5 seconds. Dynamic data (pricing, availability) is fetched real-time from suppliers.

History

### Changelog

| Version | Date | Changes |
| --- | --- | --- |
| **v3.0** Current | Aug 2026 | Added Booking List endpoint (`POST /oms/v1/hotel/bookings`) to retrieve hotel bookings by date range, including status, price, rooms, travellers, and cancellation policy. |
| **v3.0** | Feb 2026 | Initial v3 release. New Search response structure - Detail now returns dynamic-only data with embedded cancellation policies. Cancel Policy endpoint removed. Standardised error model. `optionType` (SINGLE/CROSS) and `compliance` flags added. All new commissionable structure introduced. |
| **v2.x** Deprecated | Legacy | Separate Cancellation Policy endpoint. Monolithic Detail response. See the v2 docs for the full v2 reference. |

Certification

### Self Certification (UAT Test Cases)

API Partners need to go through a certification process in order to get live access. Below are the mandatory test cases to be completed when the client is done with the API integration.

| Test Case Id | Description | Search City | Adult Count | Child Count | Room Count |
| --- | --- | --- | --- | --- | --- |
| 1 | Auto Cancellation of booking in ON HOLD status (i.e. unconfirmed case) | Domestic | 1 | 0 | 1 |
| 2 | Instant booking | Domestic | 4 | 2 | 1 |
| 3 | Hold Booking then confirm Booking | Domestic | 2, 3, 2 | 2, 1, 1 | 3 |
| 4 | Create a booking within cancellation deadline and cancel it | Domestic | 1, 2, 1, 1, 1 | 2, 1, 1, 0, 0 | 5 |
| 5 | Create a booking outside cancellation deadline and cancel it | International | 4 | 2 | 1 |
| 6 | Cancel booking in On HOLD status (i.e. Without confirming it) | International | 2, 3, 2 | 2, 1, 2001 | 3 |
| 7 | Instant Booking | International | 1, 2, 1, 1, 1 | 2, 1, 1, 0, 0 | 5 |
| 8 | Instant Booking | International | 3, 3 | 0, 0 | 2 |
| 9 | Verify that cancellation rules and policies are displayed on your application | — | — | — | — |
| 10 | Same PAN for all rooms (Create a booking using the same PAN across all rooms) (Indian nationals only) | Domestic/International | 2, 2 | 1, 0 | 2 |
| 11 | Same PAN for all guests (Create a booking using the same PAN for all guests) (Indian nationals only) | Domestic/International | 2 | 1 | 1 |
| 12 | Booking using PASSPORT (Create a booking by selecting a non-Indian nationality and using a valid Passport number) (Non-Indian nationals only) (If applicable) | Domestic/International | 2 | 1 | 1 |
| 13 | Booking with corporate PAN (Indian nationals only) (If applicable) | Domestic/International | 2 | 1 | 1 |
| 14 | Kindly cancel all test bookings made during the certification process after it is completed | - | - | - | - |

#### Notes

📋

1. Please provide Request & Response for all methods that you are implementing.
2. Certification request by API Partner — the API Partner makes a certification request by providing JSON Request/Response along with confirmation numbers for the test cases.
3. Test Cases Verification — TripJack will verify the test cases using JSON Request/Response and suggest if there is any change required. The turnaround time for the test case verification is around **1–4 working days**.
4. Sign off and Live access — On successful completion of all the above steps, Tripjack.com will give sign off and provide Live access details to the client. It is strongly recommended that the API Partner also completes their UAT before making the services live at their end.
5. After certification, it is important for you to provide the current **IPv4 address ranges** to whitelist at our end.

Go-Live

### Production Host

Use production endpoints only after UAT self-certification is complete and your integration has been approved by the TripJack API Tech Team.

📝

**Note:** Production APIs must not be used until UAT testing is successfully completed and TripJack has approved your integration. Until then, continue using the API test environment (`apitest-hms.tripjack.com`). Booking failures or API issues that occur while calling production before certification will not be treated as TripJack defects.

#### Production URLs — V3 Hotel APIs

| APIs | Production base URL |
| --- | --- |
| Nationalities, New Static Content APIs, Listing (Search), Detail, and Review | `https://hms-search.tripjack.com` |
| Book, Booking Details, Booking List, and Cancellation | `https://hms-booker.tripjack.com` |

ℹ️

Keep the same path suffixes used in UAT (for example `/hms/v3/hotel/listing`) and only change the host to the production base URL above.
