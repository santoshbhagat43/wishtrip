/** Creator referral cookies: which creator's link a visitor came through, and who the visitor is. */
export const REF_COOKIE = "wishtrip_ref";
export const VISITOR_COOKIE = "wishtrip_visitor";
// The specific reel link (/r/<code>) the visitor came through; set only together with REF_COOKIE.
export const LINK_COOKIE = "wishtrip_link";
// First touch wins for this long; matches the backend's REFERRAL_WINDOW_DAYS.
export const REF_MAX_AGE = 60 * 60 * 24 * 30;
// On the parent domain (like the SSO session), so the SSO app — where people now sign up — can
// read which creator sent them. Unset ⇒ host-only, as before.
export const REF_COOKIE_DOMAIN = process.env.SESSION_COOKIE_DOMAIN || undefined;
