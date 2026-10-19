# Trustsignal: what we use and how

Source: `Trustsignal API Collection.postman_collection.json` (121 requests: Auth, SMS, RCS, Email,
WhatsApp). The collection holds placeholders only (`APIKEY = "APIKEY"`); the real key goes in the
environment as `TRUSTSIGNAL_API_KEY` and never in the repo.

| Product | Base URL | We use it for |
| --- | --- | --- |
| Email | `https://eapi.trustsignal.io` | **Sign-in codes, today** |
| WhatsApp | `https://wpapi.trustsignal.io` | Sign-in codes later (not wired yet) |
| SMS | `https://sms.trustsignal.io` | not used |
| RCS | (see collection) | not used |
| Auth | `https://auth.trustsignal.io` | not used (sub-account registration) |

The API key goes in the **query string** (`?api_key=...`). That puts it in every request URL, so our
backend redacts `api_key=` from all logs (`RedactApiKey` in `backend/app/modules/auth/trustsignal.py`).

## Email: OTP email (what the backend sends)

`POST {EMAIL_BASE_URL}/v1/otp-email?api_key={APIKEY}`, JSON body:

| Field | Meaning | Our setting |
| --- | --- | --- |
| `to` | recipient address | the creator's email |
| `from` | a sender address verified in the Trustsignal account | `TRUSTSIGNAL_EMAIL_FROM` |
| `template_id` | the OTP email template made in the account | `TRUSTSIGNAL_EMAIL_TEMPLATE_ID` |
| `subject` | subject line | `TRUSTSIGNAL_EMAIL_SUBJECT` (default "Your WishTrip sign-in code") |
| `evariables` | **a JSON string** of the template's variables | `{"otp": "<code>", "name": "<local part>", "minutes": "10"}` |

The code is the variable named by `TRUSTSIGNAL_OTP_VARIABLE` (default `otp`), so the template body
must contain `{{otp}}` (or whatever that name is set to).

Success (HTTP 200):
```json
{"message": "Request process successfully",
 "results": {"email": "test@example.com", "transaction_id": "11903236063918584", "ecost": 1},
 "success": true}
```
Failure (HTTP 400): `{"errors": [{"code": "101", "codeMsg": "API_KEY_MISSING", "message": "API Key is required in the request"}], "success": false}`.

The same collection also has `POST /v1/transactional-email` and `POST /v1/promotional-email`
(same body) for other mail, not used yet.

## WhatsApp, for later (the sign-in code on WhatsApp)

`POST {WA_BASE_URL}/api/v1/whatsapp/otp?api_key={APIKEY}`:
`{"sender": "<sender id>", "to": "<number>", "template_id": "<authentication template>", "sample": {"otp": "<code>"}}`
(up to five optional extra variables `pr1`..`pr5`). It needs an **approved WhatsApp Authentication
template** (`POST /api/v1/template`, request "Authentication template OTP copy code button"). Success:
`{"results": [{"to": "919999999999", "transaction_id": "...", "cost": 0.2}], "success": true}`; a bad
sender gives `114 INVALID_SENDERID`. Other WhatsApp sends in the collection: `/api/v1/whatsapp/single`
(text, image, video, document, carousel, location, products), `/api/v1/whatsapp/bulk`.

## Behaviour in WishTrip

- Email is live once `TRUSTSIGNAL_API_KEY`, `TRUSTSIGNAL_EMAIL_FROM` and
  `TRUSTSIGNAL_EMAIL_TEMPLATE_ID` are all set. Until then no code is sent and the sign-in page says
  "We can't send sign-in codes right now".
- If Trustsignal refuses (wrong key, unverified sender, bad template), the creator sees "We couldn't
  send the code. Please try again in a moment." and may ask again at once; the backend log says why
  (`Could not send a sign-in code by email: Trustsignal <code>`), without the key.
- There is no hardcoded fixed code. `CREATOR_DEV_OTP` is a local-development opt-in, ignored when
  `ENVIRONMENT=production`.
