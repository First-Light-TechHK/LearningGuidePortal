"use client";

import { useEffect, useState } from "react";
import type { getMessages } from "@/lib/i18n/messages";
import { PurchasePanel } from "./PurchasePanel";
import { formatPlanPrice } from "@/lib/planPricing";
import type { Locale } from "@/lib/i18n/config";
import type { PortalCategory } from "@/lib/portalContent";

type Plan = { alreadySubscribed?: boolean; available?: boolean; id: string; name: string; termMonths: 6 | 12; device: "pc" | "mobile"; amountMinor: number; currency: string; aiPoints?: number; scope?: string; scopeId?: string | null; category?: string | null };
type Copy = ReturnType<typeof getMessages>["pricingDesign"];

export function PricingPlans({ locale, plans, categories, courseTitles, selectedPlanId, selectedCategoryId, copy }: { locale: Locale; plans: Plan[]; categories: PortalCategory[]; courseTitles: Array<{ category?: string; title: string }>; selectedPlanId?: string; selectedCategoryId?: string; copy: Copy }) {
  const selected = plans.find((plan) => plan.id === selectedPlanId && !plan.alreadySubscribed && plan.available !== false);
  const [term, setTerm] = useState(selected?.termMonths || 6);
  const firstAvailableCategory = categories.find((category) => plans.some((plan) => !plan.alreadySubscribed && plan.available !== false && plan.scope === "category" && plan.device === "pc" && (plan.scopeId || plan.category) === category.id));
  const courseCategory = categories.find((item) => item.id === selectedCategoryId && plans.some(plan => plan.scope === "category" && (plan.scopeId || plan.category) === item.id && !plan.alreadySubscribed && plan.available !== false))?.id;
  const [selectedScope, setSelectedScope] = useState<"everything" | "category">(selected?.scope === "category" || courseCategory ? "category" : "everything");
  const [category, setCategory] = useState(selected?.scope === "category" ? selected.scopeId || selected.category || firstAvailableCategory?.id : courseCategory || firstAvailableCategory?.id);
  useEffect(() => {
    const selectable = (id: string | undefined) => plans.some(plan => plan.scope === "category" && plan.device === "pc" && plan.termMonths === term && (plan.scopeId || plan.category) === id && !plan.alreadySubscribed && plan.available !== false);
    setCategory(current => selectable(current) ? current : categories.find(item => selectable(item.id))?.id);
  }, [plans, categories, term]);
  return <div className="pricing-comparison-wrap"><div className="pricing-title-row"><h1>{copy.heading}</h1><div className="pricing-term-switch" role="group" aria-label={copy.term}>
    {([6, 12] as const).map(value => <button type="button" key={value} aria-pressed={term === value} onClick={() => setTerm(value)}>{value === 12 ? copy.year : copy.sixMonths}</button>)}
  </div></div><div className="pricing-comparison">{(["everything", "category"] as const).map(scope => {
    const plan = plans.find(item => item.scope === scope && item.device === "pc" && item.termMonths === term && (scope === "everything" || (item.scopeId || item.category) === category));
    const price = plan && plan.available !== false ? formatPlanPrice(locale, plan) : null;
    const categoryPrices = categories.map(item => plans.find(candidate => candidate.scope === "category" && candidate.device === "pc" && candidate.termMonths === term && (candidate.scopeId || candidate.category) === item.id && candidate.currency === plan?.currency && candidate.available !== false));
    const comparisonAmount = categoryPrices.length && categoryPrices.every(Boolean) ? categoryPrices.reduce((sum, item) => sum + item!.amountMinor, 0) : 0;
    const savings = scope === "everything" && price && plan ? Math.max(0, comparisonAmount - plan.amountMinor) : 0;
    const includedCourses = courseTitles.filter(item => scope === "everything" || item.category === category);
    const categoryName = categories.find(item => item.id === category)?.labels[locale] || copy.category;
    const planName = scope === "everything" ? copy.everything : categoryName;
    const buyLabel = copy.getPlan.replace("{plan}", planName).replace("{price}", price || "—");
    return <article className={`pricing-design-card pricing-design-card--${scope}`} key={scope} data-selected={selectedScope === scope} onClick={() => setSelectedScope(scope)} onFocusCapture={() => setSelectedScope(scope)}>
      <div className="pricing-card-tags">{scope === "everything" ? <><span>{copy.recommended}</span>{savings > 0 && plan ? <span className="pricing-saving">{copy.save.replace("{amount}", formatPlanPrice(locale, { ...plan, amountMinor: savings }))}</span> : null}</> : null}</div>
      <header className="pricing-card-heading"><h2>{copy[scope]}</h2><p>{scope === "everything" ? copy.everythingDescription : copy.categoryDescription}</p></header>
      <div className="pricing-card-price"><strong>{price || "—"}</strong>{savings > 0 && plan ? <del>{formatPlanPrice(locale, { ...plan, amountMinor: comparisonAmount })}</del> : null}{plan ? <span>{copy.priceTerm.replace("{months}", String(term))}</span> : null}</div>
      <div className="pricing-card-includes"><p>{scope === "everything" ? copy.includesAll : copy.chooseCategory}</p><div className={`pricing-category-switch ${scope === "everything" ? "pricing-category-switch--all" : ""}`} role="group" aria-label={copy.category}>{categories.map(item => <button type="button" key={item.id} title={scope === "category" && plans.some(candidate => candidate.scope === "category" && candidate.device === "pc" && (candidate.scopeId || candidate.category) === item.id && candidate.alreadySubscribed) ? copy.alreadySubscribed : undefined} disabled={scope === "category" && !plans.some(candidate => candidate.scope === "category" && candidate.device === "pc" && candidate.termMonths === term && (candidate.scopeId || candidate.category) === item.id && !candidate.alreadySubscribed && candidate.available !== false)} aria-pressed={scope === "everything" || category === item.id} onClick={() => { if (scope === "category") setCategory(item.id); }}>{item.labels[locale]}</button>)}</div>
      <div className="pricing-card-course-list"><p>{scope === "everything" ? <>{copy.courseSummary.replace("{courses}", String(includedCourses.length)).replace("{categories}", String(categories.length))} · <a href={`/${locale}/portal/courses`}>{copy.viewAll}</a></> : copy.categorySummary.replace("{count}", String(includedCourses.length)).replace("{titles}", includedCourses.map(item => item.title).join(", "))}</p><small>{scope === "everything" ? copy.newEverything : copy.newCategory}</small></div></div>
      <ul className="pricing-card-benefits"><li><span>{copy.points}</span><strong>{(plan?.aiPoints ?? 0).toLocaleString(locale)}</strong></li></ul>
      {plan && plan.available !== false ? <PurchasePanel key={plan.id} locale={locale} courseId="*" plans={[plan]} allowTrial={false} compact copy={{ buy: buyLabel, choosePlan: copy.term, startTrial: "" }} /> : <p role="status">{scope === "category" && plans.some(item => item.scope === "category") && plans.filter(item => item.scope === "category").every(item => item.alreadySubscribed) ? copy.alreadySubscribed : copy.unavailable}</p>}
    </article>;
  })}</div></div>;
}
