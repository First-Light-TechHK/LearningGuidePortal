import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { FAQ_SIGNALS, HELPDESK_LIMITS, SITUATION_SIGNALS, buildSuggestContext, isFaqSignal, parseFaqRelease, parseSuggestTurn } from "../../contracts/helpdesk";

// Helpdesk v5 (contract fixture v6): the pure readers Portal uses for Admin's new fields. They are tolerant: an
// older Admin, a malformed item or an unknown value never breaks the chat; the wire examples are in
// helpdesk-contract-fixture.test.ts.
const NODE = "01a18100-0000-7000-8000-000000000022";
const OTHER = "01a18100-0000-7000-8000-000000000024";

async function release() {
  const fixture = JSON.parse(await readFile(path.join(process.cwd(), "tests/fixtures/helpdesk-contract.json"), "utf8")) as { portalToAdmin: { faqReleaseResponse: Record<string, unknown> & { nodes: Array<Record<string, unknown>>; edges: Array<Record<string, unknown>> } } };
  return fixture.portalToAdmin.faqReleaseResponse;
}

test("signals: the FAQ signals are the situation signals except open_ticket_waiting, in chip priority order", () => {
  assert.deepEqual([...FAQ_SIGNALS], ["payment_failed", "payment_pending", "recent_purchase", "trial_ending", "subscription_expired", "subscription_cancelled", "email_unverified", "from_order"]);
  assert.deepEqual(SITUATION_SIGNALS.filter((signal) => signal !== "open_ticket_waiting").sort(), [...FAQ_SIGNALS].sort());
  assert.equal(isFaqSignal("open_ticket_waiting"), false);
  assert.equal(isFaqSignal("payment_failed"), true);
});

test("buildSuggestContext keeps valid ids (lower case) and the last 3 non-empty learner turns, each clipped to 500 code points", () => {
  assert.deepEqual(buildSuggestContext({}), {});
  assert.deepEqual(buildSuggestContext({ nodeId: NODE.toUpperCase(), sessionId: "not-a-uuid", recentTurns: [" a ", "", "b", "c", "d\u0000"] }), { nodeId: NODE, recentTurns: ["b", "c", "d"] });
  const long = buildSuggestContext({ recentTurns: ["字".repeat(600), "😀".repeat(501)] }).recentTurns ?? [];
  assert.deepEqual(long.map((turn) => [...turn].length), [HELPDESK_LIMITS.recentTurnMax, HELPDESK_LIMITS.recentTurnMax]);
  assert.equal(HELPDESK_LIMITS.recentTurnsMax, 3);
});

test("parseSuggestTurn: null without a known kind (an older Admin); unknown values read as null, blocks as ids only", () => {
  assert.equal(parseSuggestTurn({ suggestion: null, alternatives: [] }), null);
  assert.equal(parseSuggestTurn({ kind: "handover" }), null);
  assert.equal(parseSuggestTurn(null), null);
  assert.deepEqual(parseSuggestTurn({ kind: "answer", intent: "chat", confidence: "maybe", nodeId: NODE.toUpperCase(), blocks: ["b2", "x", 3, "b2", "b3"], opening: "  ", closing: "Ask me.", covered: "yes", guard: { result: "fallback", reason: "nope", fallback: ["opening", "body"] }, releaseVersion: 0 }), {
    kind: "answer", intent: null, confidence: null, nodeId: NODE, blocks: ["b2", "b3"], opening: null, closing: "Ask me.", reply: null, explanation: null, covered: null,
    guard: { result: "fallback", reason: null, fallback: ["opening"] }, releaseVersion: null
  });
  assert.equal(parseSuggestTurn({ kind: "smalltalk", guard: { result: "odd" } })?.guard, null);
});

test("parseFaqRelease reads the contract release unchanged", async () => {
  assert.deepEqual(parseFaqRelease(await release()), await release());
});

test("parseFaqRelease drops malformed nodes and edges, and edges to nodes it does not have, so a click can never reach them", async () => {
  const raw = await release();
  const read = parseFaqRelease({
    ...raw,
    nodes: [...raw.nodes, { id: "bad", key: "x", type: "answer", category: "other", question: "q", answer: "a" }, { ...raw.nodes[0], type: "tree" }, raw.nodes[1], { ...raw.nodes[3], signals: ["open_ticket_waiting", "payment_failed", "x"], id: "01a18100-0000-7000-8000-0000000000aa" }],
    edges: [...raw.edges, { parentId: NODE, childId: "01a18100-0000-7000-8000-0000000000ff", kind: "follow_up", position: 1, label: "Gone" }, { parentId: NODE, childId: NODE, kind: "follow_up", position: 2, label: "Self" }, { parentId: NODE, childId: OTHER, kind: "jump", position: 0, label: "x" }, { parentId: NODE, childId: OTHER, kind: "follow_up", position: -1, label: "x" }, { parentId: NODE, childId: OTHER, kind: "follow_up", position: 0, label: "" }]
  })!;
  assert.deepEqual(read.nodes.map((node) => node.key), ["payment-problem", "payment-failed", "paid-no-access", "charged-twice", "contact-support", "charged-twice"], "the duplicate id and the malformed nodes are dropped");
  assert.deepEqual(read.nodes.at(-1)?.signals, ["payment_failed"], "only FAQ signals, in priority order");
  assert.deepEqual(read.edges, raw.edges, "only the contract's edges survive");
});

test("parseFaqRelease is null for a release Portal cannot use (keep the last good one)", async () => {
  const raw = await release();
  for (const broken of [null, "x", { ...raw, version: 0 }, { ...raw, version: "3" }, { ...raw, locale: "fr" }, { ...raw, nodes: undefined }, { ...raw, edges: {} }]) assert.equal(parseFaqRelease(broken), null);
  // a choice node never carries blocks, even if sent
  const read = parseFaqRelease({ ...raw, nodes: [{ ...raw.nodes[0], blocks: [{ id: "b1", text: "x" }] }], edges: [] })!;
  assert.deepEqual(read.nodes[0].blocks, []);
});
