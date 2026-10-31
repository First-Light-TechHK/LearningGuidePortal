// Helpdesk v4 Part A (helpdesk-v4-order-and-chat-end.md, 2026-10-29), Portal
// server side: an enquiry may carry the learner's own order (orderId), checked
// by code against the order record (another learner's or an unknown order is
// 400 validation_failed, field orderId), stored with the ticket, and shown to
// the BackOffice agent as a read-only projection built by code (only the
// listed fields). The AI path never sees order data: the suggest request is
// exactly as before. Storage is the real DEV-only local repository.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import {
  HELPDESK_LIMITS, HelpdeskProblem, ORDER_KINDS, ORDER_STATUSES, PAYMENT_MODES, parseCreateTicketInput, parseSuggestInput,
  type AdminSuggestRequest, type CreateTicketInput, type OrderProjection
} from "../../contracts/helpdesk";
import { createAssistantService } from "../../modules/helpdesk/assistant";
import { ORDER_PROJECTION_FIELDS, projectOrder, type OrderSource } from "../../modules/helpdesk/orderDirectory";
import { createHelpdeskService, type HelpdeskDeps } from "../../modules/helpdesk/service";
import { createLocalHelpdeskRepository } from "../../repositories/helpdeskRepository";

let root = "";
before(async () => { root = await mkdtemp(path.join(tmpdir(), "lg-helpdesk-v4-order-")); });
after(async () => { if (root && path.dirname(root) === tmpdir()) await rm(root, { recursive: true, force: true }); });

const learner = { id: "user-emily", email: "emily.carter@example.com", name: "Emily Carter" };
const other = { id: "user-other", email: "other@example.com", name: "Other Learner" };
const ORDER_ID = "order_1761720000000_a1b2c3d4";
const OTHER_ORDER_ID = "order_1761720000001_deadbeef";

/** The product store as the order owner keeps it, with the fields the projection must never pass on. */
function source(overrides: Partial<OrderSource["orders"][number]> = {}): OrderSource {
  return {
    plans: [{ id: "epicureanism-pc-6", name: "Epicureanism · PC · 6 months" }],
    orders: [
      {
        id: ORDER_ID, userId: learner.id, planId: "epicureanism-pc-6", status: "paid", amountMinor: 3900, currency: "usd", paymentMode: "stripe", kind: "purchase",
        createdAt: "2026-10-28T08:39:01.859Z", quoteId: "quote_secret", stripeCheckoutSessionId: "cs_test_secret", stripePaymentIntentId: "pi_secret", stripeInvoiceId: "in_secret",
        stripeSubscriptionId: "sub_secret", failureReason: "card_declined", ...overrides
      } as OrderSource["orders"][number],
      { id: OTHER_ORDER_ID, userId: other.id, planId: "epicureanism-pc-6", status: "paid", amountMinor: 3900, currency: "usd", paymentMode: "demo", createdAt: "2026-10-28T09:00:00.000Z" }
    ]
  };
}

function harness(orders: HelpdeskDeps["orders"] = async (userId, orderId) => projectOrder(source(), userId, orderId)) {
  const repository = createLocalHelpdeskRepository(path.join(root, randomUUID()));
  const lines: Array<Record<string, unknown>> = [];
  const service = createHelpdeskService({ repository, blobs: { async put() {}, async get() { return new Uint8Array(); } }, now: () => new Date("2026-10-29T06:00:00.000Z"), log: (line) => lines.push(line), orders });
  return { service, repository, lines };
}

const input = (extra: Partial<CreateTicketInput> = {}): CreateTicketInput => ({ category: "payments_subscriptions", subject: "Paid but no access", body: "I paid but the course is still locked.", locale: "en-GB", contactEmail: null, suggestionId: null, assistIds: [], files: [], ...extra });

async function rejectsOrder(promise: Promise<unknown>) {
  await assert.rejects(promise, (error: unknown) => {
    assert.ok(error instanceof HelpdeskProblem, String(error));
    assert.equal(error.code, "validation_failed");
    assert.equal(error.status, 400);
    assert.equal(error.field, "orderId");
    return true;
  });
}

// ---------------------------------------------------------------- contract

test("v4 contract: orderId is optional on a new enquiry; an order number in the existing format is kept, anything else is 400 field orderId", () => {
  const base = { category: "payments_subscriptions", subject: "Refund", body: "Please refund.", locale: "en-GB" };
  assert.equal(parseCreateTicketInput(base, []).orderId, null, "absent: no order");
  assert.equal(parseCreateTicketInput({ ...base, orderId: "" }, []).orderId, null, "empty (the learner removed it): no order");
  assert.equal(parseCreateTicketInput({ ...base, orderId: ` ${ORDER_ID} ` }, []).orderId, ORDER_ID, "trimmed, never rewritten");
  assert.equal(parseCreateTicketInput({ ...base, orderId: "x".repeat(HELPDESK_LIMITS.orderIdMax) }, []).orderId, "x".repeat(HELPDESK_LIMITS.orderIdMax));
  for (const bad of ["x".repeat(HELPDESK_LIMITS.orderIdMax + 1), "order 1", "order/1", "order_1\u0000", "订单1", ["a", "b"], 42, {}]) {
    assert.throws(() => parseCreateTicketInput({ ...base, orderId: bad }, []), (error: unknown) => error instanceof HelpdeskProblem && error.code === "validation_failed" && error.field === "orderId", JSON.stringify(bad));
  }
});

test("v4 contract: the order enums are the order owner's own values", () => {
  assert.deepEqual([...ORDER_STATUSES], ["paid", "pending", "failed", "canceled", "refunded"]);
  assert.deepEqual([...ORDER_KINDS], ["purchase", "trial_activation", "upgrade"]);
  assert.deepEqual([...PAYMENT_MODES], ["demo", "stripe"]);
});

test("the AI path never receives order data: a submit check drops orderId and Admin is asked exactly as before", async () => {
  const parsed = parseSuggestInput({ category: "payments_subscriptions", subject: "Refund", message: "Please refund.", locale: "en-GB", orderId: ORDER_ID, order: { id: ORDER_ID } });
  assert.deepEqual(Object.keys(parsed).sort(), ["category", "locale", "message", "subject"]);
  const calls: AdminSuggestRequest[] = [];
  const assistant = createAssistantService({
    repository: createLocalHelpdeskRepository(path.join(root, randomUUID())),
    admin: { suggest: async () => null, suggestReply: async (request: AdminSuggestRequest) => { calls.push(request); return { suggestion: null, alternatives: [] }; }, reportOutcome: async () => true },
    log: () => undefined
  });
  await assistant.checkForSubmit(learner, parsed);
  assert.deepEqual(Object.keys(calls[0]).sort(), ["category", "learnerId", "locale", "message", "parentRunId", "runId", "source", "subject"]);
  assert.doesNotMatch(JSON.stringify(calls[0]), /order/i);
});

// ---------------------------------------------------------------- projection

test("projectOrder: only the listed fields, built by code from the learner's own order record; nothing for someone else's or an unknown order", () => {
  const projected = projectOrder(source(), learner.id, ORDER_ID);
  assert.deepEqual(projected, { id: ORDER_ID, status: "paid", amount: 3900, currency: "usd", planName: "Epicureanism · PC · 6 months", kind: "purchase", createdAt: "2026-10-28T08:39:01.859Z", paymentMode: "stripe" } satisfies OrderProjection);
  assert.deepEqual(Object.keys(projected!).sort(), [...ORDER_PROJECTION_FIELDS].sort());
  assert.doesNotMatch(JSON.stringify(projected), /secret|cs_|pi_|in_|sub_|card|quote|userId/, "no card data, Stripe ids or other order fields");
  assert.equal(projectOrder(source(), learner.id, OTHER_ORDER_ID), null, "another learner's order");
  assert.equal(projectOrder(source(), other.id, ORDER_ID), null);
  assert.equal(projectOrder(source(), learner.id, "order_0_missing"), null, "unknown order");
});

test("projectOrder: the plan name the order was bought under (snapshot first), an absent kind is a purchase, a gone plan shows its id", () => {
  assert.equal(projectOrder(source({ planSnapshot: { name: "Snapshot name" } as OrderSource["orders"][number]["planSnapshot"] }), learner.id, ORDER_ID)?.planName, "Snapshot name");
  assert.equal(projectOrder(source({ kind: undefined }), learner.id, ORDER_ID)?.kind, "purchase");
  assert.equal(projectOrder(source({ planId: "retired-plan" }), learner.id, ORDER_ID)?.planName, "retired-plan");
  assert.equal(projectOrder(source({ status: "refunded", kind: "upgrade", paymentMode: "demo" }), learner.id, ORDER_ID)?.status, "refunded");
});

// ---------------------------------------------------------------- create

test("an enquiry with the learner's own order stores it; the BackOffice list carries orderId and the detail carries the projection", async () => {
  const h = harness();
  const created = await h.service.createTicket(learner, input({ orderId: ORDER_ID }), randomUUID());
  const stored = await h.repository.findTicket(created.ticket.id);
  assert.equal(stored?.ticket.orderId, ORDER_ID);
  const list = await h.service.listAgentTickets({ status: null, q: "", limit: 20, cursor: null });
  assert.equal(list.tickets[0].orderId, ORDER_ID);
  const detail = await h.service.getAgentTicket(created.ticket.id);
  assert.equal(detail.orderId, ORDER_ID);
  assert.deepEqual(detail.order, projectOrder(source(), learner.id, ORDER_ID));
  assert.equal("orderId" in created.ticket, false, "the learner's own ticket view is unchanged");
});

test("another learner's order or an unknown order is 400 validation_failed field orderId, and nothing is stored", async () => {
  const h = harness();
  await rejectsOrder(h.service.createTicket(learner, input({ orderId: OTHER_ORDER_ID }), randomUUID()));
  await rejectsOrder(h.service.createTicket(learner, input({ orderId: "order_0_missing" }), randomUUID()));
  assert.deepEqual(await h.repository.listTicketsByUser(learner.id), []);
  const noLookup = createHelpdeskService({ repository: createLocalHelpdeskRepository(path.join(root, randomUUID())), blobs: { async put() {}, async get() { return new Uint8Array(); } }, log: () => undefined });
  await rejectsOrder(noLookup.createTicket(learner, input({ orderId: ORDER_ID }), randomUUID()));
});

test("ticket creation is never blocked: no order is the v1 path, and an order store outage creates the enquiry without the link (logged without learner data)", async () => {
  const h = harness();
  const plain = await h.service.createTicket(learner, input(), randomUUID());
  assert.equal((await h.repository.findTicket(plain.ticket.id))?.ticket.orderId, null);
  assert.equal((await h.service.getAgentTicket(plain.ticket.id)).order, null);
  assert.equal((await h.service.getAgentTicket(plain.ticket.id)).orderId, null);
  const down = harness(async () => { throw new Error("store down"); });
  const created = await down.service.createTicket(learner, input({ orderId: ORDER_ID }), randomUUID());
  assert.equal((await down.repository.findTicket(created.ticket.id))?.ticket.orderId, null, "an order that could not be checked is never stored");
  assert.ok(down.lines.some((line) => line.event === "order_lookup_failed"));
  assert.doesNotMatch(JSON.stringify(down.lines), new RegExp(`${ORDER_ID}|${learner.email}`));
});

test("idempotency: a retried create with the order replays; the same key with a different order is a conflict; a key without an order hashes as before", async () => {
  const h = harness(async (userId, orderId) => projectOrder({ ...source(), orders: [...source().orders, { ...source().orders[0], id: "order_2_second" }] }, userId, orderId));
  const key = randomUUID();
  const first = await h.service.createTicket(learner, input({ orderId: ORDER_ID }), key);
  const again = await h.service.createTicket(learner, input({ orderId: ORDER_ID }), key);
  assert.equal(again.replayed, true);
  assert.equal(again.ticket.id, first.ticket.id);
  await assert.rejects(h.service.createTicket(learner, input({ orderId: "order_2_second" }), key), (error: unknown) => error instanceof HelpdeskProblem && error.code === "idempotency_conflict");
  await assert.rejects(h.service.createTicket(learner, input(), key), (error: unknown) => error instanceof HelpdeskProblem && error.code === "idempotency_conflict", "dropping the order is a different request");
  const plainKey = randomUUID();
  const plain = await h.service.createTicket(learner, input(), plainKey);
  const stored = await h.repository.findTicket(plain.ticket.id);
  assert.equal((await h.service.createTicket(learner, input({ orderId: null }), plainKey)).replayed, true, "null and absent are the same request");
  assert.ok(stored);
});

test("the agent detail reads the order live (a later refund shows) and still only for the ticket's learner; a lookup failure shows no order", async () => {
  let status: OrderSource["orders"][number]["status"] = "paid";
  let fail = false;
  const h = harness(async (userId, orderId) => { if (fail) throw new Error("down"); return projectOrder(source({ status }), userId, orderId); });
  const created = await h.service.createTicket(learner, input({ orderId: ORDER_ID }), randomUUID());
  status = "refunded";
  assert.equal((await h.service.getAgentTicket(created.ticket.id)).order?.status, "refunded");
  fail = true;
  const detail = await h.service.getAgentTicket(created.ticket.id);
  assert.equal(detail.order, null);
  assert.equal(detail.orderId, ORDER_ID, "the number stays");
  assert.ok(h.lines.some((line) => line.event === "order_lookup_failed"));
});

test("DEV local store written before v4 reads as tickets without an order", async () => {
  const dir = path.join(root, randomUUID());
  const repository = createLocalHelpdeskRepository(dir);
  const service = createHelpdeskService({ repository, blobs: { async put() {}, async get() { return new Uint8Array(); } }, log: () => undefined });
  const created = await service.createTicket(learner, input(), randomUUID());
  const { readFile, writeFile, readdir } = await import("node:fs/promises");
  const files = await readdir(dir);
  const file = path.join(dir, files.find((name) => name.endsWith(".json"))!);
  const store = JSON.parse(await readFile(file, "utf8")) as { tickets: Array<Record<string, unknown>> };
  for (const ticket of store.tickets) delete ticket.orderId;
  await writeFile(file, JSON.stringify(store));
  const reread = await createLocalHelpdeskRepository(dir).findTicket(created.ticket.id);
  assert.equal(reread?.ticket.orderId, null);
});

test("v4 review: the order lookup runs after the rate limit, so a learner over the limit costs no order-store read (also with a wrong orderId)", async () => {
  let lookups = 0;
  const h = harness(async (userId, orderId) => { lookups += 1; return projectOrder(source(), userId, orderId); });
  for (let n = 0; n < HELPDESK_LIMITS.ticketsPerHour; n += 1) await h.service.createTicket(learner, input({ subject: `Enquiry ${n}` }), randomUUID());
  assert.equal(lookups, 0, "no orderId, no lookup");
  for (const orderId of [ORDER_ID, OTHER_ORDER_ID, "order_unknown"]) {
    await assert.rejects(h.service.createTicket(learner, input({ subject: `Over the limit ${orderId}`, orderId }), randomUUID()), (error: unknown) => error instanceof HelpdeskProblem && error.code === "rate_limited");
  }
  assert.equal(lookups, 0, "the limiter answers first");
  // Under the limit the check still runs (and refuses another learner's order).
  const fresh = harness(async (userId, orderId) => { lookups += 1; return projectOrder(source(), userId, orderId); });
  await rejectsOrder(fresh.service.createTicket(learner, input({ orderId: OTHER_ORDER_ID }), randomUUID()));
  assert.equal(lookups, 1);
});

test("v4 review: the Contact Support page's order from ?orderId: the learner's own order, else a notice (not theirs, unknown, malformed, or the store failed); none without the parameter", async () => {
  const { supportOrder } = await import("../../modules/helpdesk/learnerPages");
  const lookups: string[] = [];
  const lookup = async (orderId: string) => { lookups.push(orderId); return projectOrder(source(), learner.id, orderId); };
  assert.deepEqual(await supportOrder(ORDER_ID, lookup), { order: { id: ORDER_ID }, orderUnavailable: false });
  assert.deepEqual(await supportOrder([ORDER_ID, OTHER_ORDER_ID], lookup), { order: { id: ORDER_ID }, orderUnavailable: false }, "a repeated parameter: the first");
  assert.deepEqual(await supportOrder(OTHER_ORDER_ID, lookup), { order: null, orderUnavailable: true }, "another learner's order");
  assert.deepEqual(await supportOrder("order_unknown", lookup), { order: null, orderUnavailable: true }, "no such order");
  assert.deepEqual(await supportOrder("<script>", lookup), { order: null, orderUnavailable: true }, "malformed: never looked up");
  assert.deepEqual(await supportOrder("x".repeat(65), lookup), { order: null, orderUnavailable: true });
  assert.deepEqual(lookups, [ORDER_ID, ORDER_ID, OTHER_ORDER_ID, "order_unknown"]);
  assert.deepEqual(await supportOrder(ORDER_ID, async () => { throw new Error("store down"); }), { order: null, orderUnavailable: true }, "an order store failure opens the form, with the notice");
  for (const raw of [undefined, "", "   ", []]) assert.deepEqual(await supportOrder(raw as string | string[] | undefined, lookup), { order: null, orderUnavailable: false }, `no order asked for: ${JSON.stringify(raw)}`);
});

test("v4 review: signed out, Contact Support for an order sends the learner to sign in and back to the same order (safeReturnTo keeps it); the plain form's returnTo is unchanged", async () => {
  const { supportSignInPath } = await import("../../modules/helpdesk/learnerPages");
  const { safeReturnTo } = await import("../../services/runtimeConfig");
  assert.equal(supportSignInPath("en-GB", undefined), "/en-GB/portal/sign-in?returnTo=/en-GB/account/my-learning/support", "as before v4");
  assert.equal(supportSignInPath("zh-CN", "<bad>"), "/zh-CN/portal/sign-in?returnTo=/zh-CN/account/my-learning/support", "a malformed id is dropped");
  const target = supportSignInPath("en-GB", ORDER_ID);
  const returnTo = new URL(target, "https://portal.test").searchParams.get("returnTo");
  assert.equal(returnTo, `/en-GB/account/my-learning/support?orderId=${ORDER_ID}`);
  assert.equal(safeReturnTo(returnTo, "/fallback"), `/en-GB/account/my-learning/support?orderId=${ORDER_ID}`, "the sign-in page keeps the order");
  assert.equal(new URL(supportSignInPath("zh-CN", [ORDER_ID]), "https://portal.test").searchParams.get("returnTo"), `/zh-CN/account/my-learning/support?orderId=${ORDER_ID}`);
});
