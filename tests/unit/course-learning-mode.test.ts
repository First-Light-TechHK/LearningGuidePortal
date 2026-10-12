import assert from "node:assert/strict";
import { test } from "node:test";
import { preferredLessonContentId, availableCourseLearningModes, modeLessonDestination } from "../../lib/courseLearningMode";
import type { LessonContent } from "../../contracts/lesson-content";
import type { ProductCourse } from "../../services/productStore";

test("mode switching navigates to matching accessible lessons and preserves locale/query",()=>{
  const outline=[{id:"video",href:"/zh-CN/account/learn/course?lessonId=video",modes:["video"] as const},{id:"locked",href:null,modes:["text"] as const},{id:"text",href:"/zh-CN/account/learn/course?lessonId=text",modes:["text"] as const}].map(item=>({...item,modes:[...item.modes]}));
  assert.deepEqual(modeLessonDestination(outline,"video","text",false),{lessonId:"text",href:"/zh-CN/account/learn/course?lessonId=text&viewMode=text"});
  assert.deepEqual(modeLessonDestination(outline,"video","video",true,"point-two"),{lessonId:"video",href:"/zh-CN/account/learn/course?lessonId=video&viewMode=video&contentId=point-two"});
  assert.equal(modeLessonDestination(outline.slice(0,2),"video","text",false),null);
});

test("course mode choices include only active video and text across all lessons", () => {
  const modes = (lessons: unknown[]) => availableCourseLearningModes({ sections: [{ lessons }] } as Pick<ProductCourse, "sections">);
  assert.deepEqual(modes([{contents:[{type:"video"},{type:"text",active:false}]}]),["video"]);
  assert.deepEqual(modes([{contents:[{type:"pdf"}]}]),["text"]);
  assert.deepEqual(modes([{body:"Legacy reading",contents:[]}]),["text"]);
  assert.deepEqual(modes([{contents:[{type:"video"}]},{contents:[{type:"text"}]}]),["video","text"]);
  assert.deepEqual(modes([{contents:[{type:"text",active:false}]}]),[]);
  assert.deepEqual(modes([]),[]);
});

test("preferred mode selects active media and falls back when a lesson has no matching mode", () => {
  const contents: LessonContent[] = [
    { id: "hidden", title: "Hidden", type: "text", mode: "lecture", html: "", nodes: [], active: false },
    { id: "video", title: "Video", type: "video", mode: "lecture", url: "https://example.test/video.mp4", nodes: [] },
    { id: "text", title: "Text", type: "text", mode: "lecture", html: "Text", nodes: [] },
  ];
  assert.equal(preferredLessonContentId(contents, "text"), "text");
  assert.equal(preferredLessonContentId(contents, "video"), "video");
  assert.equal(preferredLessonContentId(contents.slice(0, 2), "text"), "video");
  assert.equal(preferredLessonContentId([]), "");
});
