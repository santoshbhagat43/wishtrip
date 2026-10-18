import { CreatorHeader } from "@/components/creator/creator-header";

/** The creator site (creator.<domain>): its own header, not the traveller site's navigation. */
export default function CreatorLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <div className="min-h-dvh bg-bg">
      <CreatorHeader />
      <main className="px-4 py-8 sm:px-8">{children}</main>
    </div>
  );
}
