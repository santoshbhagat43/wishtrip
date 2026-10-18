import { ssoLoginUrl, SSO_URL } from "@/lib/server/sso";

// Rendered at request time: it builds absolute SSO URLs from env that isn't present at build.
export const dynamic = "force-dynamic";

/** Shown when a signed-in non-staff user lands on the dashboard. The shared SSO session is valid,
 *  it just isn't a staff account — so we offer to switch accounts rather than loop on the login. */
export default function NoAccessPage() {
  const websiteUrl = process.env.POST_LOGIN_FALLBACK_URL || SSO_URL || "/";
  const switchUrl = `${SSO_URL}/api/sso/logout?redirect=${encodeURIComponent(
    ssoLoginUrl(websiteUrl, "staff_only"),
  )}`;
  return (
    <main className="flex min-h-dvh items-center justify-center bg-bg p-6">
      <div className="flex w-full max-w-[460px] flex-col gap-5 rounded-[28px] border border-border bg-surface p-10 shadow-card">
        <p className="text-[11.5px] font-bold uppercase tracking-[0.14em] text-muted">Dashboard</p>
        <h1 className="text-[32px] leading-[1.1]">Staff only</h1>
        <p className="text-[15px] leading-normal text-muted">
          You&rsquo;re signed in, but this area is for the WishTrip team. Switch to a staff account
          to continue, or head back to WishTrip.
        </p>
        <div className="flex flex-wrap gap-3">
          <a
            href={switchUrl}
            className="flex h-[48px] items-center justify-center rounded-full bg-brand px-6 text-[15px] font-bold text-on-brand shadow-raised transition-colors hover:bg-brand-strong"
          >
            Sign in as staff
          </a>
          <a
            href={websiteUrl}
            className="flex h-[48px] items-center justify-center rounded-full border-[1.5px] border-border px-6 text-[15px] font-semibold transition-colors hover:border-brand"
          >
            Go to WishTrip
          </a>
        </div>
      </div>
    </main>
  );
}
