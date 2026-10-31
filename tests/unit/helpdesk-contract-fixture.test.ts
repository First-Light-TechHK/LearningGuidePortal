import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { SESSION_COOKIE } from "../../services/productAuth";
import {
  AGENT_ACTIONS, ASSIST_FEEDBACK, HELPDESK_LIMITS, ASSIST_SOURCES, BILLING_CYCLES, FAQ_CATEGORIES, HELPDESK_ATTACHMENT_TYPES, HELPDESK_LOCALES, HelpdeskProblem, ORDER_KINDS, ORDER_STATUSES, PAYMENT_MODES, PROBLEM_STATUS, SUBSCRIPTION_STATUSES,
  SUGGESTION_OUTCOMES, TICKET_CATEGORIES, TICKET_STATUSES, parseAgentActionInput, parseAgentListQuery, parseAgentMessageInput, problemBody,
  CONFIDENCE_LEVELS, FAQ_EDGE_KINDS, FAQ_NODE_TYPES, FAQ_SIGNALS, GUARDED_FIELDS, GUARD_REASONS, GUARD_RESULTS, SITUATION_SIGNALS, SUGGEST_INTENTS, SUGGEST_KINDS, parseFaqRelease, parseSuggestTurn, type AdminSuggestRequest,
  ASSIST_RETENTION_DAYS, ASSIST_VIAS, CHAT_END_REASONS, CLOSE_REASONS, HELPDESK_JOBS, INSIGHT_LIMITS, JOB_STATUSES, JOB_TRIGGERS, PII_PLACEHOLDER_KINDS, TURN_GUARDS, TURN_KINDS, parseInsightsQuery, parseJobRunInput
} from "../../contracts/helpdesk";
import { PII_KINDS } from "../../modules/helpdesk/piiScrubber";
import { createAdminHelpdeskClient, faqReleasePath } from "../../modules/helpdesk/adminClient";
import { isInlineAttachment } from "../../modules/helpdesk/attachments";
import { ORDER_PROJECTION_FIELDS } from "../../modules/helpdesk/orderDirectory";
import { projectStudent } from "../../modules/helpdesk/studentDirectory";
import { CSV, PDF } from "./helpdesk-fixtures";

// The Portal side of the Portal <-> Admin Helpdesk wire contract. The same
// tests/fixtures/helpdesk-contract.json is copied into the Admin repo, whose
// tests check the Admin side against it (server and client).
type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
type Fixture = {
  enums: Record<string, string[]> & { agentProblemCode: Record<string, string[]> };
  version: number;
  adminToPortal: Record<string, Json> & { listRequest: string; timelineRequest: string; flaggedListRequest: string; listResponse: Json & { tickets: Array<Record<string, Json>> }; detailResponse: Json & { subscription: Json; aiAssist: Json[]; orderId: Json; order: Record<string, Json> }; messageRequest: Json; actionRequests: Json[]; staleProblem: Json };
  portalToAdmin: Record<string, Json> & {
    faqsRequest: string; faqsSearchRequest: string; faqsResponse: { faqs: Json[]; etag: string }; faqRequest: string; faqResponse: Json;
    suggestRequest: Record<string, string | null>; suggestChatRequest: Record<string, string | null>; suggestChipRequest: Record<string, string | null>; traceparentHeader: string; suggestResponse: { suggestion: Json; alternatives: Json[] }; suggestNoMatchResponse: { suggestion: Json; alternatives: Json[] }; suggestAlternativesResponse: { suggestion: Json; alternatives: Json[] };
    outcomeRequest: Json; helpfulOutcomeRequest: Json; outcomeResponse: Json;
    // v6
    suggestContextRequest: Record<string, Json>; suggestAnswerContextResponse: Record<string, Json>; suggestChoiceResponse: Record<string, Json>; suggestSmalltalkResponse: Record<string, Json>;
    suggestSmalltalkFallbackResponse: Record<string, Json>; suggestClarifyResponse: Record<string, Json>; suggestClarifyNotCoveredResponse: Record<string, Json>; suggestNoMatchContextResponse: Record<string, Json>;
    faqReleaseRequest: string; faqReleaseResponse: Record<string, Json> & { nodes: Array<Record<string, Json>>; edges: Array<Record<string, Json>> }; faqReleaseResponseHeaders: Record<string, string>;
    faqReleaseNotModified: { ifNoneMatch: string; status: number }; noReleaseProblem: { status: number; code: string };
  };
};

let fixture: Fixture;
const cwd = process.cwd();
const env = { ...process.env };
const ORIGIN = "http://localhost:3000";
const TOKEN = "local-test-helpdesk-token-contract";
let directory = "";

/**
 * The JSON shape of a value: object keys (recursively) and primitive types.
 * null is a wildcard (fields such as assignee or closedAt are null in one
 * state and filled in another); arrays are described by their first item.
 */
function shape(value: Json): Json {
  if (value === null) return null;
  if (Array.isArray(value)) return value.length === 0 ? [] : [shape(value[0])];
  if (typeof value === "object") return Object.fromEntries(Object.keys(value).sort().map((key) => [key, shape(value[key])]));
  return typeof value;
}

function assertSameShape(actual: Json, expected: Json, where = "$") {
  const a = shape(actual);
  const e = shape(expected);
  if (a === null || e === null) return;
  if (Array.isArray(a) || Array.isArray(e)) {
    assert.ok(Array.isArray(a) && Array.isArray(e), `${where}: array vs non-array`);
    if (a.length && e.length) assertSameShape((actual as Json[])[0], (expected as Json[])[0], `${where}[0]`);
    return;
  }
  if (typeof a === "object" && typeof e === "object") {
    assert.deepEqual(Object.keys(a).sort(), Object.keys(e).sort(), `${where}: keys differ`);
    for (const key of Object.keys(e)) assertSameShape((actual as Record<string, Json>)[key], (expected as Record<string, Json>)[key], `${where}.${key}`);
    return;
  }
  assert.equal(a, e, `${where}: type differs`);
}

before(async () => {
  fixture = JSON.parse(await readFile(path.join(cwd, "tests/fixtures/helpdesk-contract.json"), "utf8")) as Fixture;
  directory = await mkdtemp(path.join(tmpdir(), "lg-helpdesk-contract-"));
  process.chdir(directory);
  process.env.APP_ENV = "DEV";
  process.env.STORAGE_BACKEND = "local";
  process.env.SESSION_SECRET = "test-session-secret-with-at-least-32-characters";
  process.env.PORTAL_HELPDESK_TOKEN = TOKEN;
  delete process.env.DATABASE_URL;
  delete process.env.ADMIN_HELPDESK_BASE_URL;
  // In DEV, localhost counts as a BackOffice host unless ADMIN_HOSTS says
  // otherwise; the learner upload handlers apply that rule themselves.
  process.env.ADMIN_HOSTS = "admin.ilovelearningguide.com,admin.sit.ilovelearningguide.com";
});

after(async () => {
  process.chdir(cwd);
  for (const key of Object.keys(process.env)) if (!(key in env)) delete process.env[key];
  Object.assign(process.env, env);
  if (directory && path.dirname(directory) === tmpdir()) await rm(directory, { recursive: true, force: true });
});

// The fixture is copied byte for byte into the Admin repo (server and client
// tests). Any edit here must be copied there and this pin updated together.
const FIXTURE_SHA256 = "01e5ef39a411b0299b47eebc8cd5503dda319f0ba11b997a9a96c8b539cd6963";
const ADMIN_COPIES = ["server/src/backoffice/tests/fixtures/helpdesk-contract.json", "client/tests/fixtures/helpdesk-contract.json"];

test("the contract fixture is the pinned copy, and matches the Admin copies byte for byte when that repo is checked out next to this one", async (t) => {
  const bytes = await readFile(path.join(cwd, "tests/fixtures/helpdesk-contract.json"));
  assert.equal(createHash("sha256").update(bytes).digest("hex"), FIXTURE_SHA256);
  const admin = path.resolve(cwd, process.env.LEARNINGGUIDE_ADMIN_DIR || "../learningguideadmin");
  if (!existsSync(path.join(admin, ADMIN_COPIES[0]))) { t.diagnostic(`Admin repo not found at ${admin}; checked the pin only`); return; }
  for (const copy of ADMIN_COPIES) assert.ok(bytes.equals(await readFile(path.join(admin, copy))), `${copy} differs from Portal's fixture`);
});

test("contract enums match Portal's own constants", () => {
  assert.deepEqual(fixture.enums.ticketStatus, [...TICKET_STATUSES]);
  assert.deepEqual(fixture.enums.category, [...TICKET_CATEGORIES]);
  assert.deepEqual(fixture.enums.locale, [...HELPDESK_LOCALES]);
  assert.deepEqual(fixture.enums.agentAction, [...AGENT_ACTIONS]);
  assert.deepEqual(fixture.enums.attachmentContentType, [...HELPDESK_ATTACHMENT_TYPES]);
  assert.deepEqual(fixture.enums.subscriptionStatus, [...SUBSCRIPTION_STATUSES]);
  assert.deepEqual(fixture.enums.billingCycle, [...BILLING_CYCLES]);
  assert.deepEqual(fixture.enums.suggestionOutcome, [...SUGGESTION_OUTCOMES]);
  assert.deepEqual(fixture.enums.assistFeedback, [...ASSIST_FEEDBACK]);
  assert.deepEqual(fixture.enums.assistSource, [...ASSIST_SOURCES]);
  assert.deepEqual(fixture.enums.faqCategory, [...FAQ_CATEGORIES]);
  // v5: the order block's values.
  assert.deepEqual(fixture.enums.orderStatus, [...ORDER_STATUSES]);
  assert.deepEqual(fixture.enums.orderKind, [...ORDER_KINDS]);
  assert.deepEqual(fixture.enums.paymentMode, [...PAYMENT_MODES]);
  for (const [status, codes] of Object.entries(fixture.enums.agentProblemCode)) {
    for (const code of codes) assert.equal(PROBLEM_STATUS[code as keyof typeof PROBLEM_STATUS], Number(status), code);
  }
  assert.deepEqual(HELPDESK_ATTACHMENT_TYPES.filter((type) => isInlineAttachment(type)), fixture.enums.inlineAttachmentContentType);
});

test("Admin's message and action bodies from the contract are accepted as sent", () => {
  const message = parseAgentMessageInput(fixture.adminToPortal.messageRequest);
  assert.deepEqual(message, fixture.adminToPortal.messageRequest);
  for (const request of fixture.adminToPortal.actionRequests) {
    const parsed = parseAgentActionInput(request) as unknown as Record<string, Json>;
    for (const [key, value] of Object.entries(request as Record<string, Json>)) {
      if (key === "tag") assert.equal(typeof parsed.tag, "string");
      else assert.deepEqual(parsed[key], value, key);
    }
  }
  assert.deepEqual(problemBody(new HelpdeskProblem("stale_ticket", "This request was updated. Reload it and try again.", { currentSequence: 5 })), fixture.adminToPortal.staleProblem);
  // v2: the student timeline and the Flagged filter.
  const timeline = parseAgentListQuery(new URL(fixture.adminToPortal.timelineRequest, ORIGIN).searchParams);
  assert.equal(timeline.learnerId, "user_fixture_learner");
  assert.equal(timeline.limit, 10);
  assert.equal(parseAgentListQuery(new URL(fixture.adminToPortal.flaggedListRequest, ORIGIN).searchParams).flagged, true);
});

test("the integration list and detail Portal serves have the contract's shape", async () => {
  const store = await import("../../services/productStore");
  const user = await store.registerUser({ email: "learner@example.test", password: "password1", nickname: "Emily Carter" });
  await store.verifyEmailToken(await store.issueEmailVerificationToken(user.id));
  const cookie = (await store.createSession(user.id)).token;
  const tickets = await import("../../app/api/helpdesk/tickets/route");
  const agentTickets = await import("../../app/api/integration/helpdesk/tickets/route");
  const agentTicket = await import("../../app/api/integration/helpdesk/tickets/[id]/route");
  const agentMessages = await import("../../app/api/integration/helpdesk/tickets/[id]/messages/route");
  const agentActions = await import("../../app/api/integration/helpdesk/tickets/[id]/actions/route");
  const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
  const agent = (url: string, json?: unknown) => {
    const headers = new Headers({ host: "localhost:3000", authorization: `Bearer ${TOKEN}` });
    if (json !== undefined) { headers.set("content-type", "application/json"); headers.set("idempotency-key", randomUUID()); }
    return new Request(`${ORIGIN}${url}`, { method: json === undefined ? "GET" : "POST", headers, body: json === undefined ? undefined : JSON.stringify(json) });
  };

  // A chat question first, answered by a stand-in Admin, rated by the learner (v4) and linked to the enquiry below.
  const assistant = await import("../../app/api/helpdesk/assistant/route");
  const rating = await import("../../app/api/helpdesk/assistant/[id]/rating/route");
  const fixtureAssist = fixture.adminToPortal.detailResponse.aiAssist[0] as unknown as { faqId: string; faqQuestion: string; answer: string; rating: number };
  const realFetch = globalThis.fetch;
  process.env.ADMIN_HELPDESK_BASE_URL = "http://admin.local.test";
  process.env.ADMIN_HELPDESK_TOKEN = "local-test-admin-token";
  globalThis.fetch = (async (_input: string | URL | Request, init?: RequestInit) => {
    const sent = JSON.parse(String(init?.body)) as { runId: string };
    return new Response(JSON.stringify({ suggestion: { id: sent.runId, faqId: fixtureAssist.faqId, question: fixtureAssist.faqQuestion, answer: fixtureAssist.answer }, alternatives: [] }), { status: 200 });
  }) as typeof fetch;
  let asked: Response;
  try {
    asked = await assistant.POST(new Request(`${ORIGIN}/api/helpdesk/assistant`, {
      method: "POST", body: JSON.stringify({ message: "Where can I find my invoice?", locale: "zh-CN" }),
      headers: new Headers({ host: "localhost:3000", origin: ORIGIN, cookie: `${SESSION_COOKIE}=${cookie}`, "idempotency-key": randomUUID(), "content-type": "application/json" })
    }));
  } finally {
    globalThis.fetch = realFetch;
    delete process.env.ADMIN_HELPDESK_BASE_URL;
    delete process.env.ADMIN_HELPDESK_TOKEN;
  }
  assert.equal(asked.status, 200, await asked.clone().text());
  const assistId = (await asked.json() as { id: string }).id;
  assert.equal(typeof fixtureAssist.rating, "number", "the contract's first aiAssist item carries a rating, so its type is compared");
  const rated = await rating.POST(new Request(`${ORIGIN}/api/helpdesk/assistant/${assistId}/rating`, {
    method: "POST", body: JSON.stringify({ rating: fixtureAssist.rating }),
    headers: new Headers({ host: "localhost:3000", origin: ORIGIN, cookie: `${SESSION_COOKIE}=${cookie}`, "idempotency-key": randomUUID(), "content-type": "application/json" })
  }), { params: Promise.resolve({ id: assistId }) });
  assert.equal(rated.status, 200, await rated.clone().text());
  // v5: the learner's own (demo) order, linked from the payment records.
  const { quote } = await store.createQuote(user.id, "epicureanism-pc-6", "purchase");
  const { order } = await store.createPendingDemoOrder(user.id, quote.id);
  await store.completeDemoOrder(user.id, order.id);
  const form = new FormData();
  for (const [key, value] of Object.entries({ category: "payments_subscriptions", subject: "Invoice 中文 test", body: "See files", locale: "zh-CN", contactEmail: "other@example.test" })) form.set(key, value);
  form.append("assistIds", assistId);
  form.set("orderId", order.id);
  form.append("files[]", new File([new Uint8Array(PDF)], "发票 Oct.pdf", { type: "application/pdf" }));
  form.append("files[]", new File([new Uint8Array(CSV)], "data.csv", { type: "text/csv" }));
  const created = await tickets.POST(new Request(`${ORIGIN}/api/helpdesk/tickets`, {
    method: "POST", body: form,
    headers: new Headers({ host: "localhost:3000", origin: ORIGIN, cookie: `${SESSION_COOKIE}=${cookie}`, "idempotency-key": randomUUID() })
  }));
  assert.equal(created.status, 201, await created.clone().text());
  const { id } = await created.json() as { id: string };
  const who = { id: "agent-1", name: "Alex Support" };
  const step = async (response: Promise<Response>) => { const result = await response; assert.ok(result.status < 300, await result.clone().text()); return await result.json() as { sequence: number }; };
  let current = await step(agentActions.POST(agent(`/api/integration/helpdesk/tickets/${id}/actions`, { action: "claim", agent: who, expectedSequence: 1 }), ctx(id)));
  current = await step(agentActions.POST(agent(`/api/integration/helpdesk/tickets/${id}/actions`, { action: "add_tag", tag: "Refund", agent: who, expectedSequence: current.sequence }), ctx(id)));
  current = await step(agentMessages.POST(agent(`/api/integration/helpdesk/tickets/${id}/messages`, { body: "Refund approved in Stripe.", internal: true, agent: who, expectedSequence: current.sequence }), ctx(id)));
  current = await step(agentMessages.POST(agent(`/api/integration/helpdesk/tickets/${id}/messages`, { body: "Your invoice is attached to your account now.", internal: false, agent: who, expectedSequence: current.sequence }), ctx(id)));
  await step(agentActions.POST(agent(`/api/integration/helpdesk/tickets/${id}/actions`, { action: "flag", agent: who, expectedSequence: current.sequence }), ctx(id)));

  const list = await (await agentTickets.GET(agent("/api/integration/helpdesk/tickets?limit=1"))).json() as Json;
  assertSameShape(list, fixture.adminToPortal.listResponse);
  const detail = await (await agentTicket.GET(agent(`/api/integration/helpdesk/tickets/${id}`), ctx(id))).json() as Json & { aiAssist: Json[]; flagged: boolean };
  assertSameShape(detail, fixture.adminToPortal.detailResponse);
  assert.equal(detail.aiAssist.length, 1, "the chat answer is linked and compared against the contract's aiAssist item");
  assert.equal((detail.aiAssist[0] as Record<string, Json>).rating, fixtureAssist.rating, "v4: the learner's rating reaches Admin as the number the contract shows");
  assert.equal(detail.flagged, true);
  // v5: the order number on the list and the detail, and the projection with exactly the contract's keys and values Admin labels.
  assert.equal((list as { tickets: Array<{ orderId: Json }> }).tickets[0].orderId, order.id);
  const linked = detail as unknown as { orderId: string; order: Record<string, Json> };
  assert.equal(linked.orderId, order.id);
  assert.deepEqual(Object.keys(linked.order), Object.keys(fixture.adminToPortal.detailResponse.order), "same keys, same order");
  assert.deepEqual(Object.keys(fixture.adminToPortal.detailResponse.order), [...ORDER_PROJECTION_FIELDS]);
  assert.equal(linked.order.id, order.id);
  assert.ok(fixture.enums.orderStatus.includes(String(linked.order.status)) && fixture.enums.orderKind.includes(String(linked.order.kind)) && fixture.enums.paymentMode.includes(String(linked.order.paymentMode)));
  assert.equal(fixture.adminToPortal.detailResponse.orderId, fixture.adminToPortal.detailResponse.order.id);
  assert.equal(fixture.adminToPortal.listResponse.tickets[0].orderId, fixture.adminToPortal.detailResponse.order.id);
  assert.ok(fixture.version >= 5);

  // The subscription block has the contract's keys when present (this learner now has one from the demo order above; projectStudent pins the values).
  const projected = projectStudent({
    users: [{ id: "u1", email: "learner@example.test", nickname: "Emily Carter", createdAt: "2026-10-28T08:32:19.715Z" }],
    plans: [{ id: "p6", name: "Epicureanism · PC · 6 months", termMonths: 6 }],
    subscriptions: [{ id: "s1", userId: "u1", planId: "p6", state: "active", source: "purchase", validFrom: "2026-10-28T08:39:01.859Z", validTo: "2027-04-28T08:39:01.859Z", cancelAtPeriodEnd: false }],
    studyRecords: [], courses: []
  }, "u1", new Date("2026-10-28T09:00:00.000Z"));
  assert.deepEqual(projected?.subscription, fixture.adminToPortal.detailResponse.subscription);
});

test("Portal's Admin client sends the contract's requests and reads the contract's responses", async () => {
  const sent: Array<{ url: string; method: string; body: unknown; headers: Record<string, string> }> = [];
  const replies: Response[] = [];
  const fakeFetch = (async (input: string | URL | Request, init?: RequestInit) => {
    sent.push({ url: String(input), method: init?.method ?? "GET", body: init?.body ? JSON.parse(String(init.body)) : undefined, headers: init?.headers as Record<string, string> });
    return replies.shift()!;
  }) as typeof fetch;
  process.env.ADMIN_HELPDESK_BASE_URL = "http://admin.local.test";
  process.env.ADMIN_HELPDESK_TOKEN = "local-test-admin-token";
  try {
    const p = fixture.portalToAdmin;
    // The learner request's W3C traceparent is continued on every Admin call (a new span each).
    const [traceName, incoming] = p.traceparentHeader.split(": ");
    assert.equal(traceName, "traceparent");
    const client = createAdminHelpdeskClient({ fetch: fakeFetch, log: () => undefined, traceparent: incoming });

    replies.push(new Response(JSON.stringify(p.faqsResponse), { status: 200, headers: { "content-type": "application/json", etag: p.faqsResponse.etag } }));
    assert.deepEqual(await client.faqs("en-GB", { popular: true, limit: 3 }), p.faqsResponse.faqs);
    assert.equal(sent[0].url, `http://admin.local.test${p.faqsRequest}`);
    assert.equal(sent[0].headers.Authorization, "Bearer local-test-admin-token");

    replies.push(new Response(JSON.stringify(p.faqsResponse), { status: 200 }));
    await client.faqs("zh-CN", { category: "payments_subscriptions", q: "invoice", limit: 50 });
    assert.equal(sent[1].url, `http://admin.local.test${p.faqsSearchRequest}`);

    replies.push(new Response(JSON.stringify(p.faqResponse), { status: 200 }));
    const faqId = (p.faqResponse as { id: string }).id;
    assert.deepEqual(await client.faq(faqId, "en-GB"), p.faqResponse);
    assert.equal(sent[2].url, `http://admin.local.test${p.faqRequest}`);

    // v5: the AI agent never receives order data; the suggest requests are unchanged.
    for (const body of [p.suggestRequest, p.suggestChatRequest, p.suggestChipRequest]) assert.doesNotMatch(JSON.stringify(body), /order/i);
    for (const [index, body] of [p.suggestRequest, p.suggestChatRequest, p.suggestChipRequest].entries()) {
      replies.push(new Response(JSON.stringify(p.suggestResponse), { status: 200 }));
      assert.deepEqual(await client.suggest(body as unknown as Parameters<typeof client.suggest>[0]), p.suggestResponse.suggestion);
      assert.equal(sent[3 + index].url, "http://admin.local.test/api/integration/helpdesk/suggest");
      assert.deepEqual(sent[3 + index].body, body, "sent exactly as in the contract (key order included)");
      assert.equal(JSON.stringify(sent[3 + index].body), JSON.stringify(body));
      assert.equal(sent[3 + index].headers.traceparent.split("-")[1], incoming.split("-")[1], "same trace id");
      assert.notEqual(sent[3 + index].headers.traceparent.split("-")[2], incoming.split("-")[2], "our own span id");
    }

    replies.push(new Response(JSON.stringify(p.suggestNoMatchResponse), { status: 200 }));
    assert.equal(await client.suggest(p.suggestChatRequest as unknown as Parameters<typeof client.suggest>[0]), null);

    const suggestionId = (p.suggestResponse.suggestion as { id: string }).id;
    replies.push(new Response(JSON.stringify(p.outcomeResponse), { status: 200 }));
    assert.equal(await client.reportOutcome(suggestionId, "declined"), true);
    assert.equal(sent[7].url, `http://admin.local.test/api/integration/helpdesk/suggestions/${suggestionId}/outcome`);
    assert.deepEqual(sent[7].body, p.outcomeRequest);
    replies.push(new Response(JSON.stringify({ ...p.outcomeResponse as object, outcome: "helpful" }), { status: 200 }));
    assert.equal(await client.reportOutcome(suggestionId, "helpful"), true);
    assert.deepEqual(sent[8].body, p.helpfulOutcomeRequest);

    // v4: "You might be asking" alternatives, read as the contract sends them (only when there is no answer).
    for (const response of [p.suggestResponse, p.suggestNoMatchResponse, p.suggestAlternativesResponse]) {
      replies.push(new Response(JSON.stringify(response), { status: 200 }));
      assert.deepEqual(await client.suggestReply(p.suggestRequest as unknown as Parameters<typeof client.suggest>[0]), response);
    }
    assert.equal(p.suggestAlternativesResponse.suggestion, null);
    assert.ok(p.suggestAlternativesResponse.alternatives.length > 0 && p.suggestAlternativesResponse.alternatives.length <= HELPDESK_LIMITS.alternativesMax);
  } finally {
    delete process.env.ADMIN_HELPDESK_BASE_URL;
    delete process.env.ADMIN_HELPDESK_TOKEN;
  }
});

// ---------------------------------------------------------------- v6 (helpdesk v5: situation chips, small talk, clarify, three-part answers, FAQ question trees)

const TURN_FIELDS = ["kind", "intent", "confidence", "nodeId", "blocks", "opening", "closing", "reply", "explanation", "covered", "guard", "releaseVersion"] as const;
const turnOf = (response: Record<string, Json>) => Object.fromEntries(TURN_FIELDS.map((key) => [key, response[key]]));

test("v6: the situation-signal, FAQ-graph and suggest-turn enums match Portal's constants", () => {
  assert.deepEqual(fixture.enums.situationSignal, [...SITUATION_SIGNALS]);
  assert.deepEqual(fixture.enums.faqSignal, [...FAQ_SIGNALS], "the FAQ signals in chip priority order");
  assert.ok(!(fixture.enums.faqSignal as string[]).includes("open_ticket_waiting"), "a waiting enquiry is a fixed card, not an FAQ");
  assert.deepEqual(fixture.enums.faqNodeType, [...FAQ_NODE_TYPES]);
  assert.deepEqual(fixture.enums.faqEdgeKind, [...FAQ_EDGE_KINDS]);
  assert.deepEqual(fixture.enums.suggestKind, [...SUGGEST_KINDS]);
  assert.deepEqual(fixture.enums.suggestIntent, [...SUGGEST_INTENTS]);
  assert.deepEqual(fixture.enums.confidence, [...CONFIDENCE_LEVELS]);
  assert.deepEqual(fixture.enums.guardResult, [...GUARD_RESULTS]);
  assert.deepEqual(fixture.enums.guardReason, [...GUARD_REASONS]);
  assert.deepEqual(fixture.enums.guardedField, [...GUARDED_FIELDS]);
  assert.ok(fixture.version >= 6, "v6 is part of every later version");
});

test("v6: Portal sends the contract context request and reads every v6 answer; a v5 answer has no turn", async () => {
  const sent: Array<{ url: string; body: unknown }> = [];
  const replies: Response[] = [];
  const fakeFetch = (async (input: string | URL | Request, init?: RequestInit) => {
    sent.push({ url: String(input), body: init?.body ? JSON.parse(String(init.body)) : undefined });
    return replies.shift()!;
  }) as typeof fetch;
  process.env.ADMIN_HELPDESK_BASE_URL = "http://admin.local.test";
  process.env.ADMIN_HELPDESK_TOKEN = "local-test-admin-token";
  try {
    const p = fixture.portalToAdmin;
    const client = createAdminHelpdeskClient({ fetch: fakeFetch, log: () => undefined });
    const request = p.suggestContextRequest as unknown as AdminSuggestRequest;
    // The context holds the card on screen, the session and the learner's own earlier words: no account data, no signals.
    assert.deepEqual(Object.keys(request.context ?? {}).sort(), ["nodeId", "recentTurns", "sessionId"]);
    assert.doesNotMatch(Object.keys(request).concat(Object.keys(request.context ?? {})).join(" "), /order|signal|plan|subscription|email/i);
    const examples = [p.suggestAnswerContextResponse, p.suggestChoiceResponse, p.suggestSmalltalkResponse, p.suggestSmalltalkFallbackResponse, p.suggestClarifyResponse, p.suggestClarifyNotCoveredResponse, p.suggestNoMatchContextResponse];
    for (const [index, response] of examples.entries()) {
      replies.push(new Response(JSON.stringify(response), { status: 200 }));
      const read = await client.suggestReply(request);
      assert.equal(JSON.stringify(sent[index].body), JSON.stringify(request), "sent exactly as in the contract (key order included)");
      assert.equal(sent[index].url, "http://admin.local.test/api/integration/helpdesk/suggest");
      assert.deepEqual(read.turn, turnOf(response), `example ${index}: the turn fields as Admin sent them`);
      assert.deepEqual(read.suggestion, response.suggestion);
      assert.deepEqual(read.alternatives, response.alternatives);
    }
    assert.deepEqual([...new Set(examples.map((e) => e.kind))].sort(), [...SUGGEST_KINDS].sort(), "every kind has an example");
    // An older Admin (or a request without context) answers as v5: no turn, exactly as before.
    for (const legacy of [p.suggestResponse, p.suggestNoMatchResponse, p.suggestAlternativesResponse]) {
      assert.equal(parseSuggestTurn(legacy), null);
      replies.push(new Response(JSON.stringify(legacy), { status: 200 }));
      assert.equal("turn" in await client.suggestReply(request), false);
    }
    // The excerpt names blocks of the picked answer in the release; a choice answer is a choice node with no frame.
    const release = parseFaqRelease(p.faqReleaseResponse)!;
    const picked = release.nodes.find((node) => node.id === p.suggestAnswerContextResponse.nodeId)!;
    for (const block of p.suggestAnswerContextResponse.blocks as string[]) assert.ok(picked.blocks.some((b) => b.id === block), block);
    assert.equal(release.nodes.find((node) => node.id === p.suggestChoiceResponse.nodeId)?.type, "choice");
    assert.equal(p.suggestChoiceResponse.opening, null);
    assert.equal(release.nodes.find((node) => node.id === p.suggestClarifyResponse.nodeId)?.id, (request.context ?? {}).nodeId);
  } finally {
    delete process.env.ADMIN_HELPDESK_BASE_URL;
    delete process.env.ADMIN_HELPDESK_TOKEN;
  }
});

test("v6: the FAQ release is read as the contract sends it, revalidated with If-None-Match, and 404 means no release yet", async () => {
  const sent: Array<{ url: string; headers: Record<string, string> }> = [];
  const replies: Response[] = [];
  const fakeFetch = (async (input: string | URL | Request, init?: RequestInit) => {
    sent.push({ url: String(input), headers: init?.headers as Record<string, string> });
    return replies.shift()!;
  }) as typeof fetch;
  process.env.ADMIN_HELPDESK_BASE_URL = "http://admin.local.test";
  process.env.ADMIN_HELPDESK_TOKEN = "local-test-admin-token";
  try {
    const p = fixture.portalToAdmin;
    const client = createAdminHelpdeskClient({ fetch: fakeFetch, log: () => undefined });
    assert.equal(faqReleasePath("en-GB"), p.faqReleaseRequest);
    replies.push(new Response(JSON.stringify(p.faqReleaseResponse), { status: 200, headers: { "content-type": "application/json", ...p.faqReleaseResponseHeaders } }));
    const read = await client.faqRelease("en-GB");
    assert.equal(sent[0].url, `http://admin.local.test${p.faqReleaseRequest}`);
    assert.equal(sent[0].headers.Authorization, "Bearer local-test-admin-token");
    assert.equal(sent[0].headers["If-None-Match"], undefined);
    assert.deepEqual(read, { status: "ok", release: p.faqReleaseResponse, etag: p.faqReleaseResponseHeaders.ETag });
    replies.push(new Response(null, { status: p.faqReleaseNotModified.status, headers: { etag: p.faqReleaseResponseHeaders.ETag } }));
    assert.deepEqual(await client.faqRelease("en-GB", p.faqReleaseNotModified.ifNoneMatch), { status: "not_modified" });
    assert.equal(sent[1].headers["If-None-Match"], p.faqReleaseNotModified.ifNoneMatch);
    replies.push(new Response(JSON.stringify({ ...p.noReleaseProblem, type: "https://www.ilovelearningguide.com/problems/no_release" }), { status: p.noReleaseProblem.status, headers: { "content-type": "application/problem+json" } }));
    assert.deepEqual(await client.faqRelease("en-GB"), { status: "none" });
    // An older Admin has no such route: Nest's own 404 means the same.
    replies.push(new Response(JSON.stringify({ statusCode: 404, message: "Cannot GET" }), { status: 404 }));
    assert.deepEqual(await client.faqRelease("en-GB"), { status: "none" });
    replies.push(new Response("oops", { status: 502 }));
    assert.deepEqual(await client.faqRelease("en-GB"), { status: "unavailable" });
    replies.push(new Response(JSON.stringify(p.faqReleaseResponse), { status: 200 }));
    assert.deepEqual(await client.faqRelease("zh-CN"), { status: "unavailable" }, "a release in another locale is not used");
    // Shapes: every node has blocks (answer nodes at least one), every edge joins two nodes of the release.
    const ids = new Set(p.faqReleaseResponse.nodes.map((node) => node.id));
    for (const node of p.faqReleaseResponse.nodes) assert.equal((node.blocks as Json[]).length > 0, node.type === "answer", String(node.key));
    for (const edge of p.faqReleaseResponse.edges) assert.ok(ids.has(String(edge.parentId)) && ids.has(String(edge.childId)));
  } finally {
    delete process.env.ADMIN_HELPDESK_BASE_URL;
    delete process.env.ADMIN_HELPDESK_TOKEN;
  }
});

test("v6: published FAQs carry signals; Portal keeps the known ones", async () => {
  for (const faq of [...fixture.portalToAdmin.faqsResponse.faqs, fixture.portalToAdmin.faqResponse] as Array<Record<string, Json>>) {
    assert.ok(Array.isArray(faq.signals));
    for (const signal of faq.signals as string[]) assert.ok(fixture.enums.faqSignal.includes(signal));
  }
});


// ---------------------------------------------------------------- v7: the flywheel feed and the retention job (Part G)
type Insights = { turns: Array<Record<string, Json>>; nextCursor: string | null; until: string };
const v7 = () => fixture.adminToPortal as unknown as Record<string, Json> & {
  insightsRequest: string; insightsNextRequest: string; insightsResponse: Insights; insightsLastResponse: Insights; insightsLimits: Record<string, number>;
  jobRunsRequest: string; jobRunsResponse: Record<string, Json> & { runs: Array<Record<string, Json>> }; jobRunRequestPath: string; jobRunRequest: Json; jobRunResponse: Record<string, Json>; jobRunAlreadyRunningResponse: Record<string, Json>;
};

test("v7: the feed and job enums and limits match Portal's constants", () => {
  assert.equal(fixture.version, 7);
  assert.deepEqual(fixture.enums.closeReason, [...CLOSE_REASONS]);
  assert.deepEqual(fixture.enums.turnKind, [...TURN_KINDS]);
  assert.deepEqual(fixture.enums.turnGuard, [...TURN_GUARDS]);
  assert.deepEqual(fixture.enums.assistVia, [...ASSIST_VIAS]);
  assert.deepEqual(fixture.enums.chatEndReason, [...CHAT_END_REASONS]);
  assert.deepEqual(fixture.enums.piiPlaceholder, [...PII_PLACEHOLDER_KINDS]);
  assert.deepEqual([...PII_PLACEHOLDER_KINDS], [...PII_KINDS], "the contract lists every placeholder the scrubber writes");
  assert.deepEqual(fixture.enums.helpdeskJob, [...HELPDESK_JOBS]);
  assert.deepEqual(fixture.enums.jobTrigger, [...JOB_TRIGGERS]);
  assert.deepEqual(fixture.enums.jobStatus, [...JOB_STATUSES]);
  const limits = v7().insightsLimits;
  assert.deepEqual(limits, { pageDefault: INSIGHT_LIMITS.pageDefault, pageMax: INSIGHT_LIMITS.pageMax, settleMs: INSIGHT_LIMITS.settleMs, agentReplyMax: INSIGHT_LIMITS.agentReplyMax, ticketAfterHours: INSIGHT_LIMITS.ticketAfterMs / 3_600_000, textMax: INSIGHT_LIMITS.textMax });
  assert.equal(v7().jobRunsResponse.retentionDays, ASSIST_RETENTION_DAYS);
});

test("v7: the contract's feed pages are labels and scrubbed text only, and its requests parse", () => {
  const p = v7();
  const first = parseInsightsQuery(new URL(p.insightsRequest, ORIGIN).searchParams);
  assert.equal(first.cursor, null);
  const next = parseInsightsQuery(new URL(p.insightsNextRequest, ORIGIN).searchParams);
  const last = p.insightsResponse.turns[p.insightsResponse.turns.length - 1];
  assert.deepEqual(next.cursor, { createdAt: last.createdAt, id: last.id, until: p.insightsResponse.until }, "the cursor carries the last turn and the window end");
  assert.equal(p.insightsLastResponse.nextCursor, null);
  const placeholders = new Set(fixture.enums.piiPlaceholder);
  const allowed = new Set(["id", "createdAt", "source", "locale", "text", "sessionId", "turnIndex", "lastTurn", "sessionEndReason", "kind", "intent", "guard", "via", "faqId", "nodeId", "parentNodeId", "releaseVersion", "answered", "vote", "rating", "covered", "expanded", "handover", "ticketAfterChat", "ticket", "signals"]);
  for (const turn of p.insightsResponse.turns) {
    assert.deepEqual(Object.keys(turn).filter((key) => !allowed.has(key)), [], "no other field (no learner, answer text or trace id)");
    for (const [field, values] of [["source", fixture.enums.assistSource], ["locale", fixture.enums.locale], ["kind", fixture.enums.turnKind], ["intent", fixture.enums.suggestIntent], ["guard", fixture.enums.turnGuard], ["via", fixture.enums.assistVia], ["sessionEndReason", fixture.enums.chatEndReason], ["vote", fixture.enums.assistFeedback]] as const) {
      assert.ok(turn[field] === null || values.includes(String(turn[field])), `${field}: ${turn[field]}`);
    }
    for (const signal of turn.signals as string[]) assert.ok(fixture.enums.situationSignal.includes(signal));
    const ticket = turn.ticket as Record<string, Json> | null;
    if (ticket) {
      assert.deepEqual(Object.keys(ticket).sort(), ["agentReplied", "agentReply", "closeReason", "linked", "resolvedByAgent", "status"]);
      assert.ok(fixture.enums.ticketStatus.includes(String(ticket.status)));
      assert.ok(ticket.closeReason === null || fixture.enums.closeReason.includes(String(ticket.closeReason)));
      assert.ok(ticket.agentReply === null || ticket.resolvedByAgent === true, "a reply goes along only when the agent resolved the enquiry");
    }
    for (const text of [turn.text, ticket?.agentReply ?? ""] as string[]) {
      for (const [, kind] of text.matchAll(/<([a-z_]+)>/g)) assert.ok(placeholders.has(kind), kind);
      assert.doesNotMatch(text, /@|\d{6,}|https?:/, "scrubbed");
    }
  }
  const run = parseJobRunInput(p.jobRunRequest);
  assert.deepEqual(run.agent, (p.jobRunRequest as { agent: Json }).agent);
  for (const item of [...p.jobRunsResponse.runs, p.jobRunResponse.run as Record<string, Json>]) {
    assert.ok(fixture.enums.helpdeskJob.includes(String(item.job)) && fixture.enums.jobTrigger.includes(String(item.trigger)) && fixture.enums.jobStatus.includes(String(item.status)));
    assert.equal(item.requestedBy === null, item.trigger === "schedule", "a manual run names who asked");
  }
  assert.deepEqual(p.jobRunAlreadyRunningResponse, { outcome: "already_running", run: null });
});

test("v7: the feed and the job routes Portal serves have the contract's shape", async () => {
  const p = v7();
  const store = await import("../../services/productStore");
  const user = await store.registerUser({ email: "contract.flywheel55@example.test", password: "password1", nickname: "Mei Contract" });
  const learner = { id: user.id, email: "contract.flywheel55@example.test", name: "Mei Contract" };
  const repository = (await import("../../repositories/helpdeskRepository")).helpdeskRepository();
  const { helpdeskService } = await import("../../modules/helpdesk/runtime");
  const service = helpdeskService();
  const agentIdentity = { id: "01a18100-0000-7000-8000-000000000002", name: "Alex Support" };
  const created = await service.createTicket(learner, { category: "payments_subscriptions", subject: "Paid, still Basic", body: "Please check.", locale: "zh-CN", files: [] }, randomUUID());
  let detail = await service.agentAction(created.ticket.id, { action: "claim", agent: agentIdentity, expectedSequence: created.ticket.sequence }, randomUUID());
  detail = await service.postAgentMessage(created.ticket.id, { body: "Hi Mei Contract, I re-synced your payment; your plan shows Pro now.", internal: false, agent: agentIdentity, expectedSequence: detail.ticket.sequence }, randomUUID());
  detail = await service.agentAction(created.ticket.id, { action: "propose_resolution", agent: agentIdentity, expectedSequence: detail.ticket.sequence }, randomUUID());
  await service.learnerAction(learner, created.ticket.id, { action: "confirm", expectedSequence: detail.ticket.sequence }, randomUUID());
  const sample = p.insightsResponse.turns[0];
  const at = Date.now() - 10 * 60_000;
  assert.equal(await repository.insertAssist({
    id: randomUUID(), learnerId: learner.id, source: "chat", locale: "zh-CN", question: "我是 Mei Contract，手机 13800138000，订单 order_abc123def456 付款后还是基础版", faqId: null, faqQuestion: null, answer: null,
    feedback: null, ticketId: created.ticket.id, clientEventId: randomUUID(), payloadHash: null, createdAt: new Date(at).toISOString(), feedbackDeliveredAt: null, feedbackAttemptedAt: null, alternatives: [],
    sessionId: null, turnIndex: null, nodeId: null, parentNodeId: null, via: "typed", kind: "no_match", intent: "question", guard: "passed", releaseVersion: 3, traceId: null, signals: ["payment_failed"],
    blocks: null, expanded: null, covered: null, texts: null
  }), "inserted");
  const insights = await import("../../app/api/integration/helpdesk/insights/route");
  const runs = await import("../../app/api/integration/helpdesk/jobs/assist-retention/route");
  const runNow = await import("../../app/api/integration/helpdesk/jobs/assist-retention/run/route");
  const request = (url: string, json?: Json) => {
    const headers = new Headers({ host: "localhost:3000", authorization: `Bearer ${TOKEN}` });
    if (json !== undefined) { headers.set("content-type", "application/json"); headers.set("idempotency-key", randomUUID()); }
    return new Request(`${ORIGIN}${url}`, { method: json === undefined ? "GET" : "POST", headers, body: json === undefined ? undefined : JSON.stringify(json) });
  };
  const since = new Date(at - 1000).toISOString();
  const response = await insights.GET(request(`/api/integration/helpdesk/insights?since=${encodeURIComponent(since)}&limit=1`));
  assert.equal(response.status, 200, await response.clone().text());
  const page = await response.json() as Insights;
  assertSameShape(page as unknown as Json, p.insightsResponse as unknown as Json);
  const [turn] = page.turns;
  assertSameShape(turn as Json, sample as Json);
  assert.equal(turn.text, "我是 <name>，手机 <phone>，订单 <order> 付款后还是基础版");
  assert.deepEqual(turn.ticket, sample.ticket, "the contract's outcome is what Portal serves for an enquiry the agent resolved");
  const empty = await (await insights.GET(request(`/api/integration/helpdesk/insights?since=${encodeURIComponent(new Date().toISOString())}`))).json() as Insights;
  assertSameShape(empty as unknown as Json, p.insightsLastResponse as unknown as Json);

  const ran = await runNow.POST(request(p.jobRunRequestPath, p.jobRunRequest));
  assert.equal(ran.status, 200, await ran.clone().text());
  const done = await ran.json() as Record<string, Json>;
  assertSameShape(done as Json, p.jobRunResponse as Json);
  const listed = await runs.GET(request(p.jobRunsRequest));
  assert.equal(listed.status, 200);
  assertSameShape(await listed.json() as Json, p.jobRunsResponse as unknown as Json);
});
