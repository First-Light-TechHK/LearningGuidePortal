import type { Locale } from "@/lib/i18n/config";
import type { PortalCategory } from "@/lib/portalContent";
import type { ProductLesson, ProductPlan } from "@/services/productStore";

export const PORTAL_CATEGORY_IDS = ["Chinese Humanities", "European Humanities", "Science"] as const;
export type PortalCategoryId = (typeof PORTAL_CATEGORY_IDS)[number];

const PORTAL_CATEGORY_SLUGS: Record<string, PortalCategoryId> = {
  "chinese-humanities": "Chinese Humanities",
  "european-humanities": "European Humanities",
  science: "Science",
};

export type CourseCategoryRef = {
  category?: string | null;
  categoryId?: string | null;
  subjectId?: string | null;
  outcomes?: readonly string[] | null;
};

export type CatalogueCategoryRef = {
  id: string;
  name: string;
  parentId?: string | null;
  outcomes?: readonly string[] | null;
};

export type CourseCategoryCrumb = { id: PortalCategoryId; label: string };

export type CourseCategoryDisplay = {
  membership: PortalCategoryId | "";
  crumb: CourseCategoryCrumb | null;
  cardLabel: string;
  learningLabel: string;
  recommendationLabel: string;
  pricingCategoryId: PortalCategoryId | "";
  matchesFilter: (filterId: string) => boolean;
  outcomes: string[];
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

function exactPortalId(value: string | null | undefined): PortalCategoryId | "" {
  const raw = value?.trim() || "";
  return (PORTAL_CATEGORY_IDS as readonly string[]).includes(raw) ? raw as PortalCategoryId : "";
}

function portalIdentity(value: string | null | undefined): PortalCategoryId | "" {
  const exact = exactPortalId(value);
  if (exact) return exact;
  const raw = value?.trim() || "";
  if (!raw) return "";
  return PORTAL_CATEGORY_SLUGS[categorySlug(raw)] || "";
}

function catalogueParent(id: string, catalogue: readonly CatalogueCategoryRef[]) {
  const row = catalogue.find((item) => item.id === id);
  if (!row) return undefined;
  if (!row.parentId) return row;
  return catalogue.find((item) => item.id === row.parentId && !item.parentId);
}

/**
 * Membership is one portal category or empty.
 * Inputs, in order, stop at the first of Chinese Humanities | European Humanities | Science:
 * 1. catalogue parent of categoryId (row id or slug european-humanities / science / chinese-humanities; the catalogue name does not vote)
 * 2. if categoryId is empty, the subject's catalogue parent, same match
 * 3. if both ids are empty, legacy category only when it is exactly one of those three ids
 * Range: those three ids, or empty.
 */
export function courseCategoryMembership(
  course: CourseCategoryRef | null | undefined,
  catalogue: readonly CatalogueCategoryRef[] = [],
): PortalCategoryId | "" {
  if (!course) return "";
  const categoryId = course.categoryId?.trim() || "";
  const subjectId = course.subjectId?.trim() || "";
  if (categoryId) {
    const fromId = portalIdentity(categoryId);
    if (fromId) return fromId;
    const fromParent = portalIdentity(catalogueParent(categoryId, catalogue)?.id);
    if (fromParent) return fromParent;
    return "";
  }
  if (subjectId) {
    const subject = catalogue.find((item) => item.id === subjectId);
    const parent = subject?.parentId
      ? catalogue.find((item) => item.id === subject.parentId && !item.parentId) || { id: subject.parentId, name: "" }
      : undefined;
    return portalIdentity(parent?.id);
  }
  return exactPortalId(course.category);
}

/** The course's stored outcomes, or none. Shared course-detail copy and catalogue rows are not a fallback. */
export function courseOutcomes(course: { outcomes?: readonly string[] | null } | null | undefined) {
  if (!Array.isArray(course?.outcomes)) return [];
  const seen = new Set<string>();
  const outcomes: string[] = [];
  for (const item of course.outcomes) {
    if (typeof item !== "string") continue;
    const text = item.trim();
    if (!text || seen.has(text)) continue;
    seen.add(text);
    outcomes.push(text);
  }
  return outcomes;
}

/** Locale label and sibling surfaces for one membership. Empty membership projects nothing. */
export function courseCategoryDisplay(
  course: CourseCategoryRef | null | undefined,
  categories: readonly PortalCategory[],
  locale: Locale,
  catalogue: readonly CatalogueCategoryRef[] = [],
): CourseCategoryDisplay {
  const membership = courseCategoryMembership(course, catalogue);
  const label = membership ? categories.find((item) => item.id === membership)?.labels[locale] || "" : "";
  return {
    membership,
    crumb: membership ? { id: membership, label } : null,
    cardLabel: label,
    learningLabel: label,
    recommendationLabel: label,
    pricingCategoryId: membership,
    matchesFilter: (filterId: string) => Boolean(membership) && membership === filterId,
    outcomes: courseOutcomes(course),
  };
}

/** Outcomes stored on the course, then on a related catalogue entry. Never a shared stand-in list. */
export function courseLearningOutcomes(...sources: Array<unknown>): string[] {
  for (const source of sources) {
    if (!source || typeof source !== "object") continue;
    const outcomes = normalisedOutcomes((source as { outcomes?: unknown }).outcomes);
    if (outcomes.length) return outcomes;
  }
  return [];
}

function normalisedOutcomes(value: unknown): string[] {
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

export function courseCategoryLabel(
  course: CourseCategoryRef | null | undefined,
  categories: readonly PortalCategory[],
  locale: Locale,
  catalogue: readonly CatalogueCategoryRef[] = [],
): string {
  return courseCategoryDisplay(course, categories, locale, catalogue).cardLabel;
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
  const display = courseCategoryDisplay(input.course, input.categories, input.locale, catalogue);
  const categoryId = display.membership;
  const label = display.crumb?.label || "";
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
  const display = courseCategoryDisplay(course, categories, locale, catalogue);
  const categoryId = display.membership;
  const label = display.crumb?.label || "";
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
    : input.courses.filter((course) => courseCategoryMembership(course, catalogue) === requested);
  return { chips, visible };
}

/** Category line on a catalogue card and on a home card. */
export function courseCardCategoryLine(
  course: CourseCategoryRef | null | undefined,
  categories: readonly PortalCategory[],
  locale: Locale,
  catalogue: readonly CatalogueCategoryRef[] = [],
): string {
  return courseCategoryDisplay(course, categories, locale, catalogue).cardLabel;
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
  const membership = exactPortalId(input.categoryId);
  const label = membership ? input.categories.find((item) => item.id === membership)?.labels[input.locale] || "" : "";
  return [label, `${input.lessonCount} ${input.lessonsWord}`, input.stateLabel].filter(Boolean).join(" · ");
}

/** Category line on a public-lesson recommendation card. */
export function publicLessonRecommendationCategory(
  course: CourseCategoryRef | null | undefined,
  categories: readonly PortalCategory[],
  locale: Locale,
  catalogue: readonly CatalogueCategoryRef[] = [],
): string {
  return courseCategoryDisplay(course, categories, locale, catalogue).recommendationLabel;
}

/** Portal category id used to group a course on Pricing. Empty when the course has none. */
export function pricingCourseGroup(
  course: CourseCategoryRef | null | undefined,
  _categories: readonly PortalCategory[] = [],
  catalogue: readonly CatalogueCategoryRef[] = [],
): string {
  return courseCategoryMembership(course, catalogue);
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
