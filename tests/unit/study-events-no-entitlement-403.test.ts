import assert from "node:assert/strict";
import { test } from "node:test";
import { studyEventHttpStatus } from "../../lib/studyEventHttpStatus";

// Review corner (no new BugID): handbook wants 403 when signed-in study/events
// has no entitlement; the route currently collapses that to 400.

test("review corner: study/events without entitlement is 403", () => {
  assert.equal(studyEventHttpStatus(new Error("Course access is required.")), 403);
});

test("review corner: other study event errors stay 400", () => {
  assert.equal(studyEventHttpStatus(new Error("Lesson not found.")), 400);
  assert.equal(studyEventHttpStatus(new Error("A client event id is required.")), 400);
});
