# TripJack TripSafe API: knowledge base

| | |
| --- | --- |
| **Source** | https://tripjack.com/page/api-doc (the "TripSafe API v2.0" tab) |
| **Version documented** | v2.0 |
| **Captured** | 2026-10-19: re-capture when TripJack changes the page |
| **Scope** | Everything on the page for this product, in full (Part 2), with a verified summary (Part 1) |
| **Secrets** | No API key appears in this file. Keys go in the environment (`TRIPJACK_API_KEY`), never in the repo. |

TripJack's page has three products, each in its own file here: `hotel.md`, `flight.md`, `tripsafe.md`.
An older "Api Doc 2.0" page also exists at https://tripjack.com/page/api-doc-v2 (not captured).

---

# Part 1: Quick reference

## What it is
TripSafe API **v2.0**: TripJack's **travel insurance** for international and domestic trips. Three journeys:
**Standalone** (independent of any flight or hotel booking), **Student** plans (long study stays) and **AMT (Annual Multi-Trip)** cover
(unlimited trips for a year, each covered up to 30, 45, 60 or 90 days).

## Hosts
UAT `https://apitest.tripjack.com` · Production `https://tripjack.com` · base path `/insurance/v2`. **No trailing slash.**

## Authentication, keys, IPs
- Header `apikey: <key>`. Missing or invalid gives `401`, returned as a **raw JSON error object, not the standard envelope**.
- Generate the key under **Manage User, then User Detail, then API Configuration**: add a valid **IPv4** address and a contact email under "Whitelist IPs", then pick the APIs you need and Save. **IPv6 is not supported.** Contact support for production access.

## The booking flow (3 steps)
1. **Search** `POST /insurance/v2/search`: returns a `searchId` and one `productId` per plan option.
2. **Create Booking** `POST /insurance/v2/booking`: needs `searchId` + `productId`; returns a `bookingId` and a status.
3. **Get Booking Detail** `GET /insurance/v2/booking/{bookingId}`: the policy ID per traveller, certificate-of-insurance (COI) links and the full status.
Payment: if `paymentOptions.paymentMedium` is `WALLET` or `CREDIT_LINE` (with a valid `payUserId`) and the balance is enough, payment is taken inline and the booking is `SUCCESS`.
Otherwise the booking is still created but left **`PAYMENT_PENDING`**: settle payment separately, then call Get Booking Detail.

## Every endpoint
| Operation | Method and path |
| --- | --- |
| Search plans | POST `/insurance/v2/search` |
| Create booking | POST `/insurance/v2/booking` |
| Get booking detail | GET `/insurance/v2/booking/{bookingId}` |
| Raise amendment (cancellation or correction) | POST `/insurance/v2/amendment/raise` |
| Confirm amendment | POST `/insurance/v2/amendment/confirm` |

## Search
| Field | Meaning |
| --- | --- |
| `startDate`, `endDate` | `yyyy-MM-dd`; start today or later; end derived if `coverageDuration` is given |
| `travellerDobs` | One date of birth per traveller, 1 to 10 |
| `destinations[]` | `key` (ISO country code, or a region code like `EUR`, `SCH`, `ASI`) and `type` COUNTRY / REGION / POPULARREGION |
| `planType` | Omit for regular; `STUDENT`; `AMT` |
| `journeyType` | DOMESTIC / INTERNATIONAL / ALL (derived: DOMESTIC if any destination is `IN`) |
| `coverageDuration` | Days; required for AMT (30, 45, 60, 90) |
| `funnelType` | STANDALONE (default), EMBEDDED, STUDENT, AMT, API_EMB |
| `searchId` | Reuse a search context to refine |

Cross-field rules: **Student** trips must be 30, 60, 90, 120, 180, 240, 270, 365 or 730 days. **AMT** trips must be exactly 365 days. **Domestic** trips are capped at 30 days.
The country and region catalogue (`rkey` column maps to `destinations[].key`) is **available on request**, along with a Postman collection.

## Validation rules and limits
- No searches for travellers **over 70**. Blocked countries: **Myanmar (MM), Iran (IR), North Korea (NK)**. At most **10 travellers** per search.
- A policy can be **cancelled up to 24 hours before the coverage start date**.
- Plan id and product id must stay identical between Search and Booking (`Invalid productId` otherwise); the **traveller count at Booking must equal the one at Search** (error **1134**).
- **Rate limit 40 requests per minute.** Uptime target 99.9%. Timeouts: 60 s for insurance APIs.
- Response targets: Search under 200 ms, Review under 500 ms, Booking under 1 s, Booking Details under 700 ms, Amendment and Cancellation under 1 s.

## Amendments (after issue)
Three steps: **Raise Amendment** (`bookingId`; for a correction pass `insuranceUpdateRequest.amendedTravellerInfos` with the traveller id and only the fields to change; returns `amendmentId` and `amount`, commits nothing),
then **Confirm Amendment** with the `amendmentId` (commits it), then read the status with Get Booking Detail.
Types are cancellation and correction. Enumerations (`amendmentType`, `amendmentStatus`, booking statuses) are listed in Part 2.

## Going live (certification)
Provide JSON request and response for every method you implement, with confirmation numbers per test case (the UAT test cases are listed in Part 2).
Logs must be unmodified JSON, one file per request and response, with the API key, and **real traveller names** ("TBA" or "Test" cannot be certified).
Verification takes about **1 to 2 working days**; then TripJack signs off and gives live access.

## Pitfalls and inconsistencies we noticed
- The validation list says "coverage duration must not exceed 90 days", but Student plans need 365 or 730 day trips and AMT needs exactly 365: confirm the real limits for those journeys.
- Auth failures use a different JSON shape from every other response: handle both.
- A booking can come back `PAYMENT_PENDING` even though it was created: do not treat that as a failure, and do not create it twice.


## Links on the page
- Postman collection (TripSafe sample collection): https://documenter.getpostman.com/view/4351557/2sBYAyup83


---

# Part 2: Full reference, as published

The text below is TripJack's page for this product, converted to markdown with its tables and code
samples intact. Diagrams are reduced to their labels. Where it disagrees with Part 1's
"Pitfalls", the pitfalls are things we noticed while reading, not TripJack's wording.

TripSafe API v2.0 · REST · JSON · HTTPS

## TripSafe API v2.0

TripSafe is TripJack's travel insurance product, applicable for both **international** and **domestic** trips. Through the API, clients can offer it across three journeys: as a **Standalone** purchase, independent of any TripJack booking; as **Student** plans tailored for students travelling abroad for longer-duration education; and as **AMT (Annual Multi-Trip)** cover, giving travellers unlimited trips over a year with each trip covered up to a chosen maximum duration of 30, 45, 60, or 90 days.

UAT Baseapitest.tripjack.com

Prod Basetripjack.com

Base Path/insurance/v2

ProtocolHTTPS · REST · JSON

Security

### Authentication

Every request must carry the `apikey` header. If it is missing or invalid, the API returns `401 Unauthorized`.

| Header | Type | Description |
| --- | --- | --- |
| apikey | String | Static partner API key. |

HTTP · Request Header

```
apikey: <your-partner-api-key>
```

⚠️

Auth failures (missing/invalid credentials) return a **raw JSON error object**, not the standard envelope — see the Authentication error shape in Error Handling.

Reference

### Service URLs

[TripSafe Sample Collection
 View Postman Collection
 
 
 Open →](https://documenter.getpostman.com/view/4351557/2sBYAyup83)

⚠️

Endpoints must **not** end with a trailing slash — this causes an error.

#### UAT Environment (apitest.tripjack.com)

| Service | URL |
| --- | --- |
| Search Insurance Plans | `https://apitest.tripjack.com/insurance/v2/search` |
| Create Booking | `https://apitest.tripjack.com/insurance/v2/booking` |
| Get Booking Detail | `https://apitest.tripjack.com/insurance/v2/booking/{bookingId}` |
| Raise Amendment (Cancellation / Correction) | `https://apitest.tripjack.com/insurance/v2/amendment/raise` |
| Confirm Amendment (Cancellation / Correction) | `https://apitest.tripjack.com/insurance/v2/amendment/confirm` |

#### Production Environment (.tripjack.com)

| Service | URL |
| --- | --- |
| Search Insurance Plans | `https://tripjack.com/insurance/v2/search` |
| Create Booking | `https://tripjack.com/insurance/v2/booking` |
| Get Booking Detail | `https://tripjack.com/insurance/v2/booking/{bookingId}` |
| Raise Amendment (Cancellation / Correction) | `https://tripjack.com/insurance/v2/amendment/raise` |
| Confirm Amendment (Cancellation / Correction) | `https://tripjack.com/insurance/v2/amendment/confirm` |

ℹ️

A Postman collection and the country-code catalogue (for region mapping) are available on request.

- The country/region mapping catalogue's `rkey` column maps directly to the `key` field sent in `destinations[].key`.
- `destinations[].type` is `"COUNTRY"` or `"REGION"` — for `"REGION"`, use a region code such as `EUR`, `SCH`, or `ASI` from the catalogue, not a country code.

Getting Started

### API Key & IP Whitelisting

Follow these steps to whitelist your IP and retrieve your API key before making any TripSafe calls.

1. Navigate to **Manage User → User Detail** for the user id you want to create a key for, then open **API Configuration** from the left nav.
2. Under **Whitelist IPs — For Portal**, provide a valid IPv4 address and a contact email, then click **Update**.
3. Under **API Key**, select the APIs you intend to use from the available list and click **Save**. A new API key is generated automatically once this completes.

⚠️

IPv6 addresses are not supported. Provide an IPv4 address only, and contact support to request production access.

Getting Started

### Booking Flow

Every TripSafe booking follows this three-step sequence. The `searchId` + `productId` from Step 1 are required in Step 2. The `bookingId` from Step 2 is required in Step 3.

Step 1

POST

Search

Returns searchId + one productId per plan option

Step 2

POST

Create Booking

bookingId is generated, along with status (SUCCESS or PAYMENT_PENDING depending on paymentOptions)

Step 3

GET

Get Booking Detail

TripSafe Policy ID is generated for each traveller, along with COI links and full booking status

ℹ️

If `paymentOptions.paymentMedium` is `WALLET` or `CREDIT_LINE` (with a valid `payUserId`) and the wallet has sufficient balance, payment is collected inline and the booking comes back with `status: SUCCESS`. Otherwise — `paymentOptions` omitted, or WALLET with insufficient balance — the booking is still created but left `PAYMENT_PENDING`; settle payment separately, then call Get Booking Detail to confirm it went through.

#### Amendment Flow (Cancellation / Correction)

Post-issue changes — cancelling travellers or correcting details — follow this three-step sequence. The `amendmentId` from Step 1 is required in Step 2.

Step 1

POST

Raise Amendment

Pass the bookingId for which you wish the changes to be processed. For a correction, pass insuranceUpdateRequest.amendedTravellerInfos with the traveller's id and only the keys you wish to modify. Returns amendmentId + amount, without committing anything.

Step 2

POST

Confirm Amendment

Pass the amendmentId received in Step 1 to execute the priced change.

Step 3

GET

Get Booking Detail

If you want the final state of the bookingId/policyId, fetch Get Booking Detail again with the bookingId for which the amendment was performed.

ℹ️

For CANCELLATION and financial CORRECTION (DOB, trip dates), the `amount` quoted by Raise is refunded/charged on Confirm — pass `paymentRequests[]` for a financial correction. Non-financial corrections (Name, Nominee, Passport, Gender) quote `amount: 0` and need no payment on Confirm.

Insurance APIs

### Search Insurance Plans

Searches for available travel-insurance plans for a given trip — destinations, travel dates, and traveller DOBs — and returns priced, ranked plan options.

POST`insurance/v2/search`

UAT: apitest.tripjack.com
Prod: tripjack.com

#### Plan & Journey Types

| Type | Request Field | Notes |
| --- | --- | --- |
| **Standalone** | planType not to be specified | Regular one-off trip cover, independent of any TripJack booking. funnelType defaults to STANDALONE. |
| **Student Journey** | planType: STUDENT | Tailored for students travelling abroad for longer-duration education. Requires trip duration of 30/60/90/120/180/240/270/365/730 days. |
| **Annual Multi-Trip** | planType: AMT | Unlimited trips over a year, each covered up to a chosen coverageDuration (30/45/60/90 days). Requires trip duration of exactly 365 days. |
| **Domestic Plan** | journeyType: DOMESTIC | For trips within India. Coverage capped at 30 days. |

#### Request Fields

| Field | Type | Description | M/O |
| --- | --- | --- | --- |
| startDate | String (yyyy-MM-dd) | Trip start date. Must be today or a future date. | M |
| endDate | String (yyyy-MM-dd) | Trip end date. Required unless coverageDuration is supplied, from which it's derived. Must be on/after startDate. | C |
| travellerDobs | Array<String> | One DOB per traveller, 1–10 entries. | M |
| destinations | Array<Object> | One or more travel destinations. | M |
| destinations[].key | String | Destination identifier — ISO country code (e.g. "IN", "US") when type=COUNTRY, or a region code (e.g. "EUR", "SCH", "ASI") when type=REGION. | M |
| destinations[].type | String | "COUNTRY", "REGION", or "POPULARREGION" (curated multi-region groupings, e.g. "EUR", "SCH", "USC", "ASI" — used for AMT plans). | M |
| planType | String | regular (default), STUDENT, AMT. Case-insensitive. | O |
| journeyType | String | DOMESTIC, INTERNATIONAL, or ALL. Auto-derived from destinations when omitted (DOMESTIC if any destination key is "IN", else INTERNATIONAL). | O |
| searchId | String | Reuse an existing search context, e.g. for a repriced/refined search. | O |
| coverageDuration | Integer | Number of coverage days. Required when funnelType is AMT, and required if endDate is omitted. For AMT plans must be one of 30, 45, 60, 90. | C |
| funnelType | String (enum) | STANDALONE (default), EMBEDDED, STUDENT, AMT, API_EMB. | O |

⚠️

**Cross-field rules:** STUDENT plans require trip duration of 30/60/90/120/180/240/270/365/730 days. DOMESTIC journeys cannot exceed 30 days. AMT requires trip duration of exactly 365 days with coverageDuration one of 30/45/60/90.

JSON · Sample Request

```
{
  "startDate": "2026-08-10",
  "endDate": "2026-08-20",
  "travellerDobs": ["1990-05-14", "1988-11-02"],
  "destinations": [
    { "key": "US", "type": "COUNTRY" }
  ],
  "planType": "regular",
  "funnelType": "STANDALONE"
}
```

##### SEARCH :- DOMESTIC PLAN SAMPLE REQUEST

JSON · Sample Request

```
{
    "startDate": "{{StartDate}}",
    "endDate": "{{EndDate}}",
    "travellerDobs": [
        "{{DOB}}"
    ],
    "destinations": [
        {
            "key": "IN",
            "type": "COUNTRY"
        }
    ],
    "journeyType": "DOMESTIC"
}
```

Response remains the same shape as above.

##### SEARCH :- STUDENT PLAN SAMPLE REQUEST

JSON · Sample Request

```
{
    "startDate": "2026-08-29",
    "travellerDobs": [
        "1990-01-01"
    ],
    "destinations": [
        {
            "key": "US",
            "type": "COUNTRY"
        }
    ],
    "coverageDuration": 180,
    "planType": "STUDENT"
}
```

Response remains the same shape as above.

##### SEARCH :- AMT PLAN SAMPLE REQUEST

ℹ️

AMT plans don't require `endDate` — the trip duration is derived entirely from `coverageDuration`.

JSON · Sample Request

```
{
    "startDate": "2026-09-08",
    "travellerDobs": [
        "2022-01-01"
    ],
    "destinations": [
        {
            "key": "EUR",
            "type": "POPULARREGION"
        },
        {
            "key": "SCH",
            "type": "POPULARREGION"
        },
        {
            "key": "USC",
            "type": "POPULARREGION"
        },
        {
            "key": "ASI",
            "type": "POPULARREGION"
        }
    ],
    "coverageDuration": 45,
    "planType": "AMT"
}
```

Response remains the same shape as above.

#### Response Fields — data

| Field | Type | Description |
| --- | --- | --- |
| searchId | String | Identifier for this search context. Pass to the Booking API. Cached server-side with a limited validity window. |
| productInfo[] | Array<Object> | List of available plan options — see below. |

#### productInfo[] Object

| Field | Type | Description |
| --- | --- | --- |
| productId | String | Unique identifier of the plan. Pass to the Booking API to select this plan. |
| planCoverage | String | Sum insured for the plan, e.g. "$50,000". |
| insuranceProvider | String | Underwriting insurer name, e.g. ABHI. |
| assistanceProviders | Array<String> | Third-party travel-assistance providers bundled with the plan (e.g. AAI, BOXX) — depends on the specific plan. |
| regionName | String | Human-readable region/coverage area name, e.g. INDIA. |
| planType | String (enum) | REGULAR, STUDENT, or AMT. |
| fareDetails | Object | { totalFare, agentCommission } for the whole trip, across all travellers. |
| productBenefits[] | Array<Object> | { name, type, visibility, iconCategory, benefitProvider, description }. type is INSURANCE_BENEFIT or ASSISTANCE_BENEFIT; visibility is BANNER (headline callouts) or POPUP (full benefit detail). |
| paxFareDetails[] | Array<Object> | { age, insuranceFareComponents } — per-traveller fare breakdown, keyed by the abbreviated codes in the Glossary. |

ℹ️

Assistance providers (e.g. **AAI**, **BOXX**) depend on the plan — verify which one(s) apply from the `productBenefits` section of the Search response.

JSON · Sample Response

```
{
    "success": true,
    "data": {
        "searchId": "isid9364865595",
        "productInfo": [
            {
                "productId": "ABHI-PLAN_50_DOM-IN-AAI_DOM",
                "planCoverage": "$50,000",
                "insuranceProvider": "ABHI",
                "assistanceProviders": [
                    "AAI DOM"
                ],
                "regionName": "INDIA",
                "planType": "REGULAR",
                "fareDetails": {
                    "totalFare": 118.0,
                    "agentCommission": 0.0
                },
                "productBenefits": [
                    {
                        "name": "$50k Emergency Medical Expenses",
                        "type": "INSURANCE_BENEFIT",
                        "visibility": "BANNER",
                        "benefitProvider": "ABHI"
                    },
                    {
                        "name": "$2,500 Personal Accident cover",
                        "type": "INSURANCE_BENEFIT",
                        "visibility": "BANNER",
                        "benefitProvider": "ABHI"
                    },
                    {
                        "name": "Emergency Medical Expenses",
                        "type": "INSURANCE_BENEFIT",
                        "visibility": "POPUP",
                        "iconCategory": "Medical Covers",
                        "benefitProvider": "ABHI",
                        "description": "For availing immediate emergency medical assistance required on account of any illness/injury sustained or contracted whilst on a trip. (Deductible $100)"
                    },
                    {
                        "name": "Outpatient Care",
                        "type": "INSURANCE_BENEFIT",
                        "visibility": "POPUP",
                        "iconCategory": "Medical Covers",
                        "benefitProvider": "ABHI",
                        "description": "For availing outpatient treatment required on account of any illness/injury sustained or contracted whilst on a trip. (Deductible $100)"
                    },
                    {
                        "name": "Medical Evacuation",
                        "type": "INSURANCE_BENEFIT",
                        "visibility": "POPUP",
                        "iconCategory": "Medical Covers",
                        "benefitProvider": "ABHI",
                        "description": "For the additional costs of medically prescribed transportation/evacuation from the location of the incident to the original place of residence or the nearest hospital. (Deductible $100)"
                    },
                    {
                        "name": "Repatriation of Mortal Remains",
                        "type": "INSURANCE_BENEFIT",
                        "visibility": "POPUP",
                        "iconCategory": "Medical Covers",
                        "benefitProvider": "ABHI",
                        "description": "For the costs of transporting the mortal remains of the insured back to the original place of residence."
                    },
                    {
                        "name": "Personal Accident",
                        "type": "INSURANCE_BENEFIT",
                        "visibility": "POPUP",
                        "iconCategory": "Medical Covers",
                        "benefitProvider": "ABHI",
                        "description": "For accidental body injury or death during the trip which requires urgent and immediate medical attention."
                    },
                    {
                        "name": "Loss of Checked in Baggage",
                        "type": "INSURANCE_BENEFIT",
                        "visibility": "POPUP",
                        "iconCategory": "Baggage Covers",
                        "benefitProvider": "ABHI",
                        "description": "For the total loss of checked-in baggage on a trip. (Deductible $100)"
                    },
                    {
                        "name": "Delay of Checked in baggage",
                        "type": "INSURANCE_BENEFIT",
                        "visibility": "POPUP",
                        "iconCategory": "Baggage Covers",
                        "benefitProvider": "ABHI",
                        "description": "If checked-in baggage is delayed by more than 6 hours from the expected time of delivery, by the airline."
                    },
                    {
                        "name": "Trip Cancellation / Interruption / Curtailment",
                        "type": "INSURANCE_BENEFIT",
                        "visibility": "POPUP",
                        "iconCategory": "Travel Covers",
                        "benefitProvider": "ABHI",
                        "description": "If the flight is cancelled before scheduled departure date or interrupted due to reasons mentioned in the Terms & Conditions. (Deductible $100)"
                    },
                    {
                        "name": "Emergency Medical Expenses",
                        "type": "ASSISTANCE_BENEFIT",
                        "visibility": "POPUP",
                        "iconCategory": "Medical Covers",
                        "benefitProvider": "AAI_DOM",
                        "description": "For availing immediate emergency medical assistance required on account of any illness/injury sustained or contracted whilst on a trip. (Deductible $100)"
                    },
                    {
                        "name": "Outpatient Care",
                        "type": "ASSISTANCE_BENEFIT",
                        "visibility": "POPUP",
                        "iconCategory": "Medical Covers",
                        "benefitProvider": "AAI_DOM",
                        "description": "For availing outpatient treatment required on account of any illness/injury sustained or contracted whilst on a trip. (Deductible $100)"
                    },
                    {
                        "name": "Medical Evacuation",
                        "type": "ASSISTANCE_BENEFIT",
                        "visibility": "POPUP",
                        "iconCategory": "Medical Covers",
                        "benefitProvider": "AAI_DOM",
                        "description": "For the additional costs of medically prescribed transportation/evacuation from the location of the incident to the original place of residence or the nearest hospital. (Deductible $100)"
                    },
                    {
                        "name": "Repatriation of Mortal Remains",
                        "type": "ASSISTANCE_BENEFIT",
                        "visibility": "POPUP",
                        "iconCategory": "Medical Covers",
                        "benefitProvider": "AAI_DOM",
                        "description": "For the costs of transporting the mortal remains of the insured back to the original place of residence."
                    },
                    {
                        "name": "Personal Accident",
                        "type": "ASSISTANCE_BENEFIT",
                        "visibility": "POPUP",
                        "iconCategory": "Medical Covers",
                        "benefitProvider": "AAI_DOM",
                        "description": "For accidental body injury or death during the trip which requires urgent and immediate medical attention."
                    },
                    {
                        "name": "Loss of Checked in Baggage",
                        "type": "ASSISTANCE_BENEFIT",
                        "visibility": "POPUP",
                        "iconCategory": "Baggage Covers",
                        "benefitProvider": "AAI_DOM",
                        "description": "For the total loss of checked-in baggage on a trip. (Deductible $100)"
                    },
                    {
                        "name": "Delay of Checked in baggage",
                        "type": "ASSISTANCE_BENEFIT",
                        "visibility": "POPUP",
                        "iconCategory": "Baggage Covers",
                        "benefitProvider": "AAI_DOM",
                        "description": "If checked-in baggage is delayed by more than 6 hours from the expected time of delivery, by the airline."
                    },
                    {
                        "name": "Trip Cancellation / Interruption / Curtailment",
                        "type": "ASSISTANCE_BENEFIT",
                        "visibility": "POPUP",
                        "iconCategory": "Travel Covers",
                        "benefitProvider": "AAI_DOM",
                        "description": "If the flight is cancelled before scheduled departure date or interrupted due to reasons mentioned in the Terms & Conditions. (Deductible $100)"
                    },
                    {
                        "name": "$50k Emergency Medical Expenses",
                        "type": "ASSISTANCE_BENEFIT",
                        "visibility": "BANNER",
                        "benefitProvider": "AAI_DOM"
                    },
                    {
                        "name": "$2,500 Personal Accident cover",
                        "type": "ASSISTANCE_BENEFIT",
                        "visibility": "BANNER",
                        "benefitProvider": "AAI_DOM"
                    }
                ],
                "paxFareDetails": [
                    {
                        "age": 30,
                        "insuranceFareComponents": {
                            "TF": 118.0,
                            "SPGST": 18.0,
                            "SP": 100.0,
                            "AC": 0.0
                        }
                    }
                ]
            }
        ]
    }
}
```

Insurance APIs

### Create Booking

Confirms a booking for one or more travellers against a previously executed search (`searchId`) and a selected plan (`productId`).

POST`insurance/v2/booking`

UAT: apitest.tripjack.com
Prod: tripjack.com

ℹ️

Caller role must be AGENT or AGENT_STAFF, with a valid API key.

#### Request Fields

| Field | Type | Description | M/O |
| --- | --- | --- | --- |
| searchId | String | The searchId returned by the Search API. Must still be within its validity window. | M |
| productId | String | The productId of the plan selected from the search results. | M |
| travellerInfos[] | Array<Object> | Traveller details for whom the policy is being booked, ≥1. | M |
| deliveryInfo | Object | { code[], emails[], contacts[] } — where to send the policy/COI documents. | O |
| paymentOptions | Object | Collect payment in the same booking call, without needing to call a separate payment API, when the medium is WALLET or CREDIT_LINE. | O |

#### travellerInfos[] Object

| Field | Type | Description | M/O |
| --- | --- | --- | --- |
| id | Long | Traveller identifier, if pre-assigned (e.g. from search context). | O |
| dob | String (yyyy-MM-dd) | Date of birth. | M |
| age | Integer | Traveller age (derived from dob if omitted). | O |
| title / firstName / lastName | String | Salutation and traveller name. | firstName/lastName M, title O |
| emailId | String | Traveller email, used for policy document delivery. | O |
| passportNumber / passportNationality | String | Passport number and passport-issuing country. | O |
| contactNumber / pinCode / gender | String | Contact phone number, postal code, gender. | O |
| nomineeInfo[] | Array<Object> | { nomineeName, nomineeRelationship } — see Enumerations for relationship values. If not present, defaults to Legal Heir for both nomineeName and nomineeRelationship. | O |
| isInsuranceOpted | Boolean | Whether this traveller opted into insurance. | O |

⚠️

**paymentOptions:** only `WALLET` and `CREDIT_LINE` are honored. Any other `paymentMedium` — or paymentOptions present without a valid one — is silently ignored and the call falls back to booking-only behavior, no error raised. Both `paymentMedium` and `payUserId` must be present together to trigger inline payment.

JSON · Sample Request

```
{
    "searchId": "{{SearchId}}",
    "productId": "ABHI-PLAN_250-WW-AAI-BOXX",
    "travellerInfos": [
        {
            "id": 1,
            "dob": "1999-08-01",
            "firstName": "VAIDYA  ",
            "lastName": "TEST",
            "emailId": "test.mail@tripjack.com",
            "passportNumber": "AI245678",
            "contactNumber": "9927266869",
            "pinCode": "123456",
            "gender": "Female",
            "nomineeInfo": [
                {
                    "nomineeName": "John Doe Jr",
                    "nomineeRelationship": "LEGAL_HEIR"
                }
            ]
        }
    ],
    "paymentOptions" : {
        "payUserId" : "614507",
        "paymentMedium" : "WALLET"
    }
}
```

#### Response Fields — data

| Field | Type | Description |
| --- | --- | --- |
| bookingId | String | Unique identifier of the created booking. Use to fetch or reference the booking later. |
| status | String | Booking status, e.g. PAYMENT_PENDING, SUCCESS. |
| tnc | Object | Links to the terms and conditions applicable to the booking. See **tnc Object** below. |
| paymentResult | Object | Outcome of the payment attempt made as part of this booking call. See **paymentResult Object** below. |

#### tnc Object

| Field | Type | Description |
| --- | --- | --- |
| assistance | String (URL) | Link to the travel-assistance provider's terms and conditions document (e.g. AcrossAssist). |
| insurance | String (URL) | Link to the insurer's certificate of insurance / terms and conditions document (e.g. ABHI). |
| tripjack | String (URL) | Link to TripJack's own terms and conditions page for the booking. |

#### paymentResult Object

| Field | Type | Description |
| --- | --- | --- |
| status | String | Outcome of the inline payment attempt — SUCCESS or FAILED. Reflects the result of the payment made via `paymentOptions` in the request. |
| errorCode | String | Present only when `status` is FAILED. Machine-readable payment error code. |
| errorMessage | String | Present only when `status` is FAILED. Human-readable reason for the payment failure. |

JSON · Sample Response

```
{
    "success": true,
    "message": "Booking created successfully",
    "data": {
        "bookingId": "TJS70360001517547",
        "status": "SUCCESS",
        "tnc": {
            "assistance": "https://static.tripjack.com/tripsafe/AcrossAssist_TNC.pdf",
            "insurance": "https://static.tripjack.com/COI/ABHI_T&Cs.pdf",
            "tripjack": "https://tripsafe.tripjack.com/tnc"
        },
        "paymentResult": {
            "status": "SUCCESS"
        }
    }
}
```

⚠️

`status` comes back as `PAYMENT_PENDING` when `paymentOptions.paymentMedium` is `WALLET` but the wallet doesn't have sufficient balance to cover the fare — the booking is still created with a `bookingId`, but payment must then be completed outside this call before the policy is issued. In that case, `paymentResult.status` reflects the failed/pending payment attempt.

##### Sample Response — Payment Failure

If the inline payment fails — e.g. the wallet has insufficient balance, or the payment API is down — the booking is still created (with `status: PAYMENT_PENDING`); only the payment attempt is reported as failed via `paymentResult`.

JSON · Sample Response — Payment Failure

```
{
    "success": true,
    "message": "Booking created successfully",
    "data": {
        "bookingId": "TJS70420001517311",
        "status": "PAYMENT_PENDING",
        "tnc": {
            "assistance": "https://static.tripjack.com/tripsafe/AcrossAssist_TNC.pdf",
            "insurance": "https://static.tripjack.com/COI/ABHI_T&Cs.pdf",
            "tripjack": "https://tripsafe.tripjack.com/tnc"
        },
        "paymentResult": {
            "status": "FAILED",
            "errorCode": "2064",
            "errorMessage": "Unable to process payment.Please try again or contact administrator."
        }
    }
}
```

ℹ️

Whenever `paymentResult.status` is FAILED, `bookingId` is still returned and the booking remains in PAYMENT_PENDING — retry payment (e.g. after topping up the wallet, or once the payment service is back up) rather than creating a new booking.

Insurance APIs

### Get Booking Detail

Retrieves the full details of a previously created booking, including traveller information, plan/product details, pricing breakdown, and current status.

GET`insurance/v2/booking/{bookingId}`

UAT: apitest.tripjack.com
Prod: tripjack.com

ℹ️

Caller role must be one of: AGENT, ADMIN, AGENT_STAFF, DISTRIBUTOR, ACCOUNTS, SALES, SUPPLIER, CUSTOMER, SUPERVISOR, CORPORATE_EMPLOYEE, CORPORATE, CORPORATE_STAFF, CALLCENTER. No query parameters or request body.

#### Response Fields — data

| Field | Type | Description |
| --- | --- | --- |
| status | String (enum) | Current status of the insurance booking — see InsuranceItemStatus in Enumerations. |
| metaInfo | Object | Keyed by user ID under `Users` — resolves every user ID referenced elsewhere in the response (e.g. in `bookingUser`) to its name/email/hierarchy. See **metaInfo Object** below. |
| bookingId / searchId / productId | String | Booking identifier, originating search, and booked plan/product. |
| startDate / endDate | String (yyyy-MM-dd) | Trip/coverage dates. |
| productIdentifier | String | Display tier name of the plan (e.g. Platinum, Silver Plus). |
| productInfo | Object | Full plan/product detail snapshot at time of booking — insurer, assistance providers, benefits, fare breakdown, and per-traveller info. See **productInfo Object** below. |
| totalAmount | Number | Total amount paid/payable for the booking, across all travellers. |
| bookingUser | Object | Profile of the user the booking is associated with — name, email, userId, and the parent/logged-in/emulated user IDs in the account hierarchy. |
| tnc | Object | Links to the terms and conditions applicable to the booking — same shape as in the Create Booking response (`assistance`, `insurance`, `tripjack`). |

#### metaInfo Object

| Field | Type | Description |
| --- | --- | --- |
| Users | Object | Map keyed by userId. Each entry has `name`, `email`, `userId`, `parentUserId`, `loggedInUserId`, `emulateOrLoggedInUserId`. |

#### productInfo Object

| Field | Type | Description |
| --- | --- | --- |
| id / productName / productIdentifier | String | Plan identifier, coverage amount label (e.g. "$50,000"), and tier name (e.g. Silver Plus). |
| insuranceProvider | String | Underwriting insurer (e.g. ABHI). |
| assistanceProviders[] | Array<String> | Travel-assistance partners bundled with the plan (e.g. Across Assist, BOXX). |
| regionName | String | Coverage region (e.g. ASIA). |
| productBenefits[] | Array<Object> | Each benefit has `visibility` (BANNER/POPUP), `type` (INSURANCE_BENEFIT/ASSISTANCE_BENEFIT), `name`, optional `description`/`sumInsured`/`iconCategory`, and `benefitProvider`. |
| insuranceTravellerInfos[] | Array<Object> | Per-traveller detail — same shape as submitted on Create Booking, plus a per-traveller `fareDetail`, issued `policyId`, and COI document details. See **insuranceTravellerInfos[] Object** below. |
| totalFareDetail | Object | `fareComponents` — combined fare breakdown (AC, NF, SP, TF, ACTDS, SPGST) summed across all travellers. |

#### insuranceTravellerInfos[] Object

| Field | Type | Description |
| --- | --- | --- |
| id / dob / age / title / firstName / lastName / emailId / passportNumber / contactNumber / pinCode / gender / nomineeInfo[] / isInsuranceOpted | — | Same as submitted on Create Booking — see travellerInfos[] Object under Create Booking. If `nomineeInfo.nomineeRelationship` wasn't passed, it defaults to Legal Heir and won't appear explicitly here. |
| fareDetail | Object | `fareComponents` — this traveller's individual fare breakdown (AC, NF, SP, TF, ACTDS, SPGST). |
| policyId | String | Issued policy number for this traveller. |
| coiFileName | String | File name of the traveller's Certificate of Insurance (COI). |
| coiUrl | String (URL) | Pre-signed link to the traveller's COI. Re-fetch Get Booking Detail to obtain the COI when needed. |

ℹ️

`coiUrl` is a pre-signed link — re-fetch Get Booking Detail to obtain the COI when needed.

JSON · Sample Response (abridged)

```
{
    "success": true,
    "message": "Booking retrieved successfully",
    "data": {
        "status": "SUCCESS",
        "metaInfo": {
            "Users": {
                "412857": {
                    "name": "User (412857)",
                    "email": "user412857@tripjack.com",
                    "userId": "412857",
                    "parentUserId": "412857",
                    "emulateOrLoggedInUserId": "412857",
                    "loggedInUserId": "412857"
                }
            }
        },
        "bookingId": "TJS70450001518080",
        "searchId": "isid4298462159",
        "productId": "ABHI-PLAN_50-ASIA-AAI-BOXX",
        "startDate": "2026-09-22",
        "endDate": "2026-10-02",
        "productIdentifier": "Silver Plus",
        "productInfo": {
            "id": "ABHI-PLAN_50-ASIA-AAI-BOXX",
            "productName": "$50,000",
            "productIdentifier": "Silver Plus",
            "insuranceProvider": "ABHI",
            "assistanceProviders": ["Across Assist", "BOXX"],
            "regionName": "ASIA",
            "productBenefits": [
                {
                    "visibility": "BANNER",
                    "type": "INSURANCE_BENEFIT",
                    "name": "$50k Emergency Medical Expenses",
                    "benefitProvider": "ABHI"
                },
                {
                    "visibility": "POPUP",
                    "type": "INSURANCE_BENEFIT",
                    "name": "Emergency Medical Expenses",
                    "iconCategory": "Medical Covers",
                    "description": "For availing immediate emergency medical assistance required on account of any illness/injury sustained or contracted whilst on a trip. (Deductible $100)",
                    "sumInsured": "Upto $50,000",
                    "benefitProvider": "ABHI"
                }
                // ...additional benefits omitted for brevity
            ],
            "insuranceTravellerInfos": [
                {
                    "id": 1,
                    "dob": "2009-08-01",
                    "age": 17,
                    "title": "MS",
                    "firstName": "BETA",
                    "lastName": "TEST",
                    "emailId": "anandini.vaidya@tripjack.com",
                    "passportNumber": "AI245678",
                    "contactNumber": "9927266869",
                    "pinCode": "123456",
                    "gender": "Female",
                    "nomineeInfo": [
                        { "nomineeName": "JOHN DOE JR" }
                    ],
                    "isInsuranceOpted": true,
                    "fareDetail": {
                        "fareComponents": {
                            "AC": 404.0, "NF": 676.2, "SP": 898.31,
                            "TF": 1060.0, "ACTDS": 20.2, "SPGST": 161.7
                        }
                    },
                    "policyId": "TSON11034765",
                    "coiFileName": "TJS70450001518080_BETA_TEST_TSON11034765",
                    "coiUrl": "https://static.tripjack.com.s3.ap-south-1.amazonaws.com/COI/pdfs/TJS70450001518080_BETA_TEST_TSON11034765.pdf?X-Amz-Security-Token=...&X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Date=20260903T072551Z&X-Amz-SignedHeaders=host&X-Amz-Expires=900&X-Amz-Credential=...&X-Amz-Signature=..."
                }
                // ...remaining travellers omitted for brevity
            ],
            "totalFareDetail": {
                "fareComponents": {
                    "AC": 404.0, "NF": 676.2, "SP": 898.31,
                    "TF": 1060.0, "ACTDS": 20.2, "SPGST": 161.7
                }
            }
        },
        "totalAmount": 1060.0,
        "bookingUser": {
            "name": "User (412857)",
            "email": "user412857@tripjack.com",
            "userId": "412857",
            "parentUserId": "412857",
            "emulateOrLoggedInUserId": "412857",
            "loggedInUserId": "412857"
        },
        "tnc": {
            "assistance": "https://static.tripjack.com/tripsafe/AcrossAssist_TNC.pdf",
            "insurance": "https://static.tripjack.com/COI/ABHI_T&Cs.pdf",
            "tripjack": "https://tripsafe.tripjack.com/tnc"
        }
    }
}
```

Amendments · Step 1

### Raise Amendment

Amendments let a partner change a confirmed booking post-issue — either cancelling one or more travellers (`type=CANCELLATION`) or correcting incorrect details (`type=CORRECTION`).

Raise validates the requested change and returns a priced quote — refund/charge amount and commission impact — without committing anything. Review it, then call Confirm with the returned `amendmentId` to execute it.

POST`insurance/v2/amendment/raise`

UAT: apitest.tripjack.com
Prod: tripjack.com

#### Common Request Fields

| Field | Type | Description | M/O |
| --- | --- | --- | --- |
| bookingId | String | The booking to amend. | M |
| amendmentId | String | Leave empty ("") on Raise — a new one is generated and returned. | O |
| type | String (enum) | CANCELLATION or CORRECTION. The rest of the request shape depends on this — see the two subsections below. | M |
| remarks | String | Free-text reason/notes for the amendment. | O |

ℹ️

Beyond the common fields above, Raise Amendment takes a different payload shape depending on `type`.

#### Type: CANCELLATION

Cancels one or more travellers from the booking — partial or full — and returns a refund quote.

| Field | Type | Description | M/O |
| --- | --- | --- | --- |
| travellerKeys | Object | Nested map identifying the travellers to cancel — searchId → productId → array of traveller id objects. | M |
| travellerKeys[searchId][productId][].id | Number | Traveller id to cancel, within the given searchId/productId. | M |

JSON · Sample Request — CANCELLATION

```
{
    "bookingId": "bookingId",
    "type": "CANCELLATION",
    "remarks": "Traveller requested trip extension",
    "travellerKeys": {
        "searchId": {
            "productId": [
                {
                    "id": 1  //Traveller id 
                }
            ]
        }
    }
}
```

#### Type: CORRECTION

Fixes incorrect details on the booking. Corrections fall into two categories, depending on whether they affect the plan's cost:

| Category | Fields | Effect |
| --- | --- | --- |
| **Non-financial** | Name, Nominee details, Passport details, Gender | Corrected directly — no re-pricing, no change to `amount`. Raise returns a zero-amount quote for review; Confirm applies the correction as-is, with no `paymentRequests` needed. |
| **Financial** | DOB (Date of Birth), trip start/end dates | Can shift the traveller's age band or trip duration and therefore the plan's premium. Raise re-prices the plan and returns the revised `amount`; Confirm must then carry a `paymentRequests[]` block to settle the difference. |

⚠️

Because a financial correction can change premium, always inspect the `amount` returned by Raise before calling Confirm, and pass the corresponding `paymentRequests[]` on Confirm to settle it.

| Field | Type | Description | M/O |
| --- | --- | --- | --- |
| insuranceUpdateRequest | Object | Carries the actual correction. Shape depends on what's being corrected — see below. | M |
| insuranceUpdateRequest.amendedTravellerInfos[] | Array<Object> | Used for non-financial (and DOB) corrections. Pass the traveller's **full** record — same shape as `insuranceTravellerInfos[]` in Get Booking Detail, plus `policyId` — with only the field(s) actually being corrected changed. Identify the traveller via `id`. | C |
| insuranceUpdateRequest.startDate / endDate | String (yyyy-MM-dd) | Used for a trip date / coverage-duration correction. Pass the corrected trip start and/or end date. | C |

ℹ️

Only one correction shape is sent per request — either `amendedTravellerInfos[]` (traveller-detail correction) or `startDate`/`endDate` (trip-date correction).

JSON · Sample Request — CORRECTION (Non-financial: Name)

```
{
    "bookingId": "TJS70070001516766",
    "type": "CORRECTION",
    "remarks": "test",
    "insuranceUpdateRequest": {
        "amendedTravellerInfos": [
            {
                "id": 1,
                "dob": "1994-01-28",
                "age": 32,
                "title": "MR",
                "firstName": "JOSE",
                "lastName": "TESTING",
                "emailId": "test@tripjack.com",
                "passportNumber": "G1292559",
                "contactNumber": "7824450319",
                "pinCode": "933045",
                "gender": "male",
                "nomineeInfo": [
                    {
                        "nomineeName": "KYLE MCDONALD",
                        "nomineeRelationship": "LEGAL_HEIR"
                    }
                ],
                "isInsuranceOpted": true,
                "policyId": "TSON11034638"
            }
        ]
    }
}
```

ℹ️

Here, `lastName` is being corrected from FLOYD to TESTING — every other field is passed through unchanged from the traveller's existing record. The same shape is used for correcting nominee details, passport details, or gender, and for a DOB correction (financial).

JSON · Sample Request — CORRECTION (Financial: Trip Date)

```
{
    "amendmentId": "",
    "bookingId": "TJS70070001516766",
    "type": "CORRECTION",
    "remarks": "tyuio",
    "insuranceUpdateRequest": {
        "startDate": "2026-08-05",
        "endDate": "2026-10-31"
    }
}
```

#### Response Fields

| Field | Type | Description |
| --- | --- | --- |
| amendmentItems[] | Array<Object> | The newly raised amendment. Status will be REQUESTED — see the Amendment object shape below. |
| insuranceCancellationResponse | Object | Refund breakdown — CANCELLATION only, see below. |
| errorMessage | String | Populated instead of the above on a soft failure. |

##### insuranceCancellationResponse

| Field | Type | Description |
| --- | --- | --- |
| insuranceInfo | Object | Snapshot of the remaining/affected plan. |
| totalAmountToRefund | Number | Total refund amount for the cancelled traveller(s). |
| cancellationTravellerKeys | Object | Nested map planId → productId → set of traveller keys confirmed for cancellation. |

JSON · Sample Response — CANCELLATION

```
{
  "amendmentItems": [
    {
      "amendmentId": "AMD-CANC-20260717-002",
      "bookingId": "BK-20260715-77af10c3",
      "amendmentType": "CANCELLATION",
      "status": "REQUESTED",
      "amount": 2200.00,
      "createdOn": "2026-07-17T09:20:00"
    }
  ],
  "insuranceCancellationResponse": {
    "totalAmountToRefund": 2200.00
  }
}
```

Amendments · Step 2

### Confirm Amendment

Finalizes a previously raised amendment (identified by `amendmentId`) — processes the refund/charge and applies the change to the live booking.

POST`insurance/v2/amendment/confirm`

UAT: apitest.tripjack.com
Prod: tripjack.com

#### Request Fields

| Field | Type | Description | M/O |
| --- | --- | --- | --- |
| bookingId | String | The booking being amended. | M |
| amendmentId | String | The amendmentId returned by Raise. | M |
| type | String (enum) | CANCELLATION or CORRECTION — must match the type used on Raise. | M |
| remarks | String | Free-text notes. | O |
| paymentRequests[] | Array<Object> | Required only for a financial CORRECTION where Raise quoted a non-zero `amount` — settles the difference. See **paymentRequests[] Object** below. | C |

##### Type: CANCELLATION

JSON · Sample Request — CANCELLATION

```
{
  "bookingId": "BK-20260715-77af10c3",
  "amendmentId": "AMD-CANC-20260717-002",
  "type": "CANCELLATION"
}
```

##### Type: CORRECTION

For a non-financial correction, Confirm is called the same way as for cancellations — `bookingId`, `amendmentId`, and `type` — with no `paymentRequests` needed since `amount` is 0. For a financial correction, include `paymentRequests[]` to settle the amount quoted by Raise.

| Field | Type | Description | M/O |
| --- | --- | --- | --- |
| paymentRequests[].amount | Number | Amount to collect for this correction — should match the `amount` quoted by Raise. | M |
| paymentRequests[].paymentMedium | String | WALLET or CREDIT_LINE — same mediums honored on Create Booking. | M |

JSON · Sample Request — CORRECTION (Financial)

```
{
    "amendmentId": "TJSA620001517075",
    "bookingId": "TJS70070001516766",
    "type": "CORRECTION",
    "remarks": "test date correction",
    "paymentRequests": [
        {
            "amount": 280,
            "paymentMedium": "WALLET"
        }
    ]
}
```

Response payload has the same shape as Raise's, returned directly. On success, `amendmentItems[0].status` becomes `SUCCESS` and the change is reflected on the booking — verifiable via Get Booking Detail. On failure, status becomes `REJECTED`.

JSON · Sample Response

```
{
  "amendmentItems": [
    {
      "amendmentId": "AMD-CANC-20260717-002",
      "bookingId": "BK-20260715-77af10c3",
      "amendmentType": "CANCELLATION",
      "status": "SUCCESS",
      "amount": 2200.00,
      "createdOn": "2026-07-17T09:20:00",
      "processedOn": "2026-07-17T09:24:10"
    }
  ]
}
```

#### Common Amendment Object (amendmentItems[])

Every entry in `amendmentItems[]`, across both amendment endpoints, shares this shape:

| Field | Type | Description |
| --- | --- | --- |
| amendmentId | String | Unique identifier of this amendment. Required on Confirm. |
| bookingId | String | The booking this amendment applies to. |
| amendmentType | String (enum) | CANCELLATION or CORRECTION. |
| status | String (enum) | Lifecycle status. In this flow effectively cycles REQUESTED → SUCCESS or REJECTED. |
| amount | Number | Net refund (CANCELLATION) or charge/refund (CORRECTION) amount of the amendment. |
| additionalInfo | Object | Detailed pricing/traveller-change breakdown, invoice id, remarks, commission recall totals. |
| modifiedInfo | Object | { insuranceOrderItems[], paxWiseAmount } — resulting order item(s) and per-traveller amount breakdown after the amendment applied. |
| createdOn / processedOn | String (ISO 8601) | When the amendment was raised / confirmed-finalized. |

Reference

### Common Response Envelope

All successful and business/validation-error responses — everything except raw auth failures — are wrapped in a common envelope:

JSON

```
{
  "success": true,
  "message": "Booking created successfully",
  "data": { },
  "error": null
}
```

| Field | Type | Description |
| --- | --- | --- |
| success | Boolean | true for successful calls, false for errors. |
| message | String | Optional human-readable summary. Omitted (not null) when empty. |
| data | Object | Response payload. Present only on success. |
| error | Object | Present only when success is false. |

⚠️

**Exception:** the Amendment APIs do not use this envelope on success — they return the response object directly, with no top-level success/data wrapper. They only fall back to this envelope when an error is thrown before a response object can be built.

ℹ️

Fields with empty/null values are omitted from the JSON body — the API does not emit null placeholders except where illustrated above.

Reference

### Glossary of Terms

| Term | Meaning |
| --- | --- |
| DOB | Date of Birth |
| PAX | Passenger / Traveller |
| SI | Sum Insured — the maximum amount payable under a benefit |
| COI | Certificate of Insurance — the policy document issued after booking |
| AMT | Annual Multi-Trip — an annual plan covering multiple trips within a 365-day term, with a selectable per-trip coverage window (30/45/60/90 days) |
| PMS | Payment Management Service — TripJack's internal service that executes charges/refunds across payment mediums |
| funnelType | The commercial channel/flow through which the insurance is sold, e.g. standalone vs. embedded with another product |

#### Fare Component Codes

Keys used in `insuranceFareComponents` / `fareComponents` maps throughout Search, Booking, and Booking Detail responses.

| Code | Meaning |
| --- | --- |
| TF | Total Fare |
| NF | Net Fare |
| SP | Selling Price |
| AC | Insurance Agent Commission |
| ACTDS | Agent Commission TDS |
| PF | Payment Fee |
| CGST / SGST / IGST | Central / State / Integrated GST (India) |
| SPGST | GST computed on Selling Price |

Reference

### Popular Region Mapping

Valid `key` values to send in `destinations[].key` when `destinations[].type` is `"REGION"`.

| key (Region name) | Region |
| --- | --- |
| MDE | Middle East |
| EUR | Europe |
| SCH | Schengen |
| USC | USA/Canada |
| ASI | Asia |

Reference

### Country Codes

Valid `key` values to send in `destinations[].key` when `destinations[].type` is `"COUNTRY"`.

| Country Code | Country Name | Country Code | Country Name |
| --- | --- | --- | --- |
| AF | Afghanistan | AX | Aland Islands |
| AL | Albania | DZ | Algeria |
| AS | American Samoa | AD | Andorra |
| AO | Angola | AI | Anguilla |
| AQ | Antarctica | AG | Antigua and Barbuda |
| AR | Argentina | AM | Armenia |
| AW | Aruba | AC | Ascension Island |
| AU | Australia | AT | Austria |
| AZ | Azerbaijan | BS | Bahamas |
| BH | Bahrain | BD | Bangladesh |
| BB | Barbados | BY | Belarus |
| BE | Belgium | BZ | Belize |
| BJ | Benin | BM | Bermuda |
| BT | Bhutan | BO | Bolivia |
| BA | Bosnia and Herzegovina | BW | Botswana |
| BV | Bouvet Island | BR | Brazil |
| IO | British Indian Ocean Territory | VG | British Virgin Islands |
| BN | Brunei | BG | Bulgaria |
| BF | Burkina Faso | MM | Burma (Myanmar) |
| BI | Burundi | KH | Cambodia |
| CM | Cameroon | CA | Canada |
| CV | Cape Verde | KY | Cayman Islands |
| CF | Central African Republic | TD | Chad |
| CL | Chile | CN | China |
| CX | Christmas Island | CC | Cocos (Keeling) Islands |
| CO | Colombia | KM | Comoros |
| CG | Congo | CK | Cook Islands |
| CR | Costa Rica | HR | Croatia |
| CU | Cuba | CY | Cyprus |
| CZ | Czech Republic | CD | Democratic Republic of the Congo |
| DK | Denmark | DG | Diego Garcia |
| DJ | Djibouti | DM | Dominica |
| DO | Dominican Republic | EC | Ecuador |
| EG | Egypt | SV | El Salvador |
| GQ | Equatorial Guinea | ER | Eritrea |
| EE | Estonia | ET | Ethiopia |
| FK | Falkland Islands | FO | Faroe Islands |
| FJ | Fiji | FI | Finland |
| FR | France | GF | French Guiana |
| PF | French Polynesia | TF | French Southern Territories |
| GA | Gabon | GM | Gambia |
| GE | Georgia | DE | Germany |
| GH | Ghana | GI | Gibraltar |
| GR | Greece | GL | Greenland |
| GD | Grenada | GP | Guadeloupe |
| GU | Guam | GT | Guatemala |
| GG | Guernsey | GN | Guinea |
| GW | Guinea-Bissau | GY | Guyana |
| HT | Haiti | HM | Heard Island and Mcdonald Islands |
| VA | Holy See (Vatican City) | HN | Honduras |
| HK | Hong Kong | HU | Hungary |
| IS | Iceland | IN | India |
| ID | Indonesia | IR | Iran |
| IQ | Iraq | IE | Ireland |
| IM | Isle of Man | IL | Israel |
| IT | Italy | CI | Ivory Coast |
| JM | Jamaica | JP | Japan |
| JE | Jersey | JO | Jordan |
| KZ | Kazakhstan | KE | Kenya |
| KI | Kiribati | XK | Kosovo |
| KW | Kuwait | KG | Kyrgyzstan |
| LA | Laos | LV | Latvia |
| LB | Lebanon | LS | Lesotho |
| LR | Liberia | LY | Libya |
| LI | Liechtenstein | LT | Lithuania |
| LU | Luxembourg | MO | Macau |
| MK | Macedonia | MG | Madagascar |
| MW | Malawi | MY | Malaysia |
| MV | Maldives | ML | Mali |
| MT | Malta | MH | Marshall Islands |
| MQ | Martinique | MR | Mauritania |
| MU | Mauritius | YT | Mayotte |
| MX | Mexico | FM | Micronesia |
| MD | Moldova | MC | Monaco |
| MN | Mongolia | ME | Montenegro |
| MS | Montserrat | MA | Morocco |
| MZ | Mozambique | NA | Namibia |
| NR | Nauru | NP | Nepal |
| NL | Netherlands | AN | Netherlands Antilles |
| NC | New Caledonia | NZ | New Zealand |
| NI | Nicaragua | NE | Niger |
| NG | Nigeria | NU | Niue |
| NF | Norfolk Island | MP | Northern Mariana Islands |
| KP | North Korea | NO | Norway |
| OM | Oman | PK | Pakistan |
| PW | Palau | PS | Palestine |
| PA | Panama | PG | Papua New Guinea |
| PY | Paraguay | PE | Peru |
| PH | Philippines | PN | Pitcairn Islands |
| PL | Poland | PT | Portugal |
| PR | Puerto Rico | QA | Qatar |
| CG | Republic of the Congo | RE | Reunion Island |
| RO | Romania | RU | Russia |
| RW | Rwanda | BL | Saint Barthelemy |
| SH | Saint Helena | KN | Saint Kitts and Nevis |
| LC | Saint Lucia | MF | Saint Martin |
| PM | Saint Pierre and Miquelon | VC | Saint Vincent and the Grenadines |
| WS | Samoa | SM | San Marino |
| ST | Sao Tome and Principe | SA | Saudi Arabia |
| SN | Senegal | RS | Serbia |
| SC | Seychelles | SL | Sierra Leone |
| SG | Singapore | SX | Sint Maarten |
| SK | Slovakia | SI | Slovenia |
| SB | Solomon Islands | SO | Somalia |
| ZA | South Africa | GS | South Georgia and the South Sandwich Islands |
| KR | South Korea | SS | South Sudan |
| ES | Spain | LK | Sri Lanka |
| SD | Sudan | SR | Suriname |
| SJ | Svalbard | SZ | Swaziland |
| SE | Sweden | CH | Switzerland |
| SY | Syria | TW | Taiwan |
| TJ | Tajikistan | TZ | Tanzania |
| TH | Thailand | TL | Timor-Leste (East Timor) |
| TG | Togo | TK | Tokelau |
| TO | Tonga Islands | TT | Trinidad and Tobago |
| TN | Tunisia | TR | Turkey |
| TM | Turkmenistan | TC | Turks and Caicos Islands |
| TV | Tuvalu | UG | Uganda |
| UA | Ukraine | AE | United Arab Emirates |
| GB | United Kingdom | US | United States |
| UY | Uruguay | VI | US Virgin Islands |
| UZ | Uzbekistan | VU | Vanuatu |
| VE | Venezuela | VN | Vietnam |
| WF | Wallis and Futuna | EH | Western Sahara |
| YE | Yemen | ZM | Zambia |
| ZW | Zimbabwe |  |  |

Reference

### Error Handling

#### Error Object Shape

JSON

```
{
  "success": false,
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "At least one traveller date of birth is required",
    "details": null
  }
}
```

#### Generic / Framework Error Codes

| HTTP | error.code | When it occurs |
| --- | --- | --- |
| 400 | INVALID_JSON | Request body is not valid JSON / not parseable. |
| 400 | INVALID_DATE_FORMAT | A date field is not in yyyy-MM-dd format. |
| 400 | VALIDATION_ERROR | A bean-validation constraint failed (missing required field, out-of-range value). |
| 400 | BAD_REQUEST | General bad-request / business validation exception. |
| varies | business code (see below) | Domain-specific error raised deliberately by the service layer. |
| 4xx/5xx | EXTERNAL_API_ERROR | Error propagated from a downstream/supplier system. |
| 401 | — | Missing/invalid apikey header — see the special auth error shape below. |
| 403 | FORBIDDEN / role-based | Authenticated but not authorized for this operation. |
| 500 | INTERNAL_SERVER_ERROR | Unhandled server-side exception. |

#### Business Error Codes — Insurance Domain

Returned with HTTP 400 (unless otherwise noted) inside the standard envelope. Non-exhaustive list of codes most relevant to Search, Booking, Payment, and Amendment:

| Code | Message | Typical Cause |
| --- | --- | --- |
| INS_8305 | Select at least one region info for insurance | destinations empty/missing on search. |
| INS_8306 | Pass the travellers for which insurance is opted | No traveller info supplied. |
| INS_8343 | Invalid insurance search criteria | Search parameters fail business-level checks. |
| INS_8332 / INS_8333 | Invalid End/Start Date! | endDate/startDate fails domain validation. |
| INS_8353 | No insurance search results found. | No plans matched the search criteria. |
| 404 REGION_NOT_FOUND / REGION_DOES_NOT_EXISTS | Region not found / does not exist | destinations[].key does not resolve to a known region/country. |
| 404 PRODUCT_NOT_FOUND | Product not found | productId on booking does not match any product from the search result. |
| 404 AGE_NOT_FOUND | Age not found | Traveller age could not be resolved from DOB/search context. |
| 850 INVALID_SEARCH_ID | Invalid searchId | searchId on booking is malformed. |
| 879 SEARCH_ID_NOT_FOUND | Id not found | searchId has expired or does not exist. |
| 2575 INVALID_REQUEST | Invalid request, data passed is wrong | bookingId blank on Get Booking Detail. |
| 2607 ORDER_NOT_FOUND | No order found with given orderId | bookingId does not correspond to any existing booking. |
| 2615 PENDING_ORDER | Order still pending, cannot raise amendment | Underlying booking hasn't reached SUCCESS status yet. |
| 2543 DIFFERENT_ASSIGNED_USER | You are not allowed to perform this action… | Caller does not own the booking and lacks override rights. |
| INS_8312 INS_AMENDMENT_NOT_ALLOWED | Cancellation must be raised at least 24 hours before coverage begins | Cancellation raised too close to coverage start. |
| INS_8310 INSURANCE_NOT_OPTED | Insurance not opted for this traveller | Cancellation requested for a traveller without insurance opted, or already cancelled. |
| INS_8334 INS_INVALID_TS_ID | Invalid TripSafe Id passed | A tripSafeId doesn't match any traveller on the booking. |
| 407 UNAUTHORIZED_ACCESS | Not allowed to search with given parameters | Caller not entitled to search with the given parameters. |
| 412 UNAUTHORIZED_APIKEY | UnAuthorized Access! | Invalid apikey header value. |

#### Authentication Error Shape (Special Case)

Unlike all other errors, an authentication failure is returned before reaching the controller and does **not** use the standard envelope. Special-case HTTP 401 responses to parse this shape:

JSON

```
{
  "path": "/insurance/v2/search",
  "error": "Unauthorized",
  "message": "Invalid Access. Send valid authorizarion token. Either token is invalid or it's expired",
  "timestamp": "2026-07-15T10:15:30.123456",
  "status": 401
}
```

Reference

### Appendix: Enumerations

#### funnelType (InsuranceType)

| Value | Code |
| --- | --- |
| STANDALONE | STA |
| EMBEDDED | EMB |
| STUDENT | STD |
| AMT | AMT |
| API_EMB | API_EMB |

#### journeyType

| Value | Code |
| --- | --- |
| ALL | A |
| DOMESTIC | D |
| INTERNATIONAL | I |

#### planType (response only)

REGULAR, STUDENT, AMT

#### status (InsuranceItemStatus)

IN_PROGRESS, PAYMENT_PENDING, PAYMENT_SUCCESS, SUCCESS, PENDING, PAYMENT_FAILED, ABORTED, CANCELLED, ON_HOLD, HOLD_PENDING, CONFIRM_PENDING, UNCONFIRMED, TO_BE_ACTIVATED, UPDATED

#### insuranceFareComponents (map keys)

TF, NF, CGST, SGST, IGST, AC, SP, SPGST, ACTDS, PF — full names in the Glossary.

#### amendmentType

| Value | Code |
| --- | --- |
| CANCELLATION | IC |

#### amendmentStatus

REQUESTED, ASSIGNED, PROCESSING, REJECTED, PAYMENT_PENDING, PAYMENT_FAILED, PAYMENT_SUCCESS, SUCCESS.

ℹ️

The Raise/Confirm flow only ever produces REQUESTED, SUCCESS, or REJECTED — the remaining values are used by other, non-partner-facing amendment workflows.

#### paymentMedium

WALLET, CREDIT_LINE, CREDIT

#### nomineeRelationship

LEGAL_HEIR, FATHER, MOTHER, SISTER, SPOUSE, BROTHER, DAUGHTER, SON

ℹ️

If `nomineeInfo` is not passed on Create Booking, it defaults to Legal Heir for both `nomineeName` and `nomineeRelationship`.

Reference

### Validation Rules & SLA

#### API Request Validation Rules

- **Age Restriction:** searches for travellers above 70 years of age are not permitted.
- **Restricted Countries:** Myanmar (MM), Iran (IR), and North Korea (NK) are blacklisted for searches.
- **Date Range Limit:** coverage duration must not exceed 90 days.
- **Traveller Limit:** a maximum of 10 travellers is allowed per search request.
- **Cancellation Policy:** TripSafe can be cancelled up to 24 hours prior to the coverage start date.

#### Performance & Availability

| Category | Metric | SLA Commitment |
| --- | --- | --- |
| Availability | System Uptime | 99.9% availability |
| Rate limiting | Requests per minute | 40 RPM |

#### API Response Time Commitments

| API | Expected Response Time |
| --- | --- |
| Search API | < 200 ms |
| Review API | < 500 ms |
| Booking API | < 1 second |
| Booking Details API | < 700 ms |
| Amendment API | < 1 second |
| Cancellation API | < 1 second |

#### Timeout Configuration

| API Category | Timeout |
| --- | --- |
| Insurance APIs | 60 seconds |
| Air Book API (Embedded Flow) | 60 seconds |

#### Support & Incident Management

| Priority | Response Target |
| --- | --- |
| P Critical (Total outage) | < 30 mins |
| P High (Major feature broken) | 1–2 hrs |
| P Moderate (Minor feature broken) | < 6 hrs |
| P Minor (Non-blockers) | Part of dev sprints |

Go-Live

### UAT Test Cases

API partners must complete these test cases before receiving production access. Provide JSON request/response logs for every case below, along with the confirmation number generated for each booking.

#### Search Matrix & Test Coverage

Each journey type supports a different combination of destination granularity, date logic, and duration rule. Test coverage must exercise all five.

| Journey Type | Region Allowed | Country Allowed | Date Logic | Duration Rule |
| --- | --- | --- | --- | --- |
| Standalone | Yes | Yes | Start Date – End Date | Flexible (max 180 days from Start Date) |
| Student | No | Country only | Start Date + Coverage Duration | 30 / 60 / 90 / 120 / 180 / 240 / 270 / 365 / 730 days |
| AMT | Region only | No | Start Date + Fixed Duration | 30 / 45 / 60 days only |
| Embedded (One Way Air) | Yes | Yes | Departure Date | Departure Date + 180 days max |
| Embedded (Round Trip Air) | Yes | Yes | Departure – Arrival Date | As per flight itinerary |

#### 1.0 Search Flow

| TC ID | Journey Type | Search Type | Destination (Payload Format) | Start Date | End Date / Duration | Traveller Ages | Plan Selected |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 01 | Standalone | Popular Region | `{ "key": "EUR", "type": "REGION" }` | Today + 5 | Valid | 30, 65, 12 | TripSafe Gold Plus |
| 02 | Standalone | Country | `{ "key": "US", "type": "COUNTRY" }` | Today + 5 | Today + 180 | 22, 5, 3, 45, 56, 67 | TripSafe Platinum |
| 03 | Student | Country only | `{ "key": "MY", "type": "COUNTRY" }` | Today + 5 | 30 / 90 (duration based) | 40, 18 | TripSafe Student Gold |
| 04 | Embedded | Region | `{ "key": "MDE", "type": "REGION" }` | As per Air Search | As per Air Search | 35, 40, 60 | TripSafe Classic Super |
| 05 | AMT | Region only | WW or XUSC mapping | Today + 5 | 30 / 45 / 60 | Valid | TripSafe Platinum Annual |

ℹ️

The `destinations[].key` / `destinations[].type` payload shown above is the public API format — `type: "REGION"` is used for popular regions, and `type: "COUNTRY"` for countries. Use the `rkey` column of the country/region mapping catalogue to look up valid `key` values.

#### 1.2 Standalone — Book Scenarios

1. Perform a standalone search covering any **3 countries**, with a coverage duration of **5 days**, for **4 travellers** (ages as per choice).
2. Perform a standalone search covering **2 Popular Regions**, with a coverage duration of **90 days**, for **10 travellers** (ages as per choice).

#### 1.3 Student — Book Scenarios

1. Perform a Student search covering **1 country only**, with **Start Date + 180 days** duration, for **1–3 travellers** (age 18–45).
2. Perform a Student search covering **1 country only**, with **Start Date + 365 days** duration, for multiple travellers within the eligibility criteria.

⚠️

**Student rules:** `endDate` must not be passed separately — pass the duration in `coverageDuration` instead. Traveller age must be within **18–45**.

#### 1.4 AMT (Annual Multi-Trip) — Book Scenarios

1. Perform an AMT search covering **1 Popular Region**, with **Start Date + 30 days** fixed duration, for **4 travellers**.
2. Perform an AMT search covering **1 Popular Region**, with **Start Date + 60 days** fixed duration, for **8 travellers**.

⚠️

**AMT rules:** `coverageDuration` must strictly be **30 / 45 / 60** days. Any other duration must return a validation error — capture that negative case in your logs.

#### 1.5 Embedded — Book Scenarios

1. Perform an **Embedded (One Way Air)** search where the start date is the departure date and the end date is **+90 days**.
2. Perform an **Embedded (Round Trip Air)** search where insurance coverage strictly matches the **departure and arrival dates** from the flight itinerary.

Reference

### UAT Certification & Going Live

#### Certification Process

1. Complete UAT integration and provide the JSON request/response for every method you're implementing, along with confirmation numbers for each test case.
2. Tripjack verifies test cases using the submitted JSON request/response and suggests changes if required. Turnaround time is roughly 1–2 working days.
3. On successful completion, Tripjack signs off and provides live access details. It's strongly recommended you also complete your own UAT before going live.

#### Log Format Rules

- Logs must be in JSON format, with no modification.
- Separate files for each request and each response.
- Attach the API key along with the logs.
- Passenger/traveller names must be real — "TBA" or "Test" values cannot be certified.

#### Certification Error Responses

| HTTP Code | Message | Reason |
| --- | --- | --- |
| 400 | Bad Request | Missing required field |
| 401 | Unauthorized | Invalid API Key |
| 403 | Unauthorized | Invalid Token |
| 500 | Internal Server Error | System issue |

⚠️

The **plan id** and **product id** must stay consistent between the Search response and the Booking request — a mismatch throws `Invalid productId`. In multi-pax flows, submitting a different traveller count at Booking than at Search throws error `1134`, "Please update details for every pax."

Reference

### FAQ

How do I pass the API key?

Pass it as the `apikey` header on every request.

How long is a searchId valid for?

It's cached server-side with a limited validity window — re-run the search if you get `SEARCH_ID_NOT_FOUND` (error 879).

How many travellers can I search with?

1–10 traveller DOBs per search request, and none may be above 70 years of age.

What's the difference between Raise and Confirm on amendments?

Raise prices the change and returns a quote without committing anything. Confirm executes it, using the amendmentId from Raise, and processes any payment or refund.

What happens if I don't pass paymentOptions on Create Booking?

The booking is created and remains in PAYMENT_PENDING status until payment is collected separately.

Which payment mediums trigger inline payment on Create Booking?

Only WALLET and CREDIT_LINE. Any other medium — or paymentOptions without a valid one — is silently ignored, and the call falls back to booking-only behavior.

How close to departure can I cancel?

Cancellation must be raised at least 24 hours before the coverage start date, or you'll get error INS_8312.

Do Amendment APIs use the standard {success, data} envelope?

No — on success they return the response object directly. They only fall back to the standard envelope when an error is thrown before a response can be built.

What does a 401 response look like?

A raw JSON object with path, error, message, timestamp, and status fields — not the standard {success, error} envelope used elsewhere.

Which countries are blocked from search?

Myanmar (MM), Iran (IR), and North Korea (NK) are blacklisted destinations.

What's the max coverage duration?

90 days, per the Date Range Limit validation rule. AMT plans use a separate 30/45/60/90-day coverageDuration window within a 365-day policy term.

Is IPv6 supported for API key whitelisting?

No — provide a valid IPv4 address only.
