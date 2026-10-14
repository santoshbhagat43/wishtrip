"use client";

import { useState } from "react";

import { AuthForm } from "@/components/auth-form";
import { CreatorAuth } from "@/components/creator-auth";

type Who = "traveler" | "creator";

/** Login/signup with a choice between a traveller account and a creator account. */
export function AuthPanel({ mode }: { mode: "login" | "signup" }) {
  const [who, setWho] = useState<Who>("traveler");
  const tabs: [Who, string][] = [
    ["traveler", "I'm a traveller"],
    ["creator", "I'm a creator"],
  ];
  return (
    <div className="mx-auto flex max-w-sm flex-col px-4 py-12">
      <div role="tablist" aria-label="Account type" className="mb-6 grid grid-cols-2 gap-1 rounded-full border border-border bg-surface-2 p-1">
        {tabs.map(([id, label]) => (
          <button
            key={id}
            role="tab"
            aria-selected={who === id}
            onClick={() => setWho(id)}
            className={`cursor-pointer rounded-full px-3 py-2 text-sm font-semibold transition-colors ${who === id ? "bg-surface text-text shadow-card" : "text-muted hover:text-text"}`}
          >
            {label}
          </button>
        ))}
      </div>
      {who === "traveler" ? <AuthForm mode={mode} embedded /> : <CreatorAuth />}
    </div>
  );
}
