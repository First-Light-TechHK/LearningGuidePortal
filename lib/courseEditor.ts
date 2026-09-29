export type CourseStatus = "draft" | "published" | "archived";

export type CourseEditorGate = "open" | "unpublish" | "restore";

export type OutlineSelection = { sectionId: string; lessonId: string | null };

export function courseEditorGate(status: CourseStatus): CourseEditorGate {
  if (status === "published") return "unpublish";
  if (status === "archived") return "restore";
  return "open";
}

export function resolveOutlineSelection(
  sections: { id: string; lessons: { id: string }[] }[],
  selection: OutlineSelection | null
): OutlineSelection | null {
  if (!sections.length) return null;
  const section = selection && sections.find((item) => item.id === selection.sectionId);
  if (!section) return { sectionId: sections[0].id, lessonId: sections[0].lessons[0]?.id ?? null };
  const lesson = selection.lessonId ? section.lessons.find((item) => item.id === selection.lessonId) : undefined;
  return { sectionId: section.id, lessonId: lesson?.id ?? section.lessons[0]?.id ?? null };
}
