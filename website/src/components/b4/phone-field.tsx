"use client";

import {
  getCountries,
  getCountryCallingCode,
  parsePhoneNumberFromString,
  type CountryCode,
} from "libphonenumber-js";
import { useSyncExternalStore } from "react";

/** Countries most creators will apply from, shown above the full A–Z list. */
const POPULAR: CountryCode[] = ["IN", "AE", "GB", "US", "SG", "AU", "CA"];

const regionNames = new Intl.DisplayNames(["en"], { type: "region" });

/** 🇮🇳 from "IN": each letter maps to its regional-indicator symbol. (Windows shows the letters.) */
function flag(country: string) {
  return String.fromCodePoint(...[...country].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65));
}

const ALL = getCountries()
  .map((code) => ({ code, name: regionNames.of(code) ?? code, dial: getCountryCallingCode(code) }))
  .sort((a, b) => a.name.localeCompare(b.name));
const BY_CODE = new Map(ALL.map((c) => [c.code, c]));

// Country names come from Intl, and Node and browsers disagree on a few (Node says "Falkland
// Islands (Islas Malvinas)"), so the full list is rendered in the browser only — the server and
// the hydrating render show just the current country. The visible chip is identical either way.
const noop = () => () => {};
function useInBrowser() {
  return useSyncExternalStore(noop, () => true, () => false);
}

export function countryName(code: CountryCode) {
  return BY_CODE.get(code)?.name ?? code;
}

/** The number in international format (+919876543210) — or null if it isn't a valid number. */
export function toE164(country: CountryCode, number: string): string | null {
  const parsed = parsePhoneNumberFromString(number, country);
  return parsed?.isValid() ? parsed.number : null;
}

/**
 * Country code + number. The country is a native <select> (keyboard search, the phone's own
 * picker, screen-reader friendly) drawn as a compact "🇮🇳 +91" chip on top.
 */
export function PhoneField({
  country,
  number,
  onChange,
  inputClassName,
}: {
  country: CountryCode;
  number: string;
  onChange: (country: CountryCode, number: string) => void;
  inputClassName: string;
}) {
  const current = BY_CODE.get(country);
  const inBrowser = useInBrowser();

  // A pasted "+44 7400 123456" carries its own country: switch the picker to match.
  function adoptInternational() {
    if (!number.trim().startsWith("+")) return;
    const parsed = parsePhoneNumberFromString(number);
    if (parsed?.country) onChange(parsed.country, parsed.formatNational());
  }

  return (
    <span className="flex gap-2">
      <span className={`relative flex shrink-0 items-center gap-1.5 ${inputClassName}`}>
        <span aria-hidden className="text-[18px] leading-none">
          {flag(country)}
        </span>
        <span aria-hidden className="font-semibold tracking-normal">+{current?.dial}</span>
        <svg aria-hidden viewBox="0 0 24 24" className="size-3.5 text-[#5F6B78]" fill="none" stroke="currentColor" strokeWidth={2.4}>
          <path d="M6 9l6 6 6-6" />
        </svg>
        <select
          aria-label="Country code"
          value={country}
          onChange={(e) => onChange(e.target.value as CountryCode, number)}
          className="absolute inset-0 cursor-pointer opacity-0"
        >
          {inBrowser ? (
            <>
              <optgroup label="Popular">
                {POPULAR.map((code) => (
                  <option key={`p-${code}`} value={code}>
                    {flag(code)} {countryName(code)} (+{getCountryCallingCode(code)})
                  </option>
                ))}
              </optgroup>
              <optgroup label="All countries">
                {ALL.map((c) => (
                  <option key={c.code} value={c.code}>
                    {flag(c.code)} {c.name} (+{c.dial})
                  </option>
                ))}
              </optgroup>
            </>
          ) : (
            <option value={country}>
              {flag(country)} +{current?.dial}
            </option>
          )}
        </select>
      </span>
      <input
        type="tel"
        inputMode="tel"
        autoComplete="tel-national"
        aria-label="WhatsApp number"
        value={number}
        onChange={(e) => onChange(country, e.target.value)}
        onBlur={adoptInternational}
        placeholder={country === "IN" ? "98765 43210" : "Phone number"}
        className={`min-w-0 flex-1 ${inputClassName}`}
      />
    </span>
  );
}
