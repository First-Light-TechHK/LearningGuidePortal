import assert from "node:assert/strict";
import React from "react";
import { after, before, test } from "node:test";
import { isolateProductStore, mockModule, verifiedUser } from "./helpers";
import { getMessages } from "@/lib/i18n/messages";

// Outside tests/unit/*.test.ts so test:ci / Verify does not run this lock.

(globalThis as { React?: typeof React }).React = React;

let sessionToken = "";
mockModule("next/headers", {
  namedExports: {
    cookies: async () => ({ get: (name: string) => name === "learning_guide_session" ? { value: sessionToken } : undefined }),
    headers: async () => new Headers({ host: "localhost" }),
  },
});
mockModule("next/navigation", {
  namedExports: {
    redirect: (url: string) => { throw new Error(`redirect ${url}`); },
    useRouter: () => ({ replace() {}, push() {}, refresh() {} }),
    usePathname: () => "/",
    useSearchParams: () => new URLSearchParams(),
  },
});

let isolated: Awaited<ReturnType<typeof isolateProductStore>>;

before(async () => {
  isolated = await isolateProductStore();
});

after(async () => {
  await isolated.restore();
});

function benefitsText(html: string) {
  const match = html.match(/confirmation-benefits">([\s\S]*?)<\/div>/);
  assert.ok(match, "confirmation benefits are missing");
  return match[1].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

test("BUG: epicureanism PC trial confirmation says 1 PC and 1 mobile while mobile entitlement is false", async () => {
  const { store } = isolated;
  const user = await verifiedUser(store, "pc-mobile-copy@example.test");
  sessionToken = (await store.createSession(user.id)).token;
  const pending = await store.createPendingDemoTrialOrder(user.id, "epicureanism-pc-6");
  await store.completeDemoTrialOrder(user.id, pending.order.id);
  const plan = (await store.ensureProductData()).plans.find((item) => item.id === "epicureanism-pc-6");
  assert.ok(plan);
  assert.equal(plan.device, "pc");

  const route = await import("../../../app/api/entitlements/check/route");
  const response = await route.GET(new Request("http://localhost/api/entitlements/check?courseId=epicureanism&device=mobile"));
  assert.equal(response.status, 200);
  const body = await response.json() as { ok: boolean; entitlement: { allowed: boolean; device: string | null } };
  assert.equal(body.ok, true);
  assert.equal(body.entitlement.allowed, false);
  assert.equal(body.entitlement.device, "pc");

  const { renderToStaticMarkup } = await import("react-dom/server");
  const { SubscriptionConfirmation } = await import("../../../components/portal/SubscriptionConfirmation");
  const claimsMobile = /mobile|手机|移动设备/i;
  const shown = (["en-GB", "zh-CN"] as const).map((locale) => {
    const copy = getMessages(locale);
    const html = renderToStaticMarkup(React.createElement(SubscriptionConfirmation, {
      locale,
      quote: { id: "quote_pc_trial", kind: "trial", amountMinor: 0, currency: plan.currency },
      plan: { id: plan.id, name: plan.name, termMonths: plan.termMonths, device: plan.device, amountMinor: plan.amountMinor, currency: plan.currency, aiPoints: plan.aiPoints },
      copy: copy.portal.subscriptionConfirmation,
      planHeading: plan.name,
      scopeDescription: copy.confirmationDetails.courseAccess,
    }));
    return [locale, benefitsText(html)] as const;
  }).filter(([, benefits]) => claimsMobile.test(benefits));
  assert.deepEqual(shown, [], "epicureanism-pc-6 confirmation must not claim a mobile device while device=mobile entitlement is false");
});
