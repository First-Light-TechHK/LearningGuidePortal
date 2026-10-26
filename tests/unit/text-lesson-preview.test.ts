import assert from "node:assert/strict";
import { test } from "node:test";
import type { LessonContent } from "../../contracts/lesson-content";
import { buildTextLessonPreview, firstHalfTextHtml } from "../../services/textLessonPreview";
import { isolate, setCookie, clearCookies, SESSION_COOKIE, jsonRequest } from "../io/harness";
import { verifiedUser, readProductData, writeProductData, COURSE_ID, PREVIEW_LP } from "./helpers/my-learning";

const points: LessonContent[] = [1, 2, 3, 4].map(index => ({ id: `text-${index}`, title: `Point ${index}`, type: "text", mode: "lecture", html: `<p>SECRET-${index}</p>`, nodes: [] }));

test("half-text preview includes explicit exhibit cards only in the delivered half", () => {
  const html = '<div data-exhibit-card="visible"></div><p>ABCDEFGHIJ</p><div data-exhibit-card="hidden"></div><p>KLMNOPQRST</p>';
  const contents: LessonContent[] = [{ ...points[0], exhibitMode: "authored", html, nodes: ["visible", "hidden"].map(id => ({ id, title: id, type: "image", url: `https://media.test/${id}.png`, triggerTime: 0 })) }];
  const preview = buildTextLessonPreview({ body: "", contents }, "course", false);
  assert.match(preview.contents[0].html!, /data-exhibit-card="visible"/);
  assert.deepEqual(preview.contents[0].nodes.map(node => node.id), ["visible"]);
  assert.doesNotMatch(JSON.stringify(preview), /hidden\.png|data-exhibit-card=\\"hidden/);
});

test("text preview withholds point three onwards, counts active text points, and preserves entitled material", () => {
  const source = { body: "ALTERNATIVE-SECRET", contents: [points[0], { ...points[0], id: "inactive", active: false }, { id: "video", title: "Video", type: "video", mode: "lecture", url: "https://media.test/video.mp4", nodes: [] } as LessonContent, ...points.slice(1)] };
  const projection = buildTextLessonPreview(source, "course", false);
  assert.equal(projection.textPreview?.rule, "third-point"); assert.equal(projection.body, "");
  assert.match(projection.contents[0].html!, /SECRET-1/); assert.match(projection.contents[2].html!, /SECRET-2/);
  assert.deepEqual(projection.contents[3], { id: "text-3", title: "Point 3", type: "text", mode: "lecture", nodes: [] });
  assert.ok(!JSON.stringify(projection).includes("SECRET-3")); assert.ok(!JSON.stringify(projection).includes("SECRET-4"));
  const full = buildTextLessonPreview(source, "course", true);
  assert.equal(full.textPreview, undefined); assert.match(JSON.stringify(full), /SECRET-4/); assert.equal(full.body, source.body);
  assert.deepEqual(buildTextLessonPreview({ body: "", contents: points.slice(0, 2) }, "course", false).textPreview?.points, { "text-1": "full", "text-2": "full" });
});

test("one or zero points expose half of balanced Unicode text and only visible exhibit payloads", () => {
  assert.equal(firstHalfTextHtml("<h2>AB</h2><p>CD<strong>EFGH</strong>IJ</p>"), "<h2>AB</h2><p>CD<strong>E</strong></p>");
  assert.equal(firstHalfTextHtml("<p>文😀&amp;字XYZQ</p>"), "<p>文😀&amp;字</p>");
  const html = '<p><span data-node-id="visible">A</span>BCDEFGHIJ<span data-node-id="hidden">K</span></p>';
  const contents: LessonContent[] = [{ ...points[0], html, nodes: ["visible", "hidden"].map(id => ({ id, title: id, type: "text", html: `<p>${id}-PAYLOAD</p>`, triggerTime: 0 })) }];
  const projection = buildTextLessonPreview({ body: "", contents }, "course", false);
  assert.equal(projection.textPreview?.rule, "half-text"); assert.deepEqual(projection.contents[0].nodes.map(node => node.id), ["visible"]);
  assert.ok(!JSON.stringify(projection).includes("hidden-PAYLOAD"));
  assert.equal(buildTextLessonPreview({ body: "中文😀abcdef", contents: [] }, "course", false).body, "中文😀ab");
  const pdf = buildTextLessonPreview({ body: "", contents: [{ ...points[0], type: "pdf", url: "https://media.test/protected.pdf" }] }, "course", false);
  assert.ok(!JSON.stringify(pdf).includes("protected.pdf"));
  assert.doesNotThrow(() => buildTextLessonPreview({ body: "", contents: [{ ...points[0], html: "" }] }, "course", false));
});

test("preview study API rejects locked text points and completion after expiry while valid access retains all points", async () => {
  const { restore } = await isolate("lg-text-preview-");
  try {
    const store = await import("../../services/productStore"), user = await verifiedUser(store, "text-preview@example.test");
    const data = await readProductData(), course = data.courses.find((item: { id: string }) => item.id === COURSE_ID);
    course.sections[0].lessons.find((item: { id: string }) => item.id === PREVIEW_LP).contents = points;
    await writeProductData(data);
    const event = { userId: user.id, courseId: COURSE_ID, lessonId: PREVIEW_LP, learningMode: "text" as const, contentId: "text-3", event: "open" as const, seconds: 0, clientEventId: "blocked-point" };
    await assert.rejects(store.recordStudyEvent(event, "preview"), /outside the preview/);
    await assert.rejects(store.recordStudyEvent({ ...event, event: "complete" }, "preview"), /cannot be completed/);
    const initial = await store.recordStudyEvent({ ...event, contentId: "text-2", clientEventId: "allowed-point" }, "preview");
    assert.equal(initial?.knowledgePositions?.text?.contentId, "text-2");
    const { quote } = await store.createQuote(user.id, "everything-pc-6"); await store.completeDemoCheckout(user.id, quote.id);
    await store.recordStudyEvent(event);
    const route = await import("../../app/api/study/preview/route");
    clearCookies(); assert.equal((await route.POST(jsonRequest("POST", "http://localhost/api/study/preview", event))).status, 401);
    setCookie(SESSION_COOKIE, (await store.createSession(user.id)).token);
    assert.equal((await route.POST(jsonRequest("POST", "http://localhost/api/study/preview", { ...event, clientEventId: "entitled-api" }))).status, 200);
    const expired = await readProductData(); expired.entitlements.forEach((item: { validTo: string }) => { item.validTo = new Date(0).toISOString(); }); await writeProductData(expired);
    await assert.rejects(store.recordStudyEvent({ ...event, clientEventId: "expired-paid" }), /access is required/);
    await assert.rejects(store.recordStudyEvent({ ...event, clientEventId: "expired-preview" }, "preview"), /outside the preview/);
    assert.equal((await route.POST(jsonRequest("POST", "http://localhost/api/study/preview", { ...event, clientEventId: "expired-api" }))).status, 400);
    assert.equal((await route.POST(jsonRequest("POST", "http://localhost/api/study/preview", { ...event, event: "complete", clientEventId: "expired-complete" }))).status, 403);
    assert.equal((await store.getLearningOverview(user.id)).courses[0].currentContentId, "text-3", "access changes never rewrite historical cursor");
  } finally { await restore(); }
});
