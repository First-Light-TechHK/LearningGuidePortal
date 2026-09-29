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

type OutcomeSource = {
  id?: string;
  outcomes?: unknown;
  categoryId?: string | null;
  subjectId?: string | null;
};

function catalogueParent(id: string, catalogue: readonly CatalogueCategoryRef[]) {
  const row = catalogue.find((item) => item.id === id);
  if (!row) return undefined;
  if (!row.parentId) return row;
  return catalogue.find((item) => item.id === row.parentId && !item.parentId);
}

/** Portal id for a catalogue parent. Its id wins; its name counts only when it names that same category. */
function portalIdForCatalogueParent(parent: CatalogueCategoryRef, categories: readonly PortalCategory[]) {
  const byId = matchPortalCategory(parent.id, categories);
  if (byId) return byId.id;
  return matchPortalCategory(parent.name, categories)?.id || "";
}

/**
 * Portal category id for this course, or "".
 * categoryId wins: a portal match (id, slug, or locale label), otherwise the
 * catalogue parent it names (a subject row walks up to that parent).
 * A catalogue name is used only when it names that same portal category.
 * Legacy category is used only when it names that same category, or when the
 * course has no categoryId. An empty course stays empty.
 */
export function courseCategoryId(
  course: CourseCategoryRef | null | undefined,
  categories: readonly PortalCategory[],
  catalogue: readonly CatalogueCategoryRef[] = [],
): string {
  if (!course) return "";
  const categoryId = course.categoryId?.trim() || "";
  const subjectId = course.subjectId?.trim() || "";
  const legacy = course.category?.trim() || "";
  const direct = categoryId ? matchPortalCategory(categoryId, categories) : undefined;
  if (direct) return direct.id;
  if (categoryId) {
    const parent = catalogueParent(categoryId, catalogue);
    if (parent) return portalIdForCatalogueParent(parent, categories);
  }
  if (subjectId) {
    const parent = catalogueParent(subjectId, catalogue);
    if (parent && parent.id !== subjectId) return portalIdForCatalogueParent(parent, categories);
  }
  if (categoryId && legacy) {
    const legacyMatch = matchPortalCategory(legacy, categories);
    if (legacyMatch && categorySlug(legacyMatch.id) === categorySlug(categoryId)) return legacyMatch.id;
    return "";
  }
  if (!categoryId && legacy) return matchPortalCategory(legacy, categories)?.id || "";
  return "";
}

/** Locale label for the course’s own category. Empty when the course has none — never a slug. */
export function courseCategoryLabel(
  course: CourseCategoryRef | null | undefined,
  categories: readonly PortalCategory[],
  locale: Locale,
  catalogue: readonly CatalogueCategoryRef[] = [],
): string {
  const id = courseCategoryId(course, categories, catalogue);
  if (!id) return "";
  return categories.find((item) => item.id === id)?.labels[locale] || "";
}

/** Outcomes stored on the course, then on its own subject or category row. Never another course’s list. */
export function courseLearningOutcomes(course: OutcomeSource | null | undefined, catalogue: readonly OutcomeSource[] = []) {
  const own = normalisedOutcomes(course?.outcomes);
  if (own.length) return own;
  if (!course) return [];
  const subjectId = course.subjectId?.trim();
  const categoryId = course.categoryId?.trim();
  const subject = subjectId ? catalogue.find((entry) => entry.id === subjectId) : undefined;
  const category = categoryId ? catalogue.find((entry) => entry.id === categoryId) : undefined;
  for (const entry of [subject, category]) {
    const outcomes = normalisedOutcomes(entry?.outcomes);
    if (outcomes.length) return outcomes;
  }
  return [];
}

function normalisedOutcomes(value: unknown) {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const outcomes: string[] = [];
  for (const item of value) {
    if (typeof item !== "string") continue;
    const text = item.trim();
    if (!text || seen.has(text)) continue;
    seen.add(text);
    outcomes.push(text);
  }
  return outcomes;
}
