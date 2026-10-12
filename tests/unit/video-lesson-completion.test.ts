import assert from "node:assert/strict";
import { test } from "node:test";
import { canPromptVideoCompletion, videoCompletionPercent, playbackDuration } from "../../lib/videoLessonCompletion";

test("progress uses actual media duration with the same finite fallback as the video toolbar", () => {
  const seekable={length:1,end:()=>37.5} as unknown as TimeRanges;
  assert.equal(playbackDuration({duration:37.5,seekable}),37.5);
  assert.equal(playbackDuration({duration:Infinity,seekable}),37.5);
  assert.equal(playbackDuration({duration:NaN,seekable:{length:0} as TimeRanges}),0);
  assert.equal(canPromptVideoCompletion(true,"video",{contentId:"video",currentTime:36.749,duration:37.5}),false);
  assert.equal(canPromptVideoCompletion(true,"video",{contentId:"video",currentTime:36.75,duration:37.5}),true);
});

test("98% completion prompt requires valid duration, matching content and course entitlement", () => {
  const progress = { contentId:"video",currentTime:97.99,duration:100 };
  assert.equal(canPromptVideoCompletion(true,"video",progress),false);
  progress.currentTime=98;
  assert.equal(canPromptVideoCompletion(true,"video",progress),true);
  assert.equal(canPromptVideoCompletion(false,"video",progress),false);
  assert.equal(canPromptVideoCompletion(true,"other-video",progress),false);
  for (const duration of [0,-1,NaN,Infinity]) assert.equal(canPromptVideoCompletion(true,"video",{...progress,duration}),false);
  for (const currentTime of [-1,NaN,Infinity]) assert.equal(videoCompletionPercent({...progress,currentTime}),null);
  assert.equal(videoCompletionPercent(null),null);
  assert.equal(videoCompletionPercent({...progress,currentTime:150}),100);
});
