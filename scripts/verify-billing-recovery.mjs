import assert from "node:assert/strict";
import { getStripe, getSubscriptionPaymentUrl } from "../services/stripeClient.ts";

// Isolated SDK test: no provider request is made and no live credential is used.
process.env.STRIPE_SECRET_KEY = "sk_test_not_a_real_key";
const stripe = getStripe();
let invoice = { status: "open", hosted_invoice_url: "https://invoice.stripe.com/test-fixture" };
let subscription = { customer: "cus_owner", latest_invoice: invoice };
stripe.subscriptions.retrieve = async () => subscription;
stripe.invoices.retrieve = async () => invoice;
assert.equal(await getSubscriptionPaymentUrl("sub_test", "cus_owner"), invoice.hosted_invoice_url);
await assert.rejects(getSubscriptionPaymentUrl("sub_test", "cus_other"), /does not match/);
subscription = { customer: { id: "cus_owner" }, latest_invoice: "in_test" };
assert.equal(await getSubscriptionPaymentUrl("sub_test", "cus_owner"), invoice.hosted_invoice_url);
invoice = { status: "paid", hosted_invoice_url: "https://invoice.stripe.com/test-fixture" };
await assert.rejects(getSubscriptionPaymentUrl("sub_test", "cus_owner"), /no unpaid invoice/);
invoice = { status: "open", hosted_invoice_url: null };
await assert.rejects(getSubscriptionPaymentUrl("sub_test", "cus_owner"), /no unpaid invoice/);
subscription = { customer: "cus_owner", latest_invoice: null };
await assert.rejects(getSubscriptionPaymentUrl("sub_test", "cus_owner"), /no unpaid invoice/);
console.log("PASS: open invoice, expanded customer, invoice lookup, ownership mismatch, paid invoice, missing URL and missing invoice. SDK responses mocked; no live Stripe payment tested.");
