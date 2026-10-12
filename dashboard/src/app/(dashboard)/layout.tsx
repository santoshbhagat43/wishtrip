"use client";

import { Menu, X } from "lucide-react";
import Image from "next/image";
import { useState } from "react";

import { Sidebar } from "@/components/sidebar";

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-[248px_1fr]">
      <aside className="sticky top-0 hidden h-dvh border-r border-border bg-surface lg:block">
        <Sidebar />
      </aside>
      <header className="sticky top-0 z-20 flex items-center justify-between border-b border-border bg-surface px-4 py-3 lg:hidden">
        <Image src="/logo.png" alt="WishTrip" width={909} height={351} className="h-7 w-auto dark:brightness-0 dark:invert" />
        <button aria-label="Open menu" onClick={() => setOpen(true)}>
          <Menu className="size-5" />
        </button>
      </header>
      {open && (
        <div className="fixed inset-0 z-30 lg:hidden">
          <div className="absolute inset-0 bg-black/40" onClick={() => setOpen(false)} />
          <aside className="absolute inset-y-0 left-0 w-64 bg-surface shadow-xl">
            <button aria-label="Close menu" className="absolute right-3 top-4" onClick={() => setOpen(false)}>
              <X className="size-5" />
            </button>
            <Sidebar onNavigate={() => setOpen(false)} />
          </aside>
        </div>
      )}
      <main className="min-w-0 px-4 py-6 sm:px-8 lg:py-7">{children}</main>
    </div>
  );
}
