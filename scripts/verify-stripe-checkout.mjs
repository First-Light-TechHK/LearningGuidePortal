import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { createRequire } from "node:module";
import { parseEnv } from "node:util";
import Stripe from "stripe";
import next from "next";

// Real Stripe test-mode Checkout verification, with a disposable local application store.
// No card is submitted. All open test sessions created here are expired in finally.
const repo = process.cwd();
const env = parseEnv(await fs.readFile(path.join(repo, ".env.local"), "utf8"));
if (!/^[rs]k_test_/.test(env.STRIPE_SECRET_KEY || "")) throw new Error("This check requires a Stripe test key.");
const base = "http://127.0.0.1:3097";
const temporary = await fs.mkdtemp(path.join(os.tmpdir(), "learning-guide-stripe-http-"));
Object.assign(process.env, env, { APP_ENV: "DEV", STORAGE_BACKEND: "local", PAYMENT_MODE: "stripe", LOCAL_SOCIAL_LOGIN: "1", NEXT_PUBLIC_APP_URL: base });
for (const key of ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "WECHAT_APP_ID", "WECHAT_APP_SECRET", "SMTP_HOST", "SMTP_USER", "SMTP_PASS", "SES_FROM_EMAIL", "DATABASE_URL", "DATA_S3_BUCKET"]) process.env[key] = "";
process.chdir(temporary);
const stripe = new Stripe(env.STRIPE_SECRET_KEY, { maxNetworkRetries: 1, timeout: 15000 });
const created = [];
const app = next({ dev: false, dir: repo, hostname: "127.0.0.1", port: 3097 });
let server;
let browser;
let cookie = "";
const assert = (condition, message) => { if (!condition) throw new Error(message); };
async function request(route, body) {
  const response = await fetch(base + route, { method: body ? "POST" : "GET", redirect: "manual", headers: { origin: base, "content-type": "application/json", ...(cookie ? { cookie } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
  const content = await response.text();
  let data;
  try { data = JSON.parse(content); } catch { data = content; }
  return { response, data };
}
try {
  await app.prepare();
  const handler = app.getRequestHandler();
  server = http.createServer((req, res) => handler(req, res));
  await new Promise(resolve => server.listen(3097, "127.0.0.1", resolve));
  assert((await request("/api/purchase/checkout", { quoteId: "unknown" })).response.status === 401, "Unauthenticated Checkout was accepted.");
  const login = await request("/api/auth/wechat?locale=en-GB");
  assert(login.response.status === 307, "Local test sign-in failed.");
  cookie = login.response.headers.get("set-cookie")?.split(";")[0] || "";
  const plans = (await request("/api/portal/plans")).data.plans;
  const selected = plans.filter(plan => plan.device === "pc" && ["category", "everything"].includes(plan.scope));
  assert(selected.length === 8, "Pricing did not return eight subscription choices.");
  let checked = 0;
  const unavailable = [];
  for (const plan of selected) {
    const quote = await request("/api/subscription/quote", { planId: plan.id });
    if (plan.available === false) {
      assert(quote.response.status === 503, "Unavailable Price was accepted.");
      unavailable.push(plan.id);
      continue;
    }
    assert(quote.response.status === 200, "Quote creation failed for " + plan.id);
    const input = { quoteId: quote.data.quote.id, locale: "en-GB", consents: { renewal: true, terms: true, refund: true } };
    const payment = await request("/api/purchase/checkout", input);
    assert(payment.response.status === 200, "Checkout creation failed for " + plan.id + ": " + payment.data.code);
    const id = payment.data.order.stripeCheckoutSessionId;
    created.push(id);
    const session = await stripe.checkout.sessions.retrieve(id, { expand: ["line_items"] });
    assert(!session.livemode && session.mode === "subscription", "Checkout mode mismatch.");
    assert(session.line_items.data[0].price.id === quote.data.quote.price.stripePriceId, "Pinned Price mismatch.");
    assert(session.amount_total === plan.amountMinor && session.currency === plan.currency, "Displayed and charged prices differ.");
    assert(session.success_url.startsWith(base + "/en-GB/portal/payment/success"), "Runtime return origin mismatch.");
    const repeated = await request("/api/purchase/checkout", input);
    assert(repeated.data.order.stripeCheckoutSessionId === id, "Duplicate Checkout created.");
    const success = await request("/en-GB/portal/payment/success?orderId=" + payment.data.order.id);
    assert(success.response.status === 200, "Pending result page failed.");
    checked++;
  }
  const require = createRequire(import.meta.url);
  const { chromium } = require("playwright");
  assert(checked >= 7, "Fewer than seven configured prices could be verified.");
  browser = await chromium.launch({ channel: "chrome", headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const output = path.join(repo, "test-results", "stripe-checkout");
  await fs.mkdir(output, { recursive: true });
  for (const locale of ["en-GB", "zh-CN"]) {
    await page.goto(base + "/" + locale + "/pricing", { waitUntil: "networkidle" });
    await page.screenshot({ path: path.join(output, locale + "-pricing.png"), fullPage: true });
    assert(await page.locator(".pricing-design-card").count() === 2, "Pricing cards did not render.");
  }
  console.log(JSON.stringify({ ok: true, checkoutChoicesVerified: checked, unavailable, screenshots: "test-results/stripe-checkout", charged: false }));
} catch (error) {
  process.exitCode = 1;
  console.error(error instanceof Error ? error.message : "Stripe verification failed.");
} finally {
  if (browser) await browser.close();
  for (const id of created) {
    try { await stripe.checkout.sessions.expire(id); }
    catch { console.error("A verification Checkout could not be expired; inspect test-mode sessions."); }
  }
  if (server) await new Promise(resolve => server.close(resolve));
  await app.close();
  process.chdir(repo);
  // Only remove the directory allocated by mkdtemp above.
  if (path.dirname(temporary) === os.tmpdir()) await fs.rm(temporary, { recursive: true, force: true });
}
