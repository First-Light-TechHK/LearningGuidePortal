import { test } from "node:test";

// PAY-02 remains Blocked: createHostedUpgradeCheckout / fulfilUpgrade must
// cancel the source Stripe subscription. That cannot be proven without a
// Stripe test key and a live subscription id.
test("PAY-02 Blocked: no Stripe test key to assert source subscription cancel", { skip: "Blocked: no Stripe test key; store expire of the local source row is not proof" }, () => {});
