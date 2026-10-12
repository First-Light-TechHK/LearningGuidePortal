"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { keepFocusInDialog } from "@/lib/dialogFocus";

/** Shared native modal: top-layer backdrop, focus containment and Escape handling. */
export function PortalDialog({ children, className, labelledBy, describedBy, onClose, busy = false }: {
  children: ReactNode; className?: string; labelledBy: string; describedBy?: string; onClose: () => void; busy?: boolean;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const node = dialog.current;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    node?.showModal();
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { node?.close(); document.body.style.overflow = previousOverflow; previousFocus?.focus(); };
  }, []);
  return <dialog ref={dialog} className={className} aria-labelledby={labelledBy} aria-describedby={describedBy} aria-busy={busy} onKeyDown={keepFocusInDialog} onCancel={event => { event.preventDefault(); if (!busy) onClose(); }}>{children}</dialog>;
}
