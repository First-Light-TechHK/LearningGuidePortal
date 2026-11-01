import assert from "node:assert/strict";
import test from "node:test";
import { HelpdeskProblem } from "@/contracts/helpdesk";
import { problemResponse } from "@/modules/helpdesk/http";

function captureErrors(run: () => void): string[] {
  const lines: string[] = [];
  const original = console.error;
  console.error = (line: unknown) => void lines.push(String(line));
  try {
    run();
  } finally {
    console.error = original;
  }
  return lines;
}

test("an unexpected failure is logged with its error code so ops can tell a missing table from a storage error", async () => {
  const pg = Object.assign(new Error('relation "helpdesk_tickets" does not exist'), { code: "42P01" });
  let response: Response | undefined;
  const lines = captureErrors(() => (response = problemResponse(pg, "tickets.create")));
  assert.equal(response!.status, 503);
  assert.equal((await response!.json()).code, "helpdesk_unavailable");
  assert.deepEqual(JSON.parse(lines[0]), { type: "helpdesk", event: "request_failed", scope: "tickets.create", error: "Error", code: "42P01" });
});

test("the log never carries the error message (it can hold learner text) and leaves code out when there is none", () => {
  const lines = captureErrors(() => problemResponse(new TypeError("learner wrote: my card is 4242"), "tickets.create"));
  assert.deepEqual(JSON.parse(lines[0]), { type: "helpdesk", event: "request_failed", scope: "tickets.create", error: "TypeError" });
  assert.ok(!lines[0].includes("4242"));
  // A non-string code (or an absurdly long one) is not copied either.
  const odd = captureErrors(() => problemResponse(Object.assign(new Error("x"), { code: 42 }), "s"));
  assert.equal(JSON.parse(odd[0]).code, undefined);
  const long = captureErrors(() => problemResponse(Object.assign(new Error("x"), { code: "A".repeat(65) }), "s"));
  assert.equal(JSON.parse(long[0]).code, undefined);
});

test("a known Helpdesk problem is answered as itself and not logged as a failure", () => {
  const lines = captureErrors(() => problemResponse(new HelpdeskProblem("not_found", "No such ticket."), "tickets.get"));
  assert.deepEqual(lines, []);
});
