import assert from "node:assert/strict";
import { test } from "node:test";
import {
  HELPDESK_LIMITS,
  HelpdeskProblem,
  PROBLEM_STATUS,
  parseAgentActionInput,
  parseAgentListQuery,
  parseAgentMessageInput,
  parseCreateTicketInput,
  parseIdempotencyKey,
  parseLearnerActionInput,
  parseLearnerMessageInput,
  problemBody,
  type UploadInput
} from "../../contracts/helpdesk";

const KEY = "8e03978e-40d5-43e8-bc93-6894a57f9324";
const png: UploadInput = { fileName: "shot.png", declaredType: "image/png", bytes: new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]) };
const valid = { category: "billing", subject: "  Upgrade did not apply  ", body: " I paid but my plan is still Basic. ", locale: "zh-CN" };

function problem(fn: () => unknown, code: string, field?: string) {
  assert.throws(fn, (error: unknown) => {
    assert.ok(error instanceof HelpdeskProblem, String(error));
    assert.equal(error.code, code);
    if (field) assert.equal(error.field, field);
    return true;
  });
}

test("limits live in one place and match the spec", () => {
  assert.equal(HELPDESK_LIMITS.subjectMax, 120);
  assert.equal(HELPDESK_LIMITS.bodyMax, 5000);
  assert.equal(HELPDESK_LIMITS.filesPerMessage, 3);
  assert.equal(HELPDESK_LIMITS.fileMaxBytes, 5 * 1024 * 1024);
});

test("create-ticket input is trimmed, bounded and enum-checked", () => {
  const input = parseCreateTicketInput(valid, [png]);
  assert.deepEqual({ ...input, files: input.files.length }, { category: "billing", subject: "Upgrade did not apply", body: "I paid but my plan is still Basic.", locale: "zh-CN", files: 1 });
  assert.equal(parseCreateTicketInput({ ...valid, subject: "x".repeat(120) }, []).subject.length, 120);
  problem(() => parseCreateTicketInput({ ...valid, subject: "x".repeat(121) }, []), "validation_failed", "subject");
  problem(() => parseCreateTicketInput({ ...valid, subject: "   " }, []), "validation_failed", "subject");
  problem(() => parseCreateTicketInput({ ...valid, body: "" }, []), "validation_failed", "body");
  problem(() => parseCreateTicketInput({ ...valid, body: "y".repeat(5001) }, []), "validation_failed", "body");
  assert.equal(parseCreateTicketInput({ ...valid, body: "y".repeat(5000) }, []).body.length, 5000);
  problem(() => parseCreateTicketInput({ ...valid, category: "refund" }, []), "validation_failed", "category");
  problem(() => parseCreateTicketInput({ ...valid, locale: "fr-FR" }, []), "validation_failed", "locale");
  problem(() => parseCreateTicketInput({ ...valid, subject: 42 }, []), "validation_failed", "subject");
  for (const category of ["account", "billing", "learning", "study_group", "other"]) assert.equal(parseCreateTicketInput({ ...valid, category }, []).category, category);
});

test("attachments: at most 3, each at most 5 MB, never empty", () => {
  assert.equal(parseCreateTicketInput(valid, [png, png, png]).files.length, 3);
  problem(() => parseCreateTicketInput(valid, [png, png, png, png]), "too_many_attachments");
  problem(() => parseCreateTicketInput(valid, [{ ...png, bytes: new Uint8Array(5 * 1024 * 1024 + 1) }]), "attachment_too_large");
  problem(() => parseCreateTicketInput(valid, [{ ...png, bytes: new Uint8Array(0) }]), "validation_failed", "files");
  problem(() => parseLearnerMessageInput({ body: "hi", expectedSequence: "1" }, [png, png, png, png]), "too_many_attachments");
});

test("learner message and action inputs carry an integer expectedSequence", () => {
  assert.deepEqual({ ...parseLearnerMessageInput({ body: " thanks ", expectedSequence: "3" }, []), files: [] }, { body: "thanks", expectedSequence: 3, files: [] });
  problem(() => parseLearnerMessageInput({ body: "thanks" }, []), "validation_failed", "expectedSequence");
  problem(() => parseLearnerMessageInput({ body: "thanks", expectedSequence: "1.5" }, []), "validation_failed", "expectedSequence");
  problem(() => parseLearnerMessageInput({ body: "thanks", expectedSequence: "0" }, []), "validation_failed", "expectedSequence");
  assert.deepEqual(parseLearnerActionInput({ action: "cancel", expectedSequence: 2 }), { action: "cancel", expectedSequence: 2 });
  assert.deepEqual(parseLearnerActionInput({ action: "rate", expectedSequence: 9, rating: 5 }), { action: "rate", expectedSequence: 9, rating: 5 });
  assert.deepEqual(parseLearnerActionInput({ action: "reject", expectedSequence: 4, message: " still broken " }), { action: "reject", expectedSequence: 4, message: "still broken" });
  assert.deepEqual(parseLearnerActionInput({ action: "reject", expectedSequence: 4, message: "  " }), { action: "reject", expectedSequence: 4 });
  for (const rating of [0, 6, 2.5, "5", null]) problem(() => parseLearnerActionInput({ action: "rate", expectedSequence: 1, rating }), "validation_failed", "rating");
  problem(() => parseLearnerActionInput({ action: "claim", expectedSequence: 1 }), "validation_failed", "action");
  problem(() => parseLearnerActionInput({ action: "confirm", expectedSequence: "1" }), "validation_failed", "expectedSequence");
  problem(() => parseLearnerActionInput({ action: "reject", expectedSequence: 1, message: "m".repeat(5001) }), "validation_failed", "message");
  problem(() => parseLearnerActionInput([]), "invalid_request");
});

test("agent inputs require a bounded agent identity", () => {
  const agent = { id: "emp-7", name: "Amy Chan" };
  assert.deepEqual(parseAgentMessageInput({ body: " Looking now ", internal: false, agent, expectedSequence: 1 }), { body: "Looking now", internal: false, agent, expectedSequence: 1 });
  assert.equal(parseAgentMessageInput({ body: "note", internal: true, agent, expectedSequence: 1 }).internal, true);
  problem(() => parseAgentMessageInput({ body: "note", internal: "yes", agent, expectedSequence: 1 }), "validation_failed", "internal");
  problem(() => parseAgentMessageInput({ body: "note", internal: false, expectedSequence: 1 }), "validation_failed", "agent");
  problem(() => parseAgentMessageInput({ body: "note", internal: false, agent: { id: "", name: "A" }, expectedSequence: 1 }), "validation_failed", "agent");
  problem(() => parseAgentMessageInput({ body: "note", internal: false, agent: { id: "a", name: "n".repeat(121) }, expectedSequence: 1 }), "validation_failed", "agent");
  assert.deepEqual(parseAgentActionInput({ action: "claim", agent, expectedSequence: 1 }), { action: "claim", agent, expectedSequence: 1 });
  assert.equal(parseAgentActionInput({ action: "propose_resolution", agent, expectedSequence: 2 }).action, "propose_resolution");
  problem(() => parseAgentActionInput({ action: "confirm", agent, expectedSequence: 1 }), "validation_failed", "action");
});

test("agent list query: status filter, search text, bounded limit, opaque cursor", () => {
  assert.deepEqual(parseAgentListQuery(new URLSearchParams("")), { status: null, q: "", limit: 20, cursor: null });
  const parsed = parseAgentListQuery(new URLSearchParams("status=needs_reply&q=%20LG-261028%20&limit=500"));
  assert.deepEqual(parsed, { status: "needs_reply", q: "LG-261028", limit: 100, cursor: null });
  assert.equal(parseAgentListQuery(new URLSearchParams("status=all")).status, null);
  assert.equal(parseAgentListQuery(new URLSearchParams("status=PENDING_CONFIRM")).status, "PENDING_CONFIRM");
  problem(() => parseAgentListQuery(new URLSearchParams("status=bogus")), "validation_failed", "status");
  problem(() => parseAgentListQuery(new URLSearchParams("limit=0")), "validation_failed", "limit");
  problem(() => parseAgentListQuery(new URLSearchParams("cursor=***")), "validation_failed", "cursor");
  problem(() => parseAgentListQuery(new URLSearchParams(`q=${"q".repeat(121)}`)), "validation_failed", "q");
  const cursor = Buffer.from(JSON.stringify({ updatedAt: "2026-10-28T06:00:00.000Z", id: KEY })).toString("base64url");
  assert.deepEqual(parseAgentListQuery(new URLSearchParams(`cursor=${cursor}`)).cursor, { updatedAt: "2026-10-28T06:00:00.000Z", id: KEY });
});

test("Idempotency-Key: required UUID, bare or as a structured-field string", () => {
  assert.equal(parseIdempotencyKey(KEY), KEY);
  assert.equal(parseIdempotencyKey(`"${KEY.toUpperCase()}"`), KEY);
  problem(() => parseIdempotencyKey(null), "idempotency_key_required");
  problem(() => parseIdempotencyKey("abc"), "idempotency_key_required");
});

test("problem+json body follows RFC 9457 with a stable type URI per code", () => {
  const body = problemBody(new HelpdeskProblem("stale_ticket", "Reload the ticket.", { currentSequence: 4 }));
  assert.deepEqual(body, { type: "https://www.ilovelearningguide.com/problems/stale_ticket", title: "The ticket has changed", status: 409, detail: "Reload the ticket.", code: "stale_ticket", currentSequence: 4 });
  const statuses: Record<string, number> = {
    invalid_request: 400, validation_failed: 400, too_many_attachments: 400, attachment_too_large: 413, attachment_type_unsupported: 415,
    idempotency_key_required: 400, unauthenticated: 401, invalid_token: 401, forbidden_origin: 403, not_found: 404,
    idempotency_conflict: 409, stale_ticket: 409, invalid_transition: 409, reopen_window_passed: 409, rating_window_passed: 409, already_rated: 409,
    integration_disabled: 503, helpdesk_unavailable: 503
  };
  assert.deepEqual(PROBLEM_STATUS, statuses);
});
