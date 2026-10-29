// Helpdesk learner pages (addendum §B): the pure helpers the client
// components use, the server-built UI config and the en-GB / zh-CN copy.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { HELPDESK_ATTACHMENT_TYPES, HELPDESK_LIMITS, HelpdeskProblem, STATUS_LABELS, TICKET_CATEGORIES, TICKET_STATUSES, parseCreateTicketInput, isContactEmail, type TicketDetail } from "../../contracts/helpdesk";
import { getMessages } from "../../lib/i18n/messages";
import { helpdeskUiConfig } from "../../modules/helpdesk/learnerUiConfig";
import { assistIdsOf, chatStorageKey, conversationItems, fileSignature, fillTemplate, firstName, formatBytes, initials, isValidEmail, isValidText, linkify, nextFocusIndex, pastedFiles, problemMessageKey, readTranscript, relativeTime, settleTranscript, reloadsTicket, RetryableSubmit, screenFiles, submissionSignature, SubmissionKeys } from "../../modules/helpdesk/learnerUi";

const config = helpdeskUiConfig();

test("UI config mirrors the server contract (limits, categories, accepted types)", () => {
  assert.deepEqual(config.categories, [...TICKET_CATEGORIES]);
  assert.equal(config.limits.maxFiles, HELPDESK_LIMITS.filesPerMessage);
  assert.equal(config.limits.maxFileBytes, HELPDESK_LIMITS.fileMaxBytes);
  assert.equal(config.limits.subjectMax, HELPDESK_LIMITS.subjectMax);
  assert.equal(config.limits.bodyMax, HELPDESK_LIMITS.bodyMax);
  assert.equal(config.limits.emailMax, HELPDESK_LIMITS.contactEmailMax);
  assert.deepEqual([...config.extensions].sort(), ["csv", "docx", "gif", "jpeg", "jpg", "pdf", "png", "txt", "webp", "xlsx"]);
  assert.equal(config.accept, config.extensions.map((extension) => `.${extension}`).join(","));
  assert.equal(HELPDESK_ATTACHMENT_TYPES.length, 9, "a new server type needs a new extension in learnerUiConfig");
  for (const unsafe of ["svg", "html", "htm", "exe", "zip", "js"]) assert.equal(config.extensions.includes(unsafe), false, unsafe);
});

test("the page's text check agrees with the server on every edge: code points, control characters, invisible-only text", () => {
  const emoji = "\u{1F600}";
  const samples = ["Login", "  padded  ", "", "   ", "\u200b", "\ufeff\u2060", emoji.repeat(120), emoji.repeat(121), "x".repeat(120), "x".repeat(121), "中".repeat(120),
    "a\u0000b", "bell\u0007", "tail\u000b", "del\u007f", "c1\u0085", "tab\tand\nnew\r\nline", "\u{1F468}\u200d\u{1F469}"];
  for (const subject of samples) {
    let server = true;
    try { parseCreateTicketInput({ category: "other", subject, body: "b", locale: "en-GB" }, []); } catch (error) { assert.ok(error instanceof HelpdeskProblem); server = false; }
    assert.equal(isValidText(subject, config.limits.subjectMax), server, JSON.stringify(subject));
  }
  assert.equal(isValidText(emoji.repeat(5000), config.limits.bodyMax), true);
  assert.equal(isValidText(emoji.repeat(5001), config.limits.bodyMax), false);
  for (const email of ["emily@example.com", " emily@example.com ", "a@b", "two words@example.com", "a\u0000b@example.com", "a@b.c\nBcc: x@y.z", `${"x".repeat(250)}@example.com`]) {
    assert.equal(isValidEmail(email, config.limits.emailMax), isContactEmail(email.trim()), JSON.stringify(email));
  }
});

test("client file screening mirrors the server: type by extension, 10 MB each, 5 per message", () => {
  const ok = { name: "shot.PNG", size: 1024 };
  const big = { name: "huge.png", size: HELPDESK_LIMITS.fileMaxBytes + 1 };
  const exact = { name: "edge.pdf", size: HELPDESK_LIMITS.fileMaxBytes };
  const svg = { name: "logo.svg", size: 10 };
  const noExtension = { name: "README", size: 10 };
  const result = screenFiles(0, [ok, big, exact, svg, noExtension], config.limits, config.extensions);
  assert.deepEqual(result.accepted, [ok, exact]);
  assert.deepEqual(result.errors, [{ kind: "size", name: "huge.png" }, { kind: "type", name: "logo.svg" }, { kind: "type", name: "README" }]);
  const full = screenFiles(4, [{ name: "a.png", size: 1 }, { name: "b.png", size: 1 }], config.limits, config.extensions);
  assert.equal(full.accepted.length, 1);
  assert.deepEqual(full.errors, [{ kind: "count", name: "b.png" }]);
  assert.deepEqual(screenFiles(0, [{ name: "empty.txt", size: 0 }], config.limits, config.extensions).errors, [{ kind: "type", name: "empty.txt" }]);
});

test("problem responses map to one learner message (401 / 404 / 409 / 413 / 415 / 400 / 422 / 5xx)", () => {
  assert.equal(problemMessageKey(401, "unauthenticated"), "unauthenticated");
  assert.equal(problemMessageKey(404, "not_found"), "notFound");
  assert.equal(problemMessageKey(409, "stale_ticket"), "conflict");
  assert.equal(problemMessageKey(409, "invalid_transition"), "conflict");
  assert.equal(problemMessageKey(409, "reopen_window_passed"), "reopenWindow");
  assert.equal(problemMessageKey(409, "rating_window_passed"), "ratingWindow");
  assert.equal(problemMessageKey(409, "already_rated"), "alreadyRated");
  assert.equal(problemMessageKey(422, "idempotency_conflict"), "invalid");
  assert.equal(problemMessageKey(413, "attachment_too_large"), "tooLarge");
  assert.equal(problemMessageKey(415, "attachment_type_unsupported"), "unsupported");
  assert.equal(problemMessageKey(400, "too_many_attachments"), "tooMany");
  assert.equal(problemMessageKey(400, "validation_failed"), "invalid");
  assert.equal(problemMessageKey(422, undefined), "invalid");
  assert.equal(problemMessageKey(413, undefined), "tooLarge", "a proxy 413 without a problem body");
  assert.equal(problemMessageKey(503, "helpdesk_unavailable"), "unavailable");
  assert.equal(problemMessageKey(0, undefined), "unavailable", "network failure");
  assert.equal(problemMessageKey(429, "rate_limited"), "rateLimited");
  assert.equal(problemMessageKey(429, undefined), "rateLimited", "a proxy 429 without a problem body");
  for (const locale of ["en-GB", "zh-CN"] as const) {
    const errors = getMessages(locale).helpdesk.errors;
    for (const key of ["unauthenticated", "notFound", "conflict", "tooLarge", "unsupported", "tooMany", "invalid", "reopenWindow", "ratingWindow", "alreadyRated", "rateLimited", "unavailable"] as const) assert.ok(errors[key], `${locale} ${key}`);
  }
});

test("one Idempotency-Key per logical submit: reused on retry of the same payload, new when it changes or after success", () => {
  let n = 0;
  const keys = new SubmissionKeys(() => `key-${++n}`);
  const first = keys.keyFor("payload-a");
  assert.equal(keys.keyFor("payload-a"), first, "retry keeps the key");
  const second = keys.keyFor("payload-b");
  assert.notEqual(second, first, "edited payload gets a new key");
  keys.done();
  assert.notEqual(keys.keyFor("payload-b"), second, "a completed submit never reuses its key");
  const file = { name: "a.png", size: 3, lastModified: 7 };
  assert.equal(fileSignature([file]), fileSignature([{ ...file }]));
  assert.notEqual(fileSignature([file]), fileSignature([{ ...file, size: 4 }]));
});

test("a retried submit after a lost response sends the same request: same Idempotency-Key and the same declined suggestion", () => {
  let next = 0;
  const keys = new SubmissionKeys(() => `key-${++next}`);
  const retry = new RetryableSubmit();
  const form = { category: "technical_support", subject: "Password", body: "No reset email", locale: "en-GB", contactEmail: "a@example.com" };
  const files = [{ name: "a.png", size: 3, lastModified: 1 }];
  const signature = submissionSignature(form, files);
  assert.equal(submissionSignature({ ...form, suggestionId: "s-1" }, files), signature, "which suggestion was declined is not part of the signature");
  assert.notEqual(submissionSignature({ ...form, subject: "Other" }, files), signature);
  assert.notEqual(submissionSignature(form, []), signature);
  assert.equal(retry.retryFor(signature), null, "nothing failed yet: ask for a suggestion first");
  const first = keys.keyFor(signature);
  retry.failed(signature, "s-1", 0, ["a-1", "a-2"]);
  assert.deepEqual(retry.retryFor(signature), { suggestionId: "s-1", assistIds: ["a-1", "a-2"] }, "network failure: may have been created, so resend as is, with the same linked chat answers");
  assert.equal(keys.keyFor(signature), first);
  retry.failed(signature, "s-1", 503);
  assert.deepEqual(retry.retryFor(signature), { suggestionId: "s-1", assistIds: [] });
  assert.equal(retry.retryFor(submissionSignature({ ...form, body: "Edited" }, files)), null, "an edited form is a new submit");
  retry.failed(signature, null, 502);
  assert.deepEqual(retry.retryFor(signature), { suggestionId: null, assistIds: [] }, "a direct submit is retried directly too");
  retry.failed(signature, "s-1", 400);
  assert.equal(retry.retryFor(signature), null, "a 4xx is final");
  retry.failed(signature, "s-1", 503);
  retry.clear();
  assert.equal(retry.retryFor(signature), null);
});

test("pasting: files are attached only when no text is being pasted into a text field, and never while the form is busy", () => {
  const shot = [{ name: "image.png" }];
  assert.deepEqual(pastedFiles({ files: shot, plainText: "", intoTextField: false, disabled: false }), shot);
  assert.deepEqual(pastedFiles({ files: shot, plainText: "", intoTextField: true, disabled: false }), shot, "a screenshot pasted into the message still attaches");
  assert.deepEqual(pastedFiles({ files: shot, plainText: "A1\tB1", intoTextField: true, disabled: false }), [], "Excel / Word cells: the text goes into the field");
  assert.deepEqual(pastedFiles({ files: shot, plainText: "", intoTextField: true, disabled: false }), shot, "Chrome 'Copy image' (text/html + the image, no text/plain): the image attaches");
  assert.deepEqual(pastedFiles({ files: shot, plainText: " \n\t", intoTextField: true, disabled: false }), shot, "blank text/plain is no text to paste: the image attaches");
  assert.deepEqual(pastedFiles({ files: shot, plainText: "A1", intoTextField: false, disabled: false }), shot, "not into a text field: the file is what can be pasted");
  assert.deepEqual(pastedFiles({ files: shot, plainText: "", intoTextField: false, disabled: true }), []);
  assert.deepEqual(pastedFiles({ files: [], plainText: "A1", intoTextField: true, disabled: false }), []);
});

test("the assistant modal keeps Tab inside: forward from the last wraps to the first, back from the first wraps to the last, focus outside comes back in", () => {
  assert.equal(nextFocusIndex({ count: 4, active: 3, shift: false }), 0);
  assert.equal(nextFocusIndex({ count: 4, active: 0, shift: true }), 3);
  assert.equal(nextFocusIndex({ count: 4, active: 1, shift: false }), null, "inside the cycle the browser moves focus");
  assert.equal(nextFocusIndex({ count: 4, active: 2, shift: true }), null);
  assert.equal(nextFocusIndex({ count: 4, active: -1, shift: false }), 0, "focus is on the dialog itself or outside it");
  assert.equal(nextFocusIndex({ count: 4, active: -1, shift: true }), 3);
  assert.equal(nextFocusIndex({ count: 1, active: 0, shift: false }), 0);
  assert.equal(nextFocusIndex({ count: 0, active: -1, shift: false }), -1, "nothing focusable: keep focus on the dialog");
});

test("a rejected enquiry action reloads the ticket on every 404 and 409, so stale controls go away", () => {
  for (const code of ["stale_ticket", "invalid_transition", "reopen_window_passed", "rating_window_passed", "already_rated", "not_found", undefined]) {
    assert.equal(reloadsTicket(code === "not_found" ? 404 : 409), true, String(code));
  }
  for (const [status, code] of [[400, "validation_failed"], [413, "attachment_too_large"], [415, "attachment_type_unsupported"], [429, "rate_limited"], [503, "helpdesk_unavailable"], [0, undefined], [401, "unauthenticated"]] as const) {
    assert.equal(reloadsTicket(status), false, `${status} ${code}`);
  }
});

test("names, initials, sizes and templates for the assistant modal", () => {
  assert.equal(initials("Emily Carter", "e@example.com"), "EC");
  assert.equal(initials("  hana  ", "x@example.com"), "H");
  assert.equal(initials("张小明", "x@example.com"), "张");
  assert.equal(initials("", "daniel.wu@example.com"), "D");
  assert.equal(firstName("Emily Carter"), "Emily");
  assert.equal(firstName("   "), null);
  assert.equal(formatBytes(512), "512 B");
  assert.equal(formatBytes(245 * 1024), "245 KB");
  assert.equal(formatBytes(3.5 * 1024 * 1024), "3.5 MB");
  assert.equal(fillTemplate("Hi {name}! {name}", { name: "Emily" }), "Hi Emily! Emily");
  assert.equal(fillTemplate("{n} out of 5", { n: 4 }), "4 out of 5");
});

test("free text in messages: http(s) URLs become links, nothing else is interpreted", () => {
  assert.deepEqual(linkify("See https://www.ilovelearningguide.com/help. Or javascript:alert(1)"), [
    { text: "See " },
    { text: "https://www.ilovelearningguide.com/help", href: "https://www.ilovelearningguide.com/help" },
    { text: ". Or javascript:alert(1)" }
  ]);
});

test("chat transcript: stored per account, read back defensively, and its newest 10 answer ids go with the enquiry", () => {
  assert.equal(chatStorageKey("user_1"), "lg-helpdesk-chat:v1:user_1");
  const id = (n: number) => `01a18100-0000-7000-8000-${String(n).padStart(12, "0")}`;
  const reply = { id: id(1), faqId: id(99), question: "Q?", answer: "A." };
  const stored = JSON.stringify([
    { kind: "question", text: "Q?" },
    { kind: "answer", id: id(1), reply, feedback: "helpful" },
    { kind: "answer", id: id(2), reply: null, feedback: null },
    { kind: "error", error: "rateLimited" },
    { kind: "answer", id: "not-a-uuid", reply: null, feedback: null },
    { kind: "answer", id: id(3), reply: { id: id(3), faqId: 7, question: "x", answer: "y" }, feedback: null },
    { kind: "answer", id: id(4), reply: null, feedback: "solved" },
    { kind: "question", text: 5 },
    "junk"
  ]);
  assert.deepEqual(readTranscript(stored), [
    { kind: "question", text: "Q?" },
    { kind: "answer", id: id(1), reply, feedback: "helpful" },
    { kind: "answer", id: id(2), reply: null, feedback: null },
    { kind: "error", error: "rateLimited" }
  ], "malformed entries are dropped");
  for (const bad of [null, "", "{", "{}", "42"]) assert.deepEqual(readTranscript(bad), []);
  const many = Array.from({ length: 13 }, (_, index) => ({ kind: "answer" as const, id: id(index + 1), reply: null, feedback: null }));
  assert.deepEqual(assistIdsOf([...many, { kind: "answer", id: id(13), reply: null, feedback: null }]), many.slice(3).map((entry) => entry.id), "the newest 10, once each (the server takes at most 10)");
  assert.deepEqual(assistIdsOf([{ kind: "question", text: "x" }]), []);
});

test("relative times read naturally in both locales", () => {
  const now = Date.parse("2026-10-28T10:00:00.000Z");
  assert.equal(relativeTime("2026-10-31T10:00:00.000Z", now, "en-GB"), "in 3 days");
  assert.equal(relativeTime("2026-10-28T09:58:00.000Z", now, "en-GB"), "2 minutes ago");
  assert.equal(relativeTime("2026-10-28T13:00:00.000Z", now, "zh-CN"), "3小时后");
});

test("conversation: messages in order with learner-safe state lines, no message echo events", () => {
  const base = { id: "t", number: "LG-261028-0001", subject: "s", category: "other", status: "PENDING_CONFIRM", createdAt: "2026-10-28T09:00:00.000Z", updatedAt: "2026-10-28T09:03:00.000Z", lastMessageAt: "2026-10-28T09:02:00.000Z", lastMessageBy: "agent", confirmDueAt: null, closedAt: null, sequence: 5, locale: "en-GB", contactEmail: "a@example.com", assigneeName: "Alex", closeReason: null, rating: null, followUpUntil: null } as const;
  const detail: TicketDetail = {
    ...base,
    allowedActions: [],
    messages: [
      { id: "m1", authorKind: "learner", authorName: "Hana", body: "help", createdAt: "2026-10-28T09:00:00.000Z", attachments: [] },
      { id: "m2", authorKind: "agent", authorName: "Alex", body: "done", createdAt: "2026-10-28T09:02:00.000Z", attachments: [] }
    ],
    timeline: [
      { id: "e1", type: "created", time: "2026-10-28T09:00:00.000Z", fromStatus: null, toStatus: "OPEN", actor: { kind: "learner", name: "Hana" } },
      { id: "e2", type: "claimed", time: "2026-10-28T09:01:00.000Z", fromStatus: "OPEN", toStatus: "ASSIGNED", actor: { kind: "agent", name: "Alex" } },
      { id: "e3", type: "agent_replied", time: "2026-10-28T09:02:00.000Z", fromStatus: "ASSIGNED", toStatus: "WAITING_USER", actor: { kind: "agent", name: "Alex" } },
      { id: "e4", type: "resolution_proposed", time: "2026-10-28T09:03:00.000Z", fromStatus: "WAITING_USER", toStatus: "PENDING_CONFIRM", actor: { kind: "agent", name: "Alex" } }
    ]
  };
  assert.deepEqual(conversationItems(detail).map((item) => item.kind === "message" ? `message:${item.message.id}` : `event:${item.event.type}`), ["message:m1", "event:claimed", "message:m2", "event:resolution_proposed"]);
});

test("en-GB and zh-CN copy: same keys, spec status labels, every enquiry type, short confirm wording", async () => {
  const en = getMessages("en-GB").helpdesk, zh = getMessages("zh-CN").helpdesk;
  const keys = (value: unknown, prefix = ""): string[] => value && typeof value === "object" ? Object.entries(value).flatMap(([key, child]) => keys(child, `${prefix}${key}.`)) : [prefix];
  assert.deepEqual(keys(zh).sort(), keys(en).sort());
  for (const status of TICKET_STATUSES) {
    assert.equal(en.status[status], STATUS_LABELS.learner["en-GB"][status]);
    assert.equal(zh.status[status], STATUS_LABELS.learner["zh-CN"][status]);
  }
  for (const category of TICKET_CATEGORIES) assert.ok(en.categories[category] && zh.categories[category], category);
  assert.deepEqual([en.categories.technical_support, en.categories.course_content, en.categories.payments_subscriptions, en.categories.other], ["Technical Support", "Course Content", "Payments & Subscriptions", "Other Enquiries"]);
  assert.deepEqual([en.detail.confirmPrompt, en.detail.confirmYes, en.detail.confirmNo], ["Is it solved?", "Solved", "Not yet"]);
  assert.deepEqual([zh.detail.confirmPrompt, zh.detail.confirmYes, zh.detail.confirmNo], ["问题解决了吗？", "已解决", "没解决"]);
  assert.deepEqual([en.assistant.yes, en.assistant.no, en.assistant.edit], ["Yes, this solved my issue", "No, still submit to support team", "Edit my enquiry"]);
  const nav = await readFile("components/portal/AccountNav.tsx", "utf8");
  assert.match(nav, /\/account\/my-learning\/support`/, "AccountNav Contact support goes to the signed-in support page");
  assert.doesNotMatch(nav, /\/\$\{locale\}\/contact`/);
});

test("a transcript read back after a reload: a trailing unanswered question gets the error bubble", () => {
  const question = { kind: "question" as const, text: "Hello?" };
  assert.deepEqual(settleTranscript([question]), [question, { kind: "error", error: "error" }]);
  const answered = [question, { kind: "answer" as const, id: "01a18100-0000-7000-8000-0000000000a1", reply: null, feedback: null }];
  assert.deepEqual(settleTranscript(answered), answered);
  assert.deepEqual(settleTranscript([]), []);
});
