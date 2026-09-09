"use client";

import { useState } from "react";
import { PurchasePanel } from "./PurchasePanel";
import type { Locale } from "@/lib/i18n/config";
import type { PortalCategory } from "@/lib/portalContent";

type Plan = { available?: boolean; id: string; name: string; termMonths: 6 | 12; device: "pc" | "mobile"; amountMinor: number; currency: string; aiPoints?: number; scope?: string; scopeId?: string | null; category?: string | null };
type Copy = { everything: string; category: string; sixMonths: string; year: string; term: string; subscribe: string; allCourses: string; categoryCourses: string; bilingual: string; devices: string; points: string; unavailable: string; perCategory: string };

export function PricingPlans({ locale, plans, categories, selectedPlanId, copy }: { locale: Locale; plans: Plan[]; categories: PortalCategory[]; selectedPlanId?: string; copy: Copy }) {
  const selected = plans.find((plan) => plan.id === selectedPlanId);
  const [everythingTerm, setEverythingTerm] = useState(selected?.scope === "everything" ? selected.termMonths : 6);
  const [categoryTerm, setCategoryTerm] = useState(selected?.scope === "category" ? selected.termMonths : 6);
  const firstAvailableCategory = categories.find((category) => plans.some((plan) => plan.scope === "category" && plan.device === "pc" && (plan.scopeId || plan.category) === category.id));
  const [category, setCategory] = useState(selected?.scope === "category" ? selected.scopeId || selected.category || firstAvailableCategory?.id : firstAvailableCategory?.id);
  return <div className="pricing-comparison">{(["everything", "category"] as const).map((scope) => {
    const term = scope === "everything" ? everythingTerm : categoryTerm;
    const setTerm = scope === "everything" ? setEverythingTerm : setCategoryTerm;
    const plan = plans.find((item) => item.scope === scope && item.device === "pc" && item.termMonths === term && (scope === "everything" || (item.scopeId || item.category) === category));
    const price = plan && plan.available !== false ? new Intl.NumberFormat(locale, { style: "currency", currency: plan.currency, currencyDisplay: "narrowSymbol", maximumFractionDigits: plan.amountMinor % 100 ? 2 : 0 }).format(plan.amountMinor / 100) : null;
    return <article className="pricing-design-card" key={scope}>
      <header className="pricing-card-heading"><h2>{copy[scope]}</h2><div className="pricing-term-switch" role="group" aria-label={`${copy[scope]}: ${copy.term}`}>
        {([6, 12] as const).map((value) => <button type="button" key={value} aria-pressed={term === value} onClick={() => setTerm(value)}>{value === 6 ? copy.sixMonths : copy.year}</button>)}
      </div></header>
      <div className="pricing-card-price"><strong>{price || "—"}</strong>{plan ? <span>{plan.currency.toUpperCase()}{scope === "category" ? ` / ${copy.perCategory}` : ""}</span> : null}</div>
      {scope === "everything" ? <p className="pricing-card-scope">{copy.allCourses}</p> : <div className="pricing-category-switch" role="group" aria-label={copy.category}>{categories.map((item) => <button key={item.id} type="button" aria-pressed={category === item.id} onClick={() => setCategory(item.id)}>{item.labels[locale]}</button>)}</div>}
      <ul className="pricing-card-benefits"><li>{scope === "everything" ? copy.allCourses : copy.categoryCourses}</li><li>{(plan?.aiPoints ?? 0).toLocaleString(locale)} {copy.points}</li><li>{copy.bilingual}</li><li>{copy.devices}</li></ul>
      {plan && plan.available !== false ? <PurchasePanel key={plan.id} locale={locale} courseId="*" plans={[plan]} allowTrial={false} compact copy={{ buy: copy.subscribe, choosePlan: copy.term, startTrial: "" }} /> : <p role="status">{copy.unavailable}</p>}
    </article>;
  })}</div>;
}
