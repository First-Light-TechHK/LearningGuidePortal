/** Reading navigation is measured even while hidden, so restored anchors can reserve it. */
export function readingViewportTop(surface: Element) {
  const header = document.querySelector<HTMLElement>(".portal-header");
  const headerTop = header && ["fixed", "sticky"].includes(getComputedStyle(header).position) ? Math.max(0, header.getBoundingClientRect().bottom) : 0;
  const page = surface.closest("[data-course-id]");
  const toolbar = page?.querySelector<HTMLElement>("[data-reading-toolbar]");
  const breadcrumb = page?.querySelector("[data-lesson-breadcrumb]");
  // Scroll tracking can run before React commits the toolbar's visibility.
  const toolbarVisible = toolbar?.dataset.visible === "true" || (breadcrumb && breadcrumb.getBoundingClientRect().bottom <= 0);
  return Math.max(headerTop, toolbar && toolbarVisible ? toolbar.getBoundingClientRect().bottom : 0);
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
