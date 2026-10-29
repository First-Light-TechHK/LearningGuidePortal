import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { SESSION_COOKIE } from "../../services/productAuth";
import {
  AGENT_ACTIONS, ASSIST_FEEDBACK, ASSIST_SOURCES, BILLING_CYCLES, FAQ_CATEGORIES, HELPDESK_ATTACHMENT_TYPES, HELPDESK_LOCALES, HelpdeskProblem, PROBLEM_STATUS, SUBSCRIPTION_STATUSES,
  SUGGESTION_OUTCOMES, TICKET_CATEGORIES, TICKET_STATUSES, parseAgentActionInput, parseAgentListQuery, parseAgentMessageInput, problemBody
} from "../../contracts/helpdesk";
import { createAdminHelpdeskClient } from "../../modules/helpdesk/adminClient";
import { isInlineAttachment } from "../../modules/helpdesk/attachments";
import { projectStudent } from "../../modules/helpdesk/studentDirectory";
import { CSV, PDF } from "./helpdesk-fixtures";

// The Portal side of the Portal <-> Admin Helpdesk wire contract. The same
// tests/fixtures/helpdesk-contract.json is copied into the Admin repo, whose
// tests check the Admin side against it (server and client).
type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
type Fixture = {
  enums: Record<string, string[]> & { agentProblemCode: Record<string, string[]> };
  adminToPortal: Record<string, Json> & { listRequest: string; timelineRequest: string; flaggedListRequest: string; listResponse: Json; detailResponse: Json & { subscription: Json }; messageRequest: Json; actionRequests: Json[]; staleProblem: Json };
  portalToAdmin: Record<string, Json> & {
    faqsRequest: string; faqsSearchRequest: string; faqsResponse: { faqs: Json[]; etag: string }; faqRequest: string; faqResponse: Json;
    suggestRequest: Record<string, string>; suggestChatRequest: Record<string, string>; suggestChipRequest: Record<string, string>; suggestResponse: { suggestion: Json };
    outcomeRequest: Json; helpfulOutcomeRequest: Json; outcomeResponse: Json;
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
const FIXTURE_SHA256 = "9d7a003c9d01009c794587d061e4e8f35671aecb6b403b2fd29b6e05cb281839";
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

  // A chat question first (Admin is not configured here, so the fallback answer), linked to the enquiry below.
  const assistant = await import("../../app/api/helpdesk/assistant/route");
  const asked = await assistant.POST(new Request(`${ORIGIN}/api/helpdesk/assistant`, {
    method: "POST", body: JSON.stringify({ message: "Where can I find my invoice?", locale: "zh-CN" }),
    headers: new Headers({ host: "localhost:3000", origin: ORIGIN, cookie: `${SESSION_COOKIE}=${cookie}`, "idempotency-key": randomUUID(), "content-type": "application/json" })
  }));
  assert.equal(asked.status, 200, await asked.clone().text());
  const assistId = (await asked.json() as { id: string }).id;
  const form = new FormData();
  for (const [key, value] of Object.entries({ category: "payments_subscriptions", subject: "Invoice 中文 test", body: "See files", locale: "zh-CN", contactEmail: "other@example.test" })) form.set(key, value);
  form.append("assistIds", assistId);
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
  assert.equal(detail.flagged, true);

  // The subscription block (null for this learner) has the contract's keys when present.
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
    const client = createAdminHelpdeskClient({ fetch: fakeFetch, log: () => undefined });
    const p = fixture.portalToAdmin;

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

    for (const [index, body] of [p.suggestRequest, p.suggestChatRequest, p.suggestChipRequest].entries()) {
      replies.push(new Response(JSON.stringify(p.suggestResponse), { status: 200 }));
      assert.deepEqual(await client.suggest(body as unknown as Parameters<typeof client.suggest>[0]), p.suggestResponse.suggestion);
      assert.equal(sent[3 + index].url, "http://admin.local.test/api/integration/helpdesk/suggest");
      assert.deepEqual(sent[3 + index].body, body, "sent exactly as in the contract (key order included)");
      assert.equal(JSON.stringify(sent[3 + index].body), JSON.stringify(body));
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
  } finally {
    delete process.env.ADMIN_HELPDESK_BASE_URL;
    delete process.env.ADMIN_HELPDESK_TOKEN;
  }
});
