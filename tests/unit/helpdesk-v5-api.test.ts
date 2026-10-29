// Helpdesk v5 API-level tests: the real Route Handlers for the new learner
// endpoints (sessions, click, session end, expanded) with the real session
// lookup, the DEV-only local storage and a local stand-in for Admin that
// serves the contract fixture's published release. Clicks are answered from
// Portal's cached copy of that release: no suggest call, and they keep
// working while Admin is down.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { SESSION_COOKIE } from "../../services/productAuth";

const cwd = process.cwd();
const env = { ...process.env };
const ORIGIN = "http://localhost:3000";
const ADMIN_TOKEN = "local-test-admin-helpdesk-token";
const fixture = JSON.parse(readFileSync("tests/fixtures/helpdesk-contract.json", "utf8")) as { portalToAdmin: Record<string, unknown> & { faqReleaseResponse: { nodes: Array<{ id: string; question: string; answer: string; blocks: Array<{ id: string; text: string }> }> }; faqReleaseResponseHeaders: Record<string, string> } };
const RELEASE = fixture.portalToAdmin.faqReleaseResponse;
const NODE = { choice: "01a18100-0000-7000-8000-000000000020", failed: "01a18100-0000-7000-8000-000000000021", noAccess: "01a18100-0000-7000-8000-000000000022", twice: "01a18100-0000-7000-8000-000000000023", contact: "01a18100-0000-7000-8000-000000000024" };
type Params = { params: Promise<Record<string, string>> };
type Handler = (request: Request, context: Params) => Promise<Response>;
let directory = "";
let routes: Record<"sessions" | "end" | "click" | "expanded", Record<string, Handler>>;
let learnerCookie = "";
let strangerCookie = "";
type AdminCall = { method: string; url: string; authorization: string | undefined; ifNoneMatch: string | undefined };
let admin: Server;
let adminCalls: AdminCall[] = [];
let adminDown = false;

async function drain(request: IncomingMessage) { for await (const chunk of request) void chunk; }

before(async () => {
  directory = await mkdtemp(path.join(tmpdir(), "lg-helpdesk-v5-api-"));
  process.chdir(directory);
  process.env.APP_ENV = "DEV";
  process.env.STORAGE_BACKEND = "local";
  process.env.SESSION_SECRET = "test-session-secret-with-at-least-32-characters";
  delete process.env.DATABASE_URL;
  process.env.ADMIN_HOSTS = "admin.ilovelearningguide.com,admin.sit.ilovelearningguide.com";
  admin = createServer(async (request, response) => {
    await drain(request);
    const call = { method: request.method || "", url: request.url || "", authorization: request.headers.authorization, ifNoneMatch: request.headers["if-none-match"]?.toString() };
    adminCalls.push(call);
    if (adminDown) { response.writeHead(503, { "content-type": "application/problem+json" }).end("{}"); return; }
    if (call.authorization !== `Bearer ${ADMIN_TOKEN}`) { response.writeHead(401).end(); return; }
    if (call.method === "GET" && call.url === fixture.portalToAdmin.faqReleaseRequest) {
      if (call.ifNoneMatch === fixture.portalToAdmin.faqReleaseResponseHeaders.ETag) { response.writeHead(304, { etag: call.ifNoneMatch }).end(); return; }
      response.writeHead(200, { "content-type": "application/json", ...fixture.portalToAdmin.faqReleaseResponseHeaders }).end(JSON.stringify(RELEASE));
      return;
    }
    response.writeHead(404).end();
  });
  await new Promise<void>((resolve) => admin.listen(0, "127.0.0.1", resolve));
  process.env.ADMIN_HELPDESK_BASE_URL = `http://127.0.0.1:${(admin.address() as AddressInfo).port}`;
  process.env.ADMIN_HELPDESK_TOKEN = ADMIN_TOKEN;
  const store = await import("../../services/productStore");
  const make = async (email: string, nickname: string) => {
    const user = await store.registerUser({ email, password: "password1", nickname });
    await store.verifyEmailToken(await store.issueEmailVerificationToken(user.id));
    return (await store.createSession(user.id)).token;
  };
  learnerCookie = await make("helpdesk-v5-learner@example.test", "Lin Learner");
  strangerCookie = await make("helpdesk-v5-stranger@example.test", "Sam Stranger");
  routes = {
    sessions: await import("../../app/api/helpdesk/assistant/sessions/route"),
    end: await import("../../app/api/helpdesk/assistant/sessions/[id]/end/route"),
    click: await import("../../app/api/helpdesk/assistant/click/route"),
    expanded: await import("../../app/api/helpdesk/assistant/[id]/expanded/route")
  } as unknown as typeof routes;
});

after(async () => {
  admin.closeAllConnections();
  await new Promise<void>((resolve) => admin.close(() => resolve()));
  process.chdir(cwd);
  for (const key of Object.keys(process.env)) if (!(key in env)) delete process.env[key];
  Object.assign(process.env, env);
  if (directory && path.dirname(directory) === tmpdir()) await rm(directory, { recursive: true, force: true });
});

function learnerRequest(url: string, init: { cookie?: string; key?: string; json?: unknown; origin?: string } = {}) {
  const headers = new Headers({ host: "localhost:3000", origin: init.origin ?? ORIGIN });
  if (init.cookie) headers.set("cookie", `${SESSION_COOKIE}=${init.cookie}`);
  if (init.key) headers.set("idempotency-key", init.key);
  headers.set("content-type", "application/json");
  return new Request(`${ORIGIN}${url}`, { method: "POST", headers, body: JSON.stringify(init.json ?? {}) });
}

const ctx = (params: Record<string, string> = {}): Params => ({ params: Promise.resolve(params) });

async function problem(response: Response, status: number, code: string) {
  assert.equal(response.status, status, `${code}: ${await response.clone().text()}`);
  assert.match(response.headers.get("content-type") || "", /^application\/problem\+json/);
  assert.equal((await response.json()).code, code);
}

const start = (json: unknown, cookie: string | null = learnerCookie, origin?: string) => routes.sessions.POST(learnerRequest("/api/helpdesk/assistant/sessions", { json, cookie: cookie ?? undefined, origin }), ctx());
const click = (json: unknown, init: { cookie?: string; key?: string | null } = {}) => routes.click.POST(learnerRequest("/api/helpdesk/assistant/click", { json, cookie: init.cookie ?? learnerCookie, key: init.key === null ? undefined : init.key ?? randomUUID() }), ctx());
type Turn = { kind: string; via: string; nodeId: string; nodeType: string; opening: string | null; closing: string | null; excerpt: Array<{ id: string; text: string }> | null; next: { kind: string; steps: Array<{ nodeId: string; label: string }> } | null; source: unknown; releaseVersion: number; sessionId: string; turnIndex: number; unsolved: boolean; countsAsQuestion: boolean };
type ClickBody = { id: string; reply: { faqId: string; question: string; answer: string } | null; alternatives: unknown[]; turn: Turn };

test("v5 sessions: signed in and same origin; chips from the release's entry nodes, no signals returned", async () => {
  await problem(await start({ locale: "en-GB" }, null), 401, "unauthenticated");
  await problem(await start({ locale: "en-GB" }, learnerCookie, "https://evil.example"), 403, "forbidden_origin");
  await problem(await start({ locale: "fr-FR" }), 400, "validation_failed");
  adminCalls = [];
  const response = await start({ locale: "en-GB", orderId: null });
  assert.equal(response.status, 201, await response.clone().text());
  assert.equal(response.headers.get("cache-control"), "no-store");
  const body = await response.json() as Record<string, unknown>;
  assert.deepEqual(Object.keys(body).sort(), ["chips", "releaseVersion", "sessionId", "situational", "waitingTicket"], "the signals never leave the server");
  // A verified learner with no orders or plan: no signal is on, so the popular entry node fills the row.
  assert.deepEqual(body.chips, [{ id: NODE.choice, question: "Having trouble with a payment?", reason: "popular" }]);
  assert.equal(body.situational, false);
  assert.equal(body.waitingTicket, null);
  assert.equal(body.releaseVersion, 3);
  assert.deepEqual(adminCalls.map((call) => [call.method, call.url, call.authorization]), [["GET", "/api/integration/helpdesk/faq-release/current?locale=en-GB", `Bearer ${ADMIN_TOKEN}`]], "only the release read, never suggest");
});

test("v5 click: a chip, an option and a follow-up are answered verbatim from the cached release with no Admin call; a step that is not an edge is 400; replay is identical", async () => {
  const { sessionId } = await (await start({ locale: "en-GB" })).json() as { sessionId: string };
  adminCalls = [];
  await problem(await click({ locale: "en-GB", nodeId: NODE.choice, via: "starter", sessionId }, { key: null }), 400, "idempotency_key_required");
  await problem(await click({ locale: "en-GB", nodeId: NODE.failed, via: "option", sessionId }), 400, "validation_failed");

  const chip = await click({ locale: "en-GB", nodeId: NODE.choice, via: "starter", sessionId });
  assert.equal(chip.status, 200, await chip.clone().text());
  const choice = await chip.json() as ClickBody;
  assert.equal(choice.turn.nodeType, "choice");
  assert.equal(choice.turn.opening, null, "a choice card has no opening or closing");
  assert.deepEqual(choice.turn.next, { kind: "option", steps: [{ nodeId: NODE.failed, label: "My payment failed" }, { nodeId: NODE.noAccess, label: "I paid but have no access" }] });
  assert.equal(choice.turn.sessionId, sessionId);
  assert.equal(choice.turn.turnIndex, 1);

  const key = randomUUID();
  const optionResponse = await click({ locale: "en-GB", nodeId: NODE.failed, fromNodeId: NODE.choice, via: "option", sessionId }, { key });
  const option = await optionResponse.json() as ClickBody;
  const failed = RELEASE.nodes.find((node) => node.id === NODE.failed)!;
  assert.equal(option.reply?.answer, failed.answer, "verbatim");
  assert.equal(option.turn.kind, "answer");
  assert.equal(option.turn.via, "option");
  assert.equal(option.turn.opening, "Here's how to sort this out:");
  assert.equal(option.turn.closing, "If anything's unclear, just ask.");
  assert.equal(option.turn.excerpt, null, "a click picks no blocks: the whole answer, no \"show the full answer\"");
  assert.deepEqual(option.turn.next, { kind: "follow_up", steps: [{ nodeId: NODE.twice, label: "Will I be charged twice if I pay again?" }, { nodeId: NODE.contact, label: "How do I contact support?" }] });
  assert.equal(option.turn.turnIndex, 2);
  assert.equal(option.turn.countsAsQuestion, true);
  assert.equal(option.turn.unsolved, false);
  const replayed = await click({ locale: "en-GB", nodeId: NODE.failed, fromNodeId: NODE.choice, via: "option", sessionId }, { key });
  assert.equal(replayed.headers.get("idempotent-replayed"), "true");
  assert.deepEqual(await replayed.json(), option);
  await problem(await click({ locale: "en-GB", nodeId: NODE.twice, fromNodeId: NODE.choice, via: "option", sessionId }, { key }), 422, "idempotency_conflict");

  // Not an edge of the release, the wrong kind of edge, a chip on a non-entry node, an unknown node: 400.
  await problem(await click({ locale: "en-GB", nodeId: NODE.contact, fromNodeId: NODE.choice, via: "option", sessionId }), 400, "invalid_request");
  await problem(await click({ locale: "en-GB", nodeId: NODE.twice, fromNodeId: NODE.failed, via: "option", sessionId }), 400, "invalid_request");
  await problem(await click({ locale: "en-GB", nodeId: NODE.twice, via: "signal", sessionId }), 400, "invalid_request");
  await problem(await click({ locale: "en-GB", nodeId: randomUUID(), via: "starter", sessionId }), 400, "invalid_request");
  // A real edge, but from a card this chat never showed (paid-no-access was never opened): 400, so a non-entry
  // follow-up cannot be opened without the card it belongs to.
  await problem(await click({ locale: "en-GB", nodeId: NODE.contact, fromNodeId: NODE.noAccess, via: "follow_up", sessionId }), 400, "invalid_request");
  const other = await (await start({ locale: "en-GB" })).json() as { sessionId: string };
  await problem(await click({ locale: "en-GB", nodeId: NODE.twice, fromNodeId: NODE.failed, via: "follow_up", sessionId: other.sessionId }), 400, "invalid_request");

  // Admin goes down: the cached release keeps answering clicks.
  adminDown = true;
  try {
    const followUp = await (await click({ locale: "en-GB", nodeId: NODE.twice, fromNodeId: NODE.failed, via: "follow_up", sessionId })).json() as ClickBody;
    assert.equal(followUp.turn.nodeId, NODE.twice);
    assert.equal(followUp.turn.via, "follow_up");
    assert.equal(followUp.turn.turnIndex, 3);
  } finally { adminDown = false; }
  assert.equal(adminCalls.filter((call) => call.url !== fixture.portalToAdmin.faqReleaseRequest).length, 0, "a click never asks Admin for an answer");

  // Expanded: own answers only, idempotent.
  const expand = (id: string, cookie = learnerCookie) => routes.expanded.POST(learnerRequest(`/api/helpdesk/assistant/${id}/expanded`, { cookie }), ctx({ id }));
  await problem(await expand(option.id, strangerCookie), 404, "not_found");
  await problem(await expand(choice.id), 404, "not_found");
  assert.deepEqual(await (await expand(option.id)).json(), { id: option.id, expanded: true });
  assert.deepEqual(await (await expand(option.id)).json(), { id: option.id, expanded: true });
});

test("v5 session end: own sessions only, the first end wins", async () => {
  const { sessionId } = await (await start({ locale: "en-GB" })).json() as { sessionId: string };
  const end = (json: unknown, cookie = learnerCookie) => routes.end.POST(learnerRequest(`/api/helpdesk/assistant/sessions/${sessionId}/end`, { json, cookie }), ctx({ id: sessionId }));
  await problem(await end({ reason: "ticket" }), 400, "validation_failed");
  await problem(await end({ reason: "ended_by_learner" }, strangerCookie), 404, "not_found");
  const first = await (await end({ reason: "ended_by_learner" })).json() as { sessionId: string; endedAt: string; endReason: string };
  assert.equal(first.sessionId, sessionId);
  assert.equal(first.endReason, "ended_by_learner");
  assert.deepEqual(await (await end({ reason: "idle" })).json(), first);
  // A click naming the ended session starts a new one rather than writing into it.
  const after = await (await click({ locale: "en-GB", nodeId: NODE.choice, via: "starter", sessionId })).json() as ClickBody;
  assert.notEqual(after.turn.sessionId, sessionId);
  assert.equal(after.turn.turnIndex, 1);
});
