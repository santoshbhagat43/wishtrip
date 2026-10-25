"use client";

import { useEffect } from "react";

/** A creator's link is their page, /creator/<code>: opening it credits them, once a session. */
export function ReferralBeacon({ code }: { code: string }) {
  useEffect(() => {
    const key = `ref-visit:${code}`;
    try {
      if (sessionStorage.getItem(key)) return;
      sessionStorage.setItem(key, "1");
    } catch {
      // no storage: count it anyway
    }
    fetch(`/c/${encodeURIComponent(code)}?beacon=1`, { credentials: "same-origin" }).catch(() => {});
  }, [code]);
  return null;
}
