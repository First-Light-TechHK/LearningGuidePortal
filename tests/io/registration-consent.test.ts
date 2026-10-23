import assert from "node:assert/strict";
import { test } from "node:test";
import { stop } from "esbuild";
import { isolate, PASSWORD } from "./harness";
import { readProductData } from "../unit/helpers/my-learning";
import { assertRegistrationConsent } from "../../services/registrationConsent";
import { RegistrationConsentError } from "../../contracts/registration";

test("registration consent accepts only literal true", () => {
  assert.doesNotThrow(() => assertRegistrationConsent(true));
  for (const value of [undefined, false, null, 0, 1, "true", "false", [], {}]) {
    assert.throws(() => assertRegistrationConsent(value), RegistrationConsentError);
  }
});

test("both public registration routes reject missing/forged consent without creating account, token or session", async () => {
  const { restore } = await isolate("lg-registration-consent-");
  try {
    const store = await import("../../services/productStore");
    await store.readProductAggregate();
    const routes = [await import("../../app/api/auth/register/route"), await import("../../app/api/auth/sign-up/route")];
    const before = await readProductData();
    for (const route of routes) {
      for (const termsAccepted of [undefined, false, null, "true", 1, {}, []]) {
        const response = await route.POST(new Request("http://localhost/api/auth/register", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: "consent@example.test", password: PASSWORD, nickname: "Consent Learner", termsAccepted }) }));
        assert.equal(response.status, 400);
        const body = await response.json();
        assert.equal(body.code, "REGISTRATION_CONSENT_REQUIRED"); assert.ok(body.requestId);
        assert.equal(response.headers.get("set-cookie"), null);
        assert.deepEqual(await readProductData(), before, "rejected consent cannot mutate any persisted record");
      }
    }
    for (const [index, route] of routes.entries()) {
      const response = await route.POST(new Request("http://localhost/api/auth/register", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: `accepted-${index}@example.test`, password: PASSWORD, nickname: "test001", locale: "en-GB", termsAccepted: true }) }));
      assert.equal(response.status, 200); assert.equal((await response.json()).ok, true);
<<<<<<< HEAD
      const account=(await readProductData()).users.find((user: any)=>user.email===`accepted-${index}@example.test`);
=======
      const account=(await readProductData()).users.find((user: { email: string | null; nickname: string })=>user.email===`accepted-${index}@example.test`);
>>>>>>> origin/dev
      assert.equal(account.nickname,"test001");
      assert.equal((await store.updateUserProfile({userId:account.id,nickname:"test001",locale:index===0?"en-GB":"zh-CN"})).nickname,"test001");
      await assert.rejects(()=>store.updateUserProfile({userId:account.id,nickname:"test_001",locale:"en-GB"}));
    }
  } finally { await stop(); await restore(); }
});
