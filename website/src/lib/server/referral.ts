/** Creator referral cookies: which creator's link a visitor came through, and who the visitor is. */
export const REF_COOKIE = "wishtrip_ref";
export const VISITOR_COOKIE = "wishtrip_visitor";
// First touch wins for this long; matches the backend's REFERRAL_WINDOW_DAYS.
export const REF_MAX_AGE = 60 * 60 * 24 * 30;
