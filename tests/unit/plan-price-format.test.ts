import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { formatPlanPrice, planPriceFormatOptions } from "../../lib/planPricing";

test("whole-amount plan prices set minimumFractionDigits together with maximumFractionDigits", () => {
  // BUG-0119 (SIT, 小智双核浏览器): passing only maximumFractionDigits: 0 to a
  // currency formatter is a RangeError on engines that still apply the currency's
  // CLDR minor-unit default (2 for USD) for minimumFractionDigits before the range
  // check - "maximumFractionDigits value is out of range" at `new NumberFormat`,
  // thrown inside the pricing render -> "Application error: a client-side exception".
  const whole = planPriceFormatOptions({ amountMinor: 3900, currency: "USD" });
  assert.equal(whole.style, "currency");
  assert.equal(whole.currency, "USD");
  assert.equal(whole.currencyDisplay, "narrowSymbol");
  assert.equal(whole.maximumFractionDigits, 0);
  assert.equal(whole.minimumFractionDigits, 0);
  const cents = planPriceFormatOptions({ amountMinor: 3950, currency: "USD" });
  assert.equal(cents.maximumFractionDigits, 2);
  assert.equal(cents.minimumFractionDigits, 2);
});

test("plan price options survive an engine that defaults minimumFractionDigits to the currency's minor units", () => {
  // Emulate the engine rule that crashed SIT: for style "currency" the implied
  // minimumFractionDigits is the currency's minor units (2 for USD) unless the
  // options pin it. The old inline options ({maximumFractionDigits: 0} only) throw
  // the exact QA RangeError here; the shared options must not.
  for (const plan of [{ amountMinor: 3900, currency: "USD" }, { amountMinor: 3950, currency: "USD" }]) {
    const options = planPriceFormatOptions(plan);
    assert.doesNotThrow(() => new Intl.NumberFormat("en-GB", {
      ...options,
      minimumFractionDigits: options.minimumFractionDigits ?? 2
    }));
  }
});

test("formatted plan prices keep the whole-dollar and cents display unchanged", () => {
  assert.equal(formatPlanPrice("en-GB", { amountMinor: 3900, currency: "USD" }), "$39");
  assert.equal(formatPlanPrice("en-GB", { amountMinor: 3950, currency: "USD" }), "$39.50");
  assert.equal(formatPlanPrice("zh-CN", { amountMinor: 3900, currency: "USD" }), "$39");
  assert.equal(formatPlanPrice("zh-CN", { amountMinor: 3950, currency: "USD" }), "$39.50");
});

test("the pricing page and the course page format plan prices through the shared formatter", () => {
  const pricing = readFileSync(new URL("../../components/portal/PricingPlans.tsx", import.meta.url), "utf8");
  const course = readFileSync(new URL("../../app/[locale]/portal/courses/[slug]/page.tsx", import.meta.url), "utf8");
  assert.equal(pricing.includes("maximumFractionDigits"), false);
  assert.equal(course.includes("maximumFractionDigits"), false);
  assert.match(pricing, /formatPlanPrice\(locale, plan\)/);
  assert.match(course, /formatPlanPrice\(locale, plan\)/);
});
