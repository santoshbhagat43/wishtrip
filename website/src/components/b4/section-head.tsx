import Link from "next/link";

/** Eyebrow, headline, lead and an optional "see all" link: right-aligned on desktop, below on phones. */
export function SectionHead({
  eyebrow,
  title,
  lead,
  link,
  dark = false,
  id,
}: {
  eyebrow: string;
  title: string;
  lead?: string;
  link?: { href: string; label: string };
  dark?: boolean;
  id?: string;
}) {
  return (
    <div className="mb-[18px] flex flex-col gap-1.5 md:mb-6 md:flex-row md:items-end md:justify-between md:gap-6">
      <span className="flex flex-col gap-1.5 md:gap-2.5">
        <span className={`text-[11px] font-bold tracking-[.16em] md:text-[12.5px] ${dark ? "text-[#6BEDEF]" : "text-[#0A7C80]"}`}>{eyebrow}</span>
        <h2
          id={id}
          className={`font-display m-0 text-[30px] font-medium leading-[1.1] tracking-[-0.015em] md:text-[46px] ${dark ? "text-white" : "text-[#0D2436]"}`}
        >
          {title}
        </h2>
        {lead && <span className={`text-[15px] leading-normal md:text-lg ${dark ? "text-[#C9DAE6]" : "text-[#3F5A72]"}`}>{lead}</span>}
      </span>
      {link && (
        <Link href={link.href} className="self-start whitespace-nowrap text-sm font-semibold text-[#0A7C80] underline md:self-auto md:text-[15px] md:no-underline">
          {link.label}
        </Link>
      )}
    </div>
  );
}

/** Filter chips: navy when chosen, outlined otherwise. A sideways rail on phones. */
export function Chips<T extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: readonly { id: T; label: string }[];
  value: T;
  onChange: (id: T) => void;
}) {
  return (
    <div role="group" aria-label={label} className="rail -mx-4 mb-3.5 flex gap-2 overflow-x-auto px-4 py-0.5 md:mx-0 md:mb-[22px] md:px-0">
      {options.map((o) => (
        <button
          key={o.id}
          type="button"
          onClick={() => onChange(o.id)}
          aria-pressed={value === o.id}
          className={`flex-none cursor-pointer rounded-full border-[1.5px] px-4 py-2.5 text-sm ${
            value === o.id ? "border-[#072338] bg-[#072338] font-semibold text-white" : "border-[#C7D5E1] bg-white font-medium text-[#0D2436]"
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
