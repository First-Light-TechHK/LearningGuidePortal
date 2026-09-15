import assert from "node:assert/strict";
import { test } from "node:test";
import { LESSON_CONTENT_LIMITS } from "../../contracts/lesson-content";
import { courseMediaAssetId, LessonContentError, lessonContentAssetIds, lessonContentsText, sanitiseLessonContents, sanitiseRichHtml, validateLessonContents } from "../../services/lessonContent";

const courseId = "course_123";
const assetId = "7c831ab8-cc01-4d15-8d71-ef3524d08e09";
const url = `/api/course-media/${courseId}/${assetId}`;
const content = () => ({ id: "content-1", title: "Lesson content", type: "text", mode: "interactive", html: "<p>Hello</p>", nodes: [{ id: "node-1", title: "Detail", type: "text", html: "<p>Detail</p>", triggerTime: 1.25 }] });

test("strict validation preserves IDs, ordering, timing and supported rich text", () => {
  const value = content();
  value.html = '<h2 style="text-align:center">Title</h2><p><strong>Text</strong><sup>2</sup><a data-node-id="node-1">Open</a></p>';
  const result = validateLessonContents([value], courseId);
  assert.equal(result[0].id, "content-1");
  assert.equal(result[0].nodes[0].triggerTime, 1.25);
  assert.match(result[0].html!, /data-node-id="node-1"/);
  assert.match(result[0].html!, /href="#node-node-1"/);
  assert.match(result[0].html!, /text-align:center/);
  assert.deepEqual(validateLessonContents(result, courseId), result);
});

test("rich HTML removes executable markup, external embeds and cross-course references", () => {
  const html = sanitiseRichHtml(`<script>alert(1)</script><svg onload="alert(1)"></svg><iframe src="${url}"></iframe><img src="https://tracker.test/x"><img src="/api/course-media/other/${assetId}"><img src="${url}" onerror="alert(1)"><a href="javascript:alert(1)">Bad</a><a href="//tracker.test">Protocol</a><a href="https://site.test/api/course-media/other/${assetId}">Cross</a><p style="position:fixed;background:url(https://tracker.test);text-align:right">Good</p><span data-node-id="missing">Missing</span>`, courseId, ["node-1"]);
  assert.doesNotMatch(html, /script|iframe|svg|onerror|javascript|tracker|position:|background:|data-node-id|\/other\//);
  assert.match(html, new RegExp(assetId));
  assert.match(html, /text-align:right/);
  assert.equal((html.match(/<img/g) || []).length, 1);
});

test("safe inline node links are scoped to the owning content", () => {
  const first = content();
  first.html = '<span data-node-id="node-2">Wrong content</span><a data-node-id="node-1" href="https://bad.test">Correct</a>';
  const second = { ...content(), id: "content-2", nodes: [{ ...content().nodes[0], id: "node-2" }] };
  const result = validateLessonContents([first, second], courseId);
  assert.doesNotMatch(result[0].html!, /node-2|bad.test/);
  assert.match(result[0].html!, /data-node-id="node-1"/);
});

test("media references require canonical course-local asset URLs", () => {
  const good = { ...content(), type: "video", url };
  assert.equal(validateLessonContents([good], courseId)[0].url, url);
  for (const bad of [url + "?download=1", url + "/x", "https://example.test" + url, url.replace(courseId, "other"), url.replace(courseId, "%63ourse_123"), "data:video/mp4;base64,AAAA", "../x", "blob:example"]) {
    assert.equal(courseMediaAssetId(bad, courseId), null);
    assert.throws(() => validateLessonContents([{ ...good, url: bad }], courseId), LessonContentError);
  }
  assert.equal(courseMediaAssetId(url, "../course_123"), null);
});

test("asset extraction only includes sanitised renderable HTML and structured URLs", () => {
  const value = content();
  value.html = `<script>const url = '${url}'</script><!-- <img src="${url}"> --><p>${url}</p>`;
  assert.equal(lessonContentAssetIds([value], courseId).size, 0);
  value.html += `<img src="${url}">`;
  assert.deepEqual([...lessonContentAssetIds([value], courseId)], [assetId]);
  value.html = `<a href="${url}">Download</a>`;
  assert.deepEqual([...lessonContentAssetIds([value], courseId)], [assetId]);
});

test("IDs, node limits, malformed collections and trigger times fail closed", () => {
  for (const value of [null, {}, "text", [null], [{ ...content(), id: "../escape" }], [{ ...content(), nodes: null }], [content(), content()], [{ ...content(), nodes: [{ ...content().nodes[0], id: "content-1" }] }]]) {
    assert.throws(() => validateLessonContents(value, courseId), LessonContentError);
    assert.deepEqual(sanitiseLessonContents(value, courseId), []);
  }
  for (const triggerTime of [-1, Infinity, NaN, "2", 36001]) assert.throws(() => validateLessonContents([{ ...content(), nodes: [{ ...content().nodes[0], triggerTime }] }], courseId), LessonContentError);
  assert.throws(() => validateLessonContents([{ ...content(), html: "x".repeat(LESSON_CONTENT_LIMITS.htmlCharacters + 1) }], courseId), LessonContentError);
  assert.throws(() => validateLessonContents(Array.from({ length: 101 }, (_, i) => ({ ...content(), id: `c${i}`, nodes: [] })), courseId), LessonContentError);
  assert.throws(() => validateLessonContents([{ ...content(), nodes: Array.from({ length: 201 }, (_, i) => ({ ...content().nodes[0], id: `n${i}` })) }], courseId), LessonContentError);
  assert.equal(sanitiseRichHtml("<b>ignored</b>", "../x"), "");
});

test("quiz validation supports free answers and multi-select without invalid answer indexes", () => {
  const node = { id: "quiz", title: "Question", type: "exercise", triggerTime: 5, question: "Choose two", options: ["First", "Second", "Third"], correctOptions: [2, 0] };
  const run = (changes: object) => validateLessonContents([{ ...content(), nodes: [{ ...node, ...changes }] }], courseId);
  assert.deepEqual(run({})[0].nodes[0].correctOptions, [0, 2]);
  for (const correctOptions of [[], [3], [-1], [1.1], [0, 0], ["1"]]) assert.throws(() => run({ correctOptions }), LessonContentError);
  assert.throws(() => run({ options: ["same", "Same"] }), LessonContentError);
  assert.throws(() => run({ options: ["one"] }), LessonContentError);
  assert.throws(() => run({ question: "" }), LessonContentError);
  assert.equal(run({ options: undefined, correctOptions: undefined, answer: "Explanation" })[0].nodes[0].answer, "Explanation");
  assert.throws(() => run({ options: undefined, correctOptions: undefined, answer: "" }), LessonContentError);
});

test("text extraction strips markup and scripts without adding media paths or quiz answers", () => {
  const contents = validateLessonContents([{ ...content(), html: '<p>A &amp; B &#x1f642;</p><script>secret</script>', nodes: [{ id: "q", title: "Quiz", type: "exercise", triggerTime: 0, question: "Question?", answer: "hidden-answer" }] }], courseId);
  const result = lessonContentsText(contents);
  assert.match(result, /A & B/);
  assert.match(result, /Question\?/);
  assert.doesNotMatch(result, /<p>|script|secret|hidden-answer/);
});

test("active flags default true, survive authoring, and exclude hidden nodes and groups from learner reads", () => {
  const first = { ...content(), active: true, html: '<a data-node-id="node-1">Hidden</a>', nodes: [{ ...content().nodes[0], active: false, type: "image", url }] };
  const second = { ...content(), id: "hidden", active: false, nodes: [] };
  const saved = validateLessonContents([first, second], courseId);
  assert.equal(saved[0].nodes[0].active, false);
  assert.equal(saved[1].active, false);
  assert.equal(validateLessonContents([content()], courseId)[0].active, true);
  const visible = sanitiseLessonContents(saved, courseId);
  assert.equal(visible.length, 1);
  assert.equal(visible[0].nodes.length, 0);
  assert.doesNotMatch(visible[0].html!, /data-node-id|href/);
  assert.equal(lessonContentAssetIds(saved, courseId).size, 0);
  assert.throws(() => validateLessonContents([{ ...content(), active: "false" }], courseId), LessonContentError);
});

test("task lists and image caption/alignment round-trip while form behaviour is removed", () => {
  const source = `<ul data-type="taskList"><li data-type="taskItem" data-checked="true"><label><input type="checkbox" checked onclick="alert(1)"><span></span></label><div><p>Completed</p></div></li></ul><span data-image-align="right" data-image-inline="false"><img src="${url}" data-image-align="right" data-image-inline="false" data-caption="A &amp; B"><span data-caption="A &amp; B">A &amp; B</span></span><input type="text" name="password" autofocus>`;
  const result = sanitiseRichHtml(source, courseId);
  assert.match(result, /data-type="taskList"/);
  assert.match(result, /data-type="taskItem" data-checked="true"/);
  assert.match(result, /type="checkbox" checked disabled/);
  assert.match(result, /data-image-align="right"/);
  assert.match(result, /data-caption="A &amp; B"/);
  assert.doesNotMatch(result, /onclick|autofocus|password|type="text"/);
  assert.equal(sanitiseRichHtml(result, courseId), result);
});
