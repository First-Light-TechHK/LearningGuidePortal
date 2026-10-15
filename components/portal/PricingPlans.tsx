"use client";

import { useEffect, useState } from "react";
import { PurchasePanel } from "./PurchasePanel";
import { formatPlanPrice } from "@/lib/planPricing";
import type { Locale } from "@/lib/i18n/config";
import type { PortalCategory } from "@/lib/portalContent";

type Plan = { alreadySubscribed?: boolean; available?: boolean; id: string; name: string; termMonths: 6 | 12; device: "pc" | "mobile"; amountMinor: number; currency: string; aiPoints?: number; scope?: string; scopeId?: string | null; category?: string | null };
type Copy = { everything: string; category: string; sixMonths: string; year: string; term: string; subscribe: string; allCourses: string; categoryCourses: string; bilingual: string; devices: string; points: string; unavailable: string; alreadySubscribed: string; perCategory: string };

export function PricingPlans({ locale, plans, categories, courseTitles, selectedPlanId, selectedCategoryId, copy }: { locale: Locale; plans: Plan[]; categories: PortalCategory[]; courseTitles: Array<{ category?: string; title: string }>; selectedPlanId?: string; selectedCategoryId?: string; copy: Copy }) {
  const selected = plans.find((plan) => plan.id === selectedPlanId && !plan.alreadySubscribed && plan.available !== false);
  const [term, setTerm] = useState(selected?.termMonths || 6);
  const firstAvailableCategory = categories.find((category) => plans.some((plan) => !plan.alreadySubscribed && plan.available !== false && plan.scope === "category" && plan.device === "pc" && (plan.scopeId || plan.category) === category.id));
  const courseCategory = categories.find((item) => item.id === selectedCategoryId && plans.some(plan => plan.scope === "category" && (plan.scopeId || plan.category) === item.id && !plan.alreadySubscribed && plan.available !== false))?.id;
  const [category, setCategory] = useState(selected?.scope === "category" ? selected.scopeId || selected.category || firstAvailableCategory?.id : courseCategory || firstAvailableCategory?.id);
  useEffect(() => {
    const selectable = (id: string | undefined) => plans.some(plan => plan.scope === "category" && plan.device === "pc" && plan.termMonths === term && (plan.scopeId || plan.category) === id && !plan.alreadySubscribed && plan.available !== false);
    setCategory(current => selectable(current) ? current : categories.find(item => selectable(item.id))?.id);
  }, [plans, categories, term]);
  return <div className="pricing-comparison-wrap"><div className="pricing-term-switch pricing-term-switch-global" role="group" aria-label={copy.term}>
    {([6, 12] as const).map((value) => <button type="button" key={value} className={value === 12 ? "pricing-term-year" : undefined} aria-pressed={term === value} onClick={() => setTerm(value)}>{value === 12 ? <span className="pricing-term-year-label">{copy.year}<span className="pricing-better-value">Better Value</span></span> : copy.sixMonths}</button>)}
  </div><div className="pricing-comparison">{(["everything", "category"] as const).map((scope) => {
    const plan = plans.find((item) => item.scope === scope && item.device === "pc" && item.termMonths === term && (scope === "everything" || (item.scopeId || item.category) === category));
    const price = plan && plan.available !== false ? formatPlanPrice(locale, plan) : null;
    return <article className="pricing-design-card" key={scope}>
      <header className="pricing-card-heading"><h2>{copy[scope]}</h2></header>
      <div className="pricing-card-price"><strong>{price || "—"}</strong>{plan ? <span>{plan.currency.toUpperCase()}{scope === "category" ? ` / ${copy.perCategory}` : ""}</span> : null}</div>
      <div className="pricing-card-categories"><p>{scope === "everything" ? "All categories:" : "Particular category:"}</p><div className={`pricing-category-switch ${scope === "everything" ? "pricing-category-switch--all" : ""}`} role="group" aria-label={copy.category}>{categories.map((item) => <button key={item.id} type="button" title={scope === "category" && plans.some(candidate => candidate.scope === "category" && candidate.device === "pc" && (candidate.scopeId || candidate.category) === item.id && candidate.alreadySubscribed) ? copy.alreadySubscribed : undefined} disabled={scope === "category" && !plans.some(candidate => candidate.scope === "category" && candidate.device === "pc" && candidate.termMonths === term && (candidate.scopeId || candidate.category) === item.id && !candidate.alreadySubscribed && candidate.available !== false)} aria-pressed={scope === "everything" || category === item.id} onClick={() => { if (scope === "category") setCategory(item.id); }}>{item.labels[locale]}</button>)}</div></div>
      <div className="pricing-card-course-list"><p>{scope === "everything" ? copy.allCourses : "Course list in this category:"}</p><div>{courseTitles.filter((item) => scope === "everything" || item.category === category).slice(0, 6).map((item) => <span key={item.title}>{item.title}</span>)}</div></div>
      <ul className="pricing-card-benefits"><li>{scope === "everything" ? copy.allCourses : copy.categoryCourses}</li><li>{(plan?.aiPoints ?? 0).toLocaleString(locale)} {copy.points}</li><li>{copy.bilingual}</li><li>{copy.devices}</li></ul>
      {plan && plan.available !== false ? <PurchasePanel key={plan.id} locale={locale} courseId="*" plans={[plan]} allowTrial={false} compact copy={{ buy: copy.subscribe, choosePlan: copy.term, startTrial: "" }} /> : <p role="status">{scope === "category" && plans.some(item => item.scope === "category") && plans.filter(item => item.scope === "category").every(item => item.alreadySubscribed) ? copy.alreadySubscribed : copy.unavailable}</p>}
    </article>;
  })}</div></div>;
}
