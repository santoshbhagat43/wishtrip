/**
 * Site gate: while the traveler site is private, every request needs a cookie that proves the
 * visitor entered SITE_USER / SITE_PASSWORD on /gate. Off when SITE_PASSWORD isn't set (local
 * development, tests).
 *
 * This replaces HTTP basic auth, which browsers forget whenever the app itself answers 401
 * (as /api/wt/auth/me does for anyone not signed in as a traveler) — so it asked again on
 * every refresh. SITE_PASSWORD=off turns it off.
 */
export const GATE_COOKIE = "wt_gate";
export const GATE_DAYS = 30;

export function gateEnabled() {
  const password = process.env.SITE_PASSWORD;
  return !!password && password !== "off"; // "off" makes the site public
}

/** The cookie value: an HMAC of the credentials, so the password itself is never stored. */
export async function gateToken(user = process.env.SITE_USER ?? "", password = process.env.SITE_PASSWORD ?? "") {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`wishtrip-gate:${user}`));
  return Array.from(new Uint8Array(mac), (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Constant-time comparison, so a wrong guess takes as long as a right one. */
export function sameText(a: string, b: string) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** Only ever send people back to a path on this site (never an open redirect). */
export function safeNext(next: string | null) {
  return next && next.startsWith("/") && !next.startsWith("//") ? next : "/";
}
