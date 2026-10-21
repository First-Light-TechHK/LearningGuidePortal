"use client";

import Image from "next/image";
import { useCallback, useEffect, useRef, useState } from "react";
import type { SubscriptionSelectionState } from "@/contracts/subscription-selection";
import type { UpgradeQuoteDisplay } from "@/contracts/stripe-upgrade";
import { getMessages } from "@/lib/i18n/messages";
import { formatPlanPrice } from "@/lib/planPricing";
import { PricingPlans } from "./PricingPlans";
import { PurchasePanel } from "./PurchasePanel";

type Props = Parameters<typeof PricingPlans>[0] & { selection: SubscriptionSelectionState };
const dateLabel = (locale: Props["locale"], date: string) => new Date(date).toLocaleDateString(locale, { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

function OwnedChip({ children, label }: { children: React.ReactNode; label?: string }) {
  return <span className="pricing-owned-chip">{children}{label && <small>{label}</small>}</span>;
}

export function SubscriptionSelection(props: Props) {
  if (props.selection.kind === "none") return <PricingPlans {...props}/>;
  if (props.selection.kind === "everything" || props.selection.kind === "all_categories") return <SubscriptionSummary {...props}/>;
  return <ExpandedSelection {...props}/>;
}

function SubscriptionSummary({ locale, selection, categories, courseTitles }: Props) {
  const copy = getMessages(locale).subscriptionSelection;
  const everything = selection.everything;
  const manage = `/${locale}/account/my-learning/subscription`;
  const price = everything?.amountMinor != null ? formatPlanPrice(locale, { amountMinor: everything.amountMinor, currency: everything.currency }) : null;
  const coverage = copy.coverage.replace("{count}", String(categories.length));
  const description = everything ? `${coverage} · ${everything.paymentPending ? copy.paymentPending : everything.renewal && price
    ? copy.nextPayment.replace("{date}", dateLabel(locale, everything.validTo)).replace("{price}", price)
    : copy.accessUntil.replace("{date}", dateLabel(locale, everything.validTo))}` : selection.categoryRenewals ? copy.separateRenewals : copy.separateDates;
  return <div className="pricing-ownership-summary" data-subscription-state={selection.kind}>
    <section className="pricing-owned-status">
      <Image src="/portal/subscription-selection/check.svg" width={48} height={48} alt=""/>
      <div className={everything ? "pricing-owned-copy" : "pricing-owned-copy pricing-owned-copy--categories"}>
        <h1>{everything ? copy.everythingOwned : copy.allOwned}</h1><p>{description}</p>
        {!everything && <div className="pricing-owned-chips">{categories.map(category => <OwnedChip key={category.id} label={copy.owned}>{category.labels[locale]}</OwnedChip>)}</div>}
      </div><a href={manage}>{copy.manage}</a>
    </section>
    <div className="pricing-owned-benefits"><section><p>{copy.categories}</p><strong>{categories.length} / {categories.length}</strong><p>{categories.map(category => category.labels[locale]).join(", ")}</p></section>
      <section><p>{copy.courses}</p><strong>{copy.courseCount.replace("{count}", String(courseTitles.length))}</strong><p>{copy.newCourses} · <a href={`/${locale}/portal/courses`}>{getMessages(locale).pricingDesign.viewAll}</a></p></section></div>
  </div>;
}

function ExpandedSelection({ locale, plans, categories, courseTitles, selection, selectedCategoryId, selectedPlanId, copy }: Props) {
  const text = getMessages(locale).subscriptionSelection;
  const selected = plans.find(plan => plan.id === selectedPlanId && plan.available !== false && !plan.alreadySubscribed);
  const [term, setTerm] = useState<6 | 12>(selected?.termMonths || 6);
  const selectable = useCallback((id?: string) => !selection.ownedCategoryIds.includes(id || "") && plans.some(plan => plan.scope === "category" && plan.device === "pc" && plan.termMonths === term && (plan.scopeId || plan.category) === id && plan.available !== false && !plan.alreadySubscribed), [plans, term, selection.ownedCategoryIds]);
  const [category, setCategory] = useState(selected?.scope === "category" ? selected.scopeId || selected.category || undefined : selectable(selectedCategoryId) ? selectedCategoryId : categories.find(item => selectable(item.id))?.id);
  useEffect(() => { setCategory(current => selectable(current) ? current : categories.find(item => selectable(item.id))?.id); }, [categories, selectable]);
  const one = selection.kind === "one_category";
  const [selectedScope, setSelectedScope] = useState<"everything" | "category">(!one || selected?.scope === "category" || selectable(selectedCategoryId) ? "category" : "everything");
  const owned = categories.filter(item => selection.ownedCategoryIds.includes(item.id));
  const remaining = categories.filter(item => !selection.ownedCategoryIds.includes(item.id));
  const categoryPlan = plans.find(plan => plan.scope === "category" && plan.device === "pc" && plan.termMonths === term && (plan.scopeId || plan.category) === category);
  const categoryPrice = categoryPlan?.available !== false && categoryPlan ? formatPlanPrice(locale, categoryPlan) : null;
  const categoryName = categories.find(item => item.id === category)?.labels[locale] || copy.category;
  const categoryCourses = courseTitles.filter(course => course.category === category);
  const source = selection.categorySubscription;
  const everythingPlan = plans.find(plan => plan.scope === "everything" && plan.device === "pc" && plan.termMonths === source?.termMonths);
  const [quote, setQuote] = useState<UpgradeQuoteDisplay | null>(null);
  const [refresh, setRefresh] = useState(0);
  const points = everythingPlan?.aiPoints ?? 0;
  const addedPoints = Math.max(0, points - (source?.aiPoints || 0));
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const inFlight = useRef(false);
  useEffect(() => {
    const restore = (event: PageTransitionEvent) => {
      if (event.persisted) { inFlight.current = false; setBusy(false); setRefresh(value => value + 1); }
    };
    window.addEventListener("pageshow", restore);
    return () => window.removeEventListener("pageshow", restore);
  }, []);
  useEffect(() => {
    setQuote(null); setError("");
    if (!one || !source?.canUpgrade || !everythingPlan || everythingPlan.available === false) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    setBusy(true);
    void (async () => {
      try {
        const response = await fetch("/api/subscription/quote", { method: "POST", signal: controller.signal, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ kind: "upgrade", subscriptionId: source.id }) });
        const data = await response.json() as { quote?: UpgradeQuoteDisplay; code?: keyof ReturnType<typeof getMessages>["paymentErrors"] };
        if (!response.ok || !data.quote || !Number.isSafeInteger(data.quote.amountMinor) || data.quote.amountMinor < 0 || !Number.isFinite(Date.parse(data.quote.expiresAt)) || Date.parse(data.quote.expiresAt) <= Date.now()) throw new Error(data.code && getMessages(locale).paymentErrors[data.code] || text.quoteError);
        if (controller.signal.aborted) return;
        setQuote(data.quote);
        timer = setTimeout(() => { setQuote(null); setRefresh(value => value + 1); }, Date.parse(data.quote.expiresAt) - Date.now());
      } catch (failure) {
        if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : text.quoteError);
      } finally { if (!controller.signal.aborted) setBusy(false); }
    })();
    return () => { controller.abort(); clearTimeout(timer); };
  }, [one, source?.id, source?.canUpgrade, everythingPlan?.id, everythingPlan?.available, locale, refresh, text.quoteError]);
  const estimate = quote ? formatPlanPrice(locale, quote) : "—";
  async function upgrade() {
    if (inFlight.current || !quote || !source?.canUpgrade || everythingPlan?.available === false) return;
    if (Date.parse(quote.expiresAt) <= Date.now()) { setQuote(null); setRefresh(value => value + 1); return; }
    inFlight.current = true; setBusy(true); setError("");
    try {
      window.location.assign(`/${locale}/portal/subscription/confirmation?quoteId=${encodeURIComponent(quote.id)}`);
    } catch (failure) { setError(failure instanceof Error ? failure.message : copy.unavailable); inFlight.current = false; setBusy(false); }
  }
  const termSwitch = <div className="pricing-term-switch" role="group" aria-label={copy.term}>{([6, 12] as const).map(value => <button type="button" key={value} aria-pressed={term === value} onClick={() => setTerm(value)}>{value === 6 ? copy.sixMonths : copy.year}</button>)}</div>;
  return <div className={`pricing-comparison-wrap pricing-selection--${selection.kind}`} data-subscription-state={selection.kind}>
    <div className="pricing-title-row"><h1>{one ? text.expand : text.lastHeading}</h1></div>
    <div className="pricing-owned-notice"><Image src="/portal/subscription-selection/info.svg" width={20} height={20} alt=""/><p>{text.alreadyHave}</p><div className="pricing-owned-chips">{owned.map(item => <OwnedChip key={item.id}>{item.labels[locale]}</OwnedChip>)}</div><a href={`/${locale}/account/my-learning/subscription`}>{text.details}</a></div>
    <div className={`pricing-comparison ${!one ? "pricing-comparison--last" : ""}`}>
      {one && <article className="pricing-design-card pricing-design-card--everything pricing-upgrade-card" data-selected={selectedScope === "everything"} onClick={() => setSelectedScope("everything")} onFocusCapture={() => setSelectedScope("everything")}>
        <div className="pricing-card-tags"><span>{copy.recommended}</span><span className="pricing-saving">{text.extraCategories.replace("{count}", String(remaining.length))}</span></div>
        <header className="pricing-card-heading"><h2>{text.upgrade}</h2><p>{source ? text.upgradeDescription.replace("{count}", String(remaining.length)).replace("{date}", dateLabel(locale, source.validTo)) : text.upgradeUnavailable}</p></header>
        <div className="pricing-selection-price" aria-live="polite"><div className="pricing-card-price"><strong>{estimate}</strong></div><small>{busy && !quote ? text.quoteLoading : text.estimate.replace("{days}", String(source?.remainingDays || 0))}</small></div>
        <div className="pricing-card-includes"><p>{text.allIncluded}</p><div className="pricing-category-switch pricing-category-switch--all">{[...owned, ...remaining].map(item => selection.ownedCategoryIds.includes(item.id) ? <OwnedChip key={item.id} label={text.owned}>{item.labels[locale]}</OwnedChip> : <span className="pricing-included-chip" key={item.id}>{item.labels[locale]}</span>)}</div>
          <div className="pricing-card-course-list"><p>{copy.courseSummary.replace("{courses}", String(courseTitles.length)).replace("{categories}", String(categories.length))} · <a href={`/${locale}/portal/courses`}>{copy.viewAll}</a></p><small>{copy.newEverything}</small></div></div>
        <ul className="pricing-card-benefits"><li><span>{copy.points}</span><strong>{points.toLocaleString(locale, { useGrouping: true })} (+{addedPoints.toLocaleString(locale, { useGrouping: true })})</strong></li></ul>
        <div className="pricing-upgrade-action">{error && <><p role="alert" className="portal-form-error">{error}</p><button type="button" disabled={busy} onClick={() => setRefresh(value => value + 1)}>{text.quoteRetry}</button></>}{!source?.canUpgrade ? <p role="status">{text.upgradeUnavailable}</p> : (!everythingPlan || everythingPlan.available === false) && <p role="status">{copy.unavailable}</p>}<button type="button" disabled={busy || !quote || !source?.canUpgrade || !everythingPlan || everythingPlan.available === false} onClick={() => void upgrade()}>{busy ? getMessages(locale).learning.processing : text.upgradeAction.replace("{price}", estimate)}</button></div>
      </article>}
      <article className={`pricing-design-card pricing-design-card--category ${!one ? "pricing-last-category" : ""}`} data-selected={selectedScope === "category"} onClick={() => setSelectedScope("category")} onFocusCapture={() => setSelectedScope("category")}>
        {one && <div className="pricing-card-tags"/>}
        <header className="pricing-card-heading"><h2>{one ? text.addCategory : text.addTitle.replace("{category}", categoryName)}</h2><p>{one ? text.addDescription : text.lastDescription}</p></header>
        <div className="pricing-selection-price"><div className="pricing-selection-price-row"><div className="pricing-card-price"><strong>{categoryPrice || "—"}</strong></div>{termSwitch}</div></div>
        <div className="pricing-card-includes"><p>{one ? copy.chooseCategory : text.lastCategory}</p><div className="pricing-category-switch" role="group" aria-label={copy.category}>{[...owned, ...remaining].map(item => selection.ownedCategoryIds.includes(item.id) ? <OwnedChip key={item.id} label={text.owned}>{item.labels[locale]}</OwnedChip> : <button type="button" key={item.id} disabled={!selectable(item.id)} aria-pressed={category === item.id} onClick={() => setCategory(item.id)}>{item.labels[locale]}</button>)}</div>
          <div className="pricing-card-course-list"><p>{copy.categorySummary.replace("{count}", String(categoryCourses.length)).replace("{titles}", categoryCourses.map(item => item.title).join(", "))}</p><small>{copy.newCategory}</small></div></div>
        <ul className="pricing-card-benefits"><li><span>{copy.points}</span><strong>{(categoryPlan?.aiPoints ?? 0).toLocaleString(locale)}</strong></li></ul>
        {one && <div className="pricing-upgrade-note"><Image src="/portal/subscription-selection/note.svg" width={16} height={16} alt=""/><p>{text.upgradeNote}</p></div>}
        {categoryPlan && categoryPrice ? <PurchasePanel key={categoryPlan.id} locale={locale} courseId="*" plans={[categoryPlan]} compact allowTrial={false} copy={{ buy: text.addAction.replace("{category}", categoryName).replace("{price}", categoryPrice), choosePlan: copy.term, startTrial: "" }}/> : <p role="status">{copy.unavailable}</p>}
      </article>
    </div>
  </div>;
}
