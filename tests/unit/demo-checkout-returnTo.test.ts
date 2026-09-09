import assert from "node:assert/strict";
import { test } from "node:test";
import { demoCheckoutSignInReturnTo } from "../../lib/demoCheckoutReturnTo";

// Review corner (no new BugID): unauthenticated demo checkout must keep orderId
// on returnTo so getOrderForUser can resume the pending order.

test("demo checkout sign-in returnTo keeps orderId", () => {
  assert.equal(
    demoCheckoutSignInReturnTo("en-GB", "order_123"),
    "/en-GB/portal/payment/checkout?orderId=order_123",
  );
  assert.equal(
    demoCheckoutSignInReturnTo("zh-CN", "order a"),
    "/zh-CN/portal/payment/checkout?orderId=order%20a",
  );
});
