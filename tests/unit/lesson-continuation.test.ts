import assert from "node:assert/strict";
import {test} from "node:test";
import {nextLessonHref} from "../../lib/lessonContinuation";
test("Continue follows lesson order across sections, escapes IDs and ends without a next lesson",()=>{
 const lessons=[{id:"one"},{id:"next & lesson"},{id:"three"}];
 assert.equal(nextLessonHref("en-GB","course",lessons,"one"),"/en-GB/account/learn/course?lessonId=next%20%26%20lesson");
 assert.equal(nextLessonHref("zh-CN","course",lessons,"next & lesson"),"/zh-CN/account/learn/course?lessonId=three");
 assert.equal(nextLessonHref("en-GB","course",lessons,"three"),null);assert.equal(nextLessonHref("en-GB","course",lessons,"missing"),null);assert.equal(nextLessonHref("en-GB","course",[],"one"),null);
});
