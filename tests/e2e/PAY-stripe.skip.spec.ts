import { test } from "playwright/test";

// Blocked: no Stripe test key. These must stay skipped — do not assert PAY is fixed.
const blocked = ["PAY-01", "PAY-02", "PAY-03", "PAY-04", "PAY-05", "PAY-06", "PAY-07"] as const;

for (const id of blocked) {
  test.describe(id, () => {
    test.skip(`${id} Blocked: no Stripe test key`, () => {});
  });
}
