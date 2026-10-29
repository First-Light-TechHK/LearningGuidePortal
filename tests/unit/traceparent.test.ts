// W3C Trace Context Level 1 (§3.2) traceparent on every Portal -> Admin
// Helpdesk call: a valid incoming header is continued (same trace id and
// flags, a new span of ours); a missing or invalid one starts a new trace.
// We always send version 00.
import assert from "node:assert/strict";
import { test } from "node:test";
import { outgoingTraceparent, parseTraceparent } from "../../lib/traceparent";

const TRACE = "4bf92f3577b34da6a3ce929d0e0e4736";
const PARENT = "00f067aa0ba902b7";
const SHAPE = /^00-[0-9a-f]{32}-[0-9a-f]{16}-[0-9a-f]{2}$/;

test("traceparent: parses the spec example and future versions", () => {
  assert.deepEqual(parseTraceparent(`00-${TRACE}-${PARENT}-01`), { traceId: TRACE, parentId: PARENT, flags: "01" });
  assert.deepEqual(parseTraceparent(`cc-${TRACE}-${PARENT}-09-later`), { traceId: TRACE, parentId: PARENT, flags: "09" });
  assert.equal(parseTraceparent(` 00-${TRACE}-${PARENT}-01 `)?.traceId, TRACE);
});

test("traceparent: rejects what the spec says to ignore", () => {
  for (const value of [
    undefined, null, "", 42,
    `ff-${TRACE}-${PARENT}-01`,
    `00-${TRACE.toUpperCase()}-${PARENT}-01`,
    `00-${"0".repeat(32)}-${PARENT}-01`,
    `00-${TRACE}-${"0".repeat(16)}-01`,
    `00-${TRACE.slice(1)}-${PARENT}-01`,
    `00-${TRACE}-${PARENT}-01-extra`,
    `cc-${TRACE}-${PARENT}-01x`,
    `00-${TRACE}-${PARENT}-0g`,
    `00-${TRACE}-${PARENT}-01, 00-${TRACE}-${PARENT}-01`
  ]) assert.equal(parseTraceparent(value), null, String(value));
});

test("traceparent: continues a valid incoming trace with a new span each call", () => {
  const one = outgoingTraceparent(`cc-${TRACE}-${PARENT}-01-later`);
  const two = outgoingTraceparent(`00-${TRACE}-${PARENT}-01`);
  for (const value of [one, two]) {
    assert.match(value, SHAPE);
    const parsed = parseTraceparent(value)!;
    assert.equal(parsed.traceId, TRACE);
    assert.equal(parsed.flags, "01");
    assert.notEqual(parsed.parentId, PARENT);
  }
  assert.notEqual(one, two);
});

test("traceparent: starts a new trace when there is none or it is invalid", () => {
  const fresh = [outgoingTraceparent(), outgoingTraceparent(null), outgoingTraceparent(`ff-${TRACE}-${PARENT}-01`)];
  for (const value of fresh) {
    assert.match(value, SHAPE);
    assert.ok(parseTraceparent(value), "what we send is valid");
    assert.notEqual(parseTraceparent(value)!.traceId, TRACE);
    assert.equal(parseTraceparent(value)!.flags, "00");
  }
  assert.notEqual(parseTraceparent(fresh[0])!.traceId, parseTraceparent(fresh[1])!.traceId);
});
