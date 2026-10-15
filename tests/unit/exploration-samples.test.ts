import assert from "node:assert/strict";
import { test } from "node:test";
import { explorationSamples } from "../../services/explorationSamples";
test("Exploration sample readings match the design and course exhibits start with three distinct resource types",()=>{
  for(const locale of ["en-GB","zh-CN"] as const){
    const data=explorationSamples(locale,"course-a","03");
    assert.equal(data.readings.length,4);assert.equal(data.readings[0].title,"Ways of Seeing");
    assert.deepEqual(data.exhibits.slice(0,3).map(item=>item.node.type),["image","video","model3d"]);
    assert.equal(data.exhibits.length,5);assert.equal(data.exhibits[0].lessonNumber,"03");assert.equal(data.exhibits[4].lessonNumber,"03");
    assert.ok(data.exhibits.every(item=>item.node.id.startsWith("course-a")));
    data.exhibits.pop();assert.equal(explorationSamples(locale,"course-b").exhibits.length,5);
  }
});
