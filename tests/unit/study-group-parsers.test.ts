// Review B of M1/L2 (2026-11-03): the Study Group body parsers under hostile
// input. Every wrong type is a 400 `validation` StudyGroupError, never a
// value that reaches the service as it came, and never a TypeError.
import assert from "node:assert/strict";
import { test } from "node:test";
import { StudyGroupError } from "../../modules/group-study/domain";
import { parseCreateGroupBody, parseEditGroupBody, parseEditSessionBody, parseScheduleSessionBody } from "../../modules/group-study/parsers";

const PARSERS = { parseCreateGroupBody, parseEditGroupBody, parseScheduleSessionBody, parseEditSessionBody } as const;
const TEXT_FIELDS = { parseCreateGroupBody: ["title", "courseId", "about"], parseEditGroupBody: ["title", "about", "courseId"], parseScheduleSessionBody: ["title", "startsAt", "relatedLessonId", "focus"], parseEditSessionBody: ["groupId", "title", "relatedLessonId", "startsAt", "focus"] } as const;
const NUMBER_FIELDS = { parseCreateGroupBody: [], parseEditGroupBody: [], parseScheduleSessionBody: ["durationSeconds", "maxParticipants"], parseEditSessionBody: ["durationSeconds", "maxParticipants"] } as const;
const BOOLEAN_FIELDS = { parseCreateGroupBody: [], parseEditGroupBody: [], parseScheduleSessionBody: ["aiTutorEnabled"], parseEditSessionBody: ["aiTutorEnabled"] } as const;

const NOT_TEXT: unknown[] = [1, 0, true, false, [], ["a"], {}, { toString: () => "x" }, { length: 3 }, [["nested"]]];
const NOT_NUMBER: unknown[] = [true, false, [], [4], {}, { valueOf: () => 4 }, "four", "4px", "NaN", "Infinity", "-Infinity", "1e400", "١"];
const NOT_BOOLEAN: unknown[] = ["true", "false", "yes", "no", 1, 0, [], [true], {}, "TRUE", " true"];

function validation(run: () => unknown, label: string) {
  assert.throws(run, (error: unknown) => error instanceof StudyGroupError && error.code === "validation", `${label}: expected a validation StudyGroupError`);
}

/** The parsed body as JSON would deliver it (own properties only, Object.prototype intact). */
const json = (value: unknown) => JSON.parse(JSON.stringify(value)) as Record<string, unknown>;

test("parsers: a text field that is not a string is 400 validation, whichever parser and field; absent and null read as empty or absent", () => {
  for (const [name, parse] of Object.entries(PARSERS) as Array<[keyof typeof PARSERS, (body: Record<string, unknown>) => unknown]>) {
    for (const field of TEXT_FIELDS[name]) {
      for (const bad of NOT_TEXT) validation(() => parse({ [field]: bad }), `${name}.${field}=${JSON.stringify(bad)}`);
      assert.doesNotThrow(() => parse({ [field]: null }), `${name}.${field}=null`);
      assert.doesNotThrow(() => parse({}), `${name} with nothing`);
      assert.doesNotThrow(() => parse({ [field]: "" }), `${name}.${field}=""`);
    }
  }
});

test("parsers: a number field takes a number or a numeric string (the forms' shape), null or empty as absent, and refuses everything else", () => {
  for (const [name, parse] of Object.entries(PARSERS) as Array<[keyof typeof PARSERS, (body: Record<string, unknown>) => Record<string, unknown>]>) {
    for (const field of NUMBER_FIELDS[name]) {
      for (const bad of NOT_NUMBER) validation(() => parse({ [field]: bad }), `${name}.${field}=${JSON.stringify(bad)}`);
      assert.equal(parse({ [field]: 1800 })[field], 1800);
      assert.equal(parse({ [field]: "1800" })[field], 1800);
      assert.equal(parse({ [field]: " 4 " })[field], 4, "whitespace around a numeric string is tolerated by Number()");
      assert.equal(parse({ [field]: 4.5 })[field], 4.5, "the range and integer rules are the service's");
      assert.equal(parse({ [field]: -1 })[field], -1);
      assert.equal(parse({ [field]: "0x10" })[field], 16, "Number() syntax: the service's allow-lists decide what is stored");
      assert.equal(parse({ [field]: " " })[field], 0, "Number(' ') is 0, which no allow-list or range of the service accepts");
    }
  }
  assert.ok(Number.isNaN(parseScheduleSessionBody({}).durationSeconds), "schedule: a missing duration is NaN, which the service refuses");
  assert.ok(Number.isNaN(parseScheduleSessionBody({ maxParticipants: null }).maxParticipants));
  assert.ok(Number.isNaN(parseScheduleSessionBody({ maxParticipants: "" }).maxParticipants));
  assert.equal(parseEditSessionBody({}).durationSeconds, undefined, "edit: a missing duration is not a change");
  assert.equal(parseEditSessionBody({ durationSeconds: null }).durationSeconds, undefined);
});

test("parsers: aiTutorEnabled is true, false, null (not sent) or absent; every other value is 400 validation", () => {
  for (const [name, parse] of Object.entries(PARSERS) as Array<[keyof typeof PARSERS, (body: Record<string, unknown>) => Record<string, unknown>]>) {
    for (const field of BOOLEAN_FIELDS[name]) {
      for (const bad of NOT_BOOLEAN) validation(() => parse({ [field]: bad }), `${name}.${field}=${JSON.stringify(bad)}`);
      assert.equal(parse({ [field]: true })[field], true);
      assert.equal(parse({ [field]: false })[field], false);
      assert.equal(parse({ [field]: null })[field], undefined);
      assert.equal(parse({})[field], undefined);
    }
  }
});

test("parsers: huge strings and unicode pass the shape check unchanged (the service applies the length rules), and unknown fields are ignored", () => {
  const huge = "x".repeat(1_000_000);
  const unicode = "直播课 \u{1F600} \u0000 ﻿ ﷽";
  assert.equal(parseCreateGroupBody({ title: huge, courseId: unicode, about: "" }).title.length, 1_000_000);
  assert.equal(parseCreateGroupBody({ title: huge, courseId: unicode, about: "" }).courseId, unicode);
  assert.deepEqual(parseScheduleSessionBody({ title: unicode, startsAt: unicode, focus: unicode, relatedLessonId: unicode, durationSeconds: 1800, maxParticipants: 4, extra: { deep: [1, 2] }, hostUserId: "attacker", status: "live" }), {
    title: unicode, startsAt: unicode, durationSeconds: 1800, maxParticipants: 4, relatedLessonId: unicode, focus: unicode, aiTutorEnabled: undefined
  });
  assert.deepEqual(Object.keys(parseEditSessionBody({ id: "x", groupId: "g", liveKitProjectId: "p" })), ["groupId", "title", "relatedLessonId", "startsAt", "durationSeconds", "maxParticipants", "focus", "aiTutorEnabled"], "only the known fields come out");
});

test("parsers: prototype-named keys in the JSON body are plain data and never reach the prototype chain", () => {
  const body = json({ __proto__: { title: "from proto" }, constructor: "c", hasOwnProperty: "h", toString: "t", title: "real" });
  assert.equal(parseCreateGroupBody(body).title, "real");
  assert.equal(parseCreateGroupBody(json({ __proto__: { title: "from proto" } })).title, "", "a __proto__ key does not set the prototype");
  assert.equal(({} as Record<string, unknown>).title, undefined, "Object.prototype was not polluted");
  // A body whose fields are missing never reads Object.prototype members as values: no parser field shares a name with one.
  assert.deepEqual(parseEditGroupBody({}), { title: "", about: "", courseId: undefined });
  assert.deepEqual(parseEditSessionBody(Object.create(null) as Record<string, unknown>).title, undefined);
});

test("parsers: edit bodies keep the difference between 'not sent' and 'set to empty' for the fields the service compares", () => {
  assert.deepEqual(parseEditGroupBody({ title: "T", about: "A" }), { title: "T", about: "A", courseId: undefined });
  assert.deepEqual(parseEditGroupBody({ title: "T", about: "A", courseId: null }), { title: "T", about: "A", courseId: undefined }, "null course reads as absent (nothing to compare)");
  assert.equal(parseEditGroupBody({ title: "T", about: "A", courseId: "other" }).courseId, "other", "the service refuses a changed course (409 conflict)");
  const edit = parseEditSessionBody({ groupId: "g", title: null, startsAt: null, focus: null, relatedLessonId: null, aiTutorEnabled: null });
  assert.equal(edit.title, undefined);
  assert.equal(edit.startsAt, undefined);
  assert.equal(edit.aiTutorEnabled, undefined);
  // Documented here because it differs from the `null reads as absent` rule above: a null focus or lesson on edit is
  // "clear it", which the service treats as a change other than the Start Time (403 session_time_only when it differs).
  assert.equal(edit.focus, null);
  assert.equal(edit.relatedLessonId, null);
});
