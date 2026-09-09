import { test } from "playwright/test";

// PAY-01..07 stay Blocked until payment Stripe development is finished.
// Demo / empty skip must not look like a pass. Bodies keep the invariant text.
const blocked = [
  ["PAY-01", "$0 trial invoice.paid must not grant a full paid period"],
  ["PAY-02", "upgrade must cancel the source Stripe subscription"],
  ["PAY-03", "same quote must reuse one Session, not create many"],
  ["PAY-04", "refund must terminate entitlement; later invoice must not revive"],
  ["PAY-05", "duplicate success events must not fulfil twice (UNIQUE required)"],
  ["PAY-06", "grace D+3 is from original expiry, not now+3 days"],
  ["PAY-07", "invoice.paid must not clear cancel_at_period_end"],
] as const;

for (const [id, invariant] of blocked) {
  test.describe(id, () => {
    test(`${id}: ${invariant}`, async () => {
      test.skip(true, `Blocked: ${id} 支付过程开发未完成，完成后再解除`);
    });
  });
}
