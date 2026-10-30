/**
 * Site gate: while the traveler site is private, every request needs a cookie that proves the
 * visitor entered SITE_USER / SITE_PASSWORD on /gate.
 *
 * Production fails closed: the gate is always on, whatever SITE_PASSWORD says, until launch day
 * sets SITE_PUBLIC=true. A missing or weak password then locks everyone out instead of opening
 * the site. Locally (next dev, tests) it is on only when SITE_PASSWORD is set.
 *
 * This replaces HTTP basic auth, which browsers forget whenever the app itself answers 401
 * (as /api/wt/auth/me does for anyone not signed in as a traveler) — so it asked again on
 * every refresh.
 */
export const GATE_COOKIE = "wt_gate";
export const GATE_DAYS = 30;

export function gateEnabled() {
  if (process.env.NODE_ENV === "production") return process.env.SITE_PUBLIC !== "true";
  const password = process.env.SITE_PASSWORD;
  return !!password && password !== "off";
}

/** A password the gate accepts at all: never blank, never the old "off" switch. */
export function usablePassword() {
  const password = process.env.SITE_PASSWORD ?? "";
  return password.length >= 8 && password !== "off" ? password : null;
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
