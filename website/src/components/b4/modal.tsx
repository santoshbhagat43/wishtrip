"use client";

import { X } from "lucide-react";
import { useEffect, useRef, type ReactNode } from "react";

/** A dialog over the page: closes on Escape, on the backdrop and on the close button. */
export function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const close = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    close.current?.focus();
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = overflow;
    };
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-[#041A2C]/55 p-0 md:items-center md:p-6" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div role="dialog" aria-modal="true" aria-label={title} className="flex max-h-[92dvh] w-full max-w-[760px] flex-col overflow-hidden rounded-t-[26px] bg-white text-[#0D2436] shadow-2xl md:rounded-[26px]">
        <div className="flex items-center justify-between gap-3 border-b border-[#E8EDF2] px-5 py-3.5">
          <strong className="truncate text-[16px]">{title}</strong>
          <button ref={close} type="button" aria-label="Close" onClick={onClose} className="grid size-9 flex-none place-items-center rounded-full hover:bg-[#F3F6F9]">
            <X className="size-5" />
          </button>
        </div>
        <div className="overflow-y-auto p-5">{children}</div>
      </div>
    </div>
  );
}
