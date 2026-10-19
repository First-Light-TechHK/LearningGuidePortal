import assert from "node:assert/strict";
import { test } from "node:test";
import { sampleUnderstandingOverview } from "../../services/understandingOverview";
test("Understanding design samples have fixed progress and five ordered lessons in both locales",()=>{
  for(const locale of ["en-GB","zh-CN"] as const) {
    const view=sampleUnderstandingOverview(locale);
    assert.equal(view.completed,2);assert.equal(view.total,8);assert.equal(view.percent,25);
    assert.deepEqual(view.lessons.map(lesson=>lesson.state),["completed","current","locked","locked","locked"]);
    assert.deepEqual(view.lessons.map(lesson=>lesson.number),["01","02","03","04","05"]);
    view.lessons.pop();assert.equal(sampleUnderstandingOverview(locale).lessons.length,5);
  }
});
