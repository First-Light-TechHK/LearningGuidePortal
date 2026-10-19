import assert from "node:assert/strict";
import { test } from "node:test";
import { buildSubscriptionConfirmationDisplay } from "../../services/subscriptionConfirmationDisplay";
import type { ProductPlan, ProductQuote, ProductSubscription } from "../../services/productStore";

const plan = { id: "everything-pc-6", scope: "everything", courseId: "*", termMonths: 6, aiPoints: 1500 } as ProductPlan;
const quote = { createdAt: "2026-10-13T00:00:00Z", kind: "purchase" } as ProductQuote;

test("confirmation derives only estimated purchase dates from the server quote, clamping month ends", () => {
  const display = buildSubscriptionConfirmationDisplay({ quote, plan, categoryCount: 4 });
  assert.equal(display.planKind, "everything"); assert.equal(display.categoryCount, 4);
  assert.deepEqual(display.schedule, { startsAt: "2026-10-13T00:00:00.000Z", endsAt: "2027-04-12T00:00:00.000Z", renewsAt: "2027-04-13T00:00:00.000Z" });
  assert.equal(buildSubscriptionConfirmationDisplay({ quote: { ...quote, createdAt: "2023-08-31T16:00:00Z" }, plan, categoryCount: 3 }).schedule?.renewsAt, "2024-02-29T16:00:00.000Z");
  for (const kind of ["trial", "upgrade"] as const) assert.equal(buildSubscriptionConfirmationDisplay({ quote: { ...quote, kind }, plan, categoryCount: 3 }).schedule, null);
  assert.equal(buildSubscriptionConfirmationDisplay({ quote: { ...quote, createdAt: "invalid" }, plan, categoryCount: 3 }).schedule, null);
});

test("upgrade dates and remaining days use the pinned Stripe period without rewriting source records", () => {
  const source = { validTo: "2027-02-03T00:00:00Z" } as ProductSubscription;
  const upgradeQuote = { ...quote, kind: "upgrade", upgradeProration: { periodEnd: Date.parse("2027-02-01T00:00:00Z") / 1000, prorationDate: Date.parse("2026-10-14T00:00:00Z") / 1000 } } as ProductQuote;
  const before = structuredClone({ source, upgradeQuote });
  const display = buildSubscriptionConfirmationDisplay({ quote: upgradeQuote, plan, categoryCount: 3, source, sourcePlan: { ...plan, aiPoints: 500 }, sourceCategory: "中国人文" });
  assert.deepEqual(display.upgrade, { sourceCategory: "中国人文", sourceAiPoints: 500, remainingDays: 110, validUntil: "2027-01-31T23:59:59.999Z", renewsAt: "2027-02-01T00:00:00.000Z" });
  assert.deepEqual({ source, upgradeQuote }, before);
  assert.equal(buildSubscriptionConfirmationDisplay({ quote: upgradeQuote, plan, categoryCount: 3 }).upgrade, null);
});
