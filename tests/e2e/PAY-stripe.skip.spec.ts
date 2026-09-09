import { test } from "playwright/test";

// These automated scenarios are not implemented. Manual sandbox payment/expiry
// results and remaining coverage are recorded in docs/phase1/stripe-sandbox.md.
const blocked = ["PAY-01", "PAY-02", "PAY-03", "PAY-04", "PAY-05", "PAY-06", "PAY-07"] as const;

for (const id of blocked) {
  test.describe(id, () => {
    test.skip(`${id} Automated scenario not implemented`, () => {});
  });
}
