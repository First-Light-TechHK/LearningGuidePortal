import assert from "node:assert/strict";
import { test } from "node:test";
import { checkoutRequestOrigin } from "../../services/paymentService";
import { paymentFailure } from "../../services/paymentHttp";
import { PaymentError } from "../../contracts/payment";

test("checkout origin permits only same-origin loopback in DEV and configured origin in managed environments", async () => {
  const previous = { ...process.env };
  try {
    process.env.NEXT_PUBLIC_APP_URL = "https://payment.example.test";
    for (const environment of ["DEV", "SIT", "UAT", "PPE/PROD"]) {
      process.env.APP_ENV = environment;
      for (const host of ["localhost:3011", "127.0.0.1:3001", "[::1]:3012"]) {
        const origin = `http://${host}`;
        const request = new Request(`${origin}/api/purchase/checkout`, { headers: { origin } });
        if (environment === "DEV") assert.equal(checkoutRequestOrigin(request), origin);
        else assert.throws(() => checkoutRequestOrigin(request), { code: "origin_mismatch" });
        for (const headers of [{}, { origin: "https://attacker.invalid" }, { origin: "null" }]) {
          assert.throws(() => checkoutRequestOrigin(new Request(request.url, { headers: new Headers(Object.entries(headers) as [string, string][]) })), { code: "origin_mismatch" });
        }
      }
      assert.equal(checkoutRequestOrigin(new Request("http://internal:8080/api/purchase/checkout", { headers: { origin: "https://payment.example.test" } })), "https://payment.example.test");
    }
    for (const locale of ["en-GB", "zh-CN"] as const) {
      const origin = paymentFailure(new PaymentError("origin_mismatch", 403), locale);
      const consent = paymentFailure(new PaymentError("consent_required"), locale);
      assert.equal(origin.status, 403);
      assert.equal(consent.status, 400);
      assert.notEqual((await origin.json()).message, (await consent.json()).message);
    }
  } finally { process.env = previous; }
});

test("DEV checkout accepts only the two deployed website aliases and pins the browser origin", () => {
  const previous = { ...process.env };
  try {
    const aliases = ["https://www.ilovelearningguide.com", "https://ilovelearningguide.com"];
    for (const configured of aliases) {
      process.env.NEXT_PUBLIC_APP_URL = configured;
      for (const environment of ["DEV", "SIT", "UAT", "PPE/PROD"]) {
        process.env.APP_ENV = environment;
        for (const origin of aliases) {
          // A reverse proxy may expose a loopback URL to Next.js. It must not
          // replace the configured public origin with the container address.
          for (const target of [origin, "http://localhost:8080", "http://internal:8080"]) {
            const request = new Request(`${target}/api/purchase/checkout`, { headers: { origin } });
            if (environment === "DEV" || origin === configured) assert.equal(checkoutRequestOrigin(request), origin);
            else assert.throws(() => checkoutRequestOrigin(request), { code: "origin_mismatch" });
          }
        }
        for (const origin of ["https://attacker.invalid", "https://ilovelearningguide.com.attacker.invalid", "https://admin.ilovelearningguide.com",
          "https://sit.ilovelearningguide.com", "http://ilovelearningguide.com", "https://ilovelearningguide.com:444", "null", `${configured}/path`]) {
          const request = new Request("http://internal:8080/api/purchase/checkout", { headers: { origin, host: new URL(configured).host,
            "x-forwarded-host": new URL(origin === "null" ? configured : origin).host, "x-forwarded-proto": "https" } });
          assert.throws(() => checkoutRequestOrigin(request), { code: "origin_mismatch" });
        }
        assert.throws(() => checkoutRequestOrigin(new Request(`${configured}/api/purchase/checkout`)), { code: "origin_mismatch" });
      }
    }
    process.env.APP_ENV = "DEV";
    process.env.NEXT_PUBLIC_APP_URL = "https://payment.example.test";
    assert.throws(() => checkoutRequestOrigin(new Request("https://ilovelearningguide.com/api/purchase/checkout", {
      headers: { origin: "https://ilovelearningguide.com", "x-forwarded-host": "ilovelearningguide.com" }
    })), { code: "origin_mismatch" });
  } finally { process.env = previous; }
});
