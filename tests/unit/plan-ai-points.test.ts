import assert from "node:assert/strict";
import { test } from "node:test";
import { withAnnualAiPoints } from "../../services/planAiPoints";
import type { AiPointsPlan } from "../../contracts/plan-ai-points";
import { isolate } from "../io/harness";
import { readProductData, verifiedUser, writeProductData } from "./helpers/my-learning";

test("annual points double only the same product/device six-month allowance without mutating input", () => {
  const base: AiPointsPlan = { courseId: "*", scope: "category", scopeId: "Science", device: "pc", termMonths: 6, aiPoints: 731 };
  const plans = [base, { ...base, termMonths: 12 as const, aiPoints: 731 }, { ...base, device: "mobile" as const, aiPoints: 0 }, { ...base, device: "mobile" as const, termMonths: 12 as const, aiPoints: 99 }, { ...base, scopeId: "Art", termMonths: 12 as const, aiPoints: 600 }, { ...base, scope: "everything" as const, scopeId: "*", aiPoints: 10000 }, { ...base, scope: "everything" as const, scopeId: "*", termMonths: 12 as const, aiPoints: 10000 }];
  const before = structuredClone(plans), result = withAnnualAiPoints(plans);
  assert.deepEqual(result.map(plan => plan.aiPoints), [731,1462,0,0,600,10000,20000]);
  assert.deepEqual(plans, before);
  assert.deepEqual(withAnnualAiPoints(result), result, "repeated calculation does not double again");
});

test("catalogue/API, new quote confirmation and upgrade source use the same annual points rule", async () => {
  const { restore } = await isolate("lg-plan-ai-points-");
  try {
    const store = await import("../../services/productStore");
    await store.ensureProductData();const data = await readProductData();
    for (const plan of data.plans) if (plan.device === "pc") plan.aiPoints = plan.termMonths === 6 ? plan.scope === "everything" ? 1234 : 456 : 999;
    await writeProductData(data);
    const catalogueBefore = structuredClone(data.plans);
    const plans = await store.listPlans();
    for (const annual of plans.filter(plan => plan.termMonths === 12)) {
      const six = plans.find(plan => plan.termMonths === 6 && plan.device === annual.device && plan.scope === annual.scope && plan.scopeId === annual.scopeId);
      assert.ok(six);assert.equal(annual.aiPoints,six.aiPoints! * 2);
    }
    assert.deepEqual((await readProductData()).plans,catalogueBefore,"reading offers does not rewrite persisted plans");
    const { GET } = await import("../../app/api/portal/plans/route");
    const response = await GET(new Request("http://localhost/api/portal/plans"));
    assert.equal(response.status,200);
    const body = await response.json();assert.equal(body.plans.find((plan: { id: string; aiPoints: number }) => plan.id === "everything-pc-12").aiPoints,2468);
    const user = await verifiedUser(store,"annual-points@example.test");
    const quote = await store.createQuote(user.id,"european-humanities-pc-12");
    assert.equal(quote.plan.aiPoints,912);assert.equal(quote.quote.planSnapshot?.aiPoints,912);
    assert.equal((await store.getQuoteForUser(user.id,quote.quote.id))?.plan.aiPoints,912);
    await store.completeDemoCheckout(user.id,quote.quote.id);
    assert.equal((await store.getSubscriptionSelection(user.id)).categorySubscription?.aiPoints,912);
    const updated = await readProductData();updated.plans.find((plan: { id: string; aiPoints: number })=>plan.id==="european-humanities-pc-6").aiPoints=1000;await writeProductData(updated);
    assert.equal((await store.listPlans()).find(plan=>plan.id==="european-humanities-pc-12")?.aiPoints,2000);
    assert.equal((await store.getQuoteForUser(user.id,quote.quote.id))?.plan.aiPoints,912,"existing quote snapshots retain their promised allowance");
  } finally { await restore(); }
});
