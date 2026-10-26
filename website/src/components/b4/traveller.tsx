"use client";

import { useMe } from "@/lib/session";

/** The signed-in traveller's initial, as the prototype shows it in the header. */
export function Avatar({ size = 32, letter = "A" }: { size?: number; letter?: string }) {
  return (
    <span
      aria-hidden="true"
      className="font-display grid flex-none place-items-center rounded-full text-white"
      style={{ width: size, height: size, fontSize: size * 0.44, background: "linear-gradient(145deg,#1A6094,#0B3050)" }}
    >
      {letter}
    </span>
  );
}

/** Who is signed in on this page (the headers show them instead of "Sign in"). */
export function useTraveller() {
  const me = useMe();
  const user = me.data;
  const name = user ? user.full_name || user.email.split("@")[0] : undefined;
  return { signedIn: !!user, name, loading: me.isLoading };
}
