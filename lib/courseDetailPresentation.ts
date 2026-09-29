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

/**
 * Portal category id for a learner-facing surface.
 * A categoryId that already names a portal category wins over a legacy field and over a catalogue name for a different category.
 * A subject never becomes the category. A course with no category stays empty.
 */
export function courseSurfaceCategoryId(
  course: CourseCategoryRef | null | undefined,
  categories: readonly PortalCategory[],
  catalogue: readonly CatalogueCategoryRef[] = [],
): string {
  if (!course) return "";
  const storedId = course.categoryId?.trim() || "";
  if (storedId) {
    const direct = matchPortalCategory(storedId, categories);
    if (direct) return direct.id;
    const entry = catalogue.find((item) => item.id === storedId && !item.parentId);
    if (entry) return matchPortalCategory(entry.name, categories)?.id || entry.name;
    return storedId;
  }
  const legacy = course.category?.trim() || "";
  if (!legacy) return "";
  return matchPortalCategory(legacy, categories)?.id || legacy;
}

/** Locale label for {@link courseSurfaceCategoryId}. Empty when that id is empty. */
export function courseSurfaceCategoryLabel(
  course: CourseCategoryRef | null | undefined,
  categories: readonly PortalCategory[],
  locale: Locale,
  catalogue: readonly CatalogueCategoryRef[] = [],
): string {
  const id = courseSurfaceCategoryId(course, categories, catalogue);
  if (!id) return "";
  return categories.find((item) => item.id === id)?.labels[locale] || id;
}

export type CourseBreadcrumbCrumb = {
  label: string;
  href: string | null;
  current: boolean;
};

/** Home / Courses / category / course info. The category crumb is omitted when the course has none. */
export function courseBreadcrumb(input: {
  locale: Locale;
  homeLabel: string;
  coursesLabel: string;
  courseInfoLabel: string;
  course: CourseCategoryRef | null | undefined;
  categories: readonly PortalCategory[];
  catalogue?: readonly CatalogueCategoryRef[];
}): CourseBreadcrumbCrumb[] {
  const catalogue = input.catalogue ?? [];
  const catalogHref = `/${input.locale}/portal/courses`;
  const crumbs: CourseBreadcrumbCrumb[] = [
    { label: input.homeLabel, href: `/${input.locale}/portal`, current: false },
    { label: input.coursesLabel, href: catalogHref, current: false },
  ];
  const categoryId = courseSurfaceCategoryId(input.course, input.categories, catalogue);
  const label = courseSurfaceCategoryLabel(input.course, input.categories, input.locale, catalogue);
  if (categoryId && label) {
    crumbs.push({
      label,
      href: `${catalogHref}?category=${encodeURIComponent(categoryId)}`,
      current: false,
    });
  }
  crumbs.push({ label: input.courseInfoLabel, href: null, current: true });
  return crumbs;
}

/** Category chip beside the course title. Absent when the course has no category. */
export function courseTrackChip(
  course: CourseCategoryRef | null | undefined,
  categories: readonly PortalCategory[],
  locale: Locale,
  catalogue: readonly CatalogueCategoryRef[] = [],
): { categoryId: string; label: string } | null {
  const categoryId = courseSurfaceCategoryId(course, categories, catalogue);
  const label = courseSurfaceCategoryLabel(course, categories, locale, catalogue);
  if (!categoryId || !label) return null;
  return { categoryId, label };
}

export type CatalogueFilterChip = { id: string; label: string; active: boolean };

/** Catalogue chips and the courses that belong to the requested portal category id. */
export function catalogueFilterState<T extends CourseCategoryRef>(input: {
  requestedCategory: string;
  courses: readonly T[];
  categories: readonly PortalCategory[];
  catalogue?: readonly CatalogueCategoryRef[];
  locale: Locale;
  allLabel: string;
}): { chips: CatalogueFilterChip[]; visible: T[] } {
  const catalogue = input.catalogue ?? [];
  const requested = (input.requestedCategory || "All").trim() || "All";
  const chips: CatalogueFilterChip[] = [
    { id: "All", label: input.allLabel, active: requested === "All" },
    ...input.categories.map((item) => ({
      id: item.id,
      label: item.labels[input.locale],
      active: requested === item.id,
    })),
  ];
  const visible = requested === "All"
    ? [...input.courses]
    : input.courses.filter((course) => courseSurfaceCategoryId(course, input.categories, catalogue) === requested);
  return { chips, visible };
}

/** Category line on a catalogue card and on a home card. */
export function courseCardCategoryLine(
  course: CourseCategoryRef | null | undefined,
  categories: readonly PortalCategory[],
  locale: Locale,
  catalogue: readonly CatalogueCategoryRef[] = [],
): string {
  return courseSurfaceCategoryLabel(course, categories, locale, catalogue);
}

/** Category segment of a My Learning meta line, then lesson count and state. */
export function myLearningMetaLine(input: {
  categoryId: string;
  categories: readonly PortalCategory[];
  locale: Locale;
  lessonCount: number;
  lessonsWord: string;
  stateLabel: string;
}): string {
  const label = input.categoryId
    ? input.categories.find((item) => item.id === input.categoryId)?.labels[input.locale] || input.categoryId
    : "";
  return [label, `${input.lessonCount} ${input.lessonsWord}`, input.stateLabel].filter(Boolean).join(" · ");
}

/** Category line on a public-lesson recommendation card. */
export function publicLessonRecommendationCategory(
  course: CourseCategoryRef | null | undefined,
  categories: readonly PortalCategory[],
  locale: Locale,
  catalogue: readonly CatalogueCategoryRef[] = [],
): string {
  return courseSurfaceCategoryLabel(course, categories, locale, catalogue);
}

/** Portal category id used to group a course on Pricing. Empty when the course has none. */
export function pricingCourseGroup(
  course: CourseCategoryRef | null | undefined,
  categories: readonly PortalCategory[],
  catalogue: readonly CatalogueCategoryRef[] = [],
): string {
  return courseSurfaceCategoryId(course, categories, catalogue);
}

/** Titles listed under one pricing category. A null category id lists every title. */
export function listedPricingCourseTitles(
  courseTitles: readonly { category?: string | null; title: string }[],
  categoryId: string | null,
): string[] {
  return courseTitles
    .filter((item) => categoryId == null || item.category === categoryId)
    .map((item) => item.title);
}
