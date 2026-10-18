export const ADMIN = {
  email: process.env.ADMIN_EMAIL ?? "",
  password: process.env.ADMIN_PASSWORD ?? "",
};

export const API_URL = process.env.API_URL ?? "http://localhost:8000";

// The session cookie is scoped to the parent domain (.lvh.me locally), so the dashboard and the
// SSO app must be reached on sibling subdomains — not on localhost, which never sees the cookie.
export const DASHBOARD_URL = process.env.DASHBOARD_URL ?? "http://dashboard.lvh.me:3001";
export const SSO_URL = process.env.SSO_URL ?? "http://sso.lvh.me:3001";

if (!ADMIN.email || !ADMIN.password) {
  throw new Error("Set ADMIN_EMAIL and ADMIN_PASSWORD in the repo .env (see .env.example).");
}

/** Unique, recognisable names so test data is easy to spot and clean up. */
export function uniqueName(prefix: string) {
  return `E2E ${prefix} ${Date.now().toString(36)}`;
}
