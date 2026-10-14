import { SiteHeader } from "@/components/site-header";

/** The app pages (explore, plan, profile…) keep the current header and footer for now. */
export default function SiteLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <>
      <SiteHeader />
      <main className="min-h-[calc(100dvh-8rem)]">{children}</main>
      <footer className="border-t border-border px-4 py-6 text-center text-sm text-muted">
        WishTrip · Experiences, made for you. <span className="mx-1">·</span> MVP preview — prices and booking aren&apos;t live yet.
      </footer>
    </>
  );
}
