# TripJack Flight API: knowledge base

| | |
| --- | --- |
| **Source** | https://tripjack.com/page/api-doc (the "Flights API v2.0" tab) |
| **Version documented** | v2.0.2 |
| **Captured** | 2026-10-19: re-capture when TripJack changes the page |
| **Scope** | Everything on the page for this product, in full (Part 2), with a verified summary (Part 1) |
| **Secrets** | No API key appears in this file. Keys go in the environment (`TRIPJACK_API_KEY`), never in the repo. |

TripJack's page has three products, each in its own file here: `hotel.md`, `flight.md`, `tripsafe.md`.
An older "Api Doc 2.0" page also exists at https://tripjack.com/page/api-doc-v2 (not captured).

---

# Part 1: Quick reference

## What it is
Flights API **v2.0.2**: the complete funnel (search, fare rules, review, seat map, book or hold) plus post-booking
(cancel, void, refund, reissue, ancillaries). JSON over HTTPS, split into **FMS** (pre-booking, `fms/...`) and **OMS** (post-booking, `oms/...`).

## Hosts
UAT `https://apitest.tripjack.com` · Production `https://tripjack.com`. Paths are the same on both.
**Endpoints must not end with a trailing slash** (it causes an error).

## Authentication and keys
- Header `apikey: <key>` on every request; one key covers FMS and OMS. It is never sent in the body.
- **UAT and production use separate keys.**
- Keys are generated in the TripJack portal: **Manage User, then API Configuration**. Enter **Whitelisted IPs** (comma-separated IPv4) and Save; choosing YES generates a new key, NO keeps the old key and only updates the IPs. The key is masked afterwards, so copy it the first time. Only whitelisted IPs can use the key.

## The booking flow
Without SSR: **Search, Fare Rule (optional), Review, Fare Rule (optional)**, then either
- **Instant:** Fare Validate (optional, recommended when there is a payment step) then **Book with payment**, then Booking Details; or
- **Hold:** Book **without** `paymentInfos` (only if Review says `isBA` true), Booking Details, then **Confirm Fare Before Ticket**, then **Confirm-Book** with payment, then Booking Details; or **Release PNR** to drop it.
With SSR: Review (meal, baggage, extra service), optional **Seat Map** (only if `isa` true), then the same.
**Call Booking Details only after about 5 seconds.** Whether a hold is allowed comes from the Review response.
Search `priceIds` live **15 minutes**; the Review `bookingId` lives `conditions.st` seconds.

## Every endpoint
| Operation | Method and path | Notes |
| --- | --- | --- |
| Search | POST `fms/v1/air-search-all` | One, Return, Multi-City; cabin, pax, route, modifiers |
| Fare Rule | POST `fms/v2/farerule` | By `priceId` after search, or `bookingId` after review |
| Review | POST `fms/v1/review` | Body `priceIds`; returns `bookingId` and `conditions` |
| Seat Map | POST `fms/v1/seat` | Only when `conditions.isa` is true |
| Fare Validate (instant) | POST `oms/v1/air/book/fare-validate` | Same traveller and SSR body as Book |
| Book (instant or hold) | POST `oms/v1/air/book` | Omit `paymentInfos` for a hold |
| Confirm fare before ticket | POST `oms/v1/air/fare-validate` | Hold flow step before Confirm-Book |
| Confirm-Book (hold) | POST `oms/v1/air/confirm-book` | Pass `paymentInfos.amount` |
| Booking Details | POST `oms/v1/booking-details` | PNR, tickets, status, fares; `requirePaxPricing` optional |
| Release PNR (hold) | POST `oms/v1/air/unhold` | Order then shows `UNCONFIRMED` |
| Amendment charges | POST `oms/v1/air/amendment/amendment-charges` | Optional quote for cancel, void, refund |
| Submit amendment | POST `oms/v1/air/amendment/submit-amendment` | Cancel, `VOID`, `FULL_REFUND` |
| Amendment details | POST `oms/v1/air/amendment/amendment-details` | Poll the outcome |
| Ancillaries: fetch SSR | POST `fms/v1/ancillaries/fetch/ssr` | Meals and baggage for a booking |
| Ancillaries: fetch seat | POST `fms/v1/ancillaries/fetch/seat` | Seat layout |
| Ancillaries: add | POST `oms/v1/air/amendment/add/ssr` | Then poll Amendment details |
| Reissue | POST `fms/v1/reissue/poll/searchquery-list`, `fms/v1/reissue/poll/search`, `fms/v1/reissue/review`, then `oms/v1/air/amendment/auto-reissue` | Reschedule |
| User detail | GET `ums/v1/user-detail` | **Wallet balance, credit balance and outstanding** for our account |

## Search
- `cabinClass` ECONOMY / PREMIUM_ECONOMY / BUSINESS / FIRST. `paxInfo`: ADULT (min 1), CHILD (2 to 12 yrs), INFANT (0 to 2 yrs, not more than adults). `routeInfos` with IATA `fromCityOrAirport.code`, `toCityOrAirport.code`, `travelDate`.
- Modifiers: direct only, connecting only, `pfts` REGULAR / STUDENT / SENIOR_CITIZEN, up to 10 preferred airlines.
- Response keys depend on the journey: Oneway `ONWARD`; Domestic Return `ONWARD` + `RETURN` (2 priceIds at Review); International Return and Multi-City `COMBO` (1 priceId); Domestic Multi-City indexed keys (max 6 legs).
- Fare fields per pax type: `fC.BF` base, `fC.TAF` taxes, `fC.TF` total charged to us, `fC.NCM` net commission, `rT` refundable (0 non, 1 refundable, 2 partial), baggage `bI.iB` check-in and `bI.cB` cabin, `sR` seats left.
- **`fareIdentifier`:** PUBLISHED, SPECIAL_RETURN (both legs must be special return, matched by `sri` and `msri`; IndiGo, SpiceJet, GoAir, Vistara) or **TJ_FLEX** (zero-cancellation-fee fare for domestic direct flights; the flex charge is non-refundable; cancel at least 24 h before departure).

## Review conditions that drive the booking form
`isBA` hold allowed · `isa` seat map applies · `iecr` emergency contact required · `igm` GST mandatory · `gstappl` GST optional but applicable · `pm` passport mandatory · `pped` passport expiry required ·
`adobr`/`cdobr`/`idobr` date of birth per pax type · `ipa` **PAN applicable** · `ida`/`idm` document id applicable/mandatory (student, senior).
A `FAREALERT` in `alerts` means the price changed since search: tell the customer before booking.

## Book request essentials
`bookingId`, `paymentInfos[].amount` (= `TF` from Review; omit for a hold), `deliveryInfo` (emails, contacts with country code), `contactInfo` when `iecr`,
`travellerInfo[]` (`ti` title, `pt` ADULT/CHILD/INFANT, `fN`, `lN`, `dob`, passport `pNum`/`eD`/`pNat`/`pid`, `pan`, `di`), and per-traveller SSR selections (`ssrBaggageInfos`, `ssrMealInfos`, `ssrSeatInfos`, `ssrExtraServiceInfos`, each with segment `key` and `code`), plus `gstInfo` when GST applies.
**PAN:** when `ipa` is true a valid PAN is required in Book and Hold. If PAN validation fails, the booking **goes to Pending with no error message**.

## Booking statuses (`order.status`)
`SUCCESS` (PNR and e-ticket issued, payment deducted) · `ON_HOLD` (blocked, awaiting Confirm-Book) · `PENDING` (poll again) · `FAILED` (contact support) · `ABORTED` · `CANCELLED` · `UNCONFIRMED` (hold released).
Per traveller `statusMap`: CANCELLED, VOIDED, REISSUED, NO_SHOW. PNRs are in `pnrDetails` keyed by sector (for example `DEL-BOM`), tickets in `ticketNumberDetails`.

## Post-booking rules
- A booking must be `SUCCESS` before any amendment. Cancellation is three steps: charges (optional), submit, poll details.
- **Void** only inside the airline's void window (typically same day), full refund. **Full refund** (`FULL_REFUND`) is for cases where the airline owes it: flight cancelled, DGCA rule.
- **Ancillaries:** order is fetch SSR, fetch seat, add, poll. Infants cannot add SSR; a meal and a seat can be added once per pax per segment; baggage is per trip and can be added repeatedly, one at a time.
- **Reissue:** one trip at a time; partial reissue allowed; a booking can be reissued **once**; cabin downgrade not allowed (upgrade is).
- **DGCA free look-in:** airlines give a free cancellation window after booking (IndiGo 24 h, Akasa 48 h, and so on; refund conditions in Part 2). For hold bookings it counts from PNR creation.
- The Airline Automation Coverage Matrix (Part 2) says which airlines support automated cancellation (CAN), cancellation quotes (CQ), reissue (RE, RQ) and SSR.

## Errors
Numeric codes in the body (400, 404, 407, 408, 411, 412, 802, 805 to 819, and 1000 and up). Common ones: **1000** flight no longer available, **1015** payment amount mismatch,
**816** duplicate request, **1010** duplicate passenger names, **1006** more than 9 passengers, **1001/1002** infants or children exceed adults, **412** invalid API key. Full table in Part 2.

## Going live (certification)
Provide JSON request and response logs (separate files, unmodified, with the API key, real passenger names) for **12 test cases** across oneway, domestic and international return, and domestic and international multi-city,
covering direct and connecting flights, with Published Fare (domestic and international), **Special Return Fare**, booking with **passport**, with **GST**, and with **SSR (baggage, meal)**; student or senior fare is optional.
Verification takes **1 to 4 working days**; then switch to production endpoints and give your **IPv4 ranges for whitelisting**.

## Pitfalls
- Hold is decided by Review (`isBA`); do not try it otherwise.
- Call Booking Details about 5 seconds after Book, and keep polling while `PENDING`.
- The wallet, credit and outstanding balances come from `ums/v1/user-detail`: check before ticketing.
- PAN failure leaves a booking Pending **silently**, so validate PAN format before calling.
- Sample request and response payloads are **not** in the page. They are in TripJack's shared Google Drive folders (links below).


## Links on the page
- Postman collection: https://drive.google.com/drive/folders/18Ux3elGymiDNF0OL94axVynQDCYHUpvI
- Sample payloads (requests and responses): https://drive.google.com/drive/folders/17_NVVlMjFfw6pUPSWaPrlxu2mJ6QBb77
- Further documents: https://drive.google.com/drive/folders/1xgohRL7TYFR_RlI-uQNVqXHfndkc0e6t
- Julian date converter (used in the barcode guide): http://www.longpelaexpertise.com/toolsJulian.php


---

# Part 2: Full reference, as published

The text below is TripJack's page for this product, converted to markdown with its tables and code
samples intact. Diagrams are reduced to their labels. Where it disagrees with Part 1's
"Pitfalls", the pitfalls are things we noticed while reading, not TripJack's wording.

Flights API v2.0 · REST · JSON · HTTPS

## Flights API v2.0

TripJack's Flights API v2.0 covers the complete booking funnel — search, fare rules, review, booking — plus all post-booking operations: cancellation, void, reissue, and ancillaries.

UAT Baseapitest.tripjack.com

Prod Basetripjack.com

Versionv2.0.2

ProtocolHTTPS · REST · JSON

Security

### Authentication

All API calls require your API key as the `apikey` request header. The same key is used for both pre-booking (FMS) and post-booking (OMS) endpoints.

HTTP · Request Header

```
POST /fms/v1/air-search-all HTTP/1.1
Host: apitest.tripjack.com
apikey: YOUR_API_KEY
Content-Type: application/json
```

⚠️

Keep your API key secure. Contact TripJack support if your key is compromised. UAT and production use separate keys.

Reference

### Service URLs

⚠️

Endpoints must **not** end with a trailing slash — this causes an error.

#### UAT Environment (apitest.tripjack.com)

| Service | URL |
| --- | --- |
| Search | `https://apitest.tripjack.com/fms/v1/air-search-all` |
| Fare Rule (v2) | `https://apitest.tripjack.com/fms/v2/farerule` |
| Review | `https://apitest.tripjack.com/fms/v1/review` |
| Seat Map | `https://apitest.tripjack.com/fms/v1/seat` |
| Fare Validate (Instant) | `https://apitest.tripjack.com/oms/v1/air/book/fare-validate` |
| Book (Instant / Hold) | `https://apitest.tripjack.com/oms/v1/air/book` |
| Confirm Fare Before Ticket | `https://apitest.tripjack.com/oms/v1/air/fare-validate` |
| Confirm-Book (Hold) | `https://apitest.tripjack.com/oms/v1/air/confirm-book` |
| Booking Details | `https://apitest.tripjack.com/oms/v1/booking-details` |
| Release PNR (Hold) | `https://apitest.tripjack.com/oms/v1/air/unhold` |
| Get Amendment Charges | `https://apitest.tripjack.com/oms/v1/air/amendment/amendment-charges` |
| Submit Amendment | `https://apitest.tripjack.com/oms/v1/air/amendment/submit-amendment` |
| Amendment Details | `https://apitest.tripjack.com/oms/v1/air/amendment/amendment-details` |
| User Detail | `https://apitest.tripjack.com/ums/v1/user-detail` |

#### Production Environment (tripjack.com)

| Service | URL |
| --- | --- |
| Search | `https://tripjack.com/fms/v1/air-search-all` |
| Fare Rule (v2) | `https://tripjack.com/fms/v2/farerule` |
| Review | `https://tripjack.com/fms/v1/review` |
| Seat Map | `https://tripjack.com/fms/v1/seat` |
| Fare Validate (Instant) | `https://tripjack.com/oms/v1/air/book/fare-validate` |
| Book (Instant / Hold) | `https://tripjack.com/oms/v1/air/book` |
| Confirm Fare Before Ticket | `https://tripjack.com/oms/v1/air/fare-validate` |
| Confirm-Book (Hold) | `https://tripjack.com/oms/v1/air/confirm-book` |
| Booking Details | `https://tripjack.com/oms/v1/booking-details` |
| Release PNR (Hold) | `https://tripjack.com/oms/v1/air/unhold` |
| Get Amendment Charges | `https://tripjack.com/oms/v1/air/amendment/amendment-charges` |
| Submit Amendment | `https://tripjack.com/oms/v1/air/amendment/submit-amendment` |
| Amendment Details | `https://tripjack.com/oms/v1/air/amendment/amendment-details` |
| User Detail | `https://tripjack.com/ums/v1/user-detail` |

Postman Collection: [Download here](https://drive.google.com/drive/folders/18Ux3elGymiDNF0OL94axVynQDCYHUpvI)

Integration Guide

### Booking Flow

Without SSR Booking Flow

[Diagram, labels in drawing order: Search | Fare Rule | Optional | Review | Fare Rule | Optional | If Hold | Booking | Yes | Block | Booking Detail | If Hold Booking | to Confirm? | Confirm Fare Before Ticketing | If fare is | available | Yes | Hold Confirm | Booking Detail | No | Contact Customer | Support | No | Confirm Book | Booking Detail]

* Booking Detail should be called after 5 seconds elapsed

* Hold Booking will be decided from Review response

With SSR Booking Flow

[Diagram, labels in drawing order: Search | Fare Rule | Optional | Review (Meal, Baggage, ExtraService) | Optional | Seat Map | Optional | Fare Rule | If Hold | Booking | Yes | Block | Booking Detail | If Hold Booking | to Confirm? | Confirm Fare Before Ticketing | If fare is | available | Yes | Hold Confirm | Booking Detail | No | Contact Customer | Support | No | Confirm Book | Booking Detail]

* Booking Detail should be called after 5 seconds elapsed

* Hold Booking will be decided from Review response

#### Post-Booking API

| Operation | Endpoint | Method | Purpose | When |
| --- | --- | --- | --- | --- |
| Cancellation | submit-amendment | POST | Cancel booking with refund per airline policy | After booking |
| Auto Void | submit-amendment (VOID) | POST | Cancel within same-day void window — full refund | Same day |
| Reissue | fms/v1/reissue/… + auto-reissue | POST | Reschedule flight — Search → Review → Book | After booking |
| Ancillaries | ancillaries/fetch/ssr, add/ssr | POST | Add seat, meal, baggage post-booking | After booking |
| Booking Details | oms/v1/booking-details | POST | Retrieve PNR, ticket numbers, status | Any time |
| Release PNR | oms/v1/air/unhold | POST | Release hold PNR without confirming | Hold only |

Pre-Booking · Step 1

### Search API

Returns cheapest available fares for all journey types (Oneway, Return, Multi-City). PriceIds in the response are valid for 15 minutes.

POST`fms/v1/air-search-all`

UAT: apitest.tripjack.com
Prod: tripjack.com

#### Journey Types & Response Structure

| Journey Type | Response Key | Review priceIds |
| --- | --- | --- |
| Domestic / International Oneway | ONWARD key in searchResult.tripInfos | Single priceId per trip |
| Domestic Return | ONWARD + RETURN keys | 2 priceIds required at Review |
| International Return / Multi-City | COMBO key | 1 priceId required at Review |
| Domestic Multi-City (2–6 legs) | Indexed keys per route | N priceIds at Review (max 6) |

#### Request Fields

| Field | Parent | Type | Description | M/O |
| --- | --- | --- | --- | --- |
| searchQuery | root | Object | Root search object | M |
| cabinClass | searchQuery | String | ECONOMY / PREMIUM_ECONOMY / BUSINESS / FIRST (default: ECONOMY) | O |
| paxInfo | searchQuery | Object | Passenger counts | M |
| ADULT | paxInfo | Integer | Number of adults (min 1) | M |
| CHILD | paxInfo | Integer | Number of children (2–12 yrs) | O |
| INFANT | paxInfo | Integer | Number of infants (0–2 yrs, ≤ adults) | O |
| routeInfos | searchQuery | ArrayList | List of route info objects (1 for OW, 2 for Return, 2–6 for MC) | M |
| fromCityOrAirport.code | routeInfos | String | IATA departure airport/city code | M |
| toCityOrAirport.code | routeInfos | String | IATA arrival airport/city code | M |
| travelDate | routeInfos | String | Travel date (YYYY-MM-DD) | M |
| searchModifiers | searchQuery | Object | Optional filters | O |
| isDirectFlight | searchModifiers | Boolean | Return only direct flights | O |
| isConnectingFlight | searchModifiers | Boolean | Return only connecting flights | O |
| pfts | searchModifiers | String | REGULAR / STUDENT / SENIOR_CITIZEN (default: REGULAR) | O |
| preferredAirline[].code | searchQuery | Array | Filter by airline IATA codes (max 10) | O |

#### Key Response Fields — totalPriceList

| Field | Parent | Type | Description | M/O |
| --- | --- | --- | --- | --- |
| id | totalPriceList | String | Price ID — pass to Review (valid 15 min) | M |
| fareIdentifier | totalPriceList | String | PUBLISHED / SPECIAL_RETURN / TJ_FLEX | M |
| fC.BF | fD[PaxType] | Number | Base Fare per pax | M |
| fC.TAF | fD[PaxType] | Number | Taxes and Fees | M |
| fC.TF | fD[PaxType] | Number | Total Fare (charged to agent) | M |
| fC.NCM | fD[PaxType] | Number | Net Commission (Gross - TDS) | M |
| rT | fD[PaxType] | Integer | Refundable type: 0=Non, 1=Refundable, 2=Partial | M |
| bI.iB | fD[PaxType] | String | Check-in baggage allowance | O |
| bI.cB | fD[PaxType] | String | Cabin baggage allowance | O |
| sR | fD[PaxType] | Integer | Seats remaining | O |
| cc | fD[PaxType] | String | Cabin class | M |
| sri / msri | totalPriceList | String | Special Return identifiers — must be matched across legs | M |

ℹ️

**Special Return Fares:** When fareIdentifier is SPECIAL_RETURN, both legs must be SPECIAL_RETURN. Match via `sri` (onward) and `msri` (return must contain onward sri). Airlines: IndiGo, SpiceJet, GoAir, Air Vistara.

💡

**TJ_FLEX Fare:** Zero-cancellation fee fare for domestic direct flights. Identified by `fareIdentifier: TJ_FLEX`. Flex charges (FTC) are non-refundable. Cancellation must be ≥24 hrs before departure.

Pre-Booking · Step 2

### Fare Rule API

Returns cancellation, reschedule, no-show, and seat chargeable policies for a selected fare. Can be called after Search (using priceId) or after Review/Booking (using bookingId).

POST`fms/v2/farerule`

UAT: apitest.tripjack.com
Prod: tripjack.com

| Field | Parent | Type | Description | M/O |
| --- | --- | --- | --- | --- |
| flowType | root | String | SEARCH / REVIEW / BOOKING_DETAIL | M |
| id | root | String | priceId (from Search) or bookingId (from Review/Booking) | M |

#### Response — Timed Fare Rule (tfr) Structure

Each policy key (CANCELLATION, DATECHANGE, NO_SHOW, SEAT_CHARGEABLE) contains a list of time-banded policies:

| Field | Parent | Type | Description |
| --- | --- | --- | --- |
| amount | policy | Number | Airline fee for this rule type |
| additionalFee | policy | Number | TripJack fee |
| st | policy | Number | Start time: hours before departure (min 0) |
| et | policy | Number | End time: hours before departure (max 8760) |
| pp | policy | String | Policy period: BEFORE_DEPARTURE / AFTER_DEPARTURE / DEFAULT |
| policyInfo | policy | String | Additional descriptive text for customers |
| fcs.ARF / ARFT | policy | Number | Airline Reschedule Fee / Tax |
| fcs.CRF / CRFT | policy | Number | TripJack Reschedule Fee / Tax |
| fcs.ACF / ACFT | policy | Number | Airline Cancellation Fee / Tax |
| fcs.CCF / CCFT | policy | Number | TripJack Cancellation Fee / Tax |

ℹ️

The API returns either `st/et` (time-based) OR `pp` (policy-period) — never both. If no mini-rule is available from the supplier, a Cat 16 plain-text rule is returned under `miscInfo`.

Pre-Booking · Step 3

### Review API

Revalidates selected price IDs against the supplier. Returns a session `bookingId` required for all subsequent calls. The reviewed price is valid for `conditions.st` seconds.

POST`fms/v1/review`

UAT: apitest.tripjack.com
Prod: tripjack.com

#### Request

| Field | Parent | Type | Description | M/O |
| --- | --- | --- | --- | --- |
| priceIds | root | ArrayList<String> | List of PriceId for which itinerary has to be reviewed(price validated). | M |

#### Conditions (from response)

| Field | Parent | Type | Description |
| --- | --- | --- | --- |
| st | conditions | Integer | Session time in seconds — bookingId valid this long |
| sct | conditions | String | Session created timestamp |
| isa | conditions | Boolean | **Seat Applicable** — call Seat Map API only if true |
| isBA | conditions | Boolean | Hold (block) allowed for this fare |
| iecr | conditions | Boolean | Emergency contact details mandatory in Book request |
| igm (gst) | conditions | Boolean | GST mandatory — pass gstInfo in Book |
| gstappl (gst) | conditions | Boolean | GST optional but applicable |
| pm (pcs) | conditions | Boolean | Passport mandatory |
| pped (pcs) | conditions | Boolean | Passport expiry date required |
| adobr/cdobr/idobr (dob) | conditions | Boolean | DOB required per pax type |
| ipa | conditions | Boolean | PAN card applicable |
| ida (dc) | conditions | Boolean | Document ID applicable (student/senior) |
| idm (dc) | conditions | Boolean | Document ID mandatory |

⚠️

If `alerts` (type: FAREALERT) is present in the response, the fare has changed from search. Inform the customer of the new price before proceeding.

Pre-Booking · Optional

### Seat Map API

Retrieves aircraft seat layout for the reviewed booking. Only call this when `conditions.isa = true` in the Review response. Pass the `bookingId` from Review.

POST`fms/v1/seat`

UAT: apitest.tripjack.com
Prod: tripjack.com

| Field | Parent | Type | Description | M/O |
| --- | --- | --- | --- | --- |
| bookingId | root | String | bookingId from Review response | M |

#### Response — tripSeatMap Structure

| Field | Parent | Type | Description | M/O |
| --- | --- | --- | --- | --- |
| tripSeat[key] | tripSeatMap | Object | Key is the segment ID from Review tripInfos | M |
| sData.row / sData.column | tripSeat | Integer | Aircraft deck dimensions | M |
| nt | tripSeat | String | Note/reason if sInfo is not available for this leg | O |
| sInfo[].seatNo | tripSeat | String | Seat number and code | M |
| sInfo[].isBooked | sInfo | Boolean | False = seat available | M |
| sInfo[].isLegRoom | sInfo | Boolean | Leg room available | O |
| sInfo[].isAisle | sInfo | Boolean | Aisle seat | O |
| sInfo[].isExitRow | sInfo | Boolean | Exit row indicator | O |
| sInfo[].code | sInfo | String | Supplier code — pass to Book request | M |
| sInfo[].amount | sInfo | Double | Seat charge amount | M |
| sInfo[].seatPosition.row/column | seatPosition | Integer | Grid position for UI rendering | M |

Pre-Booking · Optional

### Fare Validate API

Pre-book confirmation that the fare and booking class are still available. Recommended for flows with a payment confirmation step between Review and Book. Accepts the same traveller/SSR structure as the Book request.

POST`oms/v1/air/book/fare-validate`

UAT: apitest.tripjack.com
Prod: tripjack.com

⚠️

If fare has changed, response includes `alerts` (type: FAREALERT). If fare or class is unavailable, response contains `errors` with httpStatus 400. In those cases, start a new booking.

#### Alerts

##### CLASS_SOLD_OUT

The `CLASS_SOLD_OUT` alert is returned when the originally selected booking class (RBD) becomes unavailable between Review and Fare Validate. In such cases, instead of failing the booking immediately, we attempt to reprice the itinerary on the same flights using the next available booking class.

The flow works as follows:

- **Repricing:** We reprice the itinerary with the airline using the next available booking class.
- **Fare rules:** We fetch the fare rules again for the new booking class, as cancellation and change penalties may differ.
- **Seat removal:** Any previously selected seats are removed because seat availability and pricing depend on the booking class.

The following alert may be returned in the Fare Validate response:

- **CLASS_SOLD_OUT** – Returned when the booking class changes and the fare rules for the new class differ from the original class.

⚠️

A change in booking class can also affect baggage allowances or other fare-related benefits, and these changes may not always be accompanied by a separate alert. Therefore, API partners should compare the updated booking class, baggage details, fare rules, and pricing in the Fare Validate response against the information presented during Review.

**Recommended handling for API partners:**

- When this alert is returned, display the updated fare, booking class, baggage allowance, and applicable fare rules to the traveller, and obtain their confirmation before proceeding with the booking.
- Inform the traveller that previously selected seats will not be included in the booking and can be selected again through the airline or the post-booking flow.

Pre-Booking · Step 4

### Booking API

Commits the booking. Supports four modes: Instant Book, Hold, Confirm Fare Before Ticket, and Confirm-Book.

#### 1. Instant Book

Direct ticketing with payment. PNR and e-ticket generated on success. Use `paymentInfos.amount = TF` (Total Fare from Review).

POST`oms/v1/air/book`

UAT: apitest.tripjack.com
Prod: tripjack.com

#### 2. Hold (Without Payment)

Blocks the PNR with the supplier without payment. Same request structure as Instant Book but **omit `paymentInfos`**. Check `conditions.isBA = true` in Review before attempting.

POST`oms/v1/air/book`

UAT: apitest.tripjack.com
Prod: tripjack.com

#### 3. Confirm Fare Before Ticket (Hold → Validate)

Validates that the held fare is still available before committing payment. Returns fare status and any alerts.

POST`oms/v1/air/fare-validate`

UAT: apitest.tripjack.com
Prod: tripjack.com

ℹ️

Cases: (1) Success — proceed to Confirm-Book. (2) Fare unavailable — start new booking. (3) Hold time expired — start new booking. (4) Fare alert — inform customer.

#### 4. Confirm-Book (Hold → Ticket)

Tickets a held booking after successful fare validation. Pass `paymentInfos.amount`.

POST`oms/v1/air/confirm-book`

UAT: apitest.tripjack.com
Prod: tripjack.com

#### Booking Request Fields

| Field | Parent | Type | Description | M/O |
| --- | --- | --- | --- | --- |
| bookingId | root | String | bookingId from Review response | M |
| paymentInfos[].amount | root | Number | Gross fare (TF from Review). Omit for Hold. | M |
| deliveryInfo.emails | deliveryInfo | Array | Booking email addresses | M |
| deliveryInfo.contacts | deliveryInfo | Array | Contact numbers with country code e.g. +919500112233 | M |
| contactInfo.emails | contactInfo | Array | Emergency contact emails (required if iecr=true) | O |
| contactInfo.contacts | contactInfo | Array | Emergency contact numbers (required if iecr=true) | O |
| contactInfo.ecn | contactInfo | String | Emergency contact name (required if iecr=true) | O |
| travellerInfo[].ti | travellerInfo | String | Title: Adult=Mr/Mrs/Ms, Child/Infant=Ms/Master | M |
| travellerInfo[].pt | travellerInfo | String | ADULT / CHILD / INFANT | M |
| travellerInfo[].fN | travellerInfo | String | First name | M |
| travellerInfo[].lN | travellerInfo | String | Last name | M |
| travellerInfo[].dob | travellerInfo | String | Date of birth YYYY-MM-DD (mandatory for INFANT, check dob conditions) | O |
| travellerInfo[].pNum | travellerInfo | String | Passport number (if pm=true) | O |
| travellerInfo[].eD | travellerInfo | String | Passport expiry date YYYY-MM-DD (if pped=true) | O |
| travellerInfo[].pNat | travellerInfo | String | Passport nationality — 2-letter IATA country code | O |
| travellerInfo[].pid | travellerInfo | String | Passport issue date YYYY-MM-DD | O |
| travellerInfo[].pan | travellerInfo | String | PAN card number (if ipa=true) | O |
| travellerInfo[].di | travellerInfo | String | Document ID for student/senior citizen fares | O |
| travellerInfo[].ssrBaggageInfos[].key | ssrBaggageInfos | String | Segment key from Review tripInfos | O |
| travellerInfo[].ssrBaggageInfos[].code | ssrBaggageInfos | String | SSR code selected by customer | O |
| travellerInfo[].ssrMealInfos[].key/code | ssrMealInfos | String | Segment key + SSR code for meal | O |
| travellerInfo[].ssrSeatInfos[].key/code | ssrSeatInfos | String | Segment key + SSR code for seat | O |
| travellerInfo[].ssrExtraServiceInfos[].key/code | ssrExtraServiceInfos | String | Segment key + SSR code for extra service | O |
| travellerInfo[].ff[airlineCode] | travellerInfo | String | Frequent flyer number e.g. "AI": "23422" | O |
| gstInfo.gstNumber | gstInfo | String | 15-digit GST number (mandatory if igm=true) | O |
| gstInfo.registeredName | gstInfo | String | GST registered name (max 35 chars IATA standard) | O |
| gstInfo.email | gstInfo | String | GST email | O |
| gstInfo.mobile | gstInfo | String | GST mobile | O |
| gstInfo.address | gstInfo | String | GST address (max 70 chars IATA standard) | O |

⚠️

Amount in Book request must equal **TF (Total Fare)** from AirReviewResponse. TripJack determines the payment medium internally — do not send payment medium type.

Post-Booking

### Booking Details API

Retrieves the current state of a booking — PNR, ticket numbers, status, fare breakdown, and traveller details. Call this after Book to get PNR and ticket numbers.

POST`oms/v1/booking-details`

UAT: apitest.tripjack.com
Prod: tripjack.com

| Field | Parent | Type | Description | M/O |
| --- | --- | --- | --- | --- |
| bookingId | root | String | Booking ID | M |
| requirePaxPricing | root | Boolean | Set true to include per-pax fare breakdown in response | O |

#### Order Status Values

| Status | Meaning | Action |
| --- | --- | --- |
| SUCCESS | PNR and e-ticket generated, payment deducted |  |
| ON_HOLD | Booking blocked, awaiting confirm-book |  |
| CANCELLED | Booking cancelled |  |
| FAILED | Failed — contact TripJack support |  |
| PENDING | Processing — poll again |  |
| ABORTED | Aborted |  |
| UNCONFIRMED | Hold PNR released via unhold API |  |

#### Key Response Fields

| Field | Parent | Type | Description |
| --- | --- | --- | --- |
| order.bookingId | order | String | TripJack booking reference |
| order.amount | order | Number | Amount charged |
| order.status | order | String | Order status (see above) |
| order.orderNote | order | String | Any order-related notes |
| travellerInfos[].pnrDetails | travellerInfos | Object | Key: DEP-ARR → Value: Airline PNR |
| travellerInfos[].gdsPnrs | travellerInfos | Object | GDS PNR (optional) |
| travellerInfos[].ticketNumberDetails | travellerInfos | Object | Key: DEP-ARR → Value: Ticket number |
| travellerInfos[].statusMap | travellerInfos | Object | Per-traveller amendment status: CANCELLED/VOIDED/REISSUED/NO_SHOW |
| totalPriceInfo.fc.TF | totalPriceInfo | Number | Total fare charged |
| totalPriceInfo.fc.SSRP | totalPriceInfo | Number | SSR price (seat + meal + baggage) |

Post-Booking · Hold Only

### Release PNR

Releases a hold PNR when the customer decides not to confirm. Cancels the PNR with the supplier. After calling, verify by checking Booking Details — order status should be UNCONFIRMED.

POST`oms/v1/air/unhold`

UAT: apitest.tripjack.com
Prod: tripjack.com

| Field | Parent | Type | Description | M/O |
| --- | --- | --- | --- | --- |
| bookingId | root | String | Booking ID to release | M |
| pnrs | root | Array<String> | PNR(s) to release | M |

Post-Booking

### Cancellation Amendment API

Three-step process: (1) Get Charges (optional), (2) Submit Amendment, (3) Poll Amendment Details.

⚠️

Prerequisite: booking must be in SUCCESS state before raising any amendment.

Raising Amendment Flow

[Diagram, labels in drawing order: submit-amendment | Errors | YES | Response with | mentioned errors | NO | Response with amendmentId | amendment-details | Errors | YES | Response with | mentioned errors | NO | Response with | amendment details]

Get Charges for Amendment Flow

[Diagram, labels in drawing order: amendment-charges | Errors | YES | Response with | mentioned errors | NO | Response with | charges details]

#### Step 1 — Get Amendment Charges (Optional)

Returns cancellation fees and refundable amounts per pax type. Does not apply any changes.

POST`oms/v1/air/amendment/amendment-charges`

UAT: apitest.tripjack.com
Prod: tripjack.com

| Field | Parent | Type | Description | M/O |
| --- | --- | --- | --- | --- |
| bookingId | root | String | Booking ID | M |
| type | root | String | Amendment type e.g. CANCELLATION | M |
| remarks | root | String | Remarks (mandatory) | M |
| trips[].src | trips | String | Departure airport code (only for specific-trip cancellation) | O |
| trips[].dest | trips | String | Arrival airport code | O |
| trips[].departureDate | trips | String | YYYY-MM-DD | O |
| trips[].travellers[].fn | travellers | String | First name (only for specific-pax cancellation) | O |
| trips[].travellers[].ln | travellers | String | Last name | O |

##### Scope Options:

- **Full booking:** Send only bookingId — charges for all pax on all trips
- **Specific travellers:** Send trips[] + travellers[] — charges only for those pax
- **Specific trip:** Send trips[] without travellers[] — all pax on that trip

#### Step 2 — Submit Amendment

Applies the cancellation. Returns an `amendmentId` for status polling. Same request structure as Get Charges with addition of `remarks` field.

POST`oms/v1/air/amendment/submit-amendment`

UAT: apitest.tripjack.com
Prod: tripjack.com

| Field | Parent | Type | Description | M/O |
| --- | --- | --- | --- | --- |
| bookingId | root | String | Booking ID | M |
| type | root | String | CANCELLATION / VOIDED / FULL_REFUND etc. | M |
| remarks | root | String | Remarks — mandatory | M |
| trips | root | Array | Optional — for partial trip/pax cancellation | O |

#### Step 3 — Get Amendment Details

Polls the status of the amendment. If status is REQUESTED, poll 4–5 times with 10-second intervals. If still REQUESTED, contact TripJack support.

POST`oms/v1/air/amendment/amendment-details`

UAT: apitest.tripjack.com
Prod: tripjack.com

| Field | Parent | Type | Description | M/O |
| --- | --- | --- | --- | --- |
| amendmentId | root | String | From submit-amendment response | M |

##### amendmentStatus Values:

| Status | Meaning |  |
| --- | --- | --- |
| REQUESTED | Amendment submitted, processing in progress |  |
| SUCCESS | Amendment completed successfully |  |
| REJECTED | Amendment rejected by supplier |  |
| PENDING | Amendment in progress |  |

#### Response Fields

| Field | Parent | Type | Description | M/O |
| --- | --- | --- | --- | --- |
| bookingId | root | String | Booking reference |  |
| amendmentId | root | String | Amendment reference |  |
| amendmentStatus | root | String | Current status |  |
| amendmentCharges | root | Number | Total amendment charges |  |
| refundableAmount | root | Number | Total refund amount |  |
| totalFare | root | Number | Total fare of booking |  |
| trips[].src/dest/departureDate | trips |  | Trip details |  |
| trips[].travellers[].fn/ln | travellers |  | Traveller names |  |
| trips[].travellers[].amendmentCharges | travellers | Number | Per-pax amendment charge |  |
| trips[].travellers[].refundAmount | travellers | Number | Per-pax refund amount |  |
| trips[].travellers[].totalFare | travellers | Number | Per-pax total fare |  |

Post-Booking

### Auto Full Refund

Full refund amendment for cases where the airline owes a full refund (flight cancellation, DGCA policy, etc.). Uses the Submit Amendment endpoint with type FULL_REFUND.

POST`oms/v1/air/amendment/submit-amendment`

UAT: apitest.tripjack.com
Prod: tripjack.com

#### Remarks Checklist (use these values to trigger automated refunds)

- Flight Cancelled by Airline
- Airline rescheduled flight, revised timings are not suitable
- Already cancelled by directly contacting airline customer support team
- Airline confirmed, refund is already processed
- **Refund under DGCA policy** ← Use this exact string for DGCA automation
- Personal loss or bereavement
- Passenger is medically unfit for travel
- Refund under empowerment policy

💡

For DGCA cases, use the exact string `"Refund under DGCA policy"` in the remarks field to trigger automated processing.

#### Request

| Field | Parent | Type | Description | M/O |
| --- | --- | --- | --- | --- |
| bookingId | root | String | Booking ID | M |
| type | root | String | FULL_REFUND | M |
| remarks | root | String | Mandatory — use checklist values above | M |
| trips[].src | trips | String | Departure airport code (for partial trip refund) | O |
| trips[].dest | trips | String | Arrival airport code | O |
| trips[].departureDate | trips | String | YYYY-MM-DD | O |
| trips[].travellers[].fn | travellers | String | First name (for specific pax refund) | O |
| trips[].travellers[].ln | travellers | String | Last name | O |

##### Refund Scope Options:

- **Full booking:** Send only bookingId + remarks
- **Specific trip:** Send trips[] without travellers[]
- **Specific travellers:** Send trips[] + travellers[]

#### Response

| Field | Parent | Type | Description | M/O |
| --- | --- | --- | --- | --- |
| bookingId | root | String | Booking reference |  |
| amendmentId | root | String | Use this to poll Amendment Details |  |

ℹ️

After submitting, poll `oms/v1/air/amendment/amendment-details` with the returned amendmentId to confirm refund status.

Post-Booking

### Auto Void API

Voids a booking within the airline's void window (typically same-day). Full refund on success. Uses the standard 3-step amendment flow.

⚠️

Booking must be in SUCCESS state and within the void window before calling. Total fare per pax in the charges response = (total fare) ÷ (number of pax of that type).

#### Step 1 — Get Void Charges (Optional)

POST`oms/v1/air/amendment/amendment-charges`

UAT: apitest.tripjack.com
Prod: tripjack.com

| Field | Parent | Type | Description | M/O |
| --- | --- | --- | --- | --- |
| bookingId | root | String | Booking ID | M |
| type | root | String | VOIDED | M |
| trips | root | Array | Optional — for specific journey void | O |

#### Response Fields

| Field | Parent | Type | Description | M/O |
| --- | --- | --- | --- | --- |
| trips[].src/dest/departureDate | trips |  | Trip identifiers |  |
| trips[].flightNumbers | trips | Array | Flight numbers including connecting legs |  |
| trips[].airlines | trips | Array | Airline codes |  |
| trips[].amendmentInfo[PaxType].amendmentCharges | amendmentInfo | Number | Void fee per pax type |  |
| trips[].amendmentInfo[PaxType].refundAmount | amendmentInfo | Number | Refundable amount per pax type |  |
| trips[].amendmentInfo[PaxType].totalFare | amendmentInfo | Number | Total fare per pax type |  |

#### Step 2 — Submit Void

POST`oms/v1/air/amendment/submit-amendment`

UAT: apitest.tripjack.com
Prod: tripjack.com

| Field | Parent | Type | Description | M/O |
| --- | --- | --- | --- | --- |
| bookingId | root | String | Booking ID | M |
| type | root | String | VOIDED | M |
| remarks | root | String | Reason for void | M |
| trips | root | Array | Optional scope (same as charges request) | O |

#### Step 3 — Get Amendment Details

POST`oms/v1/air/amendment/amendment-details`

UAT: apitest.tripjack.com
Prod: tripjack.com

Poll with returned amendmentId. If REQUESTED, poll 4–5× with 10-second intervals.

| Field | Parent | Type | Description | M/O |
| --- | --- | --- | --- | --- |
| amendmentStatus | root | String | REQUESTED / PENDING / SUCCESS / REJECTED |  |
| refundableAmount | root | Number | Total refund amount |  |
| trips[].travellers[].refundAmount | travellers | Number | Per-pax refund |  |

**Environments:** UAT: `apitest.tripjack.com` | Prod: `tripjack.com`

Post-Booking

### Ancillaries (SSR) API

Add seats, meals, and baggage to a confirmed booking. APIs must be called in order: Fetch SSR → Fetch Seat → Add SSR → Amendment Details.

⚠️

Booking must be in SUCCESS state. Infants cannot add SSR. Meals can only be added once per pax per segment. Baggage is per-trip and can be added multiple times (one at a time). Seats can only be added once per pax per segment.

#### Service URLs

| Operation | Endpoint | Method | Purpose |
| --- | --- | --- | --- |
| Fetch SSR | fms/v1/ancillaries/fetch/ssr | POST | Returns available meal/baggage options |
| Fetch Seat | fms/v1/ancillaries/fetch/seat | POST | Returns seat map for the booking |
| Add SSR | oms/v1/air/amendment/add/ssr | POST | Applies selected SSR — triggers payment |
| Amendment Details | oms/v1/air/amendment/amendment-details | POST | Polls SSR amendment status |

#### 1. Fetch SSR

POST`fms/v1/ancillaries/fetch/ssr`

UAT: apitest.tripjack.com
Prod: tripjack.com

| Field | Parent | Type | Description | M/O |
| --- | --- | --- | --- | --- |
| bookingId | root | String | Booking ID | M |

Response includes `tripInfos[].sI[].bI.ssrInfo` per segment. Each SSR item has:

| Field | Parent | Type | Description | M/O |
| --- | --- | --- | --- | --- |
| code | ssrInfo | String | Unique SSR code — pass to Add SSR | M |
| amount | ssrInfo | Number | Charge amount (absent for connecting baggage) | O |
| desc | ssrInfo | String | Customer-facing description | M |
| ssrBaggageInfos | bI | Array | Already-selected baggage | O |
| ssrMeaInfos | bI | Array | Already-selected meals | O |

ℹ️

For **connecting segments**, baggage amount field is absent — selecting baggage on the first segment applies to the whole journey. Meals are segment-specific.

#### 2. Fetch Seat Map

POST`fms/v1/ancillaries/fetch/seat`

UAT: apitest.tripjack.com
Prod: tripjack.com

| Field | Parent | Type | Description | M/O |
| --- | --- | --- | --- | --- |
| bookingId | root | String | Booking ID | M |

Response: `tripSeatMap` keyed by segment ID from Fetch SSR response.

| Field | Parent | Type | Description | M/O |
| --- | --- | --- | --- | --- |
| sData.row / column | tripSeat | Integer | Grid dimensions for rendering | M |
| sInfo[].seatNo | sInfo | String | Seat label e.g. 14A | M |
| sInfo[].isBooked | sInfo | Boolean | True = unavailable | M |
| sInfo[].isLegRoom | sInfo | Boolean | Extra legroom seat | O |
| sInfo[].isAisle | sInfo | Boolean | Aisle seat | O |
| sInfo[].code | sInfo | String | Pass to Add SSR | M |
| sInfo[].amount | sInfo | Double | Seat charge | M |
| sInfo[].seatPosition.row/column | seatPosition | Integer | Grid coordinates for UI | M |

#### 3. Add SSR

POST`oms/v1/air/amendment/add/ssr`

UAT: apitest.tripjack.com
Prod: tripjack.com

| Field | Parent | Type | Description | M/O |
| --- | --- | --- | --- | --- |
| paymentInfos[].amount | root | Number | Total payable amount for the SSR additions | M |
| sI[].id | sI | String | Segment ID | M |
| sI[].bI.tI[].id | tI | String | Pax ID from Fetch SSR response | M |
| sI[].bI.tI[].sbi.code | sbi | String | Baggage SSR code (omit if not adding baggage) | O |
| sI[].bI.tI[].sbi.amount | sbi | Number | 0 for subsequent segments of same journey | O |
| sI[].bI.tI[].smi.code | smi | String | Meal SSR code (omit if not adding meal) | O |
| sI[].bI.tI[].ssi.code | ssi | String | Seat SSR code (omit if not adding seat) | O |

ℹ️

For connecting journeys with multiple segments, pass SBI (baggage) on each segment but set `amount: 0` on subsequent segments of the same journey.

Response: `amendmentids` — list of amendment IDs, one per trip. Use these to poll Amendment Details.

#### 4. Amendment Details

POST`oms/v1/air/amendment/amendment-details`

UAT: apitest.tripjack.com
Prod: tripjack.com

| Field | Parent | Type | Description | M/O |
| --- | --- | --- | --- | --- |
| amendmentId | root | String | From Add SSR response | M |

| Field | Parent | Type | Description | M/O |
| --- | --- | --- | --- | --- |
| amendmentStatus | root | String | REJECTED / SUCCESS / PENDING |  |
| totalAmount | root | Number | Total amount paid for SSR |  |
| SSRAmendmentDetails[].id | SSRAmendmentDetails | String | Segment ID |  |
| SSRAmendmentDetails[].tI[].ssrSeatInfos | tI | Object | Selected seat details |  |
| SSRAmendmentDetails[].tI[].ssrBaggageInfos | tI | Object | Selected baggage details |  |
| SSRAmendmentDetails[].tI[].ssrMeaInfos | tI | Object | Selected meal details |  |

Post-Booking

### Auto Reissue API

Reschedule a booking to a new flight. Four-step flow: Search (query list) → Search (with requestId) → Review → Book.

⚠️

One trip can be reissued at a time. Partial reissue is supported. A booking cannot be reissued more than once. Downgrading cabin class is not permitted (upgrading is allowed).

#### Service URLs

| Step | Endpoint | Method | Purpose |
| --- | --- | --- | --- |
| Search (Query List) | fms/v1/reissue/poll/searchquery-list | POST | Step 1 — returns requestId |
| Search (with requestId) | fms/v1/reissue/poll/search | POST | Step 2 — returns available flights |
| Review | fms/v1/reissue/review | POST | Step 3 — revalidates and creates bookingId |
| Book | oms/v1/air/amendment/auto-reissue | POST | Step 4 — tickets the reissued booking |

#### Step 1 — Search (Query List)

POST`fms/v1/reissue/poll/searchquery-list`

UAT: apitest.tripjack.com
Prod: tripjack.com

Returns a `requestId` used in the next search call. Pass the new travel date, original PNR, and pax IDs to reissue.

| Field | Parent | Type | Description | M/O |
| --- | --- | --- | --- | --- |
| searchQuery.paxInfo.ADULT/CHILD/INFANT | paxInfo | Integer | Pax counts | M |
| searchQuery.routeInfos[].fromCityOrAirport.code | routeInfos | String | Departure IATA code | M |
| searchQuery.routeInfos[].toCityOrAirport.code | routeInfos | String | Arrival IATA code | M |
| searchQuery.routeInfos[].travelDate | routeInfos | String | New travel date (YYYY-MM-DD) | M |
| searchQuery.pnr | searchQuery | String | PNR of original booking | M |
| searchQuery.oldBookingId | searchQuery | String | Original booking ID | M |
| searchQuery.paxIds | searchQuery | ArrayList<String> | Pax IDs to reissue (from booking-details under travellerInfo.id) | M |

Response includes `requestId` and `searchIds`.

#### Step 2 — Search (with requestId)

POST`fms/v1/reissue/poll/search`

UAT: apitest.tripjack.com
Prod: tripjack.com

Returns available flights for the reissue. Response structure matches standard Search — tripInfos with segments and totalPriceList per trip.

##### Reissue Fare Components (in totalPriceList.fD[PaxType].fC):

| Component | Parent | Type | Description |
| --- | --- | --- | --- |
| BF | fC | Number | Difference of new minus old base fare |
| TAF | fC | Number | Difference of new minus old taxes |
| TF | fC | Number | Total payable — pass this to Book |
| OTF | fC | Number | Original booking total fare |
| RSSR | fC | Number | Refundable ancillary amount from original booking |
| AFS | fC | Number | TripJack reissue fee |
| ARF | afc | Number | Airline reissue fee |
| ARFT | afc | Number | Airline reissue fee tax |

💡

Total = (New BF − Old BF) + (New Tax − Old Tax) + Airline Reissue Fee + Airline Reissue Fee Tax + TripJack Reissue Fee − Refundable Ancillaries. Example: (3200−3000) + (1100−1000) + 2500 + 100 + 50 = ₹2,950.

If ancillaries were added to the original booking, they may be refunded based on airline policy. If refundable, the average is populated in ADULT and CHILD pax types (`RSSR` field).

#### Step 3 — Review

POST`fms/v1/reissue/review`

UAT: apitest.tripjack.com
Prod: tripjack.com

| Field | Parent | Type | Description | M/O |
| --- | --- | --- | --- | --- |
| priceIds | root | ArrayList | Price ID(s) to review — single ID (one trip at a time) | M |
| oldBookingId | root | String | Original booking ID to reschedule | M |
| priceValidation | root | Boolean | Set to true | M |

Response mirrors the standard Review response structure. Returns a new `bookingId` for the reissue booking, plus conditions (GST, DOB, passport requirements).

#### Step 4 — Book (Auto Reissue)

POST`oms/v1/air/amendment/auto-reissue`

UAT: apitest.tripjack.com
Prod: tripjack.com

| Field | Parent | Type | Description | M/O |
| --- | --- | --- | --- | --- |
| bookingId | root | String | bookingId from Reissue Review response | M |
| oldBookingId | root | String | Original booking ID being rescheduled | M |
| paymentInfos[].amount | root | Number | TF (Total Fare) from Reissue Review response | M |
| paymentInfos[].bookingId | root | String | bookingId from Reissue Review response | M |
| deliveryInfo.emails/contacts | deliveryInfo | Array | Delivery details | M |
| travellerInfo | root | Array | Traveller details — must match original booking data from Review response | M |
| ssrBaggageInfos/ssrMealInfos/ssrSeatInfos | travellerInfo | Array | Optional SSR for new booking | O |
| gstInfo | root | Object | GST details (if igm=true) | O |

Traveller info must match the passenger data from the original booking exactly as returned in the Review response.

#### FAQs

How is the reissue amount calculated?

New BF minus old BF, plus difference in taxes, plus airline reissue fee, plus airline reissue fee tax, plus TripJack reissue fee. Any refundable ancillary charges are subtracted. Example: (3200−3000) + (1100−1000) + 2500 + 100 + 50 = ₹2,950.

Where do I find paxIds?

In the booking-details API response under `travellerInfo[].id`.

Can I reissue to an earlier date?

The API supports it technically — pass the new date in Search. Whether the airline permits it depends on fare rules. The API returns availability and cost if allowed.

Is partial reissue supported?

Yes — one trip at a time. If the onward leg is already flown, you can reissue the return leg.

Can I change cabin class during reissue?

Upgrading is allowed if available per fare rules. Downgrading to a lower cabin class is not permitted.

Can I add SSR during reissue?

Yes — pass ssrBaggageInfos, ssrMealInfos, and ssrSeatInfos in the Book request using SSR codes from the Review response.

Can a booking be reissued more than once?

No — a booking that has already been reissued cannot be reissued again.

Does totalPrice include airline penalty?

Yes — the airline reissue fee (ARF) and its tax (ARFT) are already included in TF.

Processing time after Book?

New ticket issued instantly if validations pass. Status updates for old and new bookings happen immediately in TripJack; airline systems may have a short delay.

Domestic vs. international applicability?

Reissues are supported for both domestic and international, regardless of airline — subject to airline system support.

Account

### User Detail API

Returns wallet balance, credit balance, and outstanding balance for the API account.

GET`ums/v1/user-detail`

UAT: apitest.tripjack.com
Prod: tripjack.com

| Field | Type | Description |
| --- | --- | --- |
| userId | root | String |
| totalBalance | root | Number |
| walletBalance | root | Number |
| creditBalance | root | Number |
| totalOutStanding | root | Number |

Reference

### Tax Codes & Fare Components

| Code | Description |
| --- | --- |
| BF | Base Fare |
| TF | Total Fare |
| NF | Net Fare |
| TAF | Taxes and Fees |
| NCM | Net Commission (Gross − TDS) |
| MF | TripJack Management Fee |
| MFT | Management Fee Tax (GST on MF) |
| YQ | Fuel Surcharge |
| YR | Carrier Misc Fee |
| AGST | Airline GST |
| IGST | Integrated GST |
| CGST | Central GST |
| SGST | State GST |
| UGST | Union Territory GST |
| OT | Other Tax / Gross Commission |
| OB | Carrier Ticketing Fee |
| WO | Airport Tax / Airport Arrival Tax |
| UDF | User Development Fee |
| PSF | Passenger Service Fee |
| WC | Airport Arrival Tax |
| YM | Development Fee |
| OC | Other Charges |
| RCF | Travel Fee |
| BP | Baggage Price |
| MP | Meal Price |
| SP | Seat Price |
| FTC | Flex Total Charges (TJ_FLEX fare) |
| CCF | TripJack Cancellation Fee |
| CCFT | TripJack Cancellation Fee Tax |
| ACF | Airline Cancellation Fee |
| ACFT | Airline Cancellation Fee Tax |
| ARF | Airline Reschedule Fee |
| ARFT | Airline Reschedule Fee Tax |
| CRF | TripJack Reschedule Fee |
| CRFT | TripJack Reschedule Fee Tax |
| AI | Additional Incentive |
| IATA | IATA Commission |
| PLB | PLB Commission |
| BCM | Commission |
| SM | Segment Money |
| PF | Payment Fee |
| SSRP | Total SSR Price |
| XT | Additional Taxes |

Reference

### Error Codes

| Code | Message |
| --- | --- |
| 400 | Bad Request |
| 404 | Resource Not Found |
| 407 | Search not allowed with given parameters |
| 408 | Access Denied |
| 411 | Insufficient permission |
| 412 | Invalid API key |
| 802 | Account inactive |
| 805 | Invalid GSTIN (must be 15 chars) |
| 806 | Invalid Email or Mobile |
| 810 | Backend error — invalid/bad data |
| 816 | Duplicate request |
| 819 | Invalid Address |
| 1000 | Flight no longer available |
| 1001 | Infants cannot exceed adults |
| 1002 | Children cannot exceed adults |
| 1003 | Travel dates must be ascending |
| 1005 | Origin and destination cannot be same |
| 1006 | Passengers cannot exceed 9 |
| 1009 | Price IDs cannot be empty |
| 1010 | Duplicate passenger names |
| 1012 | Adult age must be 12–100 yrs at departure |
| 1013 | Child age must be 2–12 yrs |
| 1014 | Infant age must be 0–2 yrs |
| 1015 | Payment amount mismatch |
| 1051/1052/1053 | DOB required (adult/child/infant) |
| 1056 | Seat selection not applicable |
| 1057 | Booking not found |
| 1059 | Hold time limit expired |
| 1064 | Passport number required |
| 1065 | Invalid passport issue date |
| 1066 | Invalid passport expiry date |
| 1067 | Passport expires within 6 months of travel |
| 1071 | Fare no longer available |
| 2540 | Contact support for amendment charges |
| 2541 | Amendment already raised |
| 2542 | Invalid trip/passenger in amendment request |
| 2543 | Travel date has passed |
| 2544 | Amendment already raised — check status |
| 2545 | Invalid amendment type |
| 2546 | Invalid amendment ID |
| 2549 | Amendment type not passed |
| 2550 | Departure airport cannot be empty |
| 2551 | Arrival airport cannot be empty |
| 2552 | Departure date cannot be empty |
| 2553 | Amendment failed — contact support |
| 2556 | Remarks mandatory in request |
| 2560 | Emergency contact fields cannot be null |
| 2567 | Document ID not provided |
| 2568 | Document ID has special characters |
| 2569 | Senior citizen age must be >60 at departure |

Reference

### Common Object Reference

#### travellerInfo

| Field | Parent | Type | Description | M/O |
| --- | --- | --- | --- | --- |
| ti | travellerInfo | String | Title: Mr/Mrs/Ms (Adult), Ms/Master (Child/Infant) | M |
| pt | travellerInfo | String | ADULT / CHILD / INFANT | M |
| fN | travellerInfo | String | First name | M |
| lN | travellerInfo | String | Last name (lowercase L) | M |
| dob | travellerInfo | String | Date of birth YYYY-MM-DD (mandatory for INFANT) | O |
| pNum | travellerInfo | String | Passport number | O |
| eD | travellerInfo | String | Passport expiry YYYY-MM-DD | O |
| pNat | travellerInfo | String | Passport nationality (2-letter IATA country code) | O |
| pid | travellerInfo | String | Passport issue date | O |
| pan | travellerInfo | String | PAN card number | O |
| di | travellerInfo | String | Document ID (student/senior citizen) | O |
| ff[airlineCode] | travellerInfo | String | Frequent flyer number e.g. "AI": "23422" | O |
| statusMap | travellerInfo | Object | Post-amendment status: CANCELLED/VOIDED/REISSUED/NO_SHOW | O |

#### segmentInfo (sI)

| Field | Parent | Type | Description | M/O |
| --- | --- | --- | --- | --- |
| id | sI | String | Segment ID — use as key for SSR selection | O |
| fD.aI.code | fD | String | Airline IATA code | M |
| fD.fN | fD | String | Flight number | M |
| fD.eT | fD | String | Aircraft equipment type | M |
| stops | sI | Integer | Number of stops | M |
| duration | sI | Integer | Journey duration in minutes | M |
| dt | sI | String | Departure datetime YYYY-MM-DDTHH:MM | M |
| at | sI | String | Arrival datetime YYYY-MM-DDTHH:MM | M |
| da | sI | Object | Departure airport (IATA code, name, country, terminal) | M |
| aa | sI | Object | Arrival airport | M |
| so | sI | Array | Stopover airports | O |
| cT | sI | Number | Connecting time in minutes | O |
| oB | sI | Object | Operating airline (if different from marketing) | O |
| iand | sI | Boolean | Arrives next day | O |
| isRs | sI | Boolean | Is return segment | O |
| sN | sI | Integer | Segment number | M |
| ssrInfo | sI | Object | Available SSR options: BAGGAGE, MEAL, EXTRASERVICES | O |

#### ssrInfo items

| Field | Parent | Type | Description | M/O |
| --- | --- | --- | --- | --- |
| code | ssrInfo[] | String | Unique SSR code — pass in booking/SSR request | M |
| amount | ssrInfo[] | Number | Charge (absent for connecting baggage = same baggage for whole journey) | O |
| desc | ssrInfo[] | String | Customer-facing description | M |

#### gstInfo

| Field | Parent | Type | Description | M/O |
| --- | --- | --- | --- | --- |
| gstNumber | gstInfo | String | 15-digit GSTIN | M |
| registeredName | gstInfo | String | GST name (max 35 chars IATA) | M |
| email | gstInfo | String | GST email | O |
| mobile | gstInfo | String | GST mobile | O |
| address | gstInfo | String | GST address (max 70 chars IATA) | O |

#### responseStatus

| Field | Parent | Type | Description | M/O |
| --- | --- | --- | --- | --- |
| status.success | status | Boolean | true on success, false on failure | M |
| status.httpStatus | status | Integer | HTTP status code | M |

Go-Live

### UAT Certification

API partners must complete certification before receiving production access. Provide JSON request/response logs for the following test cases.

#### Required Test Cases

| # | Type | Sector | Pax | Flight Type |
| --- | --- | --- | --- | --- |
| 1 | Oneway | DEL-BOM | 1A | Direct |
| 2 | Oneway | DEL-BOM | 1A | Connecting |
| 3 | Oneway | DEL-DXB | 2A, 2C | Direct |
| 4 | Oneway | BOM-SIN | 2A, 2C | Connecting |
| 5 | Oneway | MAA-DMK | 3A, 2C | Direct |
| 6 | Oneway | DXB-BKK | 5A, 3C, 2I | Direct & Connecting |
| 7 | Dom Return | DEL-BOM | 1A | Direct & Connecting |
| 8 | Dom Return | DEL-BOM | 3A, 2C | Direct |
| 9 | Dom Return | DEL-BOM | 5A, 3C, 2I | Connecting |
| 10 | Intl Return | DEL-DXB | 2A, 2C | Direct |
| 11 | Domestic Multi-City | Any | 5A, 3C, 1I | Connecting |
| 12 | Intl Multi-City | Any | 4A, 2C, 2I | Direct & Connecting |

#### Booking Types Required

- Published Fare (Domestic + International)
- Special Return Fare
- Booking with Passport
- Booking with GST
- Booking with SSR (Baggage, Meal)
- Student / Senior Citizen fare (optional)

#### Log Format Rules

- JSON format for all request/response logs
- Separate files for each request and response
- Include API key with the logs
- No modification to response logs
- Passenger names must be real (no TBA/Test)

ℹ️

Verification turnaround time: 1–4 working days. After sign-off, point integration to production endpoints and provide your IP address ranges for whitelisting.

Reference

### API Key Configuration User Guide

#### What is it?

API Key Configuration is a feature that allows authorized users to generate and manage secure API keys. These keys are used to authenticate users in the system, enabling them to search, book, and perform other operations seamlessly.

- An API key is a unique, encrypted alphanumeric string (with special characters).
- It identifies an application or an authorized user for secure access.

#### How does it work?

This feature allows users to generate and manage their own API keys.

##### Steps to Generate or Update an API Key:

1. Login to your account.
2. Navigate to **Manage User → API Configuration** (from the left-side menu).
3. You will see the following options:
 
  - API Key
  - Whitelisted IPs
4. To generate or update:
 
  - Enter/Update the required Whitelisted IPs.
  - Click **SAVE**.
5. A confirmation popup will appear:
 
  - Select **YES** → Generate a new API key.
  - Select **NO** → Keep your existing API key unchanged and only update the IPs.

#### Whitelist IPs

- You can add multiple IP addresses (comma-separated).
- Only these IPs will be allowed to access the system using your API key.
- This ensures security by limiting API usage to authorized IPs only.

#### Important Notes

- Whenever you revisit the API Configuration page, the API Key will be masked. Copy and save it securely when you generate it the first time.
- Use Whitelist IPs to prevent your API key from being exposed to all users.
- Never share API Keys through email, SMS, or with third parties. This may compromise your system's security.

⚠️

The system does not support IPv6. Please disable IPv6 before requesting API, otherwise it may result in an **"Access Denied"** error.

Reference

### DGCA Free Look-in Policy for OTA Travel Partners

| Airline Name | OTA Look-in Window (Booking vs Cancellation Hours) | Route Applicability | Minimum Refund Travel Days Criteria | Refund Criteria |
| --- | --- | --- | --- | --- |
| IndiGo | 24 hours | Domestic and International | Domestic: 7 days; International: 15 days (Consider 08th and 16th Day respectively) | Full refund if within window; credit to original payment source For hold bookings - Look-in period is calculated from the time of PNR is created |
| Air India Express | 24 hours | Domestic and International | Domestic: 7 days; International: 15 days (Consider 08th and 16th Day respectively) | Full refund if within window; credit to original payment source For hold bookings - Look-in period is calculated from the time of PNR is created |
| Akasa Air | 48 hours | Domestic and International | Domestic: 7 days; International: 15 days (Consider 08th and 16th Day respectively) | Full refund if within window; credit to original payment source For hold bookings - Look-in period is calculated from the time of PNR is created |
| SpiceJet | 24 hours | Domestic and International | Domestic: 7 days; International: 15 days (Consider 08th and 16th Day respectively) | Full refund if within window; credit to original payment source For hold bookings - Look-in period is calculated from the time of PNR is created |
| Air India | 24 hours | Domestic | Domestic: 7 days (Consider 08th Day) | Full refund if within window; credit to original payment source For hold bookings - Look-in period is calculated from the time of PNR is created |

Reference

### Airline Automation Coverage Matrix

**CAN:** Cancellation and Refund (Normal Cancellation, Cancel under DGCA (India LCC), Void) | **CQ:** Cancellation Quotation | **RE:** Reissue (Date Change) | **RQ:** Reissue Quotation | **SSR:** Ancillary Services

| # | Airline Name | CAN | CQ | RE | RQ | SSR |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | IndiGo | ✓ | ✓ | ✓ | ✓ | ✓ |
| 2 | Air India | ✓ | ✓ | ✓ | ✓ | ✓ |
| 3 | Air India Express | ✓ | ✓ | ✓ | ✓ | ✓ |
| 4 | Akasa Air | ✓ | ✓ | ✓ | ✓ | ✓ |
| 5 | Emirates | ✓ | ✓ | ✓ | ✓ | ✓ |
| 6 | SpiceJet | ✓ | ✓ | ✓ | ✓ | ✓ |
| 7 | Etihad Airways | ✓ | ✓ | ✓ | ✓ | ✓ |
| 8 | Star Air | ✓ | ✓ | ✗ | ✗ | ✗ |
| 9 | Qatar Airways | ✓ | ✓ | ✓ | ✓ | ✓ |
| 10 | Alliance Air | ✓ | ✓ | ✗ | ✗ | ✗ |
| 11 | Malaysia Airlines | ✓ | ✓ | ✓ | ✓ | ✓ |
| 12 | Saudia | ✓ | ✓ | ✓ | ✓ | ✓ |
| 13 | Cathay Pacific | ✓ | ✓ | ✓ | ✓ | ✓ |
| 14 | Thai Airways | ✓ | ✓ | ✓ | ✓ | ✓ |
| 15 | Singapore Airlines | ✓ | ✓ | ✓ | ✓ | ✓ |
| 16 | Gulf Air | ✓ | ✓ | ✓ | ✓ | ✓ |
| 17 | Oman Air | ✓ | ✓ | ✓ | ✓ | ✓ |
| 18 | Kuwait Airways | ✓ | ✓ | ✓ | ✓ | ✓ |
| 19 | Lufthansa | ✓ | ✓ | ✓ | ✓ | ✓ |
| 20 | Virgin Atlantic | ✓ | ✓ | ✓ | ✓ | ✓ |
| 21 | British Airways | ✓ | ✓ | ✓ | ✓ | ✓ |
| 22 | SriLankan Airlines | ✓ | ✓ | ✓ | ✓ | ✓ |
| 23 | KLM Royal Dutch | ✓ | ✓ | ✓ | ✓ | ✓ |
| 24 | Ethiopian Airlines | ✓ | ✓ | ✓ | ✓ | ✓ |
| 25 | Air Canada | ✓ | ✓ | ✓ | ✓ | ✓ |
| 26 | Vietnam Airlines | ✓ | ✓ | ✓ | ✓ | ✓ |
| 27 | Turkish Airlines | ✓ | ✓ | ✓ | ✓ | ✓ |
| 28 | Air France | ✓ | ✓ | ✓ | ✓ | ✓ |
| 29 | China Eastern | ✓ | ✓ | ✓ | ✓ | ✓ |
| 30 | Azerbaijan Airlines | ✓ | ✓ | ✓ | ✓ | ✓ |
| 31 | flydubai | ✗ | ✗ | ✗ | ✗ | ✗ |
| 32 | Air Astana | ✓ | ✓ | ✓ | ✓ | ✓ |
| 33 | Finnair | ✓ | ✓ | ✓ | ✓ | ✓ |
| 34 | Air Mauritius | ✓ | ✓ | ✓ | ✓ | ✓ |
| 35 | Nepal Airlines | ✓ | ✓ | ✓ | ✓ | ✓ |
| 36 | Swiss Int'l Air Lines | ✓ | ✓ | ✓ | ✓ | ✓ |
| 37 | Qantas | ✓ | ✓ | ✓ | ✓ | ✓ |
| 38 | VietJet Air | ✗ | ✗ | ✗ | ✗ | ✗ |
| 39 | Kenya Airways | ✓ | ✓ | ✓ | ✓ | ✓ |
| 40 | LOT Polish Airlines | ✓ | ✓ | ✓ | ✓ | ✓ |
| 41 | Japan Airlines | ✓ | ✓ | ✓ | ✓ | ✓ |
| 42 | All Nippon Airways | ✓ | ✓ | ✓ | ✓ | ✓ |
| 43 | Air Arabia | ✗ | ✗ | ✗ | ✗ | ✗ |
| 44 | American Airlines | ✓ | ✓ | ✓ | ✓ | ✓ |
| 45 | Air China | ✓ | ✓ | ✓ | ✓ | ✓ |
| 46 | Intersky | ✗ | ✗ | ✗ | ✗ | ✗ |
| 47 | China Southern | ✓ | ✓ | ✓ | ✓ | ✓ |
| 48 | Scoot | ✗ | ✗ | ✗ | ✗ | ✗ |
| 49 | Thai Lion Air | ✓ | ✓ | ✓ | ✓ | ✓ |
| 50 | Thai VietJet Air | ✗ | ✗ | ✗ | ✗ | ✗ |
| 51 | AirAsia Malaysia | ✓ | ✓ | ✓ | ✓ | ✓ |
| 52 | Delta Air Lines | ✓ | ✓ | ✓ | ✓ | ✓ |
| 53 | Batik Air Malaysia | ✓ | ✓ | ✓ | ✓ | ✓ |
| 54 | Air Tanzania | ✓ | ✓ | ✓ | ✓ | ✓ |
| 55 | Flynas | ✗ | ✗ | ✗ | ✗ | ✗ |
| 56 | Royal Jordanian | ✓ | ✓ | ✓ | ✓ | ✓ |
| 57 | Biman Bangladesh | ✓ | ✓ | ✓ | ✓ | ✓ |
| 58 | United Airlines | ✓ | ✓ | ✓ | ✓ | ✓ |
| 59 | Scandinavian (SAS) | ✓ | ✓ | ✓ | ✓ | ✓ |
| 60 | Aegean Airlines | ✓ | ✓ | ✓ | ✓ | ✓ |
| 61 | Uzbekistan Airways | ✓ | ✓ | ✓ | ✓ | ✓ |
| 62 | US-Bangla Airlines | ✓ | ✓ | ✓ | ✓ | ✓ |
| 63 | EgyptAir | ✓ | ✓ | ✓ | ✓ | ✓ |
| 64 | Thai AirAsia | ✓ | ✓ | ✓ | ✓ | ✓ |
| 66 | ITA Airways | ✓ | ✓ | ✓ | ✓ | ✓ |
| 67 | Bhutan Airlines | ✓ | ✓ | ✓ | ✓ | ✓ |
| 68 | Pegasus Airlines | ✗ | ✗ | ✗ | ✗ | ✗ |
| 69 | Cambodia Angkor Air | ✗ | ✗ | ✗ | ✗ | ✗ |
| 70 | Philippine Airlines | ✓ | ✓ | ✓ | ✓ | ✓ |
| 71 | TAAG Angola | ✗ | ✗ | ✗ | ✗ | ✗ |
| 72 | Iberia | ✓ | ✓ | ✓ | ✓ | ✓ |

Reference

### Airlines and Airports List

Choose Airlines or Airports. Each view is the matching sheet from the spreadsheet.

950 airlines

| Airline Name | Airline Code |
| --- | --- |
| Air Asia Japan | DJ |
| Air Carnival | 2S |
| Air Odisha | 6X |
| Air Ventura | V1 |
| Air swift | T6 |
| Air PREMIA | YP |
| Interjet | 4O |
| AirIndia Express | I5 |
| MDLR | 9H |
| Mega Maldives | LV |
| Novo Air | VQ |
| Paramount | I7 |
| Philippines AirAsia | PQ |
| MAXjet Airways | MY |
| Spring Airlines | 9C |
| Fly91 | IC |
| AirAsia Cambodia | KT |
| Tigerair Australia | TT |
| Lanmei Airlines | LQ |
| ADC Airlines | Z7 |
| AK Avia OJSC | KD |
| APA Intl Air SA | 7P |
| ATA Aerocondor | 2B |
| AVIOMPEX | M4 |
| AZUL LINHAS AEREAS BRASILEIRAS | AD |
| Aboriginal Air Services | I8 |
| AccessRail | 9B |
| Adam Air | KI |
| Adria Airways | JP |
| Aebal | DF |
| Aer Arann Express | RE |
| Aero Asia Intl | E4 |
| Aero Benin | EM |
| Aero California | JR |
| Aero Caribe | QA |
| Cebu Pacific Air | 5J |
| Passaredo Transportes | 2Z |
| Aero-Charter | DW |
| AeroRepublica | P5 |
| Aerocontractors | AJ |
| Aerogaviota | KG |
| Aerolineas Argentinas | AR |
| Aerolitoral | 5D |
| Aeromar Airlines | BQ |
| Aeropelican | OT |
| Aeropostal Alas De Venezuela | VH |
| Aerosur | 5L |
| Aerosvit Airlines | VV |
| African Express Airways | XU |
| African Transport | ML |
| Afriqiyah Airways | 8U |
| Afrique Airlines | X5 |
| Aigle Azur | ZI |
| Air Alps Aviation | A6 |
| Air Andaman | 2Y |
| Air Astana | 4L |
| Bermudair Limited | 2T |
| Air Botswana | BP |
| Air Caledonie | TY |
| Air Calin | SB |
| Air Canada Jazz | QK |
| Air Caraibes | TX |
| Air Central | NV |
| Air Chatham | CV |
| Air City | 4F |
| Air Comet | A7 |
| Air Company SCAT | DV |
| Air Corridor | QC |
| Air Creebec | YN |
| Air Dolomiti S P A | EN |
| Air Europe SPA | PE |
| Air Finland | OF |
| Air Greenland | GL |
| Air Iceland | NY |
| Air Inuit | 3H |
| Air Italy | I9 |
| Air Ivoire | VU |
| Air Jamaica Express | J4 |
| Air Japan | NQ |
| Air Koryo | JS |
| Air Link Pty | DR |
| Air Luxor GB | L8 |
| Air Luxor STP | C2 |
| Air Malawi | QM |
| Air Malta | KM |
| Air Mandalay | 6T |
| Air Marshall Islands | CW |
| Air Midwest | ZV |
| Air Moldova | 9U |
| Air Namibia | SW |
| Eurostar | 9F |
| Aeroflot Airlines | SU |
| Aeromexico | AM |
| Air Algerie | AH |
| Air Antilles Express | 3S |
| Regional Jet | EE |
| Virgin Wings | YY |
| Air Astana | KC |
| Air Berlin | AB |
| Air Canada | AC |
| Air China | CA |
| Air Costa | LB |
| Air Europa | UX |
| AI Express | IX |
| Air India | AI |
| Air Macau | NX |
| Air Mauritius | MK |
| Air Pegasus | OP |
| Druk Air | KB |
| Air Baltic | BT |
| Bhutan Airlines | B3 |
| HUNNU AIR | MR |
| Fly Dubai | FZ |
| Air Burkina | 2J |
| IndiGo | 6E |
| JetLite | S2 |
| Med-View Airline | VL |
| EASTERN AIRLINES | 2D |
| Scoot Airlines | TZ |
| Super Air Jet | IU |
| Wow Airlines | WW |
| SpiceJet | SG |
| Zoom Air | ZO |
| JamboJet | JM |
| Scoot | TR |
| Air Nippon Network | EH |
| Air North | 4N |
| Air North Regional | TL |
| Air Nostrum | YW |
| Air One | AP |
| Air Orient | UT |
| Jet Smart | GK |
| Norse Atlantic Airways | N0 |
| Norse Atlantic UK LTD | Z0 |
| Aero Dili | 8G |
| Wizz Air Malta | W4 |
| Riyadh Air | RX |
| Air Philippines | 2P |
| Air Rarotonga | GZ |
| Air Saint-Pierre | PJ |
| Air Santo Domingo | EX |
| Air Service | X7 |
| Air Sinai | 4D |
| Air Slovakia | GM |
| Air St Thomas | ZP |
| Air Sunshine | YI |
| Air Tahiti Nui | TN |
| Air Tanzania | TC |
| Air Tindi | 8T |
| Regourd Aviation | 8R |
| Air Ukraine | 6U |
| Air Vallee | DO |
| Air Vanuatu | NF |
| Air Wales | 6G |
| Air Wisconsin | ZW |
| Air Zimbabwe | UM |
| Airblue | ED |
| Aircompany Karat | V2 |
| Aircompany Polet | YQ |
| Aires SA | 4C |
| Airlinair | A5 |
| Airlines Of South Australia | RT |
| Airlines of Carriacou | C4 |
| Airlines of Papua New Guinea | CG |
| Airlink | ND |
| Airtran Airways | FL |
| Aklak Air | 6L |
| Alaska Airlines | AS |
| Alaska Central Express | KO |
| Alaska Seaplane | J5 |
| Albarka Air | F4 |
| Alidaunia | D4 |
| Alitalia Express | XM |
| Allegiant Air | G4 |
| Alliance Airlines (Australia) | QQ |
| Alliance Airlines (Chicago) | 3A |
| Alliance Air | 9I |
| Alpi Eagles | E8 |
| Amber Air | 0A |
| America West Airlines | HP |
| American Connection | AX |
| American Eagle Air | MQ |
| Angkor Airways | G6 |
| Antrak Air | O4 |
| AIR PEACE | P4 |
| Ariana Afghan Airlines | FG |
| Arkhangelsk Airlines | 5N |
| Arkia Israeli Airlines | IZ |
| Armavia Airline | U8 |
| Armenian Intl Airways | MV |
| Artic Transportation Services | 7S |
| Aserca Airlines | R7 |
| Asian Spirit | 6K |
| Aspiring Air | OI |
| SKY ANGKOR AIRLINES | ZA |
| Atlantic Airways Faroe Islands | RC |
| Atlantic Southeast Airlines | EV |
| Atlantis European Airways | TD |
| Atlas Blue | 8A |
| Augsburg Airways | IQ |
| Aurigny Air Services | GR |
| Austral Lineas Aerea | AU |
| Aviacsa Consorcio Aviaxsa | 6A |
| Avianca Brazil | O6 |
| Aviaprad | WR |
| Aviateca | GU |
| Avies | U3 |
| Avirex Gabon | G2 |
| Avitrans Nordi | 2Q |
| BA City Flyer | CJ |
| BMED | KJ |
| Bahamasair | UP |
| Bearskin Airlines | JV |
| Belavia | B2 |
| Bellview Airlines Sierra Leone | O3 |
| Bemidji Airlines | CH |
| Benin Golf Air | A8 |
| Bering Air | 8E |
| Berjaya Air | J8 |
| Binter Canarias | NT |
| Birdy Airlinesce | 4V |
| GoJet Airlines | G7 |
| Blue Panorama Airlines | BV |
| Blue Wings | QW |
| Blue1 | KF |
| Boliviana de Aviacion | OB |
| Braathens AS | BU |
| Brit Air | DB |
| Britannia Airways | BY |
| British Airways Citiexpress | TH |
| ITA Airways | AZ |
| Buddha Airline | U4 |
| Bulgaria Air | FB |
| CCM Airlines | XK |
| EllinAir | EL |
| Air Serbia | JU |
| Air Seychelles | HM |
| Air Tahiti | VT |
| AIR CAMBODIA | K6 |
| American Airlines | AA |
| Arik Air | W3 |
| Asiana Airlines | OZ |
| Atlas Jet Intl Airways | KK |
| Austrian | OS |
| Avior Airlines | 9V |
| Azerbaijan Airlines | J2 |
| Belle Air | LZ |
| Biman Bangladesh | BG |
| British Airways | BA |
| BMI British Midland | BD |
| Brussels Airlines | SN |
| Privilege Style | P6 |
| SOL LINEAS AEREAS | FQ |
| Fiji Airways | FJ |
| Avianca | AV |
| CR Airways | N8 |
| Calm Air Intl | MO |
| Camai Air | R9 |
| Cameroon Airlines | UY |
| Canadian North | 5T |
| Cape Air | 9K |
| Cape Smythe Air | 6C |
| Centrum Air | C6 |
| Pelita Air | IP |
| Tibet Airlines | TV |
| AIR CENTURY | Y2 |
| Sun PhuQuoc Airways | 9G |
| Caribbean Airlines | BW |
| Executive Airlines | OW |
| Caribbean Sun Air | ZQ |
| Carpatair | V3 |
| Cambodia Airline | KR |
| Caspian Airlines | RV |
| Cayman Airways | KX |
| Zhejiang Loong Airlines | GJ |
| Centralwings | C0 |
| Centre-Avia Airlines | J7 |
| Chalair | M6 |
| Champion Air | MG |
| Chicago Express Airlines | C8 |
| China Express Airlines | G5 |
| Cimber Air | QI |
| Cirrus Airlines | C9 |
| City Airline | CF |
| City Jet | WX |
| City Star Airlines | X9 |
| Civil Air Transport | CT |
| Clickair | XG |
| Clubair Sixgo | 6P |
| Beijing Capital Airlines | JD |
| Colgan Air | 9L |
| Comair | OH |
| CommutAir | C5 |
| Continental Micronesia | CS |
| Conviasa | V0 |
| Corporate Express Airlines | 3C |
| Corsair Intl | SS |
| Cosmic Air | F5 |
| Costal Air Transport | DQ |
| Crossair Europe | QE |
| Cubana Airlines | CU |
| Cyprus Airways | CY |
| Czech Airlines | OK |
| DHL Intl | ES |
| DOT LT | R6 |
| Daallo Airlines | D3 |
| Daghestan Air | N2 |
| Dairo Air Services | WD |
| Dalavia Far East Airways | H8 |
| Darwin Airlines | 0D |
| Dauair | D5 |
| Denim Air | 3D |
| Deutsche Bahn | 2A |
| Dnieproavia State Aviation | Z6 |
| Domodedovo Airlines | E3 |
| Donbassaero Airlines | 7D |
| Driessen Services | Y3 |
| EUROPEAN AIR | QY |
| Eagle Aviation Uganda | H7 |
| East African Airlines | QU |
| Corendon Airlines | XE |
| East African Safari Air Express | B5 |
| East Asia Airlines | 3E |
| East Star Airlines | 8C |
| Eastern Airways | T3 |
| FLEXFLIGHT | W2 |
| Elysair | EC |
| Eos Airlines | E0 |
| Era Aviation | 7H |
| Eritrean Airlines | B8 |
| Euro- Asia Air Intl | 5B |
| Euroatlantic Airways | YU |
| Eurocypria Airlines | UI |
| Eurolot SA | K2 |
| Euromanx | 3W |
| Europe Airpost | 5O |
| European Air Express | EA |
| Everts Air | 3Z |
| Falcon Air | IH |
| Far Eastern Air Transport | EF |
| Faroe Jet | F6 |
| First Air | 7F |
| First Choice Airways | DP |
| Florida Coastal Airlines | PA |
| Florida West Intl Airways | RF |
| Fly European | E7 |
| FlyMe Sweden | SH |
| FlyNordic | LF |
| Flybaboo | F7 |
| Flybondi Airlines | FO |
| Flying Carpet Air Transport | 7Y |
| Forty Mile Air | Q5 |
| FLYPELICAN | FP |
| China Airlines | CI |
| Cathay Pacific Airways | CX |
| Compass Airlines | CP |
| China Eastern Air | MU |
| LINK AIRWAYS FLY FC | FC |
| Continental Airlines | CO |
| Copa Airlines | CM |
| Danish Air Transport | DX |
| Delta Air Lines | DL |
| DBA Luftfahrtgesellschaft | DI |
| Brightline Rail | BE |
| Egyptair | MS |
| Emirates Airlines | EK |
| Ecuatoriana | EU |
| Ethiopian Air Lines | ET |
| Etihad Airways | EY |
| EVA Airways | BR |
| Finnair | AY |
| Chautauqua Airlines | RP |
| European Executive Express | RY |
| Joon | JN |
| Frontier Flying Service | 2F |
| Futura Intl Airways | FH |
| GB Airways | GT |
| GMG Airlines | Z5 |
| Gabon Airlines | GY |
| Gazpromavia | 4G |
| Georgian Airways | A9 |
| Georgian National Airlines | QB |
| Germania Fluggesellschaft | ST |
| Ghana Intl | G0 |
| Golden Air Commuter | DC |
| Grant Aviation | GV |
| Great Lakes Airlines | ZK |
| Great Western Airlines | MT |
| Gromov Air | 3R |
| Lao Aviation | QV |
| Hageland Aviation Services | H6 |
| Hahn Air | H1 |
| Hamburg Intl | 4R |
| Hapag-Lloyd Express | X3 |
| Harbour Air (Canada) | H3 |
| Hawaiian Airlines | HA |
| Hawkair | BH |
| Heavylift Cargo Airlines | HN |
| Helgoland Airlines | LE |
| Heli Securite | H4 |
| Helijet Intl | JB |
| Helikopter Service | L5 |
| Helios Airways | ZU |
| Helvetic Airways | 2L |
| Hemus Air | DU |
| Hewa Bora Airways | EO |
| Hex Air | UD |
| Highland Airways | 8H |
| Hokkaido Intl Airlines | HD |
| Eastar Jet | ZE |
| Horizon Air - Seattle | QX |
| IBEX Airlines | FW |
| ICAR | C3 |
| Icaro | X8 |
| Icelandair | FI |
| Iliamna Air Taxi | V8 |
| Imair | IK |
| Independence AIr | DH |
| Insel Air Intl | 7I |
| Interair South Africa | D6 |
| Intl Business Airlines | 6I |
| Iran Assemam Airlines | EP |
| Island Air | WP |
| Island Airlines of Nantucket | IS |
| Islandsflug HF | HH |
| Islas Airways | IF |
| Islena Airlines | WC |
| Israir | 6H |
| Itali Airlines | 9X |
| Itek Air | GI |
| Ivoire Airways | XV |
| Ivoirienne de Transport | I3 |
| JAL Express | JC |
| JALways | JO |
| JAPAN AIR COMMUTER | 3X |
| Jamahiriya Libyan Arab Airlines | LN |
| Japan Asia Airways | EG |
| Japan Trans Ocean Air | NU |
| Jet Aviation Business Jets | PP |
| Smartlynx Airlines | 6Y |
| JetStar Pacific | BL |
| Jetlink Express | J0 |
| Job Air | 3B |
| Jubba Airways | 6J |
| Transportes Aereos Guatemaltecos | 5U |
| KEYSTONE AIR SERVICE | BZ |
| KLM Cityhopper BV | WA |
| Kavminvodyavia | KV |
| Keewatin Air | FK |
| Kenmore Air | M5 |
| Kenn Borek Air | 4K |
| Kibris Turkish | YK |
| Loganair | LM |
| Air Arabia Maroc | 3O |
| Krasnoyarsk Airlines | 7B |
| Kronflyg | K4 |
| Uganda National Airlines | UR |
| Kyrgyz Airways | KH |
| Kyrgyzstan Airlines | R8 |
| L A B Flying Service | JF |
| L Avion Elysair | A0 |
| LACSA | LR |
| LAM Lineas Aereas de Mocambique | TM |
| LGW | HE |
| LTU Billa Lufttransport | L3 |
| LTU Intl Airways | LT |
| Labrador Airways | WJ |
| Lagun Air | N7 |
| Laker Airways (Bahamas) | 7Z |
| Lan Argentina | 4M |
| Lan Chile Cargo | UC |
| Lan Ecuador Aerolane SA | XL |
| Lan Express | LU |
| Kam Air | RQ |
| Kulula com | MN |
| Germanwings | 4U |
| Gulf Air | GF |
| Hahn Air Businessline | HR |
| Hainan Airlines | HU |
| Iberia | IB |
| Hong Kong Airlines | HX |
| Iran Air | IR |
| Japan Airlines Intl | JL |
| Batik Air Indonesia | ID |
| Jet Airways | 9W |
| JetBlue Airways | B6 |
| Guangxi Beibu Gulf Airlines | GX |
| GREATER BAY AIRLINES | HB |
| Kenya Airways | KQ |
| Kingfisher | IT |
| KLM Royal Dutch Airlines | KL |
| Korean Air | KE |
| Kuwait Airways | KU |
| LOT Polish Airlines | LO |
| Harmony Airways | HQ |
| Saudi Gulf | 6S |
| Gol Transportes Aereos | G3 |
| Latam Airline | LA |
| Lan Peru SA | LP |
| Larrys Flying Service | J6 |
| Laser | 8Z |
| Laser Airlines | QL |
| Latpass Airlines | QJ |
| Lauda Air Luftfahrt | NG |
| Lauda-air SPA | L4 |
| Lithuanian Airlines | TE |
| Lucky Air | 8L |
| Lufthansa CityLine | CL |
| Luxair | LG |
| Indonesia AirAsia | QZ |
| NEOS | NO |
| Lviv Airlines | 5V |
| MIAT - Mongolian Airlines | OM |
| Macair | CC |
| Macedonian Airlines | IN |
| Mahfooz Aviation (Gambia) | M2 |
| Malev Hungarian Airlines | MA |
| Malmo Aviation | TF |
| Mandarin Airlines | AE |
| Mars RK | 6V |
| Martinair Holland | MP |
| Maya Island Air | MW |
| Mexicana De Aviacion | MX |
| Midwest Express Airlines | YX |
| Minerva Airlines | N4 |
| Mission Aviation Fellowship | FS |
| Montenergo Airlines | YM |
| Motor Sich JSC | M9 |
| US-Bangla Airlines | BS |
| MyAir com | 8I |
| Myanmar National Airlines | UB |
| Nakina Air Service | T2 |
| Nasair | UE |
| National Airways Cameroon | 9O |
| National Jet Systems | NC |
| Nationwide Air | CE |
| Nature Air | 5C |
| New England Airlines | EJ |
| Niger Air Continental | N9 |
| Nigeria Airways | WT |
| Niki Luftfahrt | HG |
| Nordeste-Linhas Aereas Regionals | JH |
| Nordic Regional | 6N |
| Nordkalottflyg | 8N |
| North American Airlines | NA |
| North Flying | M3 |
| North-Wright Air | HW |
| Northwest Seaplanes | 2G |
| Northwestern Air | J3 |
| Nouvelair Tunisie | BJ |
| Nuevo Continente SA | N6 |
| OLT Ostfriesische Luftransport | OL |
| Oasis Hong Kong Airlines | O8 |
| Ocean Airlines SPA | VC |
| Odessa Airlines | 5K |
| Olympic Airlines | OA |
| Omni | OC |
| Omskavia Airlines | N3 |
| One Ticket to the World | /K |
| Orient Thai Airlines | OX |
| Origin Pacific Airways | QO |
| Overland Airways | OJ |
| OzJet Airlines | O7 |
| PB Air | 9Q |
| PLAS SA | P8 |
| PT Mandella Airlines | RI |
| Pace Airlines | Y5 |
| Pacific Airways | 3F |
| Pacific Coastal Airlines | 8P |
| Pacific Island Aviation | 9J |
| Pacific Wings | LW |
| Palau National Airlines | 9P |
| Palestinian Airlines | PF |
| Pamir Air | NR |
| Pan Air Lineas Aereas SA | PV |
| Pan Am World Airways Dominicana | 7N |
| Panagra Airways | 7E |
| Papillon Airways | HI |
| Pelican Air | 7V |
| Pelita Air Service | 6D |
| Peninsula Airways | KS |
| Perimeter Aviation | 4B |
| Perm Airlines | P9 |
| Phuket Air | 9R |
| Pinnacle Airlines | 9E |
| Polar Air Cargo | PO |
| Polynesian Airlines | PH |
| Porter Airlines | PD |
| Portugalia | NI |
| Primaris Airlines | FE |
| Private Wings | 8W |
| ProflightCommuter Services | P0 |
| Promech | Z3 |
| Starlux Airline | JX |
| SATA AZORES AIRLINES | S4 |
| Nauru Airlines | ON |
| Malaysia Airline | MH |
| Maldivian Airlines | Q2 |
| Urumqi Airlines | UQ |
| Malta Air Charter | R5 |
| Mihin Lanka | MJ |
| Monarch Airlines | ZB |
| Myanmar Airways Intl | 8M |
| Northwest Airlines | NW |
| Philippine Airlines | PR |
| Pakistan Intl Airlines | PK |
| FASTJET ZIMBABWE | FN |
| Montair Aviation | UJ |
| Precisionair | PW |
| Mesa Airlines | YV |
| Liat Airline | LI |
| Pullmantur Air | EB |
| Quebecair Express | Q0 |
| RAS Fluggesellschaft | RW |
| Red Sea Air | 7R |
| Regional Air | RM |
| PLUS ULTRA LINEAS AEREAS | PU |
| Regional CAE | YS |
| Regional Pacific Airlines | QT |
| Rossiya- Russian Airlines | FV |
| Royal Air Force-38 Transport Group | RR |
| Royal Aruban Airlines | V5 |
| Royal Swazi National | ZC |
| Russian Sky Airlines | P7 |
| SATENA | 9N |
| SNCF | 2C |
| STA Trans African | T8 |
| TRANSAIR SENEGAL | R2 |
| ZAMBIA AIRWAYS LIMITED | ZN |
| Thai AirAsia | FD |
| IBEROJET AIRLINES | E9 |
| RYANAIR UK LTD | RK |
| IBERIA EXPRESS AIRLINE | I2 |
| MAYA ISLAND AIR | 2M |
| Play Airline | OG |
| STP Airways | 8F |
| SUPREME AIRLINES | 9Z |
| Sakhalinskie Aviatrassy | HZ |
| Salmon Air | S6 |
| Sama | ZS |
| Samara Airlines | E5 |
| San Juan Aviation | JI |
| Santa Barbara Airlines CA | S3 |
| Scenic Airlines | YR |
| ScotAirways | CB |
| Seaborne Airlines | BB |
| Servicios Aereos Profesionales | 5S |
| Severstal Aircompany | D2 |
| Shaheen Air Intl | NL |
| Siem Reap Airways Intl | FT |
| Silverjet | Y7 |
| Skagway Air Service | N5 |
| Skippers Avaition | JW |
| Jin Air | LJ |
| Sky Service | H2 |
| SkyEurope Airlines Hungary | 5P |
| Skyservice Airlines | 5G |
| Skyway Airlines | AL |
| Skyways AB | JZ |
| Skywest Airlines | OO |
| Skywest Airlines (Australia) | XR |
| Slok Air Intl | S0 |
| StarAir | S5 |
| Smokey Bay Air | 2E |
| FitsAir | 8D |
| Soder Airlines | OY |
| Solomon Airlines | IE |
| South Airlines | YG |
| Nile Air | NP |
| Southern Air Charter | PL |
| Southern Winds SA | A4 |
| Spanair | JK |
| Sterling | NB |
| Sterling Blue | DM |
| Sudan Airways | SD |
| Sun Air of Scandinavia | EZ |
| Sun Country Airlines | SY |
| Sun dOR Intl Airlines | 2U |
| Sunshine Express Airline | CQ |
| NESMA AIRLINES | NE |
| Svenska Direktflyg | HS |
| Swe Fly | WV |
| Swedline | SM |
| TCI Skyking | RU |
| Taca Intl Airlines | TA |
| Tandem Aero | TQ |
| Taquan Air Service | K3 |
| Tassili Airlines | SF |
| Tatarstan | U9 |
| AJET | VF |
| Teamline Air Luftfahrt | L9 |
| Teddy Air A/S | ZJ |
| Tibesti AirLibya | 7Q |
| Toumai Air Tchad | 9D |
| Tradewinds Airlines | WI |
| Trans Air Congo | Q8 |
| Trans Meridian Airlines | T9 |
| HARBOUR AIR LTD | YB |
| Thai Smile | WE |
| SATA Air Acores | SP |
| Skynet Airlines | SI |
| Qantas Airways | QF |
| Qatar Airways | QR |
| Hebei Airlines Co LTD | NS |
| Thai Airways Intl | TG |
| Royal Brunei Air | BI |
| Royal Jordanian | RJ |
| Royal Nepal Airlines | RA |
| Rwanda Air | WB |
| Safi Airways | 4Q |
| Saudi Arabian Airlines | SV |
| SAS Scandinavian Airlines | SK |
| Shandong Airlines | SC |
| Shanghai Airlines | FM |
| Shenzhen Airlines | ZH |
| SilkAir | MI |
| Singapore Airlines | SQ |
| Smartwings Travel Service | QS |
| South African Airways | SA |
| Southwest Airlines | WN |
| Sriwijaya Air | SJ |
| Star Up | 2I |
| Thai Lion | SL |
| Swiss | LX |
| Syrian Arab Airlines | RB |
| TAAG Angola Airlines | DT |
| Tajikair | 7J |
| TAM Linhas Aereas | JJ |
| Tarom-Romanian Air Transport | RO |
| Royal Air Maroc | AT |
| United Nigeria Airlines | UN |
| Transportes Aereos de Cabo Verde | VR |
| Transportes Aereso del Mercosur | PZ |
| Travelspan | 9T |
| Trygg-Flygg | YC |
| Tui Airlines Belgium | TB |
| Tui Airlines Nederland | OR |
| Tuninter | UG |
| Twin Jet | T7 |
| Tyrolean Airways | VO |
| UNIWAYS | 3Y |
| USA 3000 Airlines | U5 |
| UTair Aviation JSC | P2 |
| Ukrainian - Mediterranian Airlines | UF |
| Uni Airways | B7 |
| United Airways | 4H |
| Universal Airlines | UW |
| VIM Airlines | NN |
| VIP SA | V6 |
| TezJet | K9 |
| Vanair | X4 |
| Varig | RG |
| Viaggio Air | VM |
| Vieques Air Link | VI |
| TravelImpression Special | TIS |
| Thai AirAsia X | XJ |
| EURO AIRLINES | Q4 |
| Virgin Nigeria Airways | VK |
| Air Arabia | G9 |
| Vladivostok Air Russian | XF |
| Volare SPA | VE |
| Warbelows Air Ventures | 4W |
| Wayra Peru | 7W |
| Welcome Air | 2W |
| West Caribbean Air | YH |
| West Coast Air | 8O |
| Westward Airways | CN |
| Wideroes Flyveselskap | WF |
| Wind Jet | IV |
| Wings Air | IW |
| Wings of Alaska | K5 |
| Wizz Air UK | W9 |
| Wright Air Service | 8V |
| XEROX | 2X |
| XL Airways France | SE |
| Yamal Airlines | YL |
| Yangon Airways | HK |
| Yellow Air Taxi | Y0 |
| Yute Air Alaska | 4Y |
| Zambia Skyways | K8 |
| Zambian Airways | Q3 |
| Zan Air | B4 |
| Zoom Airlines | Z4 |
| Suparna Airlines | Y8 |
| US Airways | US |
| Aeromar Airlines | VW |
| Air Austral | UU |
| Croatia Airlines | OU |
| Air France | AF |
| Meridiana | IG |
| Air Madagascar | MD |
| Heli-Air Monaco | YO |
| Aero nomad | KA |
| Air Niugini | PX |
| Uzbekistan Airways | HY |
| All Nippon Airways | NH |
| Bangkok Airways | PG |
| China Southern Airlines | CZ |
| El Al Israel Airlines | LY |
| Aeroitalia | XZ |
| West Air Sweden AB | PT |
| Iraqi Airways | IA |
| Juneyao Airlines | HO |
| Senegal Airlines | DN |
| Marsland Aviation | M7 |
| Middle East Airlines | ME |
| Garuda Indonesian | GA |
| PT Indonesia AirAsia Extra | XT |
| Siberia Airlines | S7 |
| SriLankan Airlines | UL |
| Western Express Airlines | WG |
| TAP Air Portugal | TP |
| Tunis Air | TU |
| Turkmenistan Airlines | T5 |
| Ukraine Intl Airline | PS |
| United Airlines | UA |
| Ural Airlines | U6 |
| Vietnam Airlines | VN |
| Virgin America | VX |
| Virgin Atlantic | VS |
| WestJet | WS |
| Xiamen Airlines | MF |
| Yemenia Yemen Airways | IY |
| NokScoot Airlines | XW |
| Air Cote DIvoire | HF |
| Tobruk Air | 7T |
| EuroWings | E2 |
| Fly540 | 5H |
| Linear Air | O2 |
| Globus LLC | GH |
| Mahan Air | W5 |
| Tway Air | TW |
| Pan Pacific Airlines | 8Y |
| MAY Air | 7M |
| JetSmart | JA |
| JC International Airlines | QD |
| French Bee | BF |
| FlyMe | VP |
| Onur Air | 8Q |
| Blue Air | 0B |
| Tianjin Airlines | GS |
| Himalaya Airlines | H9 |
| AirLink | 4Z |
| Acvila Air | WZ |
| Volaris Air | Y4 |
| GetJet Airlines | GW |
| China United Airlines | KN |
| Chongqing Airlines | OQ |
| Star Flyer | 7G |
| Air KBZ | K7 |
| Scorpio Aviation | 8S |
| Aircompany Somon Air | SZ |
| Bek Air | Z9 |
| Vietnam Air Service Company | 0V |
| AVIANCA-Ecuador | 2K |
| Africa World Airlines Limited | AW |
| Vistara | UK |
| Windward Island Airways | WM |
| Sichuan Airlines | 3U |
| TAME Linea Aerea del Ecuador | EQ |
| Mango Airlines | JE |
| Fly Safair | FA |
| Charter Airline | 99 |
| Oman Aviation | WY |
| A.P.G. Distribution System | A1 |
| Hahn Air Technologies | X1 |
| Jazeera Airways | J9 |
| DreamJet SAS | B0 |
| Jubba Airways Ltd | 3J |
| Air Senegal | HC |
| Asky Airlines | KP |
| InterCaribbean Airways | JY |
| CemAir | 5Z |
| Mauritania Airlines | L6 |
| PAL Airlines | PB |
| Go First | G8 |
| Silver Airways | 3M |
| VG Airlines | VG |
| APG AIRLINES | GP |
| Air Arabia Abu Dhabi | 3L |
| Akasa Air | QP |
| Aer Lingus PLC | EI |
| AirAsia | AK |
| Spirit Airlines | NK |
| AirAsia X | D7 |
| Air Transat AT | TS |
| Yeti Airlines | YT |
| Casino Express Airlines | XP |
| Central Mountain Air | 9M |
| Transavia France | TO |
| Edelweiss Air | WK |
| Freedom Airlines | F8 |
| Condor Flugdienst | DE |
| Easyjet Airline | U2 |
| Eurowings AG | EW |
| Flynas Airline | XY |
| Frontier Airlines | F9 |
| GREAT WALL AIRLINES | IJ |
| Hong Kong Express Airways | UO |
| Jet2com | LS |
| K D Air | XC |
| Kish Airlines | Y9 |
| Jetstar Asia Airways | 3K |
| Jetstar Airways | JQ |
| Lion Airlines | JT |
| Lufthansa | LH |
| Firefly | FY |
| Pegasus | PC |
| Batik Air | OD |
| South East Asian Airlines | DG |
| Surinam Airways | PY |
| Regional Express | ZL |
| SunExpress | XQ |
| Transavia Airlines | HV |
| Nok Air | DD |
| World Airways | WO |
| Aegean Air | A3 |
| Air New Zealand | NZ |
| Norwegian Air Shuttle | DY |
| RyanAir (Ireland) | FR |
| Turkish Airlines | TK |
| V Australia | VA |
| Vueling Airlines | VY |
| SafariLink | F2 |
| Salam Air | OV |
| Air Seoul | RS |
| Flyadeal | F3 |
| Sky Express Airlines | GQ |
| Jeju Air | 7C |
| Bamboo Airways | QH |
| Volotea | V7 |
| World Ticket Ltd | W1 |
| Viva Aerobus | VB |
| Flybig | S9 |
| Corendon Dutch Airlines | CD |
| Vietjet Airlines | VJ |
| Citilink Indonesia | QG |
| 9 Air | AQ |
| Norwegian Air Sweden | D8 |
| FLY ONE S.R.L | 5F |
| Wizz Air | W6 |
| CHAM WINGS AIRLINES | 6Q |
| TRANSNUSA | 8B |
| LIFT | GE |
| AIR BUSAN | BX |
| Thai Vietjet Air | VZ |
| ZIPAIR TOKYO | ZG |
| Wizz Air Abu Dhabi | 5W |
| Peach Aviation Limited | MM |
| PHILIPPINES AIRASIA INC | Z2 |

Reference

### PAN_Handling_in_Air_Booking_Flow

#### Overview

For certain air bookings, providing a valid Permanent Account Number (PAN) is mandatory. PAN applicability is communicated during the review stage and must be honored during Hold or Book requests.

#### PAN Applicability Indicator

The Air Review API response includes a boolean field named `ipa` that indicates whether PAN is required.

| Field | Type | Description |
| --- | --- | --- |
| ipa | boolean | Indicates if PAN is mandatory for the booking |

Values: true → PAN required, false → PAN not required

#### Instant Booking Flow (Air Book API)

When `ipa` is true, a valid PAN must be provided in the Air Book request payload.

| Field | Type | Mandatory | Description |
| --- | --- | --- | --- |
| pan | string | Yes (if ipa = true) | Valid Indian PAN |

Example: `"pan": "XSDTW6829M"`

#### Hold Booking Flow (Hold API)

When `ipa` is true, a valid PAN must be provided in the Hold API request payload.

| Field | Type | Mandatory | Description |
| --- | --- | --- | --- |
| pan | string | Yes (if ipa = true) | Valid Indian PAN |

Example: `"pan": "XSDTW6829M"`

#### PAN Validation Behavior

If PAN validation fails, the booking is moved to a Pending state. No explicit error message is returned in the API response under the current flow.

#### Passenger Data Applicability

Passenger information, including PAN, follows the same structure for one-way, return, and multi-city bookings. The sample payloads are applicable across all journey types.

Reference

### Flights_2D_Barcode_User_Guide

#### Objective

The Ministry of Civil Aviation has mandated airlines to issue air tickets with barcodes to quicken the flow of passengers at airport entry gates. Tripjack has implemented a 2D barcode on flight tickets.

API partners must include a barcode of the booking reference in every customer itinerary.

#### Instructions to Generate Bar Code on Itinerary

- The suggested text should be “Your Airlines Reference:” followed by the code.
- Keep a 10 pixel margin at the top and at the right so codes do not overflow the page.
- The gap between two barcodes should be 50 pixels.
- A barcode is not required for an infant.
- Generate a barcode journey-wise for each individual passenger.

Sample itinerary:

#### Syntax

Barcode string

```
<Format Code><Number of Legs Encoded><Passenger Name><Electronic Ticket Indicator><Operating carrier PNR Code><From City Airport Code><To City Airport Code><Operating carrier Designator><Flight Number><Date of Flight (Julian Date)><Compartment Code><Seat Number><Check-in Sequence Number><Passenger Status><Field Size of variable>
```

Example: `M1SRIVASTAVA/PANKAJ ABC123 DELBOM6E 0112 226Y00000000 000`

#### Field Details

| Element | Size | Unique / Repeated | Remarks |
| --- | --- | --- | --- |
| Format Code | 1 | Unique | Default → M |
| Number of Legs Encoded | 1 | Unique | Default → 1 |
| Passenger Name | 20 | Unique | Syntax: <Last Name>/<FirstName><MiddleName>. Trimmed to 20 characters if longer. Right-padded with spaces if shorter than 20. |
| Electronic Ticket Indicator | 1 | Unique | Use a blank space. |
| Operating carrier PNR Code | 7 | Repeated | Must be 7 characters. Right-pad with spaces if shorter. Example: ABCDEF as “ABCDEF ”. |
| From City Airport Code | 3 | Repeated | Departure station code. |
| To City Airport Code | 3 | Repeated | Arrival station code. |
| Operating carrier Designator | 3 | Repeated | Example: “6E ”, “G8”. Must be 3 characters. Right-pad with a space if shorter. |
| Flight Number | 5 | Repeated | Must be 5 characters. Right-pad with a space if shorter. Examples: 1 → “0001 ”, 11 → “0011 ”, 111 → “0111 ”, 1111 → “1111 ”, 11111 → “11111”. |
| Date of Flight (Julian Date) | 3 | Repeated | Convert the travel date to a Julian date and use the last 3 digits. For 01-May-23 the Julian date is 23121, so the value is 121. [Julian date converter](http://www.longpelaexpertise.com/toolsJulian.php) |
| Compartment Code | 1 | Repeated | Default → Y |
| Seat Number | 4 | Repeated | Default → “0000” |
| Check-in Sequence Number | 5 | Repeated | Default → “00000” |
| Passenger Status | 1 | Repeated | Default → 0 |
| Field Size of variable | 2 | Repeated | Default → 00 |

#### Journey-wise Barcodes

Mr. A and Mr. B book a return flight DEL–BOM–DEL, onward on 9 Feb and return on 12 Feb. The ticket needs four barcodes:

1. Mr. A for DEL–BOM
2. Mr. B for DEL–BOM
3. Mr. A for BOM–DEL
4. Mr. B for BOM–DEL

Reference

### Corporate_Codes_Api_Contract

#### Purpose

Allow clients to send PCC + airline + corporateCode mapping in the search request to fetch corporate or negotiated fares from supported suppliers.

#### Request Contract

Relevant part of the search request:

JSON

```
{
  "searchQuery": {
    "cabinClass": "ECONOMY",
    "preferredAirline": [],
    "searchModifiers": {
      "pfts": ["REGULAR"],
      "isDirectFlight": false,
      "isConnectingFlight": false
    },
    "routeInfos": [
      {
        "fromCityOrAirport": { "code": "DEL" },
        "toCityOrAirport": { "code": "DXB" },
        "travelDate": "2026-04-20"
      }
    ],
    "paxInfo": {
      "ADULT": 1,
      "CHILD": 0,
      "INFANT": 0
    },
    "corporateCodes": [
      {
        "pcc": "517Z",
        "airlineKeys": [
          {
            "airline": "AI",
            "corporateCode": "SME"
          }
        ]
      }
    ]
  }
}
```

#### Field Definitions

`corporateCodes` (optional): list of PCC mappings used to fetch corporate fares.

| Field | Type | Mandatory | Description |
| --- | --- | --- | --- |
| pcc | String | Yes | Pseudo City Code |
| airlineKeys | Array | Yes | Airline-specific mappings |
| airline | String | Yes | Airline code (for example AI, EK) |
| corporateCode | String | Yes | Corporate fare code |

#### Processing Logic

**Step 1: Validation.** Ignore an entry if `pcc` is invalid, the airline is not supported, or `corporateCode` is empty.

**Step 2: Mapping creation.** (PCC, Airline) → CorporateCode

#### Response Behavior

- If corporate fares are found → return them along with regular fares.
- If not → fall back to regular fares.
- No hard failure for an invalid corporate mapping.

#### Business Rules

- Multiple PCCs are supported.
- Multiple airlines per PCC are supported.
- Corporate codes are airline-specific.
- Duplicate mappings are deduplicated internally.
- A corporate fare is not guaranteed to be returned.

#### Edge Handling

| Case | Behavior |
| --- | --- |
| Invalid PCC | Ignored |
| Unsupported airline | Skipped |
| Invalid corporate code | Ignored |
| No corporate fares | Return regular fares |

Reference

### FAQ

How do I pass the API key?

Pass it as the `apikey` header on every request. It is never sent in the body.

How long are Search priceIds valid?

15 minutes from the time of the search response.

How many passengers can I search with?

Minimum 1 adult. Sum of adults + children ≤ 9. Number of infants ≤ number of adults.

How many priceIds does Review need?

Oneway / International Return / Intl Multi-City: 1. Domestic Return: 2 (one ONWARD, one RETURN). Domestic Multi-City: N (one per leg, max 6).

When should I call the Seat Map API?

Only when `conditions.isa = true` in the Review response. Not all flights support seat selection.

Is GST mandatory for all bookings?

No — it depends on the supplier. If `igm = true` in Review conditions, GST is mandatory. If `gstappl = true` but `igm = false`, it's optional.

Do I need to validate fare before booking?

No — fare validation is optional. Fare changes are surfaced as `alerts` in the Review response. For Hold bookings, you must call fare-validate before confirm-book.

Can we retry the /oms/v1/air/book/fare-validate API before proceeding with the Air Book API call?

No. Retrying the Fare Validate API is not supported. If the API returns an error, do not retry the request. Handle the response according to the error received and proceed only after successful fare validation.

Will TripJack send SMS/email to the booking contact?

No. TripJack sends notifications to the API partner only, not to the end-passenger contact provided in the booking request.

Can I pass frequent flyer numbers?

Yes — under `travellerInfo[].ff` as `"AirlineCode": "ffNumber"` e.g. `"AI": "23422"`.

What cabin classes are available?

ECONOMY, PREMIUM_ECONOMY, BUSINESS, FIRST. If ECONOMY is requested, results include all cabin classes. If BUSINESS, results include BUSINESS and FIRST.

Is SSR supported for all airlines?

SSR is supported only for LCC (Low Cost Carriers). GDS bookings do not support SSR. Supported types: BAGGAGE, MEAL, SEAT.

What SSR types are supported?

BAGGAGE (per trip), MEAL (per segment, once per pax per segment), SEAT (per segment, once per pax per segment). Infants cannot add SSR.

Is duplicate booking allowed?

No — same itinerary with same passenger names from the same agent is rejected with error 816.

What currency does TripJack support?

INR only for the Air API.

How do I identify connecting flights?

Check `sI[].stops` (number of stops) and `sI[].so` (stopover airport information).

What is the refundable type (rT) field?

0 = Non-Refundable, 1 = Refundable, 2 = Partial Refundable. Found under totalPriceList in Search and Review.

How do I identify student / senior citizen fares?

Set `pfts` to STUDENT or SENIOR_CITIZEN in searchModifiers. Only applicable for ADULT pax type. Senior citizen minimum age: 60 yrs. Student minimum age: 12 yrs.
