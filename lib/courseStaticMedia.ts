/** Repository-owned seed images: canonical, course-scoped paths only. */
export function isCourseStaticImage(value: unknown, courseId: string): value is string {
  return typeof value === "string" && /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/.test(courseId)
    && value.startsWith(`/courses/${courseId}/`)
    && /^[a-zA-Z0-9_-]+\.(?:png|jpe?g|webp|gif)$/i.test(value.slice(`/courses/${courseId}/`.length));
}
