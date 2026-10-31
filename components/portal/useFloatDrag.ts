"use client";

import { useCallback, useEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from "react";

export type Offset = { x: number; y: number };
export type Box = { left: number; top: number; right: number; bottom: number };

// A pointer that travels less than this is a click on the handle, not a drag.
const DRAG_THRESHOLD_PX = 4;
// A dragged float keeps this much of the frame around it.
const FRAME_MARGIN_PX = 8;

// How far a box may move by (dx, dy) without leaving the frame. With (0, 0) it
// is the nudge that brings a box that already sticks out back inside.
export function clampMove(box: Box, frame: Box, dx: number, dy: number, margin = FRAME_MARGIN_PX): Offset {
  return {
    x: Math.min(Math.max(dx, frame.left + margin - box.left), frame.right - margin - box.right),
    y: Math.min(Math.max(dy, frame.top + margin - box.top), frame.bottom - margin - box.bottom)
  };
}

// Owner 2026-10-30: the floating windows (people, chat) can be dragged anywhere
// over the screen they float on. Layout stays in CSS: the float rests where its
// stylesheet puts it and the hook only adds a translate, clamped to the float's
// positioned parent. A new `scope` (entering or leaving full screen) puts it
// back to rest; a window resize nudges it back inside.
export function useFloatDrag<T extends HTMLElement>(scope: unknown) {
  const ref = useRef<T>(null);
  const [offset, setOffset] = useState<Offset>({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);

  useEffect(() => setOffset({ x: 0, y: 0 }), [scope]);

  useEffect(() => {
    const keepInside = () => {
      const element = ref.current;
      const frame = element?.offsetParent;
      if (!element || !frame) return;
      const nudge = clampMove(element.getBoundingClientRect(), frame.getBoundingClientRect(), 0, 0);
      if (nudge.x || nudge.y) setOffset((current) => ({ x: current.x + nudge.x, y: current.y + nudge.y }));
    };
    window.addEventListener("resize", keepInside);
    return () => window.removeEventListener("resize", keepInside);
  }, []);

  const onPointerDown = useCallback((event: ReactPointerEvent<HTMLElement>) => {
    const element = ref.current;
    const frame = element?.offsetParent;
    if (!element || !frame || event.button !== 0) return;
    const start = { x: event.clientX, y: event.clientY };
    const box = element.getBoundingClientRect();
    const bounds = frame.getBoundingClientRect();
    const origin = offset;
    let moved = false;
    const move = (next: PointerEvent) => {
      const dx = next.clientX - start.x;
      const dy = next.clientY - start.y;
      if (!moved && Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) return;
      if (!moved) { moved = true; setDragging(true); }
      const step = clampMove(box, bounds, dx, dy);
      setOffset({ x: origin.x + step.x, y: origin.y + step.y });
    };
    const end = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", end);
      window.removeEventListener("pointercancel", end);
      if (!moved) return;
      setDragging(false);
      // The press that ends a drag is not also a click on the handle (no fold).
      const swallow = (click: MouseEvent) => { click.stopPropagation(); click.preventDefault(); };
      window.addEventListener("click", swallow, { capture: true, once: true });
      window.setTimeout(() => window.removeEventListener("click", swallow, { capture: true }), 0);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", end);
    window.addEventListener("pointercancel", end);
  }, [offset]);

  const style: CSSProperties | undefined = offset.x || offset.y ? { transform: `translate(${offset.x}px, ${offset.y}px)` } : undefined;
  return { ref, style, dragging, handle: { onPointerDown, "data-drag-handle": "" } };
}
