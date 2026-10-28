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
  parseSuggestInput,
  parseSuggestionOutcome,
  problemBody,
  isContactEmail,
  HELPDESK_ATTACHMENT_TYPES,
  TICKET_CATEGORIES,
  type UploadInput
} from "../../contracts/helpdesk";

const KEY = "8e03978e-40d5-43e8-bc93-6894a57f9324";
const png: UploadInput = { fileName: "shot.png", declaredType: "image/png", bytes: new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]) };
const valid = { category: "payments_subscriptions", subject: "  Upgrade did not apply  ", body: " I paid but my plan is still Basic. ", locale: "zh-CN" };

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
  assert.equal(HELPDESK_LIMITS.filesPerMessage, 5);
  assert.equal(HELPDESK_LIMITS.fileMaxBytes, 10 * 1024 * 1024);
  assert.equal(HELPDESK_LIMITS.contactEmailMax, 254);
  assert.equal(HELPDESK_LIMITS.tagMax, 32);
  assert.equal(HELPDESK_LIMITS.tagsPerTicket, 10);
  assert.equal(HELPDESK_LIMITS.previewMax, 120);
});

test("addendum: the four Figma enquiry types replace the old categories; nine attachment types, never html or svg", () => {
  assert.deepEqual([...TICKET_CATEGORIES], ["technical_support", "course_content", "payments_subscriptions", "other"]);
  assert.deepEqual([...HELPDESK_ATTACHMENT_TYPES], [
    "image/png", "image/jpeg", "image/webp", "image/gif", "application/pdf", "text/plain", "text/csv",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
  ]);
  assert.ok(!HELPDESK_ATTACHMENT_TYPES.some((type) => /html|svg|javascript|^(?:text|application)\/xml$/.test(type)));
});

test("create-ticket input is trimmed, bounded and enum-checked", () => {
  const input = parseCreateTicketInput(valid, [png]);
  assert.deepEqual({ ...input, files: input.files.length }, { category: "payments_subscriptions", subject: "Upgrade did not apply", body: "I paid but my plan is still Basic.", locale: "zh-CN", contactEmail: null, suggestionId: null, files: 1 });
  assert.equal(parseCreateTicketInput({ ...valid, subject: "x".repeat(120) }, []).subject.length, 120);
  problem(() => parseCreateTicketInput({ ...valid, subject: "x".repeat(121) }, []), "validation_failed", "subject");
  problem(() => parseCreateTicketInput({ ...valid, subject: "   " }, []), "validation_failed", "subject");
  problem(() => parseCreateTicketInput({ ...valid, body: "" }, []), "validation_failed", "body");
  problem(() => parseCreateTicketInput({ ...valid, body: "y".repeat(5001) }, []), "validation_failed", "body");
  assert.equal(parseCreateTicketInput({ ...valid, body: "y".repeat(5000) }, []).body.length, 5000);
  problem(() => parseCreateTicketInput({ ...valid, category: "refund" }, []), "validation_failed", "category");
  problem(() => parseCreateTicketInput({ ...valid, locale: "fr-FR" }, []), "validation_failed", "locale");
  problem(() => parseCreateTicketInput({ ...valid, subject: 42 }, []), "validation_failed", "subject");
  for (const category of ["technical_support", "course_content", "payments_subscriptions", "other"]) assert.equal(parseCreateTicketInput({ ...valid, category }, []).category, category);
  for (const category of ["account", "billing", "learning", "study_group"]) problem(() => parseCreateTicketInput({ ...valid, category }, []), "validation_failed", "category");
});

test("create-ticket input: optional contact email (validated, trimmed) and optional suggestion id (UUID)", () => {
  const suggestionId = "0192d4f0-7b6a-7c3e-9a10-1234567890ab";
  const input = parseCreateTicketInput({ ...valid, contactEmail: "  Emily.Carter@Example.com ", suggestionId }, []);
  assert.equal(input.contactEmail, "Emily.Carter@Example.com");
  assert.equal(input.suggestionId, suggestionId);
  assert.equal(parseCreateTicketInput({ ...valid, contactEmail: "   " }, []).contactEmail, null, "blank means: use the account email");
  assert.equal(parseCreateTicketInput({ ...valid, suggestionId: "" }, []).suggestionId, null);
  for (const contactEmail of ["not-an-email", "a@b", "two words@example.com", `${"x".repeat(250)}@example.com`, "a@b.c\nBcc: x@y.z"]) problem(() => parseCreateTicketInput({ ...valid, contactEmail }, []), "validation_failed", "contactEmail");
  problem(() => parseCreateTicketInput({ ...valid, contactEmail: 7 }, []), "validation_failed", "contactEmail");
  problem(() => parseCreateTicketInput({ ...valid, suggestionId: "abc" }, []), "validation_failed", "suggestionId");
});

test("attachments: at most 5, each at most 10 MB, never empty", () => {
  assert.equal(parseCreateTicketInput(valid, [png, png, png, png, png]).files.length, 5);
  problem(() => parseCreateTicketInput(valid, [png, png, png, png, png, png]), "too_many_attachments");
  assert.equal(parseCreateTicketInput(valid, [{ ...png, bytes: new Uint8Array(10 * 1024 * 1024) }]).files.length, 1);
  problem(() => parseCreateTicketInput(valid, [{ ...png, bytes: new Uint8Array(10 * 1024 * 1024 + 1) }]), "attachment_too_large");
  problem(() => parseCreateTicketInput(valid, [{ ...png, bytes: new Uint8Array(0) }]), "validation_failed", "files");
  problem(() => parseLearnerMessageInput({ body: "hi", expectedSequence: "1" }, [png, png, png, png, png, png]), "too_many_attachments");
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
  problem(() => parseAgentActionInput({ action: "claim", agent }), "validation_failed", "expectedSequence");
});

test("agent tag and mark_read actions: tag normalised (trim, collapse spaces, lower case, <= 32), expectedSequence optional", () => {
  const agent = { id: "emp-7", name: "Amy Chan" };
  assert.deepEqual(parseAgentActionInput({ action: "add_tag", agent, tag: "  Login   Issue " }), { action: "add_tag", agent, expectedSequence: null, tag: "login issue" });
  assert.deepEqual(parseAgentActionInput({ action: "remove_tag", agent, tag: "payment", expectedSequence: 4 }), { action: "remove_tag", agent, expectedSequence: 4, tag: "payment" });
  assert.deepEqual(parseAgentActionInput({ action: "mark_read", agent }), { action: "mark_read", agent, expectedSequence: null });
  assert.equal(parseAgentActionInput({ action: "add_tag", agent, tag: "t".repeat(32) }).tag?.length, 32);
  for (const tag of ["", "   ", "t".repeat(33), 5, null]) problem(() => parseAgentActionInput({ action: "add_tag", agent, tag }), "validation_failed", "tag");
  problem(() => parseAgentActionInput({ action: "remove_tag", agent }), "validation_failed", "tag");
  problem(() => parseAgentActionInput({ action: "mark_read" }), "validation_failed", "agent");
  problem(() => parseAgentActionInput({ action: "add_tag", agent, tag: "x", expectedSequence: "2" }), "validation_failed", "expectedSequence");
});

test("suggestion inputs: same bounds as a ticket; outcome is solved | declined | edited", () => {
  assert.deepEqual(parseSuggestInput({ category: "technical_support", subject: " Cannot log in ", message: " It says invalid password ", locale: "en-GB" }), { category: "technical_support", subject: "Cannot log in", message: "It says invalid password", locale: "en-GB" });
  problem(() => parseSuggestInput({ category: "billing", subject: "s", message: "m", locale: "en-GB" }), "validation_failed", "category");
  problem(() => parseSuggestInput({ category: "other", subject: "s".repeat(121), message: "m", locale: "en-GB" }), "validation_failed", "subject");
  problem(() => parseSuggestInput({ category: "other", subject: "s", message: "", locale: "en-GB" }), "validation_failed", "message");
  problem(() => parseSuggestInput({ category: "other", subject: "s", message: "m", locale: "de-DE" }), "validation_failed", "locale");
  problem(() => parseSuggestInput("x"), "invalid_request");
  for (const outcome of ["solved", "declined", "edited"]) assert.equal(parseSuggestionOutcome({ outcome }), outcome);
  problem(() => parseSuggestionOutcome({ outcome: "maybe" }), "validation_failed", "outcome");
});

test("agent list query: status filter, search text, bounded limit, opaque cursor", () => {
  assert.deepEqual(parseAgentListQuery(new URLSearchParams("")), { status: null, q: "", limit: 20, cursor: null, category: null, tag: null });
  const parsed = parseAgentListQuery(new URLSearchParams("status=needs_reply&q=%20LG-261028%20&limit=500"));
  assert.deepEqual(parsed, { status: "needs_reply", q: "LG-261028", limit: 100, cursor: null, category: null, tag: null });
  const filtered = parseAgentListQuery(new URLSearchParams("category=technical_support&tag=%20Login%20Issue"));
  assert.equal(filtered.category, "technical_support");
  assert.equal(filtered.tag, "login issue");
  problem(() => parseAgentListQuery(new URLSearchParams("category=billing")), "validation_failed", "category");
  problem(() => parseAgentListQuery(new URLSearchParams(`tag=${"t".repeat(33)}`)), "validation_failed", "tag");
  assert.equal(parseAgentListQuery(new URLSearchParams("status=all")).status, null);
  assert.equal(parseAgentListQuery(new URLSearchParams("status=PENDING_CONFIRM")).status, "PENDING_CONFIRM");
  problem(() => parseAgentListQuery(new URLSearchParams("status=bogus")), "validation_failed", "status");
  problem(() => parseAgentListQuery(new URLSearchParams("limit=0")), "validation_failed", "limit");
  problem(() => parseAgentListQuery(new URLSearchParams("cursor=***")), "validation_failed", "cursor");
  problem(() => parseAgentListQuery(new URLSearchParams(`q=${"q".repeat(121)}`)), "validation_failed", "q");
  const cursor = Buffer.from(JSON.stringify({ updatedAt: "2026-10-28T06:00:00.000Z", id: KEY })).toString("base64url");
  assert.deepEqual(parseAgentListQuery(new URLSearchParams(`cursor=${cursor}`)).cursor, { updatedAt: "2026-10-28T06:00:00.000Z", id: KEY });
});

test("control characters (other than tab, line feed and carriage return) are refused with 400 in every parsed text field", () => {
  const agent = { id: "emp-7", name: "Amy Chan" };
  for (const bad of ["x\u0000y", "bell\u0007", "esc\u001b[0m", "del\u007f", "form\u000cfeed", "vt\u000b", "c1\u0085"]) {
    problem(() => parseCreateTicketInput({ ...valid, subject: bad }, []), "validation_failed", "subject");
    problem(() => parseCreateTicketInput({ ...valid, body: bad }, []), "validation_failed", "body");
    problem(() => parseLearnerMessageInput({ body: bad, expectedSequence: "1" }, []), "validation_failed", "body");
    problem(() => parseLearnerActionInput({ action: "reject", expectedSequence: 1, message: bad }), "validation_failed", "message");
    problem(() => parseAgentMessageInput({ body: bad, internal: false, agent, expectedSequence: 1 }), "validation_failed", "body");
    problem(() => parseAgentMessageInput({ body: "ok", internal: true, agent: { id: "emp-7", name: bad }, expectedSequence: 1 }), "validation_failed", "agent");
    problem(() => parseAgentActionInput({ action: "claim", agent: { id: bad, name: "Amy" }, expectedSequence: 1 }), "validation_failed", "agent");
    problem(() => parseSuggestInput({ category: "other", subject: bad, message: "m", locale: "en-GB" }), "validation_failed", "subject");
    problem(() => parseSuggestInput({ category: "other", subject: "s", message: bad, locale: "en-GB" }), "validation_failed", "message");
    problem(() => parseAgentListQuery(new URLSearchParams({ q: bad })), "validation_failed", "q");
    problem(() => parseCreateTicketInput({ ...valid, contactEmail: `a${bad.replace(/[^\u0000-\u001f\u007f-\u009f]/g, "")}b@example.com` }, []), "validation_failed", "contactEmail");
  }
  assert.equal(isContactEmail("a\u0000b@example.com"), false);
  const multiline = "Line 1\r\nLine 2\n\tindented";
  assert.equal(parseCreateTicketInput({ ...valid, body: multiline }, []).body, multiline);
  assert.equal(parseLearnerMessageInput({ body: multiline, expectedSequence: "2" }, []).body, multiline);
});

test("text limits count Unicode code points (as PostgreSQL char_length does); invisible-only text is empty", () => {
  const emoji = "\u{1F600}";
  assert.equal(parseCreateTicketInput({ ...valid, subject: emoji.repeat(120) }, []).subject, emoji.repeat(120));
  problem(() => parseCreateTicketInput({ ...valid, subject: emoji.repeat(121) }, []), "validation_failed", "subject");
  assert.equal(parseCreateTicketInput({ ...valid, body: "中".repeat(4999) + emoji }, []).body.length, 5001, "5000 code points in 5001 UTF-16 units");
  problem(() => parseCreateTicketInput({ ...valid, body: emoji.repeat(5001) }, []), "validation_failed", "body");
  assert.equal(parseLearnerActionInput({ action: "reject", expectedSequence: 1, message: emoji.repeat(5000) }).message, emoji.repeat(5000));
  problem(() => parseLearnerActionInput({ action: "reject", expectedSequence: 1, message: emoji.repeat(5001) }), "validation_failed", "message");
  assert.equal(parseAgentListQuery(new URLSearchParams({ q: emoji.repeat(120) })).q, emoji.repeat(120));
  problem(() => parseAgentListQuery(new URLSearchParams({ q: emoji.repeat(121) })), "validation_failed", "q");
  assert.equal(parseAgentMessageInput({ body: "ok", internal: true, agent: { id: "emp", name: emoji.repeat(120) }, expectedSequence: 1 }).agent.name, emoji.repeat(120));
  for (const blank of ["\u200b", " \u200b\u200c\u200d ", "\u2060", "\ufeff"]) {
    problem(() => parseCreateTicketInput({ ...valid, subject: blank }, []), "validation_failed", "subject");
    problem(() => parseLearnerMessageInput({ body: blank, expectedSequence: "1" }, []), "validation_failed", "body");
  }
  assert.equal(parseCreateTicketInput({ ...valid, subject: "\u{1F468}\u200d\u{1F469}" }, []).subject, "\u{1F468}\u200d\u{1F469}", "a joined emoji is visible text");
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
    tag_limit_reached: 409, integration_disabled: 503, helpdesk_unavailable: 503, assistant_unavailable: 503
  };
  assert.deepEqual(PROBLEM_STATUS, statuses);
});
