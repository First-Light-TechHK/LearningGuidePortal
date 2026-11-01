// BackOffice HelpDesk data tab: daily ticket numbers (GET /api/integration/helpdesk/ticket-stats).
// The counting is one pure function over (opened, closed, close reason, first public staff reply); the file store,
// PostgreSQL (tests/io/postgres/helpdesk-insights.test.ts) and the route all go through it.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { HelpdeskProblem, parseTicketStatsQuery, TICKET_STATS_LIMITS } from "../../contracts/helpdesk";
import type { TicketTiming } from "../../modules/helpdesk/repository";
import { createHelpdeskService } from "../../modules/helpdesk/service";
import { createTicketStatsService, percentile, ticketStats } from "../../modules/helpdesk/ticketStats";
import { createLocalHelpdeskRepository } from "../../repositories/helpdeskRepository";

const cwd = process.cwd();
const env = { ...process.env };
const TOKEN = "local-test-helpdesk-token-ticket-stats-01";
let directory = "";

before(async () => {
  directory = await mkdtemp(path.join(tmpdir(), "lg-helpdesk-ticket-stats-"));
});

after(async () => {
  process.chdir(cwd);
  for (const key of Object.keys(process.env)) if (!(key in env)) delete process.env[key];
  Object.assign(process.env, env);
  if (directory && path.dirname(directory) === tmpdir()) await rm(directory, { recursive: true, force: true });
});

const timing = (createdAt: string, patch: Partial<TicketTiming> = {}): TicketTiming => ({ createdAt, closedAt: null, closeReason: null, firstReplyAt: null, ...patch });

test("query: two UTC dates, both ends included, at most 92 days, to not before from", () => {
  const parse = (query: string) => parseTicketStatsQuery(new URLSearchParams(query));
  assert.deepEqual(parse("from=2026-10-01&to=2026-10-31"), { from: "2026-10-01", to: "2026-10-31" });
  assert.deepEqual(parse("from=2026-10-31&to=2026-10-31"), { from: "2026-10-31", to: "2026-10-31" });
  for (const bad of ["", "from=2026-10-01", "to=2026-10-01", "from=2026-10-1&to=2026-10-31", "from=2026-02-30&to=2026-03-01", "from=2026-10-31&to=2026-10-01", "from=2026-01-01&to=2026-04-03", "from=2026-10-01T00:00:00Z&to=2026-10-31"])
    assert.throws(() => parse(bad), (error: unknown) => error instanceof HelpdeskProblem && error.code === "validation_failed", bad);
  assert.equal(TICKET_STATS_LIMITS.daysMax, 92);
  assert.doesNotThrow(() => parse("from=2026-01-01&to=2026-04-02"));
});

test("percentile interpolates like percentile_cont and rounds to 0.1 minute", () => {
  assert.equal(percentile([], 0.5), null);
  assert.equal(percentile([7], 0.9), 7);
  assert.equal(percentile([1, 2, 3, 4], 0.5), 2.5);
  assert.equal(percentile([10, 20, 30, 40, 50, 60, 70, 80, 90, 100], 0.9), 91);
});

test("counts per UTC day: opened, resolved, cancelled, open at the day's end, first public staff reply", () => {
  const out = ticketStats([
    // opened day 1, replied after 30 minutes, resolved on day 2
    timing("2026-10-01T08:00:00.000Z", { firstReplyAt: "2026-10-01T08:30:00.000Z", closedAt: "2026-10-02T10:00:00.000Z", closeReason: "user_confirmed" }),
    // opened day 1 late, replied after 90 minutes (on day 2), still open
    timing("2026-10-01T23:30:00.000Z", { firstReplyAt: "2026-10-02T01:00:00.000Z" }),
    // opened day 2, cancelled the same day, no reply
    timing("2026-10-02T09:00:00.000Z", { closedAt: "2026-10-02T09:05:00.000Z", closeReason: "cancelled" }),
    // opened before the window, auto-confirmed on day 3
    timing("2026-09-20T09:00:00.000Z", { firstReplyAt: "2026-09-20T09:10:00.000Z", closedAt: "2026-10-03T00:00:00.000Z", closeReason: "auto_confirmed" })
  ], { from: "2026-10-01", to: "2026-10-03" });
  assert.equal(out.timeZone, "UTC");
  assert.deepEqual(out.days, [
    { day: "2026-10-01", created: 2, resolved: 0, cancelled: 0, openAtEnd: 3, firstReplies: 2, firstReplyMedianMinutes: 60, firstReplyP90Minutes: 84 },
    { day: "2026-10-02", created: 1, resolved: 1, cancelled: 1, openAtEnd: 2, firstReplies: 0, firstReplyMedianMinutes: null, firstReplyP90Minutes: null },
    { day: "2026-10-03", created: 0, resolved: 1, cancelled: 0, openAtEnd: 1, firstReplies: 0, firstReplyMedianMinutes: null, firstReplyP90Minutes: null }
  ]);
  // the totals' reply times are over the window's own enquiries only (not the one opened in September)
  assert.deepEqual(out.totals, { created: 3, resolved: 2, cancelled: 1, firstReplies: 2, firstReplyMedianMinutes: 60, firstReplyP90Minutes: 84 });
});

test("the file store hands over opened / closed / first public staff reply; internal notes do not count as a reply", async () => {
  let clock = Date.parse("2026-10-05T06:00:00.000Z");
  const repository = createLocalHelpdeskRepository(path.join(directory, randomUUID()));
  const service = createHelpdeskService({ repository, blobs: { async put() {}, async get() { return new Uint8Array(); } }, now: () => new Date(clock), log: () => {} });
  const learner = { id: "user-stats", email: "stats.learner@example.test", name: "Stats Learner" };
  const agent = { id: "emp-stats", name: "Amy Agent" };
  const input = { category: "payments_subscriptions" as const, subject: "Paid, still Basic", body: "Please check.", locale: "en-GB" as const, files: [] };
  const replied = await service.createTicket(learner, input, randomUUID());
  clock += 5 * 60_000;
  let detail = await service.agentAction(replied.ticket.id, { action: "claim", agent, expectedSequence: replied.ticket.sequence }, randomUUID());
  detail = await service.postAgentMessage(replied.ticket.id, { body: "Looking now (note)", internal: true, agent, expectedSequence: detail.ticket.sequence }, randomUUID());
  clock += 10 * 60_000;
  await service.postAgentMessage(replied.ticket.id, { body: "Fixed, please check.", internal: false, agent, expectedSequence: detail.ticket.sequence }, randomUUID());
  const cancelled = await service.createTicket(learner, { ...input, subject: "Never mind" }, randomUUID());
  clock += 60_000;
  await service.learnerAction(learner, cancelled.ticket.id, { action: "cancel", expectedSequence: cancelled.ticket.sequence }, randomUUID());

  const stats = await createTicketStatsService({ repository }).stats({ from: "2026-10-05", to: "2026-10-05" });
  assert.deepEqual(stats.days, [{ day: "2026-10-05", created: 2, resolved: 0, cancelled: 1, openAtEnd: 1, firstReplies: 1, firstReplyMedianMinutes: 15, firstReplyP90Minutes: 15 }]);
  // a window after everything closed still counts the open one at each day's end, and nothing else
  const later = await createTicketStatsService({ repository }).stats({ from: "2026-10-06", to: "2026-10-07" });
  assert.deepEqual(later.days.map((d) => [d.day, d.created, d.openAtEnd]), [["2026-10-06", 0, 1], ["2026-10-07", 0, 1]]);
});

test("route: integration bearer like the other Admin reads; bad dates are 400 validation_failed", async () => {
  process.chdir(directory);
  process.env.APP_ENV = "DEV";
  process.env.STORAGE_BACKEND = "local";
  process.env.SESSION_SECRET = "test-session-secret-with-at-least-32-characters";
  delete process.env.DATABASE_URL;
  delete process.env.PORTAL_HELPDESK_TOKEN;
  const route = await import("../../app/api/integration/helpdesk/ticket-stats/route");
  const get = (query: string, token: string | null = TOKEN) => {
    const headers = new Headers({ host: "localhost:3000" });
    if (token !== null) headers.set("authorization", `Bearer ${token}`);
    return route.GET(new Request(`http://localhost:3000/api/integration/helpdesk/ticket-stats${query}`, { headers }));
  };
  const problem = async (response: Response, status: number, code: string) => {
    assert.equal(response.status, status, await response.clone().text());
    assert.match(response.headers.get("content-type") || "", /^application\/problem\+json/);
    assert.equal((await response.json()).code, code);
  };
  await problem(await get("?from=2026-10-01&to=2026-10-02"), 503, "integration_disabled");
  process.env.PORTAL_HELPDESK_TOKEN = TOKEN;
  await problem(await get("?from=2026-10-01&to=2026-10-02", null), 401, "invalid_token");
  await problem(await get("?from=2026-10-01&to=2026-10-02", "nope"), 401, "invalid_token");
  await problem(await get("?from=yesterday&to=2026-10-02"), 400, "validation_failed");
  const ok = await get("?from=2026-10-01&to=2026-10-02");
  assert.equal(ok.status, 200);
  const body = await ok.json();
  assert.deepEqual(body.days.map((d: { day: string; created: number }) => [d.day, d.created]), [["2026-10-01", 0], ["2026-10-02", 0]]);
});
