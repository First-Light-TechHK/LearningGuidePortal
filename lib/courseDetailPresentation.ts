import type { Locale } from "@/lib/i18n/config";
import type { PortalCategory } from "@/lib/portalContent";
import type { ProductLesson, ProductPlan } from "@/services/productStore";

export type CourseCategoryRef = {
  category?: string | null;
  categoryId?: string | null;
  subjectId?: string | null;
};

export type CatalogueCategoryRef = {
  id: string;
  name: string;
  parentId?: string | null;
};

/** Display actual media duration; never infer it from the lesson's position. */
export function courseLessonDuration(lesson?: Pick<ProductLesson, "durationMinutes" | "videoDurationSeconds">) {
  if (!lesson) return "—";
  const seconds = Math.max(0, Math.round(lesson.videoDurationSeconds ?? lesson.durationMinutes * 60));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

export function courseCategoryPlan(plans: ProductPlan[], category: string) {
  return plans.find((plan) => plan.scope === "category" && plan.device === "pc" &&
    plan.termMonths === 6 && plan.available !== false && (plan.scopeId || plan.category) === category);
}

function categorySlug(value: string) {
  return value.trim().toLocaleLowerCase().replace(/[\s_]+/g, "-");
}

/** Match a stored id, slug, or locale label to a portal category. */
export function matchPortalCategory(value: string, categories: readonly PortalCategory[]) {
  const raw = value.trim();
  if (!raw) return undefined;
  const slug = categorySlug(raw);
  return categories.find((item) => item.id === raw
    || categorySlug(item.id) === slug
    || Object.values(item.labels).some((label) => label === raw || categorySlug(label) === slug));
}

function catalogueCategoryEntry(course: CourseCategoryRef, catalogue: readonly CatalogueCategoryRef[]) {
  const categoryId = course.categoryId?.trim();
  if (categoryId) return catalogue.find((item) => item.id === categoryId && !item.parentId);
  const subjectId = course.subjectId?.trim();
  if (!subjectId) return undefined;
  const subject = catalogue.find((item) => item.id === subjectId && item.parentId);
  if (!subject?.parentId) return undefined;
  return catalogue.find((item) => item.id === subject.parentId && !item.parentId);
}

/**
 * Portal category id for this course.
 * categoryId (then its subject’s parent) wins over the legacy category field.
 * An empty course stays empty — it is not filed under another category.
 */
export function courseCategoryId(
  course: CourseCategoryRef | null | undefined,
  categories: readonly PortalCategory[],
  catalogue: readonly CatalogueCategoryRef[] = [],
): string {
  if (!course) return "";
  const entry = catalogueCategoryEntry(course, catalogue);
  if (entry) return matchPortalCategory(entry.name, categories)?.id || entry.name;
  const storedId = course.categoryId?.trim() || "";
  if (storedId) {
    const direct = matchPortalCategory(storedId, categories);
    if (direct) return direct.id;
    const legacy = course.category?.trim() || "";
    const legacyMatch = legacy ? matchPortalCategory(legacy, categories) : undefined;
    if (legacyMatch && categorySlug(legacyMatch.id) === categorySlug(storedId)) return legacyMatch.id;
    return storedId;
  }
  const legacy = course.category?.trim() || "";
  if (!legacy) return "";
  return matchPortalCategory(legacy, categories)?.id || legacy;
}

/** Locale label for the course’s own category. Empty when the course has none. */
export function courseCategoryLabel(
  course: CourseCategoryRef | null | undefined,
  categories: readonly PortalCategory[],
  locale: Locale,
  catalogue: readonly CatalogueCategoryRef[] = [],
): string {
  const id = courseCategoryId(course, categories, catalogue);
  if (!id) return "";
  return categories.find((item) => item.id === id)?.labels[locale] || id;
}
