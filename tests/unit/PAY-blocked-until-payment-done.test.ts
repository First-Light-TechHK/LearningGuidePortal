import assert from "node:assert/strict";
import { test } from "node:test";
import {
  PAYMENT_PROCESS_COMPLETE,
  PAY_BLOCKED_IDS,
  PAY_BLOCKED_UNTIL_DONE,
  payBlockedSkip,
} from "./pay-strict-blocked";

test("PAY-01..07 remain Blocked until payment development is finished", () => {
  assert.equal(
    PAYMENT_PROCESS_COMPLETE,
    false,
    "do not lift PAYMENT_PROCESS_COMPLETE until the Stripe path and PAY-01..07 invariants are actually done",
  );
  for (const id of PAY_BLOCKED_IDS) {
    const reason = payBlockedSkip(id);
    assert.ok(typeof reason === "string" && reason.startsWith("Blocked:"), `${id} must stay Blocked`);
    assert.ok(reason.includes(PAY_BLOCKED_UNTIL_DONE), `${id} skip must say development is unfinished`);
  }
});
