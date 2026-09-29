import assert from "node:assert/strict";
import { test } from "node:test";
import { isBusinessEmail } from "../../lib/emailValidation";

test("business email validation permits only the configured email punctuation", () => {
  for (const email of ["learner@example.com", "learner_name@example-domain.co.uk", "learner.name@example.com"]) assert.equal(isBusinessEmail(email), true, email);
  for (const email of ["learner+tag@example.com", "learner:tag@example.com", "learner!tag@example.com", "learner name@example.com", "learner@example!.com", "qq_.123@qq.com", `${"a".repeat(244)}@example.com`]) assert.equal(isBusinessEmail(email), false, email);
});
