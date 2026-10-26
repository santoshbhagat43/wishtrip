"""The words of each transactional email: subject and plain-text body (the HTML is in templates/).

Placeholders are `{{name}}`; `service.render` fills them. Copy follows the Wishtrip creator-program
email templates (Prateek Jawalkar, Co-founder)."""

PROGRAM = "[Travel Inspiration Creator Program]"

SIGNATURE = """Regards,
Prateek Jawalkar
Co-founder
wishtrip — https://wishtrip.co/"""

FOOTER = """—
You're receiving this email because you applied to the Wishtrip Travel Inspiration Creator Program.
Questions? Write to us at {{support_email}}
© {{current_year}} Wishtrip"""

SUBJECTS = {
    "application-received": PROGRAM + " We've received your application, {{first_name}}",
    "approved": PROGRAM + " Welcome aboard, {{first_name}}! One last step to go live",
    "rejected": PROGRAM + " An update on your application",
    "bank-details-reminder": PROGRAM + " {{first_name}}, your trip links are waiting",
    "account-active": PROGRAM + " You're all set, {{first_name}} — your account is active",
    "sign-in-code": "{{code}} is your WishTrip sign-in code",
}

_BODIES = {
    "application-received": """Hi {{first_name}},

I'm Prateek, Co-founder of Wishtrip. Thank you for applying to the Travel Inspiration Creator Program — really glad you'd like to be a part of it.

Our team is now reviewing your profile and content. You'll hear back from us within {{review_days}} days.

Your onboarding: [✓] Apply  →  [2] Review  →  [3] Bank details  →  [4] Trip links live

A QUICK BRIEF ABOUT WISHTRIP
Wishtrip is an inspiration-led travel platform that transforms the trips people discover and dream about into personalised, bookable travel experiences.
We believe travel creators do much more than create content — they inspire people to explore the world. And we want to bridge the gap between that inspiration and the actual travel experience.

We're starting with a small group of creators who share our passion for travel, authentic storytelling, and meaningful experiences. While you wait, take a look around:

Explore Wishtrip → https://wishtrip.co

Should you have any questions, let me know.""",
    "approved": """Hi {{first_name}},

Great news — your application has been approved. We're excited to have you on board as a Wishtrip Travel Inspiration Creator Partner.

There's just one step left: add your bank details. This is how we pay out your earnings, and it unlocks trip link generation on your creator dashboard.

Add bank details → {{bank_details_link}}

Your onboarding: [✓] Apply  →  [✓] Review  →  [3] Bank details  →  [4] Trip links live

AS A CREATOR PARTNER, YOU'LL HAVE THE OPPORTUNITY TO:
- Turn your content into real travel experiences — Help your audience discover and plan trips inspired by the destinations and experiences you showcase.
- Make your travel recommendations actionable — Go beyond inspiring your followers by helping them turn your recommendations into personalised itineraries and bookings.
- Earn from the travel you inspire — Receive upto 20% revenue share on Wishtrip Attributed Revenue generated through your content, subject to the partnership terms.
- Collaborate as an early partner — Work closely with our founding team, contribute ideas, and help shape how creators and travellers interact on the platform.

Should you have any questions, let me know.""",
    "rejected": """Hi {{first_name}},

Thank you for applying to the Travel Inspiration Creator Program and for sharing your content with us — we genuinely appreciate the time you took.

We're starting with a small group of creators for our early partner cohort, and after careful review we're not able to move ahead with your application right now.

This isn't a closed door. You're welcome to apply again after {{reapply_days}} days — we'd love to see what you've been creating by then.

In the meantime, you can keep up with what we're building at Wishtrip:

Explore Wishtrip → https://wishtrip.co

Thank you again for your interest in Wishtrip. Should you have any questions, let me know.""",
    "bank-details-reminder": """Hi {{first_name}},

Just a quick nudge — it's been {{days_since_approval}} days since you were approved for the Travel Inspiration Creator Program, and we haven't received your bank details yet.

Once you add them, trip link generation unlocks on your dashboard. Add your personal link to your content — "Want this trip? Book on Wishtrip" — and followers who come through it are tagged to you.

Add bank details → {{bank_details_link}}

Your onboarding: [✓] Apply  →  [✓] Review  →  [3] Bank details  →  [4] Trip links live

Looking forward to hearing back from you, so that the onboarding process can be completed. Should you have any questions, let me know.""",
    "account-active": """Hi {{first_name}},

Your bank details are confirmed and your Wishtrip creator account is now active. Exciting times ahead!

Your personalised creator dashboard is ready. That's where you generate your personal trip links and add them to the reels and content of trips you've taken.

Open your dashboard → {{dashboard_link}}

Your onboarding: [✓] Apply  →  [✓] Review  →  [✓] Bank details  →  [✓] Trip links live

HOW IT WORKS FROM HERE
- "Want this trip? Book on Wishtrip" — Add your personal link. Followers who come through it are tagged to you.
- We make your trip bookable — Flights, hotels, experiences & transfers booked in one single checkout.
- We handle everything else — Bookings, payments & customer support.
- You get paid, for life — Paid after each trip is completed. Track every booking in your dashboard.

Let's turn travel inspiration into journeys worth taking.

Should you have any questions, let me know.""",
}

TEXTS = {name: f"{body}\n\n{SIGNATURE}\n\n{FOOTER}" for name, body in _BODIES.items()}

TEXTS["sign-in-code"] = """Your WishTrip sign-in code is {{code}}

It works once and expires in {{expires_minutes}} minutes. If you didn't ask for it, you can ignore this email.

Never share this code with anyone. WishTrip will never ask you for it.

—
Questions? Write to us at {{support_email}}
© {{current_year}} Wishtrip"""

TEMPLATES = tuple(SUBJECTS)
