import assert from "node:assert/strict";
import { test } from "node:test";
import type { LessonContent } from "../../contracts/lesson-content";
import { videoLessonPoint } from "../../lib/videoLessonPoint";

const video = (id: string, startSeconds?: number, url = "/lesson.mp4"): LessonContent => ({ id, title: id, type: "video", mode: "lecture", nodes: [], url, startSeconds });

test("video timeline follows exact boundaries, skipped points and backward seeks within its active source", () => {
  const first = video("first", 0), second = video("second", 412), third = video("third", 587);
  const contents = [third, video("foreign", 400, "/other.mp4"), first, { ...video("hidden", 420), active: false }, second];
  for (const [time, id] of [[0,"first"],[411.99,"first"],[412,"second"],[500,"second"],[587,"third"],[1200,"third"]] as const) {
    assert.equal(videoLessonPoint(contents, first, time).id, id);
  }
  assert.equal(videoLessonPoint(contents, third, 450).id, "second");
  assert.equal(videoLessonPoint(contents, third, 0).id, "first");
  assert.equal(videoLessonPoint([video("zero"), second], second, 10).id, "zero", "an omitted first offset defaults to zero on backward seeks");
});

test("unconfigured, invalid or duplicate offsets do not switch unrelated or ambiguous points", () => {
  const selected = video("selected");
  const contents = [video("untimed"), video("invalid", NaN), video("negative", -1), video("duplicate", 0), selected];
  assert.equal(videoLessonPoint(contents, selected, 10).id, selected.id);
  assert.equal(videoLessonPoint(contents, selected, NaN).id, selected.id);
  assert.equal(videoLessonPoint(contents, selected, -1).id, selected.id);
  assert.equal(videoLessonPoint(contents, { ...selected, type: "text" }, 10).type, "text");
});
