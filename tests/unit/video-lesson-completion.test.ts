import assert from "node:assert/strict";
import { test } from "node:test";
import { videoCompletionPercent, playbackDuration } from "../../lib/videoLessonCompletion";

test("progress uses actual media duration with the same finite fallback as the video toolbar", () => {
  const seekable={length:1,start:()=>0,end:()=>37.5} as TimeRanges;
  assert.equal(playbackDuration({duration:37.5,seekable}),37.5);
  assert.equal(playbackDuration({duration:Infinity,seekable}),37.5);
  assert.equal(playbackDuration({duration:NaN,seekable:{length:0} as TimeRanges}),0);
  assert.ok(videoCompletionPercent({contentId:"video",currentTime:36.749,duration:37.5})! < 98);
  assert.equal(videoCompletionPercent({contentId:"video",currentTime:36.75,duration:37.5}),98);
});

test("display percentage handles missing metadata independently of manual completion", () => {
  const progress = { contentId:"video",currentTime:97.99,duration:100 };
  assert.equal(videoCompletionPercent(progress),97.99);
  progress.currentTime=98;
  assert.equal(videoCompletionPercent(progress),98);
  for (const duration of [0,-1,NaN,Infinity]) assert.equal(videoCompletionPercent({...progress,duration}),null);
  for (const currentTime of [-1,NaN,Infinity]) assert.equal(videoCompletionPercent({...progress,currentTime}),null);
  assert.equal(videoCompletionPercent(null),null);
  assert.equal(videoCompletionPercent({...progress,currentTime:150}),100);
});
