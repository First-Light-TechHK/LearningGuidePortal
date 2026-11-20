/** Reading navigation is measured even while hidden, so restored anchors can reserve it. */
export function readingViewportTop(surface: Element) {
  const header = document.querySelector<HTMLElement>(".portal-header");
  const headerTop = header && ["fixed", "sticky"].includes(getComputedStyle(header).position) ? Math.max(0, header.getBoundingClientRect().bottom) : 0;
  const toolbar = surface.closest("[data-course-id]")?.querySelector<HTMLElement>('[data-reading-toolbar][data-visible="true"]');
  return Math.max(headerTop, toolbar?.getBoundingClientRect().bottom || 0);
}

export function readingTargetTop(surface: Element, target: Element) {
  const page = surface.closest("[data-course-id]");
  const toolbar = page?.querySelector<HTMLElement>("[data-reading-toolbar]");
  const breadcrumb = page?.querySelector<HTMLElement>("[data-lesson-breadcrumb]");
  if (!toolbar || !breadcrumb) return readingViewportTop(surface);
  const height = toolbar.getBoundingClientRect().height;
  // The compact bar only takes over after the original navigation leaves the viewport.
  return target.getBoundingClientRect().top - height - 12 >= breadcrumb.getBoundingClientRect().bottom
    ? Math.max(height, readingViewportTop(surface)) : readingViewportTop(surface);
}
