"use client";

import { useState } from "react";
import { PurchasePanel } from "./PurchasePanel";
import { categorySubscribeOffer, everythingOffer, type CourseInput, type OfferScope } from "@/lib/offer";
import type { Locale } from "@/lib/i18n/config";
import type { PortalCategory } from "@/lib/portalContent";

type Plan = { available?: boolean; id: string; name: string; termMonths: 6 | 12; device: "pc" | "mobile"; amountMinor: number; currency: string; aiPoints?: number; scope?: OfferScope; scopeId?: string | null; category?: string | null };
type Copy = { everything: string; category: string; sixMonths: string; year: string; term: string; subscribe: string; allCourses: string; categoryCourses: string; bilingual: string; devices: string; points: string; unavailable: string; perCategory: string };

export function PricingPlans({ locale, plans, courses, categories, courseTitles, selectedPlanId, copy }: { locale: Locale; plans: Plan[]; courses: CourseInput[]; categories: PortalCategory[]; courseTitles: Array<{ category?: string; title: string }>; selectedPlanId?: string; copy: Copy }) {
  const selected = plans.find((plan) => plan.id === selectedPlanId);
  const initialTerm = selected?.termMonths || 6;
  const selectedCategoryId = selected?.scope === "category" ? selected.scopeId || selected.category || "" : "";
  const selectedIsLegal = Boolean(selectedCategoryId && categorySubscribeOffer(plans, courses, selectedCategoryId, initialTerm));
  const firstLegalCategory = categories.find((item) => categorySubscribeOffer(plans, courses, item.id, initialTerm));
  const [term, setTerm] = useState<6 | 12>(initialTerm);
  const [category, setCategory] = useState(selectedIsLegal ? selectedCategoryId : firstLegalCategory?.id);
  return <div className="pricing-comparison-wrap"><div className="pricing-term-switch pricing-term-switch-global" role="group" aria-label={copy.term}>
    {([6, 12] as const).map((value) => <button type="button" key={value} aria-pressed={term === value} onClick={() => setTerm(value)}>{value === 12 ? <><span className="pricing-better-value">Better Value</span>{copy.year}</> : copy.sixMonths}</button>)}
  </div><div className="pricing-comparison">{(["everything", "category"] as const).map((scope) => {
    const offer = scope === "everything" ? everythingOffer(plans, term) : categorySubscribeOffer(plans, courses, category || "", term);
    const plan = offer ? plans.find((item) => item.id === offer.planId) : undefined;
    const price = offer ? new Intl.NumberFormat(locale, { style: "currency", currency: offer.currency, currencyDisplay: "narrowSymbol", maximumFractionDigits: offer.amountMinor % 100 ? 2 : 0 }).format(offer.amountMinor / 100) : null;
    return <article className="pricing-design-card" key={scope} data-offer-scope={offer?.scope} data-offer-plan-id={offer?.planId} data-offer-amount={offer?.amountMinor}>
      <header className="pricing-card-heading"><h2>{copy[scope]}</h2></header>
      <div className="pricing-card-price"><strong>{price || "—"}</strong>{plan ? <span>{plan.currency.toUpperCase()}{scope === "category" ? ` / ${copy.perCategory}` : ""}</span> : null}</div>
      <div className="pricing-card-categories"><p>{scope === "everything" ? "All categories:" : "Particular category:"}</p><div className={`pricing-category-switch ${scope === "everything" ? "pricing-category-switch--all" : ""}`} role="group" aria-label={copy.category}>{categories.map((item) => <button key={item.id} type="button" aria-pressed={scope === "everything" || category === item.id} onClick={() => { if (scope === "category") setCategory(item.id); }}>{item.labels[locale]}</button>)}</div></div>
      <div className="pricing-card-course-list"><p>{scope === "everything" ? copy.allCourses : "Course list in this category:"}</p><div>{courseTitles.filter((item) => scope === "everything" || item.category === category).slice(0, 6).map((item) => <span key={item.title}>{item.title}</span>)}</div></div>
      <ul className="pricing-card-benefits"><li>{scope === "everything" ? copy.allCourses : copy.categoryCourses}</li><li>{(plan?.aiPoints ?? 0).toLocaleString(locale)} {copy.points}</li><li>{copy.bilingual}</li><li>{copy.devices}</li></ul>
      {offer && plan ? <PurchasePanel key={offer.planId} locale={locale} courseId="*" plans={[{ ...plan, id: offer.planId, amountMinor: offer.amountMinor }]} allowTrial={false} compact copy={{ buy: copy.subscribe, choosePlan: copy.term, startTrial: "" }} /> : <p role="status">{copy.unavailable}</p>}
    </article>;
  })}</div></div>;
}
