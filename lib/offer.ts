export type OfferScope = "course" | "category" | "everything";

/** The command a purchase control commits. A trial keeps the plan amount and charges nothing now. */
export type Offer = {
  scope: OfferScope;
  planId: string;
  amountMinor: number;
  currency: string;
  trial: boolean;
  dueNowMinor: number;
  termMonths: 6 | 12;
};

export type PlanInput = {
  id: string;
  scope?: OfferScope;
  scopeId?: string | null;
  courseId?: string;
  category?: string | null;
  device?: "pc" | "mobile";
  termMonths?: 6 | 12;
  amountMinor: number;
  currency: string;
  available?: boolean;
};

export type CourseInput = { status: string; category?: string | null };

const PRICING_CATEGORIES = ["Chinese Humanities", "European Humanities", "Science"] as const;

export function categoryHasPublishedCourse(courses: readonly CourseInput[], categoryId: string) {
  return courses.some((course) => course.status === "published" && course.category === categoryId);
}

/** A category purchase grants the published courses in that category. An empty category is not a command. */
export function categoryPurchaseAllowed(plan: { scope?: string; scopeId?: string | null; category?: string | null }, courses: readonly CourseInput[]) {
  if (plan.scope !== "category") return true;
  const categoryId = plan.scopeId || plan.category || "";
  return categoryId.length > 0 && categoryHasPublishedCourse(courses, categoryId);
}

export function offerFromPlan(plan: PlanInput, trial = false): Offer {
  const scope: OfferScope = plan.scope === "category" || plan.scope === "everything" || plan.scope === "course"
    ? plan.scope
    : plan.courseId === "*" ? "everything" : "course";
  return {
    scope,
    planId: plan.id,
    amountMinor: plan.amountMinor,
    currency: plan.currency,
    trial,
    dueNowMinor: trial ? 0 : plan.amountMinor,
    termMonths: plan.termMonths === 12 ? 12 : 6,
  };
}

function desktopPlan(plans: readonly PlanInput[], predicate: (plan: PlanInput) => boolean) {
  return plans.find((plan) => plan.available !== false && plan.device !== "mobile" && predicate(plan));
}

export function categorySubscribeOffer(plans: readonly PlanInput[], courses: readonly CourseInput[], categoryId: string, termMonths: 6 | 12 = 6): Offer | null {
  if (!categoryHasPublishedCourse(courses, categoryId)) return null;
  const plan = desktopPlan(plans, (item) => item.scope === "category" && item.termMonths === termMonths && (item.scopeId || item.category) === categoryId);
  return plan ? offerFromPlan(plan, false) : null;
}

export function courseSidebarOffer(plans: readonly PlanInput[], courses: readonly CourseInput[], categoryId: string) {
  return categorySubscribeOffer(plans, courses, categoryId, 6);
}

/** The sidebar control opens the category offer. It does not attach a course-plan purchase. */
export function courseSidebarHref(locale: string, offer: Offer) {
  return `/${locale}/pricing?planId=${encodeURIComponent(offer.planId)}`;
}

export function pricingCourseOffer(plans: readonly PlanInput[], courseId: string): Offer | null {
  const plan = desktopPlan(plans, (item) => item.scope === "course" && item.termMonths === 6 && (item.scopeId || item.courseId) === courseId);
  return plan ? offerFromPlan(plan, false) : null;
}

export function everythingOffer(plans: readonly PlanInput[], termMonths: 6 | 12): Offer | null {
  const plan = desktopPlan(plans, (item) => item.scope === "everything" && item.termMonths === termMonths);
  return plan ? offerFromPlan(plan, false) : null;
}

export function trialConfirmationOffer(plan: PlanInput): Offer {
  const offer = offerFromPlan(plan, true);
  return offer;
}

export function pricingPageModel(input: { plans: readonly PlanInput[]; courses: readonly CourseInput[]; courseId?: string | null; termMonths?: 6 | 12 }) {
  const termMonths = input.termMonths === 12 ? 12 : 6;
  return {
    course: input.courseId ? pricingCourseOffer(input.plans, input.courseId) : null,
    categories: PRICING_CATEGORIES.map((id) => ({
      id,
      subscribe: categorySubscribeOffer(input.plans, input.courses, id, termMonths),
    })),
  };
}
