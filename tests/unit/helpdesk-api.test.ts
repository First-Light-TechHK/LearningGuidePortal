import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { SESSION_COOKIE } from "../../services/productAuth";
import { PDF } from "./helpdesk-fixtures";

// API-level tests: the real Route Handlers, the real session lookup and the
// real DEV-only local storage (STORAGE_BACKEND=local), as in study-group-api.
const cwd = process.cwd();
const env = { ...process.env };
const ORIGIN = "http://localhost:3000";
const TOKEN = "local-test-helpdesk-token-0123456789";
const PNG = Buffer.from("89504e470d0a1a0a0000000d4948445200000001000000010806000000", "hex");
type Params = { params: Promise<Record<string, string>> };
type Handler = (request: Request, context: Params) => Promise<Response>;
type Routes = Record<"tickets" | "ticket" | "messages" | "actions" | "attachment" | "agentTickets" | "agentTicket" | "agentMessages" | "agentActions" | "agentAttachment" | "assistant" | "assistantFeedback" | "assistantRating" | "suggestions" | "outcome", Record<string, Handler>>;
let directory = "";
let routes: Routes;
let learnerCookie = "";
let strangerCookie = "";
let strangerId = "";
let learnerId = "";
let store: typeof import("../../services/productStore");

before(async () => {
  directory = await mkdtemp(path.join(tmpdir(), "lg-helpdesk-api-"));
  process.chdir(directory);
  process.env.APP_ENV = "DEV";
  process.env.STORAGE_BACKEND = "local";
  process.env.SESSION_SECRET = "test-session-secret-with-at-least-32-characters";
  delete process.env.DATABASE_URL;
  delete process.env.PORTAL_HELPDESK_TOKEN;
  // In DEV, localhost counts as a BackOffice host unless ADMIN_HOSTS says
  // otherwise (services/adminHost.ts); these tests play the learner site.
  process.env.ADMIN_HOSTS = "admin.ilovelearningguide.com,admin.sit.ilovelearningguide.com";
  store = await import("../../services/productStore");
  const make = async (email: string, nickname: string) => {
    const user = await store.registerUser({ email, password: "password1", nickname });
    await store.verifyEmailToken(await store.issueEmailVerificationToken(user.id));
    return { user, token: (await store.createSession(user.id)).token };
  };
  const learner = await make("helpdesk-learner@example.test", "Lin Learner");
  learnerId = learner.user.id;
  learnerCookie = learner.token;
  const stranger = await make("helpdesk-stranger@example.test", "Sam Stranger");
  strangerCookie = stranger.token;
  strangerId = stranger.user.id;
  routes = {
    tickets: await import("../../app/api/helpdesk/tickets/route"),
    ticket: await import("../../app/api/helpdesk/tickets/[id]/route"),
    messages: await import("../../app/api/helpdesk/tickets/[id]/messages/route"),
    actions: await import("../../app/api/helpdesk/tickets/[id]/actions/route"),
    attachment: await import("../../app/api/helpdesk/attachments/[id]/route"),
    agentTickets: await import("../../app/api/integration/helpdesk/tickets/route"),
    agentTicket: await import("../../app/api/integration/helpdesk/tickets/[id]/route"),
    agentMessages: await import("../../app/api/integration/helpdesk/tickets/[id]/messages/route"),
    agentActions: await import("../../app/api/integration/helpdesk/tickets/[id]/actions/route"),
    agentAttachment: await import("../../app/api/integration/helpdesk/attachments/[id]/route"),
    assistant: await import("../../app/api/helpdesk/assistant/route"),
    assistantFeedback: await import("../../app/api/helpdesk/assistant/[id]/feedback/route"),
    assistantRating: await import("../../app/api/helpdesk/assistant/[id]/rating/route"),
    suggestions: await import("../../app/api/helpdesk/suggestions/route"),
    outcome: await import("../../app/api/helpdesk/suggestions/[id]/outcome/route")
  } as unknown as Routes;
});

after(async () => {
  process.chdir(cwd);
  for (const key of Object.keys(process.env)) if (!(key in env)) delete process.env[key];
  Object.assign(process.env, env);
  if (directory && path.dirname(directory) === tmpdir()) await rm(directory, { recursive: true, force: true });
});

function learnerRequest(url: string, init: { method?: string; cookie?: string; key?: string; body?: BodyInit; json?: unknown; origin?: string | null; traceparent?: string } = {}) {
  const headers = new Headers({ host: "localhost:3000" });
  if (init.traceparent) headers.set("traceparent", init.traceparent);
  if (init.origin !== null) headers.set("origin", init.origin ?? ORIGIN);
  if (init.cookie) headers.set("cookie", `${SESSION_COOKIE}=${init.cookie}`);
  if (init.key) headers.set("idempotency-key", init.key);
  let body = init.body;
  if (init.json !== undefined) { headers.set("content-type", "application/json"); body = JSON.stringify(init.json); }
  return new Request(`${ORIGIN}${url}`, { method: init.method ?? (body === undefined ? "GET" : "POST"), headers, body });
}

function agentRequest(url: string, init: { token?: string | null; key?: string; json?: unknown } = {}) {
  const headers = new Headers({ host: "localhost:3000" });
  if (init.token !== null) headers.set("authorization", `Bearer ${init.token ?? TOKEN}`);
  if (init.key) headers.set("idempotency-key", init.key);
  if (init.json !== undefined) headers.set("content-type", "application/json");
  return new Request(`${ORIGIN}${url}`, { method: init.json === undefined ? "GET" : "POST", headers, body: init.json === undefined ? undefined : JSON.stringify(init.json) });
}

const ctx = (params: Record<string, string> = {}): Params => ({ params: Promise.resolve(params) });

function ticketForm(fields: Record<string, string>, files: Array<{ bytes: Buffer; name: string; type: string }> = []) {
  const form = new FormData();
  for (const [key, value] of Object.entries(fields)) form.set(key, value);
  for (const item of files) form.append("files[]", new File([new Uint8Array(item.bytes)], item.name, { type: item.type }));
  return form;
}

async function problem(response: Response, status: number, code: string) {
  assert.equal(response.status, status, `${code}: ${await response.clone().text()}`);
  assert.match(response.headers.get("content-type") || "", /^application\/problem\+json/);
  const body = await response.json();
  assert.equal(body.code, code);
  assert.equal(body.status, status);
  assert.equal(body.type, `https://www.ilovelearningguide.com/problems/${code}`);
  assert.equal(typeof body.title, "string");
  assert.equal(typeof body.detail, "string");
  return body;
}

const createFields = { category: "payments_subscriptions", subject: "Upgrade did not apply", body: "I paid for Everything but still see Basic.", locale: "en-GB" };

test("learner endpoints require a session (401 problem) and a same-origin POST", async () => {
  await problem(await routes.tickets.GET(learnerRequest("/api/helpdesk/tickets"), ctx()), 401, "unauthenticated");
  await problem(await routes.tickets.POST(learnerRequest("/api/helpdesk/tickets", { body: ticketForm(createFields), key: randomUUID() }), ctx()), 401, "unauthenticated");
  await problem(await routes.ticket.GET(learnerRequest(`/api/helpdesk/tickets/${randomUUID()}`), ctx({ id: randomUUID() })), 401, "unauthenticated");
  await problem(await routes.attachment.GET(learnerRequest(`/api/helpdesk/attachments/${randomUUID()}`), ctx({ id: randomUUID() })), 401, "unauthenticated");
  await problem(await routes.tickets.POST(learnerRequest("/api/helpdesk/tickets", { body: ticketForm(createFields), key: randomUUID(), cookie: learnerCookie, origin: "https://evil.example" }), ctx()), 403, "forbidden_origin");
});

test("the upload endpoints skip middleware, so they apply its admin-host rule and the body bound themselves", async () => {
  const { middleware } = await import("../../middleware");
  const { NextRequest } = await import("next/server");
  const ticketId = randomUUID();
  const onAdmin = (url: string, method: "GET" | "POST") => new Request(`https://admin.ilovelearningguide.com${url}`, {
    method, headers: { host: "admin.ilovelearningguide.com", origin: "https://admin.ilovelearningguide.com", cookie: `${SESSION_COOKIE}=${learnerCookie}`, "idempotency-key": randomUUID() },
    body: method === "POST" ? ticketForm(createFields) : undefined
  });
  const cases: Array<[string, "GET" | "POST", (request: Request) => Promise<Response>]> = [
    ["/api/helpdesk/tickets", "GET", (request) => routes.tickets.GET(request, ctx())],
    ["/api/helpdesk/tickets", "POST", (request) => routes.tickets.POST(request, ctx())],
    [`/api/helpdesk/tickets/${ticketId}/messages`, "POST", (request) => routes.messages.POST(request, ctx({ id: ticketId }))]
  ];
  for (const [url, method, call] of cases) {
    const expected = middleware(new NextRequest(onAdmin(url, method)));
    const response = await call(onAdmin(url, method));
    assert.equal(response.status, 307, `${method} ${url}`);
    assert.equal(response.status, expected.status);
    assert.equal(response.headers.get("location"), expected.headers.get("location"));
  }
  // A Content-Length over five 10 MB files plus framing is refused before the body is read.
  const before = (await (await routes.tickets.GET(learnerRequest("/api/helpdesk/tickets", { cookie: learnerCookie }), ctx())).json()).tickets.length;
  const huge = learnerRequest("/api/helpdesk/tickets", { body: ticketForm(createFields), key: randomUUID(), cookie: learnerCookie });
  const oversized = new Request(huge.url, { method: "POST", headers: new Headers([...huge.headers, ["content-length", String(51 * 1024 * 1024 + 1)]]), body: await huge.arrayBuffer() });
  await problem(await routes.tickets.POST(oversized, ctx()), 413, "attachment_too_large");
  assert.equal((await (await routes.tickets.GET(learnerRequest("/api/helpdesk/tickets", { cookie: learnerCookie }), ctx())).json()).tickets.length, before);
});

test("integration endpoints: 503 when the token is unset, 401 Bearer challenge when wrong, rotation applies per request", async () => {
  delete process.env.PORTAL_HELPDESK_TOKEN;
  await problem(await routes.agentTickets.GET(agentRequest("/api/integration/helpdesk/tickets"), ctx()), 503, "integration_disabled");
  process.env.PORTAL_HELPDESK_TOKEN = TOKEN;
  const wrong = await routes.agentTickets.GET(agentRequest("/api/integration/helpdesk/tickets", { token: "nope" }), ctx());
  assert.match(wrong.headers.get("www-authenticate") || "", /^Bearer /);
  await problem(wrong, 401, "invalid_token");
  await problem(await routes.agentTickets.GET(agentRequest("/api/integration/helpdesk/tickets", { token: null }), ctx()), 401, "invalid_token");
  assert.equal((await routes.agentTickets.GET(agentRequest("/api/integration/helpdesk/tickets"), ctx())).status, 200);
  process.env.PORTAL_HELPDESK_TOKEN = `${TOKEN}-rotated`;
  await problem(await routes.agentTickets.GET(agentRequest("/api/integration/helpdesk/tickets"), ctx()), 401, "invalid_token");
  assert.equal((await routes.agentTickets.GET(agentRequest("/api/integration/helpdesk/tickets", { token: `${TOKEN}-rotated` }), ctx())).status, 200);
  process.env.PORTAL_HELPDESK_TOKEN = TOKEN;
});

test("every learner POST (messages, actions, suggestion outcome) needs a session and a same-origin request", async () => {
  const id = randomUUID();
  const posts: Array<[string, (request: Request) => Promise<Response>, Record<string, unknown>]> = [
    [`/api/helpdesk/tickets/${id}/messages`, (request) => routes.messages.POST(request, ctx({ id })), { body: "Hello", expectedSequence: 1 }],
    [`/api/helpdesk/tickets/${id}/actions`, (request) => routes.actions.POST(request, ctx({ id })), { action: "cancel", expectedSequence: 1 }],
    [`/api/helpdesk/suggestions/${id}/outcome`, (request) => routes.outcome.POST(request, ctx({ id })), { outcome: "solved" }]
  ];
  for (const [url, call, json] of posts) {
    await problem(await call(learnerRequest(url, { json, key: randomUUID() })), 401, "unauthenticated");
    await problem(await call(learnerRequest(url, { json, key: randomUUID(), cookie: learnerCookie, origin: "https://evil.example" })), 403, "forbidden_origin");
  }
});

test("all five integration routes refuse a missing or wrong Bearer token, and answer 503 while the token is unset", async () => {
  const id = randomUUID();
  const agent = { id: "emp-1", name: "Amy Agent" };
  const calls: Array<[string, (token: string | null) => Promise<Response>]> = [
    ["list", (token) => routes.agentTickets.GET(agentRequest("/api/integration/helpdesk/tickets", { token }), ctx())],
    ["detail", (token) => routes.agentTicket.GET(agentRequest(`/api/integration/helpdesk/tickets/${id}`, { token }), ctx({ id }))],
    ["actions", (token) => routes.agentActions.POST(agentRequest(`/api/integration/helpdesk/tickets/${id}/actions`, { token, key: randomUUID(), json: { action: "claim", agent, expectedSequence: 1 } }), ctx({ id }))],
    ["messages", (token) => routes.agentMessages.POST(agentRequest(`/api/integration/helpdesk/tickets/${id}/messages`, { token, key: randomUUID(), json: { body: "Hi", agent, internal: false, expectedSequence: 1 } }), ctx({ id }))],
    ["attachment", (token) => routes.agentAttachment.GET(agentRequest(`/api/integration/helpdesk/attachments/${id}`, { token }), ctx({ id }))]
  ];
  try {
    delete process.env.PORTAL_HELPDESK_TOKEN;
    for (const [name, call] of calls) await problem(await call(TOKEN), 503, "integration_disabled").catch((error) => { throw new Error(`${name}: ${error}`); });
    process.env.PORTAL_HELPDESK_TOKEN = TOKEN;
    for (const [name, call] of calls) {
      for (const token of [null, "nope", `${TOKEN}x`, TOKEN.slice(0, -1)]) {
        const response = await call(token);
        assert.match(response.headers.get("www-authenticate") || "", /^Bearer /, `${name} ${token}`);
        await problem(response, 401, "invalid_token");
      }
      // With the right token the request gets past auth: the list answers, the unknown ticket does not exist.
      if (name === "list") assert.equal((await call(TOKEN)).status, 200);
      else await problem(await call(TOKEN), 404, "not_found");
    }
  } finally {
    process.env.PORTAL_HELPDESK_TOKEN = TOKEN;
  }
});

test("submit with a screenshot -> card -> agent reply -> learner reply -> resolution -> confirm -> rating", async () => {
  process.env.PORTAL_HELPDESK_TOKEN = TOKEN;
  await problem(await routes.tickets.POST(learnerRequest("/api/helpdesk/tickets", { body: ticketForm(createFields), cookie: learnerCookie }), ctx()), 400, "idempotency_key_required");
  await problem(await routes.tickets.POST(learnerRequest("/api/helpdesk/tickets", { body: ticketForm({ ...createFields, subject: "" }), cookie: learnerCookie, key: randomUUID() }), ctx()), 400, "validation_failed");
  await problem(await routes.tickets.POST(learnerRequest("/api/helpdesk/tickets", { body: ticketForm(createFields, [{ bytes: Buffer.from("<svg xmlns=\"http://www.w3.org/2000/svg\"/>"), name: "a.png", type: "image/png" }]), cookie: learnerCookie, key: randomUUID() }), ctx()), 415, "attachment_type_unsupported");

  const key = randomUUID();
  const form = () => ticketForm(createFields, [{ bytes: PNG, name: "screen.png", type: "image/png" }]);
  const created = await routes.tickets.POST(learnerRequest("/api/helpdesk/tickets", { body: form(), cookie: learnerCookie, key }), ctx());
  assert.equal(created.status, 201, await created.clone().text());
  assert.match(created.headers.get("content-type") || "", /^application\/json/);
  assert.equal(created.headers.get("idempotent-replayed"), null);
  const ticket = await created.json();
  assert.equal(ticket.ok, undefined, "no {ok} envelope on the new endpoints");
  assert.match(ticket.number, /^LG-\d{6}-0001$/);
  assert.equal(ticket.status, "OPEN");
  const attachmentUrl: string = ticket.messages[0].attachments[0].url;
  assert.equal(attachmentUrl, `/api/helpdesk/attachments/${ticket.messages[0].attachments[0].id}`);

  const replay = await routes.tickets.POST(learnerRequest("/api/helpdesk/tickets", { body: form(), cookie: learnerCookie, key }), ctx());
  assert.equal(replay.status, 200);
  assert.equal(replay.headers.get("idempotent-replayed"), "true");
  assert.equal((await replay.json()).id, ticket.id);
  await problem(await routes.tickets.POST(learnerRequest("/api/helpdesk/tickets", { body: ticketForm({ ...createFields, subject: "Other" }), cookie: learnerCookie, key }), ctx()), 422, "idempotency_conflict");

  const list = await (await routes.tickets.GET(learnerRequest("/api/helpdesk/tickets", { cookie: learnerCookie }), ctx())).json();
  assert.deepEqual(list.tickets.map((item: { id: string }) => item.id), [ticket.id]);
  assert.deepEqual((await (await routes.tickets.GET(learnerRequest("/api/helpdesk/tickets", { cookie: strangerCookie }), ctx())).json()).tickets, []);

  const image = await routes.attachment.GET(learnerRequest(attachmentUrl, { cookie: learnerCookie }), ctx({ id: ticket.messages[0].attachments[0].id }));
  assert.equal(image.status, 200);
  assert.equal(image.headers.get("content-type"), "image/png");
  assert.equal(image.headers.get("cache-control"), "private, no-store");
  assert.equal(image.headers.get("x-content-type-options"), "nosniff");
  assert.deepEqual(Buffer.from(await image.arrayBuffer()), PNG);
  await problem(await routes.attachment.GET(learnerRequest(attachmentUrl, { cookie: strangerCookie }), ctx({ id: ticket.messages[0].attachments[0].id })), 404, "not_found");
  await problem(await routes.ticket.GET(learnerRequest(`/api/helpdesk/tickets/${ticket.id}`, { cookie: strangerCookie }), ctx({ id: ticket.id })), 404, "not_found");
  await problem(await routes.ticket.GET(learnerRequest("/api/helpdesk/tickets/not-a-uuid", { cookie: learnerCookie }), ctx({ id: "not-a-uuid" })), 404, "not_found");

  const agent = { id: "emp-1", name: "Amy Agent" };
  const agentList = await (await routes.agentTickets.GET(agentRequest(`/api/integration/helpdesk/tickets?status=needs_reply&q=${encodeURIComponent("helpdesk-learner@")}`), ctx())).json();
  assert.deepEqual(agentList.tickets.map((item: { id: string }) => item.id), [ticket.id]);
  assert.equal(agentList.counts.needs_reply, 1);
  assert.equal(agentList.nextCursor, null);
  assert.deepEqual(agentList.tickets[0].learner, { id: learnerId, email: "helpdesk-learner@example.test", name: "Lin Learner" });

  await problem(await routes.agentMessages.POST(agentRequest(`/api/integration/helpdesk/tickets/${ticket.id}/messages`, { json: { body: "x", internal: false, agent, expectedSequence: 1 } }), ctx({ id: ticket.id })), 400, "idempotency_key_required");
  await problem(await routes.agentMessages.POST(agentRequest(`/api/integration/helpdesk/tickets/${ticket.id}/messages`, { key: randomUUID(), json: { body: "x", internal: false, expectedSequence: 1 } }), ctx({ id: ticket.id })), 400, "validation_failed");
  const note = await routes.agentMessages.POST(agentRequest(`/api/integration/helpdesk/tickets/${ticket.id}/messages`, { key: randomUUID(), json: { body: "VIP customer", internal: true, agent, expectedSequence: 1 } }), ctx({ id: ticket.id }));
  assert.equal(note.status, 201);
  const reply = await routes.agentMessages.POST(agentRequest(`/api/integration/helpdesk/tickets/${ticket.id}/messages`, { key: randomUUID(), json: { body: "Which order number?", internal: false, agent, expectedSequence: 2 } }), ctx({ id: ticket.id }));
  assert.equal(reply.status, 201);
  const agentDetail = await reply.json();
  assert.equal(agentDetail.status, "WAITING_USER");
  assert.deepEqual(agentDetail.assignee, agent);
  assert.equal(agentDetail.messages[0].attachments[0].url, `/api/integration/helpdesk/attachments/${ticket.messages[0].attachments[0].id}`);
  const agentImage = await routes.agentAttachment.GET(agentRequest(agentDetail.messages[0].attachments[0].url), ctx({ id: ticket.messages[0].attachments[0].id }));
  assert.equal(agentImage.status, 200);
  assert.equal(agentImage.headers.get("cache-control"), "private, no-store");

  const notifications = (await store.readProductAggregate()).notifications.filter((item) => item.userId === learnerId);
  assert.equal(notifications.filter((item) => item.body.includes(ticket.number)).length, 1, "a public agent reply adds one in-app notification");

  let view = await (await routes.ticket.GET(learnerRequest(`/api/helpdesk/tickets/${ticket.id}`, { cookie: learnerCookie }), ctx({ id: ticket.id }))).json();
  assert.equal(view.status, "WAITING_USER");
  assert.ok(!JSON.stringify(view).includes("VIP customer"));
  assert.equal(view.messages.at(-1).body, "Which order number?");

  await problem(await routes.messages.POST(learnerRequest(`/api/helpdesk/tickets/${ticket.id}/messages`, { cookie: learnerCookie, key: randomUUID(), body: ticketForm({ body: "Order 1", expectedSequence: "1" }) }), ctx({ id: ticket.id })), 409, "stale_ticket");
  const learnerReply = await routes.messages.POST(learnerRequest(`/api/helpdesk/tickets/${ticket.id}/messages`, { cookie: learnerCookie, key: randomUUID(), body: ticketForm({ body: "Order 1", expectedSequence: String(view.sequence) }, [{ bytes: PNG, name: "receipt.png", type: "image/png" }]) }), ctx({ id: ticket.id }));
  assert.equal(learnerReply.status, 201, await learnerReply.clone().text());
  view = await learnerReply.json();
  assert.equal(view.status, "ASSIGNED");

  const proposed = await routes.agentActions.POST(agentRequest(`/api/integration/helpdesk/tickets/${ticket.id}/actions`, { key: randomUUID(), json: { action: "propose_resolution", agent, expectedSequence: view.sequence } }), ctx({ id: ticket.id }));
  assert.equal(proposed.status, 200, await proposed.clone().text());
  view = await (await routes.ticket.GET(learnerRequest(`/api/helpdesk/tickets/${ticket.id}`, { cookie: learnerCookie }), ctx({ id: ticket.id }))).json();
  assert.equal(view.status, "PENDING_CONFIRM");
  assert.ok(view.confirmDueAt);

  await problem(await routes.actions.POST(learnerRequest(`/api/helpdesk/tickets/${ticket.id}/actions`, { cookie: learnerCookie, key: randomUUID(), json: { action: "cancel", expectedSequence: view.sequence } }), ctx({ id: ticket.id })), 409, "invalid_transition");
  await problem(await routes.actions.POST(learnerRequest(`/api/helpdesk/tickets/${ticket.id}/actions`, { cookie: learnerCookie, key: randomUUID(), json: "nope" }), ctx({ id: ticket.id })), 400, "invalid_request");
  const confirmKey = randomUUID();
  const confirmed = await routes.actions.POST(learnerRequest(`/api/helpdesk/tickets/${ticket.id}/actions`, { cookie: learnerCookie, key: confirmKey, json: { action: "confirm", expectedSequence: view.sequence } }), ctx({ id: ticket.id }));
  assert.equal(confirmed.status, 200);
  view = await confirmed.json();
  assert.equal(view.status, "CLOSED");
  const confirmReplay = await routes.actions.POST(learnerRequest(`/api/helpdesk/tickets/${ticket.id}/actions`, { cookie: learnerCookie, key: confirmKey, json: { action: "confirm", expectedSequence: view.sequence - 1 } }), ctx({ id: ticket.id }));
  assert.equal(confirmReplay.status, 200);
  assert.equal(confirmReplay.headers.get("idempotent-replayed"), "true");
  const rated = await (await routes.actions.POST(learnerRequest(`/api/helpdesk/tickets/${ticket.id}/actions`, { cookie: learnerCookie, key: randomUUID(), json: { action: "rate", rating: 5, expectedSequence: view.sequence } }), ctx({ id: ticket.id }))).json();
  assert.equal(rated.rating, 5);

  const full = await (await routes.agentTicket.GET(agentRequest(`/api/integration/helpdesk/tickets/${ticket.id}`), ctx({ id: ticket.id }))).json();
  assert.equal(full.messages.find((item: { internal: boolean }) => item.internal).body, "VIP customer");
  assert.deepEqual(full.learner, { id: learnerId, email: "helpdesk-learner@example.test", name: "Lin Learner", locale: "en-GB" });
  assert.equal(full.events.at(-1).type, "com.ilovelearningguide.helpdesk.ticket.rated");
  assert.equal(full.events.at(-1).specversion, "1.0");
  await problem(await routes.agentTicket.GET(agentRequest(`/api/integration/helpdesk/tickets/${randomUUID()}`), ctx({ id: randomUUID() })), 404, "not_found");
});

test("control characters in learner and agent text are a 400 validation_failed, never a 503", async () => {
  process.env.PORTAL_HELPDESK_TOKEN = TOKEN;
  await problem(await routes.tickets.POST(learnerRequest("/api/helpdesk/tickets", { body: ticketForm({ ...createFields, subject: "x\u0000y" }), cookie: learnerCookie, key: randomUUID() }), ctx()), 400, "validation_failed");
  await problem(await routes.tickets.POST(learnerRequest("/api/helpdesk/tickets", { body: ticketForm({ ...createFields, body: "nul\u0000" }), cookie: learnerCookie, key: randomUUID() }), ctx()), 400, "validation_failed");
  const created = await (await routes.tickets.POST(learnerRequest("/api/helpdesk/tickets", { body: ticketForm({ ...createFields, subject: "Control characters" }), cookie: learnerCookie, key: randomUUID() }), ctx())).json();
  await problem(await routes.messages.POST(learnerRequest(`/api/helpdesk/tickets/${created.id}/messages`, { cookie: learnerCookie, key: randomUUID(), body: ticketForm({ body: "a\u0000b", expectedSequence: "1" }) }), ctx({ id: created.id })), 400, "validation_failed");
  await problem(await routes.agentMessages.POST(agentRequest(`/api/integration/helpdesk/tickets/${created.id}/messages`, { key: randomUUID(), json: { body: "a\u0000b", internal: true, agent: { id: "emp-1", name: "Amy" }, expectedSequence: 1 } }), ctx({ id: created.id })), 400, "validation_failed");
  await problem(await routes.agentTickets.GET(agentRequest(`/api/integration/helpdesk/tickets?q=${encodeURIComponent("a\u0000")}`), ctx()), 400, "validation_failed");
});

test("rate limited requests answer 429 rate_limited with a Retry-After header", async () => {
  const { user, token } = await (async () => {
    const created = await store.registerUser({ email: "helpdesk-busy@example.test", password: "password1", nickname: "Busy Learner" });
    await store.verifyEmailToken(await store.issueEmailVerificationToken(created.id));
    return { user: created, token: (await store.createSession(created.id)).token };
  })();
  assert.ok(user.id);
  for (let index = 0; index < 10; index += 1) {
    const created = await routes.tickets.POST(learnerRequest("/api/helpdesk/tickets", { body: ticketForm({ ...createFields, subject: `Busy ${index}` }), cookie: token, key: randomUUID() }), ctx());
    assert.equal(created.status, 201);
  }
  const limited = await routes.tickets.POST(learnerRequest("/api/helpdesk/tickets", { body: ticketForm({ ...createFields, subject: "One too many" }), cookie: token, key: randomUUID() }), ctx());
  const retryAfter = Number(limited.headers.get("retry-after"));
  const body = await problem(limited, 429, "rate_limited");
  assert.ok(Number.isInteger(retryAfter) && retryAfter >= 3590 && retryAfter <= 3600, `Retry-After ${retryAfter}`);
  assert.equal(body.retryAfter, retryAfter);
});

test("withdraw an OPEN request; nothing else can be done afterwards", async () => {
  const created = await (await routes.tickets.POST(learnerRequest("/api/helpdesk/tickets", { body: ticketForm({ ...createFields, subject: "Withdraw me" }), cookie: learnerCookie, key: randomUUID() }), ctx())).json();
  await problem(await routes.actions.POST(learnerRequest(`/api/helpdesk/tickets/${created.id}/actions`, { cookie: strangerCookie, key: randomUUID(), json: { action: "cancel", expectedSequence: 1 } }), ctx({ id: created.id })), 404, "not_found");
  const cancelled = await (await routes.actions.POST(learnerRequest(`/api/helpdesk/tickets/${created.id}/actions`, { cookie: learnerCookie, key: randomUUID(), json: { action: "cancel", expectedSequence: 1 } }), ctx({ id: created.id }))).json();
  assert.equal(cancelled.status, "CANCELLED");
  assert.deepEqual(cancelled.allowedActions, []);
  await problem(await routes.agentActions.POST(agentRequest(`/api/integration/helpdesk/tickets/${created.id}/actions`, { key: randomUUID(), json: { action: "claim", agent: { id: "emp-1", name: "Amy" }, expectedSequence: 2 } }), ctx({ id: created.id })), 409, "invalid_transition");
});

test("storage that is not configured fails closed with 503 helpdesk_unavailable", async () => {
  process.env.STORAGE_BACKEND = "unconfigured";
  try {
    await problem(await routes.tickets.GET(learnerRequest("/api/helpdesk/tickets", { cookie: learnerCookie }), ctx()), 503, "helpdesk_unavailable");
  } finally {
    process.env.STORAGE_BACKEND = "local";
  }
});

// ------------------------------------------------------------ Figma addendum

test("create accepts contactEmail and suggestionId; the agent API tags, marks read and sees the projection; PDFs download", async () => {
  process.env.PORTAL_HELPDESK_TOKEN = TOKEN;
  const suggestionId = "0192d4f0-7b6a-7c3e-9a10-0000000000aa";
  await problem(await routes.tickets.POST(learnerRequest("/api/helpdesk/tickets", { body: ticketForm({ ...createFields, contactEmail: "nope" }), cookie: learnerCookie, key: randomUUID() }), ctx()), 400, "validation_failed");
  const created = await routes.tickets.POST(learnerRequest("/api/helpdesk/tickets", {
    body: ticketForm({ ...createFields, category: "technical_support", subject: "Cannot log in", contactEmail: "lin@work.example", suggestionId }, [{ bytes: PDF, name: "error.pdf", type: "application/pdf" }]),
    cookie: learnerCookie, key: randomUUID()
  }), ctx());
  assert.equal(created.status, 201, await created.clone().text());
  const ticket = await created.json();
  assert.equal(ticket.contactEmail, "lin@work.example");
  assert.equal(ticket.category, "technical_support");
  const pdf = await routes.attachment.GET(learnerRequest(ticket.messages[0].attachments[0].url, { cookie: learnerCookie }), ctx({ id: ticket.messages[0].attachments[0].id }));
  assert.equal(pdf.status, 200);
  assert.equal(pdf.headers.get("content-type"), "application/pdf");
  assert.match(pdf.headers.get("content-disposition") || "", /^attachment; filename\*=UTF-8''error\.pdf$/);
  assert.equal(pdf.headers.get("x-content-type-options"), "nosniff");

  const list = await (await routes.agentTickets.GET(agentRequest(`/api/integration/helpdesk/tickets?category=technical_support&q=${encodeURIComponent("lin@work")}`), ctx())).json();
  assert.deepEqual(list.tickets.map((item: { id: string }) => item.id), [ticket.id]);
  assert.equal(list.tickets[0].contactEmail, "lin@work.example");
  assert.equal(list.tickets[0].unreadByAgent, true);
  assert.equal(typeof list.tickets[0].preview, "string");
  const agent = { id: "emp-1", name: "Amy Agent" };
  await problem(await routes.agentActions.POST(agentRequest(`/api/integration/helpdesk/tickets/${ticket.id}/actions`, { key: randomUUID(), json: { action: "add_tag", agent, tag: "" } }), ctx({ id: ticket.id })), 400, "validation_failed");
  const tagged = await routes.agentActions.POST(agentRequest(`/api/integration/helpdesk/tickets/${ticket.id}/actions`, { key: randomUUID(), json: { action: "add_tag", agent, tag: "Login Issue" } }), ctx({ id: ticket.id }));
  assert.equal(tagged.status, 200, await tagged.clone().text());
  assert.deepEqual((await tagged.json()).tags, ["login issue"]);
  const read = await (await routes.agentActions.POST(agentRequest(`/api/integration/helpdesk/tickets/${ticket.id}/actions`, { key: randomUUID(), json: { action: "mark_read", agent } }), ctx({ id: ticket.id }))).json();
  assert.equal(read.unreadByAgent, false);
  const detail = await (await routes.agentTicket.GET(agentRequest(`/api/integration/helpdesk/tickets/${ticket.id}`), ctx({ id: ticket.id }))).json();
  assert.equal(detail.suggestionId, suggestionId);
  assert.equal(detail.events[1].type, "com.ilovelearningguide.helpdesk.ticket.suggestion_declined");
  assert.equal(detail.student.id, learnerId);
  assert.equal(detail.student.accountEmail, "helpdesk-learner@example.test");
  assert.equal(detail.student.contactEmail, "lin@work.example");
  assert.match(detail.student.joinedAt, /^\d{4}-\d{2}-\d{2}T/);
  assert.ok(detail.student.totalEnquiries >= 1);
  assert.equal(detail.subscription, null, "this learner has no plan");
  assert.deepEqual(detail.tags, ["login issue"]);
});

const UUID_V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const TRACEPARENT = /^00-[0-9a-f]{32}-[0-9a-f]{16}-[0-9a-f]{2}$/;
// A learner request's W3C traceparent; every Portal -> Admin call continues it with a new span.
const INCOMING = "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01";
function assertContinues(traceparent: string | undefined, what: string) {
  assert.match(traceparent ?? "", /^00-4bf92f3577b34da6a3ce929d0e0e4736-[0-9a-f]{16}-01$/, what);
  assert.notEqual(traceparent, INCOMING, `${what}: a new span`);
}

// A local stand-in for Admin's integration API (v2 §2).
type AdminCall = { method: string; url: string; authorization: string | undefined; traceparent: string | undefined; body: string };
let admin: Server;
let adminCalls: AdminCall[] = [];
let adminMode: "ok" | "down" | "slow" = "ok";
const ADMIN_TOKEN = "local-test-admin-helpdesk-token";
const FAQ = { id: "0192d4f0-7b6a-7c3e-9a10-1234567890ab", category: "account_technical", popular: true, question: "How do I reset my password?", answer: "Open **Sign in**, then Forgot password.", updatedAt: "2026-10-28T08:30:00.000Z" };
const ALTERNATIVE = { faqId: FAQ.id, question: FAQ.question };
let suggestionSeq = 0;
const suggestionFor = () => ({ id: `0192d4f0-7b6a-7c3e-9a10-${String(++suggestionSeq).padStart(12, "0")}`, faqId: FAQ.id, question: FAQ.question, answer: FAQ.answer });

async function readBody(request: IncomingMessage) {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}

async function startAdmin() {
  admin = createServer(async (request, response) => {
    const call = { method: request.method || "", url: request.url || "", authorization: request.headers.authorization, traceparent: request.headers.traceparent?.toString(), body: await readBody(request) };
    adminCalls.push(call);
    if (adminMode === "down") { response.writeHead(503, { "content-type": "application/problem+json" }).end("{}"); return; }
    if (adminMode === "slow") { setTimeout(() => response.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ suggestion: suggestionFor() })), 6_000).unref(); return; }
    if (call.authorization !== `Bearer ${ADMIN_TOKEN}`) { response.writeHead(401).end(); return; }
    if (call.method === "POST" && call.url === "/api/integration/helpdesk/suggest") {
      const body = JSON.parse(call.body) as { subject?: string; message: string; faqId?: string };
      const hit = body.faqId === FAQ.id || /password/i.test(`${body.subject ?? ""} ${body.message}`);
      // v4 of the contract: no answer for an "account" question comes with "You might be asking" alternatives.
      const alternatives = !hit && /account/i.test(`${body.subject ?? ""} ${body.message}`) ? [ALTERNATIVE] : undefined;
      response.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ suggestion: hit ? suggestionFor() : null, ...(alternatives ? { alternatives } : {}) }));
      return;
    }
    if (call.method === "POST" && /^\/api\/integration\/helpdesk\/suggestions\/[^/]+\/outcome$/.test(call.url)) { response.writeHead(204).end(); return; }
    response.writeHead(404).end();
  });
  await new Promise<void>((resolve) => admin.listen(0, "127.0.0.1", resolve));
  process.env.ADMIN_HELPDESK_BASE_URL = `http://127.0.0.1:${(admin.address() as AddressInfo).port}`;
  process.env.ADMIN_HELPDESK_TOKEN = ADMIN_TOKEN;
}

test("submit-time suggestions and outcomes: signed-in only, logged as source submit, never blocking; outcomes are kept when Admin is down", async (t) => {
  await startAdmin();
  t.after(() => new Promise<void>((resolve) => { admin.closeAllConnections(); admin.close(() => resolve()); }));
  adminCalls = [];

  const enquiry = { category: "technical_support", subject: "Forgot my password", message: "I cannot sign in", locale: "en-GB" };
  await problem(await routes.suggestions.POST(learnerRequest("/api/helpdesk/suggestions", { json: enquiry }), ctx()), 401, "unauthenticated");
  await problem(await routes.suggestions.POST(learnerRequest("/api/helpdesk/suggestions", { json: enquiry, cookie: learnerCookie, origin: "https://evil.example" }), ctx()), 403, "forbidden_origin");
  await problem(await routes.suggestions.POST(learnerRequest("/api/helpdesk/suggestions", { json: { ...enquiry, category: "billing" }, cookie: learnerCookie }), ctx()), 400, "validation_failed");
  const suggested = await routes.suggestions.POST(learnerRequest("/api/helpdesk/suggestions", { json: enquiry, cookie: learnerCookie }), ctx());
  assert.equal(suggested.status, 200);
  const { suggestion } = await suggested.json() as { suggestion: { id: string; faqId: string; question: string; answer: string } };
  assert.deepEqual(Object.keys(suggestion).sort(), ["answer", "faqId", "id", "question"]);
  assert.equal(suggestion.faqId, FAQ.id);
  const { runId, parentRunId, ...asked } = JSON.parse(adminCalls.at(-1)!.body) as Record<string, unknown>;
  assert.deepEqual(asked, { learnerId, locale: "en-GB", source: "submit", category: "technical_support", subject: "Forgot my password", message: "I cannot sign in" });
  assert.match(String(runId), UUID_V7, "the run id Portal stores the row under");
  assert.ok(parentRunId === null || UUID_V7.test(String(parentRunId)));
  assert.match(adminCalls.at(-1)!.traceparent ?? "", TRACEPARENT, "a new trace when the learner request had none");
  // A valid incoming W3C traceparent is continued to Admin with a new span.
  await routes.suggestions.POST(learnerRequest("/api/helpdesk/suggestions", { json: enquiry, cookie: learnerCookie, traceparent: INCOMING }), ctx());
  assertContinues(adminCalls.at(-1)!.traceparent, "the suggestions route");
  const none = await routes.suggestions.POST(learnerRequest("/api/helpdesk/suggestions", { json: { ...enquiry, subject: "Refund", message: "money back" }, cookie: learnerCookie }), ctx());
  assert.deepEqual(await none.json(), { suggestion: null, alternatives: [] });
  const ticketsBefore = (await (await routes.tickets.GET(learnerRequest("/api/helpdesk/tickets", { cookie: learnerCookie }), ctx())).json()).tickets.length;

  await problem(await routes.outcome.POST(learnerRequest(`/api/helpdesk/suggestions/${suggestion.id}/outcome`, { json: { outcome: "solved" } }), ctx({ id: suggestion.id })), 401, "unauthenticated");
  await problem(await routes.outcome.POST(learnerRequest(`/api/helpdesk/suggestions/${suggestion.id}/outcome`, { json: { outcome: "maybe" }, cookie: learnerCookie }), ctx({ id: suggestion.id })), 400, "validation_failed");
  await problem(await routes.outcome.POST(learnerRequest("/api/helpdesk/suggestions/nope/outcome", { json: { outcome: "solved" }, cookie: learnerCookie }), ctx({ id: "nope" })), 404, "not_found");
  await problem(await routes.outcome.POST(learnerRequest(`/api/helpdesk/suggestions/${suggestion.id}/outcome`, { json: { outcome: "solved" }, cookie: strangerCookie }), ctx({ id: suggestion.id })), 404, "not_found");
  const solved = await routes.outcome.POST(learnerRequest(`/api/helpdesk/suggestions/${suggestion.id}/outcome`, { json: { outcome: "solved" }, cookie: learnerCookie, traceparent: INCOMING }), ctx({ id: suggestion.id }));
  assert.equal(solved.status, 204);
  assert.equal(adminCalls.at(-1)!.url, `/api/integration/helpdesk/suggestions/${suggestion.id}/outcome`);
  assertContinues(adminCalls.at(-1)!.traceparent, "the outcome route");
  assert.deepEqual(JSON.parse(adminCalls.at(-1)!.body), { outcome: "solved" });
  assert.equal((await (await routes.tickets.GET(learnerRequest("/api/helpdesk/tickets", { cookie: learnerCookie }), ctx())).json()).tickets.length, ticketsBefore, "'solved' creates no ticket");

  adminMode = "down";
  const failed = await routes.suggestions.POST(learnerRequest("/api/helpdesk/suggestions", { json: enquiry, cookie: learnerCookie }), ctx());
  assert.equal(failed.status, 200);
  assert.deepEqual(await failed.json(), { suggestion: null, alternatives: [] }, "an Admin failure means: create the ticket directly");
  adminMode = "ok";
  const second = (await (await routes.suggestions.POST(learnerRequest("/api/helpdesk/suggestions", { json: enquiry, cookie: learnerCookie }), ctx())).json()).suggestion as { id: string };
  adminMode = "down";
  const kept = await routes.outcome.POST(learnerRequest(`/api/helpdesk/suggestions/${second.id}/outcome`, { json: { outcome: "declined" }, cookie: learnerCookie }), ctx({ id: second.id }));
  assert.equal(kept.status, 204, "Portal keeps the outcome even when Admin cannot be told");
  adminMode = "ok";
  // The declined suggestion is linked to the ticket and the BackOffice sees what the learner chose.
  process.env.PORTAL_HELPDESK_TOKEN = TOKEN;
  const created = await routes.tickets.POST(learnerRequest("/api/helpdesk/tickets", { body: ticketForm({ ...createFields, suggestionId: second.id }), key: randomUUID(), cookie: learnerCookie, traceparent: INCOMING }), ctx());
  assert.equal(created.status, 201, await created.clone().text());
  const ticketId = (await created.json()).id as string;
  const detail = await (await routes.agentTicket.GET(agentRequest(`/api/integration/helpdesk/tickets/${ticketId}`), ctx({ id: ticketId }))).json();
  assert.deepEqual(detail.aiAssist.map((item: { id: string; source: string; feedback: string }) => [item.id, item.source, item.feedback]), [[second.id, "submit", "declined"]]);
  const outcomeCalls = (id: string) => adminCalls.filter((call) => call.url === `/api/integration/helpdesk/suggestions/${id}/outcome`).map((call) => JSON.parse(call.body).outcome);
  const eventually = async (check: () => boolean) => { for (let attempt = 0; attempt < 50 && !check(); attempt += 1) await new Promise((resolve) => setTimeout(resolve, 20)); return check(); };
  assert.ok(await eventually(() => outcomeCalls(second.id).length === 2), "the server re-delivers the outcome Admin missed");
  assert.deepEqual(outcomeCalls(second.id), ["declined", "declined"]);
  assertContinues(adminCalls.filter((call) => call.url === `/api/integration/helpdesk/suggestions/${second.id}/outcome`).at(-1)!.traceparent, "the ticket route's outcome re-delivery");
  // The browser's outcome call is lost: submitting alone records and forwards "declined" from the server.
  const third = (await (await routes.suggestions.POST(learnerRequest("/api/helpdesk/suggestions", { json: enquiry, cookie: learnerCookie }), ctx())).json()).suggestion as { id: string };
  const direct = await routes.tickets.POST(learnerRequest("/api/helpdesk/tickets", { body: ticketForm({ ...createFields, subject: "Third", suggestionId: third.id }), key: randomUUID(), cookie: learnerCookie }), ctx());
  assert.equal(direct.status, 201);
  const directId = (await direct.json()).id as string;
  const directDetail = await (await routes.agentTicket.GET(agentRequest(`/api/integration/helpdesk/tickets/${directId}`), ctx({ id: directId }))).json();
  assert.deepEqual(directDetail.aiAssist.map((item: { feedback: string }) => item.feedback), ["declined"]);
  assert.ok(await eventually(() => outcomeCalls(third.id).length === 1));
  assert.deepEqual(outcomeCalls(third.id), ["declined"]);

  adminMode = "slow";
  const started = Date.now();
  const slow = await routes.suggestions.POST(learnerRequest("/api/helpdesk/suggestions", { json: enquiry, cookie: learnerCookie }), ctx());
  const elapsed = Date.now() - started;
  assert.deepEqual(await slow.json(), { suggestion: null, alternatives: [] });
  assert.ok(elapsed >= 3_500 && elapsed < 5_500, `4 s timeout, took ${elapsed} ms`);
  adminMode = "ok";

  delete process.env.ADMIN_HELPDESK_TOKEN;
  assert.deepEqual(await (await routes.suggestions.POST(learnerRequest("/api/helpdesk/suggestions", { json: enquiry, cookie: learnerCookie }), ctx())).json(), { suggestion: null, alternatives: [] });
});

test("assistant: signed in, same origin, Idempotency-Key; chat and chip answers, fallback null, replay, 30/hour then 429 with Retry-After", async (t) => {
  await startAdmin();
  t.after(() => new Promise<void>((resolve) => { admin.closeAllConnections(); admin.close(() => resolve()); }));
  adminCalls = [];
  const ask = (json: unknown, init: { cookie?: string; key?: string | null; origin?: string; traceparent?: string } = {}) => routes.assistant.POST(learnerRequest("/api/helpdesk/assistant", { json, cookie: init.cookie, key: init.key === null ? undefined : init.key ?? randomUUID(), origin: init.origin, traceparent: init.traceparent }), ctx());
  await problem(await ask({ message: "password", locale: "en-GB" }), 401, "unauthenticated");
  await problem(await ask({ message: "password", locale: "en-GB" }, { cookie: strangerCookie, origin: "https://evil.example" }), 403, "forbidden_origin");
  await problem(await ask({ message: "password", locale: "en-GB" }, { cookie: strangerCookie, key: null }), 400, "idempotency_key_required");
  await problem(await ask({ message: "x".repeat(501), locale: "en-GB" }, { cookie: strangerCookie }), 400, "validation_failed");

  const key = randomUUID();
  const chat = await ask({ message: "I never get the password email", locale: "en-GB" }, { cookie: strangerCookie, key, traceparent: INCOMING });
  assert.equal(chat.status, 200, await chat.clone().text());
  assertContinues(adminCalls.at(-1)!.traceparent, "the assistant route");
  assert.equal(chat.headers.get("cache-control"), "no-store");
  const answered = await chat.json() as { id: string; reply: { id: string; faqId: string; question: string; answer: string } };
  assert.equal(answered.reply.answer, FAQ.answer, "verbatim");
  assert.equal(answered.id, answered.reply.id);
  const callsBefore = adminCalls.length;
  const replayed = await ask({ message: "I never get the password email", locale: "en-GB" }, { cookie: strangerCookie, key });
  assert.equal(replayed.headers.get("idempotent-replayed"), "true");
  assert.deepEqual(await replayed.json(), answered);
  assert.equal(adminCalls.length, callsBefore, "a replay never asks Admin again");
  await problem(await ask({ message: "something else", locale: "en-GB" }, { cookie: strangerCookie, key }), 422, "idempotency_conflict");

  const chip = await (await ask({ message: FAQ.question, locale: "zh-CN", faqId: FAQ.id }, { cookie: strangerCookie })).json();
  assert.equal(chip.reply.faqId, FAQ.id);
  const { runId: chipRun, parentRunId: chipParent, context: chipContext, ...chipAsked } = JSON.parse(adminCalls.at(-1)!.body) as Record<string, unknown>;
  assert.deepEqual(chipAsked, { learnerId: strangerId, locale: "zh-CN", source: "chip", message: FAQ.question, faqId: FAQ.id, shownFaqIds: [FAQ.id] }, "v3: the FAQ the chat already showed is named, so Admin does not offer it again");
  // v5 (spec change): every chat request carries context; without a sessionId from the chat a new session starts, with no card on screen.
  assert.deepEqual(Object.keys(chipContext as Record<string, unknown>), ["sessionId"]);
  assert.match(String((chipContext as Record<string, unknown>).sessionId), UUID_V7);
  assert.match(String(chipRun), UUID_V7);
  assert.match(String(chipParent), UUID_V7, "the chip belongs to the conversation the chat started");
  assert.match(adminCalls.at(-1)!.traceparent ?? "", TRACEPARENT);
  const fallback = await (await ask({ message: "refund for order 42", locale: "en-GB" }, { cookie: strangerCookie })).json();
  assert.equal(fallback.reply, null);
  assert.match(fallback.id, /^[0-9a-f-]{36}$/);

  // Feedback: own answers only, first value wins, forwarded to Admin.
  const feedback = (id: string, json: unknown, cookie = strangerCookie, withKey = true) => routes.assistantFeedback.POST(learnerRequest(`/api/helpdesk/assistant/${id}/feedback`, { json, cookie, key: withKey ? randomUUID() : undefined, traceparent: INCOMING }), ctx({ id }));
  await problem(await feedback(answered.id, { helpful: true }, learnerCookie), 404, "not_found");
  await problem(await feedback(answered.id, { helpful: true }, strangerCookie, false), 400, "idempotency_key_required");
  await problem(await feedback(answered.id, { helpful: "yes" }), 400, "validation_failed");
  await problem(await feedback(fallback.id, { helpful: true }), 404, "not_found");
  const yes = await feedback(answered.id, { helpful: true });
  assert.equal(yes.status, 200);
  assert.deepEqual(await yes.json(), { id: answered.id, feedback: "helpful" });
  assert.deepEqual(JSON.parse(adminCalls.at(-1)!.body), { outcome: "helpful" });
  assertContinues(adminCalls.at(-1)!.traceparent, "the feedback route");
  assert.deepEqual(await (await feedback(answered.id, { helpful: false })).json(), { id: answered.id, feedback: "helpful" }, "first value wins");

  // Admin down or slow: reply null, never an error.
  adminMode = "down";
  assert.equal((await (await ask({ message: "password", locale: "en-GB" }, { cookie: strangerCookie })).json()).reply, null);
  adminMode = "ok";

  // 30 per hour per learner (chat + chip): this learner has asked 4 times so far (a replay does not count).
  for (let index = 0; index < 26; index += 1) assert.equal((await ask({ message: `question ${index}`, locale: "en-GB" }, { cookie: strangerCookie })).status, 200);
  const limited = await ask({ message: "one more", locale: "en-GB" }, { cookie: strangerCookie });
  const body = await problem(limited, 429, "rate_limited");
  assert.ok(Number(limited.headers.get("retry-after")) > 0);
  assert.ok(body.retryAfter > 0);
  assert.equal((await ask({ message: "password please", locale: "en-GB" }, { cookie: learnerCookie })).status, 200, "other learners are not limited");

  // The chat answers are linked to the next enquiry (multipart assistIds), and the agent sees them.
  const form = ticketForm(createFields);
  form.append("assistIds", answered.id);
  form.append("assistIds", fallback.id);
  const created = await routes.tickets.POST(learnerRequest("/api/helpdesk/tickets", { body: form, key: randomUUID(), cookie: strangerCookie }), ctx());
  assert.equal(created.status, 201, await created.clone().text());
  const ticketId = (await created.json()).id as string;
  process.env.PORTAL_HELPDESK_TOKEN = TOKEN;
  const detail = await (await routes.agentTicket.GET(agentRequest(`/api/integration/helpdesk/tickets/${ticketId}`), ctx({ id: ticketId }))).json();
  assert.deepEqual(detail.aiAssist.map((item: { id: string }) => item.id), [answered.id, fallback.id]);
  assert.equal(detail.aiAssist[0].feedback, "helpful");
  assert.equal(detail.aiAssist[0].question, "I never get the password email");
  assert.equal(detail.aiAssist[1].answer, null);
  const tooMany = ticketForm(createFields);
  for (let index = 0; index < 11; index += 1) tooMany.append("assistIds[]", randomUUID());
  await problem(await routes.tickets.POST(learnerRequest("/api/helpdesk/tickets", { body: tooMany, key: randomUUID(), cookie: strangerCookie }), ctx()), 400, "validation_failed");
});

test("agent flag / unflag and the flagged / learnerId list filters over HTTP", async () => {
  process.env.PORTAL_HELPDESK_TOKEN = TOKEN;
  const created = await routes.tickets.POST(learnerRequest("/api/helpdesk/tickets", { body: ticketForm({ ...createFields, subject: "Flag me" }), key: randomUUID(), cookie: learnerCookie }), ctx());
  const ticket = await created.json() as { id: string };
  const agent = { id: "emp-1", name: "Amy Agent" };
  await problem(await routes.agentActions.POST(agentRequest(`/api/integration/helpdesk/tickets/${ticket.id}/actions`, { key: randomUUID(), json: { action: "flag", agent } }), ctx({ id: ticket.id })), 400, "validation_failed");
  const flagged = await routes.agentActions.POST(agentRequest(`/api/integration/helpdesk/tickets/${ticket.id}/actions`, { key: randomUUID(), json: { action: "flag", agent, expectedSequence: 1 } }), ctx({ id: ticket.id }));
  assert.equal(flagged.status, 200, await flagged.clone().text());
  assert.equal((await flagged.json()).flagged, true);
  const list = await (await routes.agentTickets.GET(agentRequest("/api/integration/helpdesk/tickets?flagged=true"), ctx())).json();
  assert.ok(list.tickets.length >= 1);
  assert.ok(list.tickets.every((item: { flagged: boolean }) => item.flagged));
  const timeline = await (await routes.agentTickets.GET(agentRequest(`/api/integration/helpdesk/tickets?learnerId=${encodeURIComponent(learnerId)}&limit=10`), ctx())).json();
  assert.ok(timeline.tickets.length >= 1);
  assert.ok(timeline.tickets.every((item: { learner: { id: string } }) => item.learner.id === learnerId));
  await problem(await routes.agentTickets.GET(agentRequest("/api/integration/helpdesk/tickets?flagged=maybe"), ctx()), 400, "validation_failed");
  const unflagged = await routes.agentActions.POST(agentRequest(`/api/integration/helpdesk/tickets/${ticket.id}/actions`, { key: randomUUID(), json: { action: "unflag", agent, expectedSequence: 2 } }), ctx({ id: ticket.id }));
  assert.equal((await unflagged.json()).flagged, false);
  const learnerView = await (await routes.ticket.GET(learnerRequest(`/api/helpdesk/tickets/${ticket.id}`, { cookie: learnerCookie }), ctx({ id: ticket.id }))).json();
  assert.equal(learnerView.timeline.some((item: { type: string }) => item.type === "flagged" || item.type === "unflagged"), false);
});

test("v3: the submit check and the chat pass on Admin's alternatives; rating an answer is own-only, first wins, 409 on a different value, RFC 9457 errors", async (t) => {
  await startAdmin();
  t.after(() => new Promise<void>((resolve) => { admin.closeAllConnections(); admin.close(() => resolve()); }));
  adminCalls = [];
  // A learner of its own: the other tests have used up their hourly budgets.
  const user = await store.registerUser({ email: "helpdesk-rater@example.test", password: "password1", nickname: "Rae Rater" });
  await store.verifyEmailToken(await store.issueEmailVerificationToken(user.id));
  const learnerCookie = (await store.createSession(user.id)).token;
  const enquiry = { category: "technical_support", subject: "Cannot open my account", message: "It just spins", locale: "en-GB" };
  const offered = await routes.suggestions.POST(learnerRequest("/api/helpdesk/suggestions", { json: enquiry, cookie: learnerCookie }), ctx());
  assert.equal(offered.status, 200);
  assert.deepEqual(await offered.json(), { suggestion: null, alternatives: [ALTERNATIVE] });
  const ask = (json: unknown) => routes.assistant.POST(learnerRequest("/api/helpdesk/assistant", { json, cookie: learnerCookie, key: randomUUID() }), ctx());
  const fallback = await (await ask({ message: "my account is locked", locale: "en-GB" })).json() as { id: string; reply: null; alternatives: unknown[] };
  assert.equal(fallback.reply, null);
  assert.deepEqual(fallback.alternatives, [ALTERNATIVE]);
  const answered = await (await routes.suggestions.POST(learnerRequest("/api/helpdesk/suggestions", { json: { ...enquiry, subject: "Forgot my password" }, cookie: learnerCookie }), ctx())).json() as { suggestion: { id: string }; alternatives: unknown[] };
  assert.deepEqual(answered.alternatives, []);
  // That suggestion showed the FAQ: Admin is told (shownFaqIds) and it is never offered again in this conversation.
  const after = await (await ask({ message: "my account is still locked", locale: "en-GB" })).json() as { reply: null; alternatives: unknown[] };
  assert.deepEqual(JSON.parse(adminCalls.at(-1)!.body).shownFaqIds, [FAQ.id]);
  assert.deepEqual(after.alternatives, [], "the FAQ just shown is not offered again");
  const chip = await (await ask({ message: ALTERNATIVE.question, locale: "en-GB", faqId: ALTERNATIVE.faqId })).json() as { id: string; reply: { faqId: string }; alternatives: unknown[] };
  assert.equal(chip.reply.faqId, FAQ.id);
  assert.deepEqual(chip.alternatives, []);

  const rate = (id: string, json: unknown, init: { cookie?: string; key?: boolean; origin?: string } = {}) => routes.assistantRating.POST(learnerRequest(`/api/helpdesk/assistant/${id}/rating`, { json, cookie: init.cookie === undefined ? learnerCookie : init.cookie || undefined, key: init.key === false ? undefined : randomUUID(), origin: init.origin }), ctx({ id }));
  const suggestionId = answered.suggestion.id;
  await problem(await rate(suggestionId, { rating: 5 }, { cookie: "" }), 401, "unauthenticated");
  await problem(await rate(suggestionId, { rating: 5 }, { origin: "https://evil.example" }), 403, "forbidden_origin");
  await problem(await rate(suggestionId, { rating: 5 }, { key: false }), 400, "idempotency_key_required");
  await problem(await rate(suggestionId, { rating: 6 }), 400, "validation_failed");
  await problem(await rate("nope", { rating: 5 }), 404, "not_found");
  await problem(await rate(suggestionId, { rating: 5 }, { cookie: strangerCookie }), 404, "not_found");
  await problem(await rate(fallback.id, { rating: 5 }), 404, "not_found");
  const first = await rate(suggestionId, { rating: 5 });
  assert.equal(first.status, 200, await first.clone().text());
  assert.equal(first.headers.get("cache-control"), "no-store");
  assert.deepEqual(await first.json(), { id: suggestionId, rating: 5 });
  assert.deepEqual(await (await rate(suggestionId, { rating: 5 })).json(), { id: suggestionId, rating: 5 }, "idempotent");
  const conflict = await problem(await rate(suggestionId, { rating: 2 }), 409, "answer_already_rated");
  assert.equal(conflict.rating, 5);
  assert.deepEqual(await (await rate(chip.id, { rating: 3 })).json(), { id: chip.id, rating: 3 }, "a chosen alternative's answer is rated on its own");
  assert.ok(!adminCalls.some((call) => call.url.includes("/rating")), "ratings stay in Portal");

  // The BackOffice reads the rating on the AI blocks of the ticket that links the answers.
  process.env.PORTAL_HELPDESK_TOKEN = TOKEN;
  const form = ticketForm({ ...createFields, subject: "Rated answers" });
  form.append("assistIds", fallback.id);
  form.append("assistIds", chip.id);
  const created = await routes.tickets.POST(learnerRequest("/api/helpdesk/tickets", { body: form, key: randomUUID(), cookie: learnerCookie }), ctx());
  assert.equal(created.status, 201, await created.clone().text());
  const ticketId = (await created.json()).id as string;
  const detail = await (await routes.agentTicket.GET(agentRequest(`/api/integration/helpdesk/tickets/${ticketId}`), ctx({ id: ticketId }))).json();
  assert.deepEqual(detail.aiAssist.map((item: { id: string; rating: number | null }) => [item.id, item.rating]), [[fallback.id, null], [chip.id, 3]]);
});
