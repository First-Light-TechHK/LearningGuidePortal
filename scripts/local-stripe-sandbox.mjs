import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import http from "node:http";
import { parseEnv } from "node:util";
import Stripe from "stripe";
import next from "next";

// One process keeps the app and CLI on the same ephemeral signing secret.
// --smoke uses disposable local data and expires an unpaid test Checkout only.
const repo = process.cwd();
const env = parseEnv(await readFile(path.join(repo, ".env.local"), "utf8"));
Object.assign(process.env, env);
if (process.env.STRIPE_SANDBOX !== "1" || !process.env.STRIPE_SECRET_KEY?.startsWith("sk_test_")) throw new Error("Stripe Sandbox test key required.");
const smoke = process.argv.includes("--smoke"), port = Number(process.env.STRIPE_LOCAL_PORT || 3014);
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error("Invalid local port.");
const origin = `http://127.0.0.1:${port}`;
Object.assign(process.env, { APP_ENV: "DEV", STORAGE_BACKEND: "local", PAYMENT_MODE: "stripe", NEXT_PUBLIC_APP_URL: origin, STRIPE_NO_AUTO_UPDATE: "1" });
const events = "checkout.session.completed,checkout.session.async_payment_succeeded,checkout.session.async_payment_failed,checkout.session.expired,invoice.paid,invoice.payment_failed,invoice.voided,customer.subscription.updated,customer.subscription.deleted";
const delivered = new Set();
const listener = spawn(process.env.STRIPE_CLI_PATH || "stripe", ["listen", "--forward-to", `${origin}/api/payment/webhook`, "--events", events], {
  windowsHide: true, env: { ...process.env, STRIPE_API_KEY: process.env.STRIPE_SECRET_KEY }, stdio: ["ignore", "pipe", "pipe"],
});
let settleSecret, rejectSecret, secretSettled = false;
const secret = new Promise((resolve, reject) => { settleSecret = resolve; rejectSecret = reject; });
const listenerTimer = setTimeout(() => rejectSecret(new Error("Stripe listener did not become ready.")), 45000);
for (const stream of [listener.stdout, listener.stderr]) {
  let buffered = "";
  stream.on("data", chunk => {
    buffered += chunk.toString();
    // The Ready line contains the CLI signing secret. Keep it in memory only.
    const match = buffered.match(/whsec_[A-Za-z0-9]+/);
    if (match && !secretSettled) { secretSettled = true; clearTimeout(listenerTimer); settleSecret(match[0]); }
    const lines = buffered.split(/\r?\n/); buffered = lines.pop() || "";
    for (const line of lines) {
      const event = line.match(/\[200\].*\[(evt_[A-Za-z0-9]+)\]/);
      if (event) delivered.add(event[1]);
      console.log(line.replace(/whsec_[A-Za-z0-9]+/g, "[signing secret hidden]"));
    }
  });
}
listener.on("error", () => rejectSecret(new Error("Stripe CLI unavailable; set STRIPE_CLI_PATH or install Stripe CLI.")));
listener.on("exit", () => { if (!secretSettled) rejectSecret(new Error("Stripe listener exited before becoming ready.")); });
let app, server, temporary, probe, stripe, closing = false;
async function close() {
  if (closing) return; closing = true;
  clearTimeout(listenerTimer); listener.kill();
  if (probe && stripe) { try { await stripe.checkout.sessions.expire(probe.id); } catch { /* already expired */ } }
  if (server) { server.closeIdleConnections?.(); await new Promise(resolve => server.close(resolve)); }
  if (app) await app.close();
  process.chdir(repo);
  if (temporary && path.dirname(temporary) === tmpdir()) await rm(temporary, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => { void close().then(() => process.exit()); });
try {
  process.env.STRIPE_WEBHOOK_SECRET = await secret;
  if (smoke) {
    temporary = await mkdtemp(path.join(tmpdir(), "lg-stripe-local-"));
    process.chdir(temporary);
  }
  app = next({ dev: false, dir: repo, hostname: "127.0.0.1", port });
  await app.prepare();
  const handler = app.getRequestHandler();
  server = http.createServer((req, res) => handler(req, res));
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(port, "127.0.0.1", resolve); });
  console.log(JSON.stringify({ ready: true, origin, webhook: `${origin}/api/payment/webhook`, isolatedData: smoke, environmentFileChanged: false }));
  if (smoke) {
    stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { maxNetworkRetries: 1, timeout: 15000 });
    const reference = process.env.STRIPE_PRICE_EVERYTHING_SIX_MONTHS;
    if (!reference) throw new Error("Everything six-month Price is not configured.");
    const price = reference.startsWith("price_") ? await stripe.prices.retrieve(reference) : (await stripe.prices.list({ active: true, lookup_keys: [reference], limit: 2 })).data[0];
    if (!price || price.livemode) throw new Error("A test recurring Price is required.");
    probe = await stripe.checkout.sessions.create({ mode: "subscription", line_items: [{ price: price.id, quantity: 1 }], metadata: { app: "local_webhook_transport_probe" },
      managed_payments: { enabled: false }, adaptive_pricing: { enabled: false }, success_url: origin, cancel_url: origin });
    await stripe.checkout.sessions.expire(probe.id);
    let actualEvent;
    const deadline = Date.now() + 45000;
    while (Date.now() < deadline) {
      if (!actualEvent) actualEvent = (await stripe.events.list({ type: "checkout.session.expired", limit: 10 })).data.find(event => event.data.object.id === probe.id);
      if (actualEvent && delivered.has(actualEvent.id)) break;
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    if (!actualEvent || !delivered.has(actualEvent.id)) throw new Error("The real CLI-forwarded event did not receive HTTP 200.");
    const raw = JSON.stringify(actualEvent);
    const post = signature => fetch(`${origin}/api/payment/webhook`, { method: "POST", headers: { "content-type": "application/json", "stripe-signature": signature }, body: raw });
    const invalid = await post(stripe.webhooks.generateTestHeaderString({ payload: raw, secret: "whsec_invalid_test_only" }));
    if (invalid.status !== 400) throw new Error("Invalid webhook signature was not rejected.");
    for (let count = 0; count < 2; count++) {
      const repeat = await post(stripe.webhooks.generateTestHeaderString({ payload: raw, secret: process.env.STRIPE_WEBHOOK_SECRET }));
      if (repeat.status !== 200) throw new Error("Signed event replay failed.");
    }
    console.log(JSON.stringify({ ok: true, realCliForwardedEvent: true, webhookStatus: 200, invalidSignatureStatus: 400, signedReplays: 2, charged: false }));
    await close();
  }
} catch (error) {
  console.error(error instanceof Stripe.errors.StripeError ? JSON.stringify({ error: "Stripe sandbox probe failed", type: error.type, code: error.code }) : error.message);
  process.exitCode = 1; await close();
}
