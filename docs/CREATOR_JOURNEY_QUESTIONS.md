# Creator journey — questions for the client

A walkthrough of the creator journey as the prototype implies it, with the open questions to
confirm with the client at each step. Use this to run the conversation; each section says what
the prototype shows, then the decisions we still need.

Journey at a glance:
**Discover → Apply (the “Join the creator program” page) → “We’ll review you” → Moderation & approval →
Notify the creator → Creator signs in → Make a trip from a reel/video → Review & edit the itinerary →
Publish & get an affiliate link → Use the link + attach the reel → Travellers find it → Book / customise.**

---

## A. Positioning & eligibility

1. Who is a “creator” for v1 — Instagram and YouTube only, or any traveller who posts?
2. Is there a minimum bar (followers, public account, number of travel posts), or is everyone accepted and we filter in moderation?
3. One creator = one account. Is the identity the **email**, the **Instagram/YouTube handle**, or both? What if two people share a handle, or one person has several handles?
4. Do we support both Instagram **and** YouTube at launch, or Instagram first?

## B. The “Join the creator program” landing page

The prototype has a dedicated page with a hero (“Your trip becomes a source of earning”), how it works,
“what you get”, an FAQ, and a **Join the creator program** button that scrolls to an application form.

5. Is the **Join** button the only entry point, or do we also link it from the main nav / footer / a banner?
6. The “what you get” copy mentions earning a share of every booking — can we state the **actual commission** publicly, or keep it “set with you” until approval?
7. The FAQ answers “what does it cost / do I need new content / when do I get paid” — are those answers final, especially **payout timing** (prototype says “5th of every month”)?

## C. The application form (fields)

The prototype form collects: **Your name**, **Instagram or YouTube handle**, **WhatsApp number**,
**where have you posted trips from** (a tag/location), and **followers** (a range like “10k–50k”), then **Apply to join**.

8. Confirm the exact fields and which are **required**: name, handle, WhatsApp, email, “where you’ve posted from”, follower range — anything else (city, languages, sample post link, payout/bank details later)?
9. “Where have you posted trips from” — is this **free text**, a **destinations picker**, or tags? What is it used for (matching, display, nothing yet)?
10. Follower count — a **range dropdown** (as shown) or an exact number? Do we verify it, or trust it?
11. Do we need the creator to **agree to terms** (affiliate T&Cs, content rights) at this step — a checkbox and a linked document?
12. Email vs WhatsApp: which is the **primary** channel for the login code and all later messages? (Our current build signs creators in by **email + a code**; the prototype collects WhatsApp — we should align.)
13. Can someone apply more than once / re-apply after rejection? What stops duplicate applications (same email or handle)?

## D. After applying — the confirmation screen & communication

The prototype shows a “✓ You’re on the list — we’ll message you on WhatsApp within 2 days” screen.

14. **This is the screen the client wanted us to define together.** What should it say exactly? Suggested elements: confirmation, the review timeframe, the channel we’ll use, and what to do meanwhile.
15. Review promise — is it “**within 2 days**”, 24 hours, or “we’ll be in touch”? Do we commit to an SLA?
16. Do we send an **immediate acknowledgement** (email/WhatsApp) on apply, separate from the approval message? What does it say?
17. Can the creator **check their status** later (a “pending” page they can return to), or is it message-only?
18. After applying, can they already **sign in** and see a “waiting for approval” screen (our current build does this), or are they fully locked out until approved?

## E. Moderation & approval (the dashboard)

Staff review applications in the admin dashboard’s **Creators** area.

19. Who moderates — any staff, or a specific **role** (admin only, a “growth” role)? Current build: admin/editor.
20. What does the moderator need to see to decide — handle, follower range, where they’ve posted, a link to their profile, sample content? Anything we must **add** to the moderation view?
21. On approval, what does the moderator set: **status = active**, the **commission** (type + value), the **Instagram/YouTube handle** (if not captured), notes? Anything else (a tier, a category, a region)?
22. Is there a **reject** path and a **request-more-info** path, or only approve? What happens to a rejected application (deleted, kept, can re-apply)?
23. Do we need an **audit trail** (who approved, when, what commission) for payouts/disputes?
24. Bulk actions — approve several at once, filter by status/followers — needed for v1 or later?

## F. Approval decision & commission

25. Commission model — **percentage of each booking** or a **flat amount per booking**, set **per creator** at approval? (Current build supports both, per creator.) Is there a **default** when staff don’t set one?
26. Is commission **per booking** (what the prototype implies) or per traveller who plans a trip? When exactly is it “earned” — at booking, at travel, after the refund window?
27. Can commission **change later**, and does a change apply to **future** bookings only or retroactively?
28. Are there tiers (e.g. higher % above X bookings), caps, or minimums? Any **minimum payout** threshold?

## G. Notifying the creator (approved / rejected)

29. How is the creator told they’re **approved** — WhatsApp, email, both? What does the message say, and does it include a **sign-in link**?
30. Is there a **rejection** message? What does it say, and can they re-apply later?
31. Since we have no SMTP/WhatsApp integration yet, what’s the **interim** plan — manual message, or do we need email/WhatsApp wired before launch? (Right now the sign-in code is a fixed demo code.)

## H. Creator login & authentication

The client wants: clicking **Sign in** takes the creator to their workspace. Our current build uses **email + a 4-digit code** (no password).

32. Confirm the login method: **email + one-time code**, phone/WhatsApp OTP, Google, or password? The prototype says “phone number or Google, no passwords”.
33. Should creators log in from the **same** sign-in page as travellers (a toggle) or a **dedicated** creator sign-in page? (We’ve built a dedicated `/creators/join` registration; confirm this is what you want.)
34. If a creator tries to sign in **before** approval, what do they see — “waiting for approval”, or blocked?
35. Session length, sign-out, multiple devices — any requirements?

## I. Creating a trip from a reel or video

After sign-in, the creator **pastes a reel URL** or **browses/uploads an MP4**, and we extract an itinerary
(download → read on-screen text → transcribe the voice-over with AI → pull out the places).

36. Both inputs at launch — **paste a public reel link** and **upload a video file**? (Both are built.) Any size/length limit to state to the creator?
37. For a **link**: only Instagram, or YouTube Shorts too? What about private/age-restricted reels — show what error?
38. Instagram downloading needs a logged-in account on our side. Is the client OK with the **compliance/ToS** risk, and who owns that Instagram account? (Currently a personal one — needs a dedicated account.)
39. What if extraction finds **few or no places** (a vibe/music-only reel)? Let the creator add places manually, or reject?
40. The creator uploading **their own** video vs pasting **someone else’s** reel — do we restrict creators to their own content? How do we check ownership?
41. Can a creator make **several** trips, and is there a limit per day (rate-limit)?

## J. Reviewing & editing the itinerary

The creator sees the generated itinerary and should be able to adjust it (prototype: details → trip board).

42. What can the creator **edit** — reorder stops, add/remove places, add a hotel, change text, assign days, set the number of days? Anything they **cannot** change?
43. Do they set **trip inputs** first (who it’s for, how many days, pace) like the traveller flow, or jump straight to the board?
44. We **don’t show prices** today (no pricing integration). Is a price-free itinerary acceptable for the creator view, or does the client expect indicative prices? (We currently say “priced at checkout”.)
45. Which places count as “verified” (matched to our knowledge base) vs “from the reel”? Should the creator see that distinction, and can they publish unverified places?
46. Can the creator **save a draft** and come back, or is it publish-in-one-go?

## K. Publishing & getting the affiliate link

From the board, the creator chooses **Save**, which publishes the trip and returns a **shareable link** to promote.
(Traveller version of the same board ends in Book → Booked; creator version ends in Save → link.)

47. The link format — e.g. `wishtrip…/t/<code>`. Does the client want a **custom/branded** slug, a short link, or a per-creator vanity URL?
48. Can a creator publish **multiple** trips, each with its own link? Can they **edit after publishing** (update the live trip) and **unpublish**?
49. Should the link carry **UTM / campaign** parameters so the creator can track which video drove which bookings?
50. Besides the raw link, do we give the creator ready-to-use assets — a **QR code**, a “link in bio” page, suggested caption?

## L. Linking the published reel back to the trip (the reel ID)

The client described: the creator takes the link, puts it in their **video**, posts the reel, then **attaches that reel’s ID** to the trip so travellers can match the reel they saw to the itinerary.

51. How does the creator attach the reel — paste the **posted reel’s URL/ID** into the trip after publishing? A field on the trip for “the reel I posted this in”?
52. What does the reel ID power — showing the **reel thumbnail/embed** on the trip page, matching when a traveller **pastes the same reel**, discovery in a “creator reels” feed, or all three?
53. If a traveller pastes a reel that a creator already turned into a trip, do we show them the **creator’s published trip** instead of re-extracting? (This is the “easy for the customer” path the client mentioned.)
54. Can one trip be promoted across **several reels** (multiple reel IDs), or one reel per trip?

## M. The traveller / consumer side

The client wants: a normal user can **paste the reel**, or open the **creator tab** and see a **list of reels**;
click one → see the itinerary → **book**, and **customise** if needed.

55. Discovery entry points: (a) paste the same reel on `/reel`, (b) a **“Creator trips” tab/feed** listing published creator reels. Both at launch?
56. The creator feed — how is it **sorted/filtered** (most booked, newest, by destination, by creator)? Any search?
57. On a creator trip page, the traveller can **Book** or **Customise**. What does “customise” mean — change dates/travellers/pace and re-plan, add/remove stops, swap hotels?
58. When a traveller books or customises a creator’s trip, is the creator **still credited** (attribution) even after edits? What if they remove most of the creator’s places?
59. First-touch vs last-touch attribution, and the **window** (we default to 30 days). Confirm.
60. Does the traveller need an **account** to book, or can they browse the itinerary anonymously and sign up at booking?

## N. Commission, attribution & payouts

61. Attribution mechanics — cookie + the creator’s referral code (built). Confirm the **window** and **first-touch** rule, and what happens across devices / if cookies are cleared.
62. When is commission **booked** vs **paid** — on booking, after travel, after the refund window? Payout schedule (prototype: 5th of the month)?
63. What payout details do we collect and when — at application, at approval, or at first payout? Bank/UPI, KYC/tax?
64. Do creators need a **statement/ledger** of what they’ve earned and what’s been paid? (The dashboard has the start of this.)
65. Refunds/cancellations — does the creator’s commission **claw back**?

## O. Content rights, compliance & edge cases

66. Who owns the generated itinerary and the extracted text — the creator, wishtrip, or shared? What rights does the creator grant by publishing?
67. Instagram/YouTube **terms** on automated downloading — is the client accepting that risk, and is there a fallback (creators submit their own video file instead of us scraping)?
68. Moderating **content quality** — can staff unpublish a creator trip or pause a creator? What triggers that?
69. Duplicate trips (two creators post the same places) — allowed, merged, or flagged?
70. Data/privacy — the reel’s audio and frames are processed by AI (OpenRouter/Gemini). Is that disclosed and acceptable?

## P. Creator dashboard & analytics

71. What does an **approved** creator see in their own area — their trips, each trip’s views/saves/bookings, total earned, payout status? (We have the scaffolding.)
72. Any per-reel performance (which video drove bookings), or just per-trip?
73. Notifications to the creator — booking happened, payout sent, trip needs attention? Channel?

## Q. Lifecycle & admin

74. States a creator can be in: **pending → active → paused → removed**. Who can move between them and why?
75. Can a creator **delete** their account / trips, and what happens to live links and pending commissions?
76. Re-approval — if paused/removed, can they come back?

---

### Notes on what we’ve already built (so you can mark “confirmed vs open”)

- Creator **sign-up/sign-in**: email + a one-time code sent through Trustsignal (the old fixed demo code `1234` is gone). Dedicated `/creators/join` page.
- **Moderation**: dashboard **Creators** tab — filter pending, approve, set commission (percentage or flat) + handle.
- **Make a trip**: paste a reel **or upload a video** → extract → itinerary (details → board) → **Save → affiliate link** (`/t/<code>`).
- **Attribution**: referral cookie, first-touch, 30-day window; commission recorded, **payout not wired** (no bookings/pricing yet).
- **Not built yet / needs client input**: WhatsApp/email delivery, the application form’s extra fields (where-posted, followers), rejection flow, the creator-reels discovery feed for travellers, reel-ID-back-to-trip matching, pricing/booking, payouts/KYC.
