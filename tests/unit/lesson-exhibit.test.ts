import assert from "node:assert/strict";
import { test } from "node:test";
import { resolveLessonExhibit, TRIAL_STOP_SELECTOR } from "../../lib/lessonExhibit";

const media = "/api/course-media/course/11111111-1111-4111-8111-111111111111";

test("CM-07 exhibit URL wins over fallbackImageUrl (4e4d4c3-7)", () => {
  const exhibit = resolveLessonExhibit({
    instanceType: "4",
    instanceSrc: media,
    title: "<Exh 3>",
    fallbackImageUrl: "/portal/exh.jpg",
  });
  assert.deepEqual(exhibit, { title: "<Exh 3>", type: "image", url: media, html: "", missing: false });
});

test("CM-07 fallback is used only when the exhibit URL is missing", () => {
  const exhibit = resolveLessonExhibit({
    instanceType: "4",
    instanceSrc: "",
    instanceContent: "",
    title: "Empty",
    fallbackImageUrl: "/portal/exh.jpg",
  });
  assert.equal(exhibit?.url, "/portal/exh.jpg");
  assert.equal(exhibit?.missing, false);
});

test("CM-07 executable instance-content is not required once instance-src is set (4e4d4c3-1/8)", () => {
  const exhibit = resolveLessonExhibit({
    instanceType: "4",
    instanceSrc: media,
    instanceContent: '<img onerror=alert(1) src="https://evil.test/x">',
    fallbackImageUrl: "/portal/exh.jpg",
  });
  assert.equal(exhibit?.url, media);
  assert.doesNotMatch(exhibit?.html || "", /onerror|evil/);
});

test("CM-07 trial stop is a data-instance-type marker, not the <Exh 3> string (4e4d4c3-6)", () => {
  assert.match(TRIAL_STOP_SELECTOR, /data-trial-stop/);
  assert.match(TRIAL_STOP_SELECTOR, /data-instance-type="3"/);
  assert.doesNotMatch(TRIAL_STOP_SELECTOR, /Exh 3|textStopLabel|textContent/);
});
