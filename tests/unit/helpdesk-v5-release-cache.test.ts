// Helpdesk v5 (helpdesk-v5-faq-graph-design.md §4 "Caching", Part H): Portal's
// cached copy of Admin's published release (60 s revalidation with
// If-None-Match, the last good one kept on failure, per-FAQ list without a
// release), the graph view clicks are checked against, and Portal's own
// defence-in-depth check of Admin's short strings, the excerpt and the next steps.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { parseFaqRelease, type FaqRelease, type HelpdeskLocale } from "../../contracts/helpdesk";
import type { FaqReleaseRead } from "../../modules/helpdesk/adminClient";
import { EXCERPT_RULES, NEXT_STEPS_MAX, TURN_TEMPLATES, TURN_TEXT_MAX, excerptOf, nextOf, replyTemplate, screenTurnText } from "../../modules/helpdesk/assistantTurn";
import { FAQ_RELEASE_RETRY_MS, FAQ_RELEASE_TTL_MS, createFaqReleaseCache, releaseGraph } from "../../modules/helpdesk/faqReleaseCache";

const fixture = JSON.parse(readFileSync("tests/fixtures/helpdesk-contract.json", "utf8")) as { portalToAdmin: Record<string, unknown> };
export const RELEASE = parseFaqRelease(fixture.portalToAdmin.faqReleaseResponse) as FaqRelease;
const id = (n: number) => `01a18100-0000-7000-8000-${String(n).padStart(12, "0")}`;

function source(reads: Array<FaqReleaseRead | Error>) {
  const calls: Array<{ locale: HelpdeskLocale; ifNoneMatch: string | null | undefined }> = [];
  return {
    calls,
    async faqRelease(locale: HelpdeskLocale, ifNoneMatch?: string | null): Promise<FaqReleaseRead> {
      calls.push({ locale, ifNoneMatch });
      const next = reads.shift() ?? { status: "unavailable" };
      if (next instanceof Error) throw next;
      return next;
    }
  };
}

test("v5 release cache: fetched once, fresh for 60 s, then revalidated with If-None-Match; a 304 keeps it", async () => {
  let clock = 1_000_000;
  const cache = createFaqReleaseCache({ now: () => clock, log: () => undefined });
  const admin = source([{ status: "ok", release: RELEASE, etag: "\"v3\"" }, { status: "not_modified" }]);
  assert.equal(FAQ_RELEASE_TTL_MS, 60_000);
  assert.equal((await cache.current(admin, "en-GB"))?.version, 3);
  assert.equal((await cache.current(admin, "en-GB"))?.version, 3);
  clock += FAQ_RELEASE_TTL_MS - 1;
  await cache.current(admin, "en-GB");
  assert.equal(admin.calls.length, 1, "fresh: no request");
  clock += 1;
  assert.equal((await cache.current(admin, "en-GB"))?.version, 3, "stale: served at once while it revalidates");
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(admin.calls.map((call) => call.ifNoneMatch), [null, "\"v3\""]);
  clock += 1_000;
  await cache.current(admin, "en-GB");
  assert.equal(admin.calls.length, 2, "the 304 made it fresh again");
});

test("v5 release cache: Admin down keeps the last good release (and waits 15 s before asking again); 404 means the per-FAQ list", async () => {
  let clock = 0;
  const logs: Array<Record<string, unknown>> = [];
  const cache = createFaqReleaseCache({ now: () => clock, log: (line) => logs.push(line) });
  const admin = source([{ status: "ok", release: RELEASE, etag: "\"v3\"" }, { status: "unavailable" }, new Error("boom"), { status: "none" }]);
  await cache.current(admin, "en-GB");
  clock += FAQ_RELEASE_TTL_MS;
  await cache.current(admin, "en-GB");
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal((await cache.current(admin, "en-GB"))?.version, 3, "kept while Admin is unavailable");
  assert.equal(admin.calls.length, 2, "no new request inside the retry window");
  assert.ok(logs.some((line) => line.event === "faq_release_stale" && line.cached === 3));
  clock += FAQ_RELEASE_RETRY_MS;
  assert.equal((await cache.current(admin, "en-GB"))?.version, 3, "a thrown error is a failure too");
  await new Promise((resolve) => setImmediate(resolve));
  clock += FAQ_RELEASE_RETRY_MS;
  await cache.current(admin, "en-GB");
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(await cache.current(admin, "en-GB"), null, "Admin now says there is no release: use the per-FAQ list");
});

test("v5 release cache: nothing cached waits for the first read (bounded); locales are separate; minVersion forces a newer one; one request at a time", async () => {
  const cache = createFaqReleaseCache({ log: () => undefined });
  const admin = source([{ status: "none" }]);
  assert.equal(await cache.current(admin, "zh-CN"), null);
  assert.deepEqual(admin.calls.map((call) => call.locale), ["zh-CN"]);
  const hanging = { calls: 0, faqRelease: () => { hanging.calls += 1; return new Promise<FaqReleaseRead>(() => undefined); } };
  const started = Date.now();
  const [a, b] = await Promise.all([cache.current(hanging, "en-GB", { waitMs: 20 }), cache.current(hanging, "en-GB", { waitMs: 20 })]);
  assert.equal(a, null);
  assert.equal(b, null);
  assert.ok(Date.now() - started < 1_000);
  assert.equal(hanging.calls, 1, "one request in flight per locale");
  const fresh = createFaqReleaseCache({ log: () => undefined });
  const newer = { ...RELEASE, version: 4 };
  const versions = source([{ status: "ok", release: RELEASE, etag: "\"v3\"" }, { status: "ok", release: newer, etag: "\"v4\"" }]);
  await fresh.current(versions, "en-GB");
  assert.equal((await fresh.current(versions, "en-GB", { minVersion: 4 }))?.version, 4, "Admin answered from v4: the cache catches up before answering");
  assert.equal((await fresh.current(versions, "en-GB", { minVersion: 4 }))?.version, 4);
  assert.equal(versions.calls.length, 2);
});

test("v5 release graph: nodes by id, children by position, edges by parent and child", () => {
  const graph = releaseGraph(RELEASE);
  assert.equal(graph.node(id(20).toUpperCase())?.type, "choice");
  assert.equal(graph.node(id(99)), null);
  assert.deepEqual(graph.children(id(20)).map((edge) => [edge.childId, edge.kind, edge.position]), [[id(21), "option", 0], [id(22), "option", 1]]);
  assert.equal(graph.edge(id(21), id(23))?.kind, "follow_up");
  assert.equal(graph.edge(id(20), id(23)), null, "no edge: a click there is refused");
  assert.deepEqual(graph.children(id(24)), []);
});

// ---------------------------------------------------------------- Portal's own check of Admin's strings

test("v5 strings: plain short text passes; too long, links, emails, digits and markup are refused (defence in depth)", () => {
  assert.deepEqual(TURN_TEXT_MAX, { opening: 80, closing: 80, reply: 200, explanation: 350 });
  assert.deepEqual(screenTurnText("opening", "  Don't worry,\nthis is usually quick:  "), { text: "Don't worry, this is usually quick:", reason: null }, "whitespace collapsed");
  assert.deepEqual(screenTurnText("reply", "你好！遇到什么问题了？"), { text: "你好！遇到什么问题了？", reason: null });
  assert.equal(screenTurnText("reply", "您好！請問有什麼可以幫您？").text, "您好！請問有什麼可以幫您？", "Traditional Chinese is fine");
  assert.equal(screenTurnText("opening", "x".repeat(80)).reason, null);
  const cases: Array<[Parameters<typeof screenTurnText>[0], string | null | undefined, string]> = [
    ["opening", "x".repeat(81), "too_long"],
    ["reply", "y".repeat(201), "too_long"],
    ["closing", "See https://evil.example/x", "link"],
    ["closing", "see www.example.com now", "link"],
    ["reply", "Write to help@example.com", "email"],
    ["opening", "It takes 3 days", "digit"],
    ["opening", "需要３天", "digit"],
    ["opening", "**Bold** start", "markup"],
    ["reply", "<img src=x onerror=alert(1)>", "markup"],
    ["reply", "Use `code`", "markup"],
    ["reply", "[link](x)", "markup"],
    ["reply", "- a list", "markup"],
    ["reply", "", "missing"],
    ["reply", "   ", "missing"],
    ["reply", null, "missing"],
    ["reply", undefined, "missing"]
  ];
  for (const [field, text, reason] of cases) assert.deepEqual(screenTurnText(field, text), { text: null, reason }, String(text));
  assert.equal(screenTurnText("reply", "hi\u0000there‮").text, "hi there", "control and direction characters are dropped");
});

test("v5 strings: an explanation may repeat the card's own digits, links and emails, and nothing else", () => {
  const card = "Refunds take 5-10 working days. Open https://www.ilovelearningguide.com/en-GB/help or write to support@ilovelearningguide.com.";
  assert.equal(screenTurnText("explanation", "It takes 5 to 10 working days.", card).reason, null);
  assert.equal(screenTurnText("explanation", "It takes 5 to 14 working days.", card).reason, "ungrounded");
  assert.equal(screenTurnText("explanation", "It takes 5 days.").reason, "ungrounded", "no card to ground it: a digit is refused");
  assert.equal(screenTurnText("explanation", "See https://www.ilovelearningguide.com/en-GB/help.", card).reason, null);
  assert.equal(screenTurnText("explanation", "See https://other.example/help", card).reason, "link");
  assert.equal(screenTurnText("explanation", "Write to support@ilovelearningguide.com", card).reason, null);
  assert.equal(screenTurnText("explanation", "Write to boss@ilovelearningguide.com", card).reason, "email");
  assert.equal(screenTurnText("explanation", "Only for a few minutes. If it is still not active after that, reload My Learning, then sign out and back in.", card).reason, null);
  assert.equal(screenTurnText("opening", "It takes 5 days.", card).reason, "digit", "only an explanation is grounded");
});

test("v5 strings: Portal's fixed templates exist in both locales and pass Portal's own check", () => {
  for (const locale of ["en-GB", "zh-CN"] as const) {
    const copy = TURN_TEMPLATES[locale];
    for (const [field, text] of [["opening", copy.opening], ["closing", copy.closing], ["reply", copy.greeting], ["reply", copy.farewell], ["reply", copy.offTopic]] as const) assert.equal(screenTurnText(field, text).text, text, `${locale} ${text}`);
    assert.equal(replyTemplate(locale, "greeting"), copy.greeting);
    assert.equal(replyTemplate(locale, "vague"), copy.greeting);
    assert.equal(replyTemplate(locale, "farewell"), copy.farewell);
    assert.equal(replyTemplate(locale, "off_topic"), copy.offTopic);
    assert.equal(replyTemplate(locale, null), copy.greeting);
  }
  assert.equal(TURN_TEMPLATES["zh-CN"].opening, "好的，这个问题可以这样处理：");
  assert.equal(TURN_TEMPLATES["en-GB"].closing, "If anything's unclear, just ask.");
  for (const text of Object.values(TURN_TEMPLATES["zh-CN"])) assert.doesNotMatch(text, /没找到|没有找到|找不到/, "never 'couldn't find'");
  for (const text of Object.values(TURN_TEMPLATES["en-GB"])) assert.doesNotMatch(text, /couldn.t find/i);
});

test("v5 excerpt: 1-3 contiguous blocks of a long answer, verbatim; anything else is the whole answer", () => {
  const graph = releaseGraph(RELEASE);
  const long = graph.node(id(22));
  assert.deepEqual(EXCERPT_RULES, { maxBlocks: 3, shortBlocks: 3, shortChars: 200 });
  assert.deepEqual(excerptOf(long, ["b2", "b3"]), long?.blocks.slice(1, 3));
  assert.deepEqual(excerptOf(long, ["b3", "b2"])?.map((block) => block.id), ["b2", "b3"], "in answer order");
  assert.equal(excerptOf(long, ["b1", "b3"]), null, "not contiguous");
  assert.equal(excerptOf(long, ["b1", "b2", "b3", "b4"]), null, "more than 3");
  assert.equal(excerptOf(long, ["b9"]), null, "not a block of this answer");
  assert.equal(excerptOf(long, ["b2", "b2"]), null);
  assert.equal(excerptOf(long, []), null, "no pick: the whole answer");
  assert.equal(excerptOf(graph.node(id(21)), ["b1"]), null, "2 blocks: short, the whole answer");
  assert.equal(excerptOf(graph.node(id(20)), ["b1"]), null, "a choice node has no blocks");
  assert.equal(excerptOf(null, ["b1"]), null);
  const shortText = { ...long!, answer: "a\n\nb\n\nc\n\nd", blocks: ["a", "b", "c", "d"].map((text, index) => ({ id: `b${index + 1}`, text })) };
  assert.equal(excerptOf(shortText, ["b1"]), null, "200 characters or fewer: the whole answer");
});

test("v5 next steps: follow-up chips under an answer (at most 4, by position), options of a choice node; none otherwise", () => {
  const graph = releaseGraph(RELEASE);
  assert.equal(NEXT_STEPS_MAX, 4);
  assert.deepEqual(nextOf(graph, graph.node(id(20))), { kind: "option", steps: [{ nodeId: id(21), label: "My payment failed" }, { nodeId: id(22), label: "I paid but have no access" }] });
  assert.deepEqual(nextOf(graph, graph.node(id(21))), { kind: "follow_up", steps: [{ nodeId: id(23), label: "Will I be charged twice if I pay again?" }, { nodeId: id(24), label: "How do I contact support?" }] });
  assert.equal(nextOf(graph, graph.node(id(24))), null);
  assert.equal(nextOf(null, graph.node(id(21))), null);
  const many = releaseGraph({ ...RELEASE, edges: [...RELEASE.edges, ...[22, 23, 24, 20].map((n, position) => ({ parentId: id(23), childId: id(n), kind: "follow_up" as const, position, label: `L${n}` })), { parentId: id(23), childId: id(21), kind: "follow_up", position: 9, label: "L21" }] });
  assert.equal(nextOf(many, many.node(id(23)))?.steps.length, 4);
});
