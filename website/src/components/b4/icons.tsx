/** Line icons drawn the way the prototype draws them: one path, round caps, no fill. */
export function Path({
  d,
  size = 19,
  stroke = "currentColor",
  width = 2,
  className,
}: {
  d: string;
  size?: number;
  stroke?: string;
  width?: number;
  className?: string;
}) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={stroke} strokeWidth={width} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className={className}>
      <path d={d} />
    </svg>
  );
}

export const ARROW = "M5 12h14M13 6l6 6-6 6";
export const CLOSE = "M6 6l12 12M18 6L6 18";
export const MENU = "M4 7h16M4 12h16M4 17h16";
export const CHECK = "M5 12l5 5 9-10";

export function Play({ size = 13 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="#072338" aria-hidden="true">
      <path d="M7 4l13 8-13 8z" />
    </svg>
  );
}

/** Arya's avatar: an italic "A" on the cyan-to-blue gradient. */
export function AryaMark({ size = 24, fontSize = 13 }: { size?: number; fontSize?: number }) {
  return (
    <span
      aria-hidden="true"
      className="font-display grid flex-none place-items-center rounded-full font-semibold italic text-white"
      style={{ width: size, height: size, fontSize, background: "linear-gradient(135deg,#22DDE0 0%,#1A6094 100%)" }}
    >
      A
    </span>
  );
}
