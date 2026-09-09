import type { KeyboardEvent } from "react";

export function keepFocusInDialog(event: KeyboardEvent<HTMLDialogElement>) {
  if (event.key !== "Tab") return;
  const candidates = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href], [tabindex="0"]')).filter((element) => element.tabIndex >= 0 && element.getClientRects().length > 0);
  const controls = candidates.filter((element) => {
    if (!(element instanceof HTMLInputElement) || element.type !== "radio" || !element.name) return true;
    const group = candidates.filter((item): item is HTMLInputElement => item instanceof HTMLInputElement && item.type === "radio" && item.name === element.name);
    return element === (group.find((item) => item.checked) || group[0]);
  });
  event.preventDefault();
  if (!controls.length) return;
  const index = controls.indexOf(document.activeElement as HTMLElement);
  const next = index < 0 ? (event.shiftKey ? controls.length - 1 : 0) : (index + (event.shiftKey ? -1 : 1) + controls.length) % controls.length;
  controls[next].focus();
}
