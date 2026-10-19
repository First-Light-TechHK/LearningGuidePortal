import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile, mkdir } from "node:fs/promises";
import { build } from "esbuild";
import { chromium } from "playwright";
import { getMessages } from "../../lib/i18n/messages";
import { defaultPortalContent } from "../../lib/portalContent";

test("owned categories and course terms cannot be selected or submitted in either locale", async () => {
  const bundle = await build({
    stdin: { contents: `import React from 'react';import {createRoot} from 'react-dom/client';import {flushSync} from 'react-dom';import {PricingPlans} from './components/portal/PricingPlans';import {PurchasePanel} from './components/portal/PurchasePanel';import {getMessages} from './lib/i18n/messages';const root=createRoot(document.getElementById('root'));window.mount=p=>flushSync(()=>root.render(p.direct?<PurchasePanel key={p.key} {...p} copy={{buy:getMessages(p.locale).pricingDesign.subscribe,choosePlan:getMessages(p.locale).learning.choosePlan,startTrial:getMessages(p.locale).learning.startTrial}}/>:<main className="portal-page pricing-design-page"><section className="pricing-design-main"><PricingPlans key={p.key} {...p} copy={getMessages(p.locale).pricingDesign}/></section></main>));`, resolveDir: process.cwd(), loader: "tsx" },
    bundle: true, write: false, platform: "browser", jsx: "automatic", define: { "process.env.NODE_ENV": '"production"' },
  });
  const plans = ["European Humanities", "Chinese Humanities", "Science"].flatMap(category => [6, 12].map(term => ({ id: `${category}-${term}`, name: `${category} ${term}`, courseId: "*", scope: "category", scopeId: category, device: "pc", termMonths: term, currency: "usd", amountMinor: term === 6 ? 3900 : 7800, alreadySubscribed: category !== "Chinese Humanities" })));
  plans.push(...[6, 12].map(term => ({ id: `everything-${term}`, name: `Everything ${term}`, courseId: "*", scope: "everything", scopeId: "*", device: "pc", termMonths: term, currency: "usd", amountMinor: 9900, alreadySubscribed: false })));
  const browser = await chromium.launch();
  await mkdir("test-results/purchase-eligibility", { recursive: true });
  try {
    for (const locale of ["en-GB", "zh-CN"] as const) {
      const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
      let quoteRequests = 0;
      const quotedPlans: string[] = [];
      await page.route("http://subscription.test/**", route => {
        if (new URL(route.request().url()).pathname === "/api/subscription/quote") {
          quoteRequests++;
          quotedPlans.push(route.request().postDataJSON().planId);
          return route.fulfill({ status: 400, contentType: "application/json", body: JSON.stringify({ ok: false, code: "already_subscribed", error: "server language differs" }) });
        }
        return route.fulfill({ contentType: "text/html", body: '<div id="root"></div>' });
      });
      await page.goto("http://subscription.test/?planId=Science-12");
      for (const file of ["app/styles.css", "app/portal-design.css"]) await page.addStyleTag({ content: await readFile(file, "utf8") });
      await page.addScriptTag({ content: bundle.outputFiles[0].text });
      const props = { locale, key: "pricing", plans, selectedPlanId: "Science-12", categories: defaultPortalContent.categories, courseTitles: [] };
      await page.evaluate(p => (window as unknown as { mount: (p: unknown) => void }).mount(p), props);
      const categoryCard = page.locator(".pricing-design-card").nth(1);
      const categoryButtons = categoryCard.locator(".pricing-category-switch button");
      for (const term of [6, 12]) {
        await page.getByRole("button", { name: term === 6 ? getMessages(locale).pricingDesign.sixMonths : new RegExp(getMessages(locale).pricingDesign.year) }).click();
        assert.equal(await categoryButtons.nth(1).isDisabled(), true);
        assert.equal(await categoryButtons.nth(2).isDisabled(), true);
        assert.equal(await categoryButtons.nth(0).isDisabled(), false);
        assert.equal(await categoryButtons.nth(0).getAttribute("aria-pressed"), "true");
        assert.equal(await categoryCard.locator(".purchase-actions button").isDisabled(), false);
      }
      await page.screenshot({ path: `test-results/purchase-eligibility/${locale}-desktop.png`, fullPage: true });
      await page.setViewportSize({ width: 390, height: 844 });
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
      await page.screenshot({ path: `test-results/purchase-eligibility/${locale}-mobile.png`, fullPage: true });
      await page.evaluate(p => (window as unknown as { mount: (p: unknown) => void }).mount(p), { ...props, key: "all-owned", plans: plans.map(plan => ({ ...plan, alreadySubscribed: true })) });
      assert.equal(await categoryCard.locator('button[aria-pressed="true"]').count(), 0);
      assert.equal(await page.locator(".pricing-design-card").first().locator(".purchase-actions button").isDisabled(), true);
      assert.equal(await page.getByRole("status").count(), 2);

      const directPlans = [6, 12].map(term => ({ id: `course-${term}`, name: `Owned course ${term}`, device: "pc", termMonths: term, currency: "usd", amountMinor: 4900, alreadySubscribed: true }));
      await page.evaluate(p => (window as unknown as { mount: (p: unknown) => void }).mount(p), { direct: true, key: "course", locale, courseId: "course", plans: directPlans });
      const radios = page.getByRole("radio");
      assert.equal(await radios.count(), 2);
      assert.equal(await radios.nth(0).isDisabled(), true);
      assert.equal(await radios.nth(1).isDisabled(), true);
      assert.equal(await page.locator('input:checked').count(), 0);
      assert.equal(await page.getByRole("button", { name: getMessages(locale).pricingDesign.subscribe, exact: true }).isDisabled(), true);
      assert.equal(quoteRequests, 0);

      await page.evaluate(p => (window as unknown as { mount: (p: unknown) => void }).mount(p), { direct: true, key: "stale-page", locale, courseId: "course", allowTrial: false, plans: directPlans.map(plan => ({ ...plan, alreadySubscribed: false })) });
      await page.getByRole("button", { name: getMessages(locale).pricingDesign.subscribe, exact: true }).click();
      await page.getByRole("alert").waitFor();
      assert.equal(await page.getByRole("alert").textContent(), getMessages(locale).paymentErrors.already_subscribed);
      assert.equal(quoteRequests, 1);
      assert.ok(page.url().startsWith("http://subscription.test/"));
      assert.equal(await page.getByRole("button", { name: getMessages(locale).pricingDesign.subscribe, exact: true }).isDisabled(), false);
      // A server refresh supplies new plan objects on the same mounted panel.
      // An old login-return planId must not overwrite the user's annual choice.
      await page.evaluate(() => history.replaceState({}, "", "/?planId=everything-pc-6"));
      const termPlans = [6, 12].map(term => ({ id: `everything-pc-${term}`, name: `Everything ${term}`, device: "pc", termMonths: term, currency: "usd", amountMinor: term === 6 ? 9900 : 19800 }));
      const directProps = { direct: true, key: "term-refresh", locale, courseId: "*", allowTrial: false, plans: termPlans };
      await page.evaluate(p => (window as unknown as { mount: (p: unknown) => void }).mount(p), directProps);
      await page.getByRole("radio").nth(1).check();
      await page.evaluate(p => (window as unknown as { mount: (p: unknown) => void }).mount(p), directProps);
      assert.equal(await page.getByRole("radio").nth(1).isChecked(), true);
      await page.getByRole("button", { name: getMessages(locale).pricingDesign.subscribe, exact: true }).click();
      await page.getByRole("alert").waitFor();
      assert.equal(quotedPlans.at(-1), "everything-pc-12");
      for (const term of [6, 12, 6, 12]) {
        await page.evaluate(p => (window as unknown as { mount: (p: unknown) => void }).mount(p), { ...props, key: "term-pricing", plans: [...plans.filter(plan => plan.scope === "category"), ...termPlans.map(plan => ({ ...plan, scope:"everything", scopeId:"*", alreadySubscribed:false }))] });
        await page.getByRole("button", { name: term === 6 ? getMessages(locale).pricingDesign.sixMonths : new RegExp(getMessages(locale).pricingDesign.year) }).click();
        await page.locator(".pricing-design-card").first().locator(".purchase-actions button").click();
        await page.getByRole("alert").waitFor();
        assert.equal(quotedPlans.at(-1), `everything-pc-${term}`);
      }
      await page.close();
    }
  } finally { await browser.close(); }
});
