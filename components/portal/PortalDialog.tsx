"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { keepFocusInDialog } from "@/lib/dialogFocus";
import styles from "./portal-dialog.module.css";

/** Shared native modal: top-layer backdrop, focus containment and Escape handling. */
export function PortalDialog({ children, className, labelledBy, describedBy, onClose, busy = false }: {
  children: ReactNode; className?: string; labelledBy: string; describedBy?: string; onClose: () => void; busy?: boolean;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [target, setTarget] = useState<HTMLElement | null>(null);
  useEffect(() => { if (!className) setTarget(document.body); }, [className]);
  useEffect(() => {
    const node = dialog.current;
    if (!node) return;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    node?.showModal();
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { node?.close(); document.body.style.overflow = previousOverflow; previousFocus?.focus(); };
  }, [target]);
  const content = <dialog ref={dialog} className={className || styles.dialog} aria-labelledby={labelledBy} aria-describedby={describedBy} aria-busy={busy} onKeyDown={keepFocusInDialog} onCancel={event => { event.preventDefault(); if (!busy) onClose(); }}>{children}</dialog>;
  return className ? content : target ? createPortal(content, target) : null;
}
