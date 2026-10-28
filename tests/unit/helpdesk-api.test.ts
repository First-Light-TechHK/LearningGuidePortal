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
type Routes = Record<"tickets" | "ticket" | "messages" | "actions" | "attachment" | "agentTickets" | "agentTicket" | "agentMessages" | "agentActions" | "agentAttachment" | "commonQuestions" | "suggestions" | "outcome", Record<string, Handler>>;
let directory = "";
let routes: Routes;
let learnerCookie = "";
let strangerCookie = "";
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
  strangerCookie = (await make("helpdesk-stranger@example.test", "Sam Stranger")).token;
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
    commonQuestions: await import("../../app/api/helpdesk/common-questions/route"),
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

function learnerRequest(url: string, init: { method?: string; cookie?: string; key?: string; body?: BodyInit; json?: unknown; origin?: string | null } = {}) {
  const headers = new Headers({ host: "localhost:3000" });
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
  await problem(await routes.tickets.POST(learnerRequest("/api/helpdesk/tickets", { body: ticketForm({ ...createFields, subject: "Other" }), cookie: learnerCookie, key }), ctx()), 409, "idempotency_conflict");

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

// A local stand-in for Admin's integration API (addendum §A/§C/§E).
type AdminCall = { method: string; url: string; authorization: string | undefined; body: string };
let admin: Server;
let adminCalls: AdminCall[] = [];
let adminMode: "ok" | "down" | "slow" = "ok";
const ADMIN_TOKEN = "local-test-admin-helpdesk-token";
const QA = { id: "0192d4f0-7b6a-7c3e-9a10-1234567890ab", category: "technical_support", question: "How do I reset my password?", answer: "Open Sign in, then Forgot password." };
const SUGGESTION = { id: "0192d4f0-7b6a-7c3e-9a10-0000000000bb", qaId: QA.id, question: QA.question, answer: QA.answer };

async function readBody(request: IncomingMessage) {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}

async function startAdmin() {
  admin = createServer(async (request, response) => {
    const call = { method: request.method || "", url: request.url || "", authorization: request.headers.authorization, body: await readBody(request) };
    adminCalls.push(call);
    if (adminMode === "down") { response.writeHead(503, { "content-type": "application/problem+json" }).end("{}"); return; }
    if (adminMode === "slow") { setTimeout(() => response.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ suggestion: SUGGESTION })), 6_000).unref(); return; }
    if (call.authorization !== `Bearer ${ADMIN_TOKEN}`) { response.writeHead(401).end(); return; }
    if (call.method === "GET" && call.url.startsWith("/api/integration/helpdesk/questions?")) { response.writeHead(200, { "content-type": "application/json", etag: "\"q1\"" }).end(JSON.stringify({ questions: [QA], etag: "\"q1\"" })); return; }
    if (call.method === "POST" && call.url === "/api/integration/helpdesk/suggest") { response.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ suggestion: JSON.parse(call.body).subject.includes("password") ? SUGGESTION : null })); return; }
    if (call.method === "POST" && call.url === `/api/integration/helpdesk/suggestions/${SUGGESTION.id}/outcome`) { response.writeHead(204).end(); return; }
    response.writeHead(404).end();
  });
  await new Promise<void>((resolve) => admin.listen(0, "127.0.0.1", resolve));
  process.env.ADMIN_HELPDESK_BASE_URL = `http://127.0.0.1:${(admin.address() as AddressInfo).port}`;
  process.env.ADMIN_HELPDESK_TOKEN = ADMIN_TOKEN;
}

test("common questions, suggestions and outcomes: signed-in only, thin pass-through to Admin, never blocking", async (t) => {
  await startAdmin();
  t.after(() => new Promise<void>((resolve) => { admin.closeAllConnections(); admin.close(() => resolve()); }));
  const { clearCommonQuestionsCache } = await import("../../modules/helpdesk/adminClient");
  clearCommonQuestionsCache();
  adminCalls = [];

  await problem(await routes.commonQuestions.GET(learnerRequest("/api/helpdesk/common-questions?locale=en-GB"), ctx()), 401, "unauthenticated");
  await problem(await routes.commonQuestions.GET(learnerRequest("/api/helpdesk/common-questions?locale=fr-FR", { cookie: learnerCookie }), ctx()), 400, "validation_failed");
  const questions = await routes.commonQuestions.GET(learnerRequest("/api/helpdesk/common-questions?locale=en-GB", { cookie: learnerCookie }), ctx());
  assert.equal(questions.status, 200);
  assert.equal(questions.headers.get("cache-control"), "no-store");
  assert.deepEqual(await questions.json(), { questions: [QA] });
  assert.equal(adminCalls[0].url, "/api/integration/helpdesk/questions?locale=en-GB&featured=true");
  await routes.commonQuestions.GET(learnerRequest("/api/helpdesk/common-questions?locale=en-GB", { cookie: learnerCookie }), ctx());
  assert.equal(adminCalls.length, 1, "served from the 60 s cache");

  const enquiry = { category: "technical_support", subject: "Forgot my password", message: "I cannot sign in", locale: "en-GB" };
  await problem(await routes.suggestions.POST(learnerRequest("/api/helpdesk/suggestions", { json: enquiry }), ctx()), 401, "unauthenticated");
  await problem(await routes.suggestions.POST(learnerRequest("/api/helpdesk/suggestions", { json: enquiry, cookie: learnerCookie, origin: "https://evil.example" }), ctx()), 403, "forbidden_origin");
  await problem(await routes.suggestions.POST(learnerRequest("/api/helpdesk/suggestions", { json: { ...enquiry, category: "billing" }, cookie: learnerCookie }), ctx()), 400, "validation_failed");
  const suggested = await routes.suggestions.POST(learnerRequest("/api/helpdesk/suggestions", { json: enquiry, cookie: learnerCookie }), ctx());
  assert.equal(suggested.status, 200);
  assert.deepEqual(await suggested.json(), { suggestion: SUGGESTION });
  assert.deepEqual(JSON.parse(adminCalls.at(-1)!.body), { learnerId, locale: "en-GB", category: "technical_support", subject: "Forgot my password", message: "I cannot sign in" });
  const none = await routes.suggestions.POST(learnerRequest("/api/helpdesk/suggestions", { json: { ...enquiry, subject: "Refund" }, cookie: learnerCookie }), ctx());
  assert.deepEqual(await none.json(), { suggestion: null });
  const ticketsBefore = (await (await routes.tickets.GET(learnerRequest("/api/helpdesk/tickets", { cookie: learnerCookie }), ctx())).json()).tickets.length;

  await problem(await routes.outcome.POST(learnerRequest(`/api/helpdesk/suggestions/${SUGGESTION.id}/outcome`, { json: { outcome: "solved" } }), ctx({ id: SUGGESTION.id })), 401, "unauthenticated");
  await problem(await routes.outcome.POST(learnerRequest(`/api/helpdesk/suggestions/${SUGGESTION.id}/outcome`, { json: { outcome: "maybe" }, cookie: learnerCookie }), ctx({ id: SUGGESTION.id })), 400, "validation_failed");
  await problem(await routes.outcome.POST(learnerRequest("/api/helpdesk/suggestions/nope/outcome", { json: { outcome: "solved" }, cookie: learnerCookie }), ctx({ id: "nope" })), 404, "not_found");
  const solved = await routes.outcome.POST(learnerRequest(`/api/helpdesk/suggestions/${SUGGESTION.id}/outcome`, { json: { outcome: "solved" }, cookie: learnerCookie }), ctx({ id: SUGGESTION.id }));
  assert.equal(solved.status, 204);
  assert.deepEqual(JSON.parse(adminCalls.at(-1)!.body), { outcome: "solved" });
  assert.equal((await (await routes.tickets.GET(learnerRequest("/api/helpdesk/tickets", { cookie: learnerCookie }), ctx())).json()).tickets.length, ticketsBefore, "'solved' creates no ticket");

  adminMode = "down";
  const failed = await routes.suggestions.POST(learnerRequest("/api/helpdesk/suggestions", { json: enquiry, cookie: learnerCookie }), ctx());
  assert.equal(failed.status, 200);
  assert.deepEqual(await failed.json(), { suggestion: null }, "an Admin failure means: create the ticket directly");
  await problem(await routes.outcome.POST(learnerRequest(`/api/helpdesk/suggestions/${SUGGESTION.id}/outcome`, { json: { outcome: "edited" }, cookie: learnerCookie }), ctx({ id: SUGGESTION.id })), 503, "assistant_unavailable");
  clearCommonQuestionsCache();
  assert.deepEqual(await (await routes.commonQuestions.GET(learnerRequest("/api/helpdesk/common-questions?locale=zh-CN", { cookie: learnerCookie }), ctx())).json(), { questions: [] }, "nothing cached: the column is hidden");

  adminMode = "slow";
  const started = Date.now();
  const slow = await routes.suggestions.POST(learnerRequest("/api/helpdesk/suggestions", { json: enquiry, cookie: learnerCookie }), ctx());
  const elapsed = Date.now() - started;
  assert.deepEqual(await slow.json(), { suggestion: null });
  assert.ok(elapsed >= 3_500 && elapsed < 5_500, `4 s timeout, took ${elapsed} ms`);
  adminMode = "ok";

  delete process.env.ADMIN_HELPDESK_TOKEN;
  assert.deepEqual(await (await routes.suggestions.POST(learnerRequest("/api/helpdesk/suggestions", { json: enquiry, cookie: learnerCookie }), ctx())).json(), { suggestion: null });
});
