/** Arya's picture: the brand teal-to-navy circle with her italic initial (no stock face). */
export function AryaAvatar({ size = 40 }: { size?: number }) {
  return (
    <span
      aria-hidden
      style={{ width: size, height: size, fontSize: size * 0.48 }}
      className="grid flex-none place-items-center rounded-full bg-gradient-to-br from-[#22DDE0] to-[#0A7C80] font-display italic text-white shadow-sm"
    >
      A
    </span>
  );
}
