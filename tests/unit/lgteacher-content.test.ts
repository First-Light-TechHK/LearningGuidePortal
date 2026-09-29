import assert from "node:assert/strict";
import { test } from "node:test";
import type { LessonContent, LessonNode } from "../../contracts/lesson-content";
import { LESSON_CONTENT_LIMITS as LIMITS } from "../../contracts/lesson-content";
import { courseMediaAssetId, LessonContentError, lessonContentAssetIds, lessonContentsText, sanitiseLessonContents, sanitiseRichHtml, validateLessonContents } from "../../services/lessonContent";
import { applyCourseDraft, AuthoringError } from "../../services/courseAuthoring";
import type { ProductCourse } from "../../services/productStore";
import type { CourseDraftInput } from "../../contracts/course-authoring";

const courseId = "lgteacher-course";
const assetId = "11111111-1111-4111-8111-111111111111";
const media = `/api/course-media/${courseId}/${assetId}`;
const fixture = (): LessonContent[] => [{
  id: "text-group", title: "Structured lesson", type: "text", mode: "interactive",
  html: '<h2>Saved heading</h2><p><strong>Bold</strong> and <em>emphasis</em> <a data-node-id="quiz-node">Question</a></p><table><tbody><tr><td>Cell</td></tr></tbody></table>',
  nodes: [
    { id: "text-node", title: "Explanation", type: "text", triggerTime: 0, html: "<p>Supporting text</p>" },
    { id: "quiz-node", title: "Question", type: "exercise", triggerTime: 1, question: "Which is correct?", options: ["Incorrect", "Correct"], correctOptions: [1] },
    { id: "image-node", title: "Image", type: "image", triggerTime: 2, url: media },
    { id: "video-node", title: "Clip", type: "video", triggerTime: 3, url: media },
  ],
}, { id: "video-group", title: "Video lesson", type: "video", mode: "lecture", url: media, nodes: [] }];

test("LGTeacher: structured groups, all node fields and safe rich references survive JSON round trips", () => {
  const input = fixture();
  const snapshot = structuredClone(input);
  const first = validateLessonContents(input, courseId);
  const restored = validateLessonContents(JSON.parse(JSON.stringify(first)), courseId);
  assert.deepEqual(restored, first);
  assert.deepEqual(input, snapshot, "validation must not mutate client input");
  assert.deepEqual(restored.map(item => item.id), ["text-group", "video-group"]);
  assert.deepEqual(restored[0].nodes, snapshot[0].nodes.map(node => ({ ...node, active: true })));
  assert.match(restored[0].html!, /data-node-id="quiz-node"/);
  assert.match(restored[0].html!, /href="#node-quiz-node"/);
  assert.match(restored[0].html!, /<strong>Bold<\/strong>/);
  assert.match(restored[0].html!, /<td>Cell<\/td>/);
});

test("LGTeacher: HTML sanitisation removes executable markup, unsafe CSS and forged references", () => {
  const attacks = [
    '<script>window.__lgteacherXss=1</script><p onclick="window.__lgteacherXss=1">Keep me</p>',
    '<svg onload="window.__lgteacherXss=1"><script>alert(1)</script></svg><iframe srcdoc="<script>alert(1)</script>"></iframe>',
    '<a href="jav&#x61;script:alert(1)">Unsafe</a><a href="data:text/html,test">Data</a>',
    '<p style="position:fixed;background-image:url(javascript:alert(1));text-align:center">Safe alignment</p>',
    '<span data-instance-type="1" data-instance-content="&lt;img onerror=alert(1)&gt;">Legacy instance</span>',
    '<a data-node-id="foreign-node" href="javascript:alert(1)">Forged instance</a>',
    '<math><mtext><img src=x onerror=alert(1)></mtext></math>',
  ];
  for (const attack of attacks) {
    const safe = sanitiseRichHtml(attack, courseId, ["quiz-node"]);
    assert.doesNotMatch(safe, /<script|<iframe|<svg|<math|\bon\w+\s*=|javascript:|data:text|srcdoc|position:|background-image|data-instance-content|data-node-id="foreign-node"/i, attack);
    assert.equal(sanitiseRichHtml(safe, courseId, ["quiz-node"]), safe, "sanitisation is idempotent");
  }
  assert.match(sanitiseRichHtml(attacks[0], courseId), /Keep me/);
  assert.match(sanitiseRichHtml(attacks[3], courseId), /text-align:center/);
});

test("LGTeacher: course-scoped media parser rejects alternate origins, encodings and traversal", () => {
  assert.equal(courseMediaAssetId(media, courseId), assetId);
  for (const unsafe of [
    media.replace(courseId, "foreign-course"), `https://example.test${media}`, `//example.test${media}`,
    `${media}?download=1`, `${media}#fragment`, media.replace(assetId, "../secret"),
    media.replace(courseId, encodeURIComponent(`${courseId}/..`)), media.replace("/api/", "/%61pi/"),
    media.replace(assetId, "%31" + assetId.slice(1)), `\\example.test${media}`, "javascript:alert(1)",
  ]) assert.equal(courseMediaAssetId(unsafe, courseId), null, unsafe);
  const safe = sanitiseRichHtml(`<img src="${media}" alt="Owned"><img src="${media.replace(courseId, "foreign-course")}" alt="Foreign">`, courseId);
  assert.match(safe, /alt="Owned"/);
  assert.doesNotMatch(safe, /Foreign|foreign-course/);
});

test("LGTeacher: foreign media in groups or nodes is rejected instead of silently persisted", () => {
  for (const target of ["group", "node"] as const) {
    const input = fixture();
    if (target === "group") input[1].url = media.replace(courseId, "foreign-course");
    else input[0].nodes[2].url = media.replace(courseId, "foreign-course");
    assert.throws(() => validateLessonContents(input, courseId), LessonContentError);
    assert.deepEqual(sanitiseLessonContents(input, courseId), [], "invalid historical payloads fail closed");
  }
});

test("LGTeacher: duplicate IDs, invalid triggers, malformed quizzes and excessive groups fail validation", () => {
  const mutations: Array<(input: LessonContent[]) => void> = [
    input => { input[1].id = input[0].id; },
    input => { input[0].nodes[0].id = input[0].id; },
    input => { input[0].nodes[1].id = input[0].nodes[0].id; },
    input => { input[0].nodes[0].triggerTime = -1; },
    input => { input[0].nodes[0].triggerTime = NaN; },
    input => { input[0].nodes[0].triggerTime = Infinity; },
    input => { input[0].nodes[0].triggerTime = LIMITS.triggerSeconds + 1; },
    input => { input[0].nodes[1].correctOptions = [2]; },
    input => { input[0].nodes[1].correctOptions = [1, 1]; },
    input => { input[0].nodes[1].correctOptions = []; },
    input => { input[0].nodes[1].options = ["Same", "same"]; },
    input => { input[0].nodes[1].question = " "; },
    input => { input[0].nodes[0].answer = "Wrong node type"; },
    input => { input[0].title = "x".repeat(LIMITS.titleCharacters + 1); },
    input => { input[0].html = "x".repeat(LIMITS.htmlCharacters + 1); },
    input => { input[0].nodes = Array.from({ length: LIMITS.nodesPerContent + 1 }, (_, i) => ({ ...input[0].nodes[0], id: `n-${i}` })); },
  ];
  for (const mutate of mutations) {
    const input = fixture(); mutate(input);
    assert.throws(() => validateLessonContents(input, courseId), LessonContentError, mutate.toString());
  }
  assert.throws(() => validateLessonContents(Array.from({ length: LIMITS.contents + 1 }, (_, i) => ({ ...fixture()[0], id: `g-${i}`, nodes: [] })), courseId), LessonContentError);
});

test("LGTeacher: fill-in, audio, OBJ and PDF use the explicit integrated contract", () => {
  const nodes: LessonNode[] = [
    { id: "fill-in", title: "Fill in", type: "exercise", triggerTime: 0, question: "Two plus two?", answer: "4" },
    { id: "audio", title: "Audio", type: "audio", triggerTime: 1, url: media },
    { id: "obj", title: "Model", type: "model3d", triggerTime: 2, url: media },
  ];
  const result = validateLessonContents([{ id: "pdf", title: "PDF", type: "pdf", mode: "lecture", url: media, nodes }], courseId);
  assert.deepEqual(result[0].nodes, nodes.map(node => ({ ...node, active: true })));
  assert.equal(result[0].type, "pdf");
});

test("LGTeacher: reference extraction excludes discarded HTML and text extraction excludes quiz answers", () => {
  const input = fixture();
  input[0].html += `<img src="${media}"><script>"/api/course-media/${courseId}/22222222-2222-4222-8222-222222222222"</script>`;
  assert.deepEqual([...lessonContentAssetIds(input, courseId)], [assetId]);
  const text = lessonContentsText(validateLessonContents(input, courseId));
  assert.match(text, /Which is correct\?/);
  assert.match(text, /Supporting text/);
  assert.doesNotMatch(text, /<strong>|<script>|correctOptions/);
});

test("LGTeacher: checked task lists and embedded instance references retain their structure", () => {
  const input = fixture();
  input[0].html = '<ul data-type="taskList"><li data-type="taskItem" data-checked="true"><label><input type="checkbox" checked="checked"><span></span></label><div><p>Completed task <span data-node-id="quiz-node">Inline quiz</span></p></div></li></ul>';
  const first = validateLessonContents(input, courseId);
  const restored = validateLessonContents(JSON.parse(JSON.stringify(first)), courseId);
  assert.equal(restored[0].html, first[0].html);
  assert.match(restored[0].html!, /data-type="taskList"/);
  assert.match(restored[0].html!, /data-type="taskItem"/);
  assert.match(restored[0].html!, /data-checked="true"/);
  assert.match(restored[0].html!, /type="checkbox"[^>]*checked/);
  assert.match(restored[0].html!, /data-node-id="quiz-node"/);
  assert.doesNotMatch(restored[0].html!, /<script|onchange=/);
});

test("LGTeacher: inactive content is retained by authoring but withheld from learner rendering", () => {
  const input = fixture();
  input[1].active = false;
  input[0].nodes[1].active = false;
  const authored = validateLessonContents(input, courseId);
  assert.equal(authored[1].active, false);
  assert.equal(authored[0].nodes[1].active, false);
  const playable = sanitiseLessonContents(JSON.parse(JSON.stringify(authored)), courseId);
  assert.deepEqual(playable.map(content => content.id), ["text-group"]);
  assert.equal(playable[0].nodes.some(node => node.id === "quiz-node"), false);
  assert.doesNotMatch(playable[0].html!, /data-node-id="quiz-node"/);
});

const course = (): ProductCourse => ({
  id: courseId, slug: "lgteacher-course", title: "Course", description: "", status: "draft",
  createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z",
  sections: [{ id: "section-1", title: "Section", lessons: [{ id: "lesson-1", title: "Lesson", body: "Legacy", durationMinutes: 10, isPublic: true, contents: fixture() }] }],
});
const draft = (value: ProductCourse): CourseDraftInput => ({ expectedUpdatedAt: value.updatedAt, title: value.title, description: value.description, sections: structuredClone(value.sections) });

test("LGTeacher: legacy outline saves cannot flatten structured content; stale writes preserve the winner", () => {
  const original = course(), input = draft(original);
  delete input.sections[0].lessons[0].contents;
  input.sections[0].lessons[0].body = "Outdated plain text";
  const saved = applyCourseDraft(original, input);
  assert.deepEqual(saved.sections[0].lessons[0].contents, original.sections[0].lessons[0].contents);
  assert.notEqual(saved.sections[0].lessons[0].body, "Outdated plain text");
  const snapshot = structuredClone(saved);
  assert.throws(() => applyCourseDraft(saved, input), error => error instanceof AuthoringError && error.code === "conflict");
  assert.deepEqual(saved, snapshot);
});

test("LGTeacher: explicit lesson removal archives its original content and identity", () => {
  const original = course(), input = draft(original);
  input.sections[0].lessons = [];
  assert.throws(() => applyCourseDraft(original, input), AuthoringError, "implicit deletion must fail");
  input.removedLessonIds = ["lesson-1"];
  const saved = applyCourseDraft(original, input);
  assert.equal(saved.sections[0].lessons.length, 0);
  const retained = saved.archivedSections?.flatMap(section => section.lessons).find(lesson => lesson.id === "lesson-1");
  assert.deepEqual(retained, original.sections[0].lessons[0]);
  assert.equal(original.sections[0].lessons.length, 1);
});
