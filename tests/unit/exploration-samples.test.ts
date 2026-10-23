import assert from "node:assert/strict";
import { test } from "node:test";
import { explorationSamples, explorationCourseSamples } from "../../services/explorationSamples";
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

test("Whole course samples multiply by unlocked lessons with unique course/lesson identities",()=>{
  for(const locale of ["en-GB","zh-CN"] as const){
    const lessons=[{number:"01",title:"First",unlocked:true},{number:"2",title:"Second",unlocked:true},{number:"03",title:"Locked",unlocked:false},{number:"04",title:"Fourth",unlocked:true},{number:"02",title:"Duplicate second",unlocked:true}];
    const data=explorationCourseSamples(locale,"course-a",lessons);
    assert.equal(data.readings.length,12);assert.equal(data.exhibits.length,15);
    assert.deepEqual([...new Set(data.readings.map(item=>item.lessonNumber))],["01","02","04"]);
    assert.deepEqual([...new Set(data.exhibits.map(item=>item.lessonNumber))],["01","02","04"]);
    assert.equal(new Set(data.readings.map(item=>item.id)).size,12);assert.equal(new Set(data.exhibits.map(item=>item.node.id)).size,15);
    for(const number of ["01","02","04"]){assert.equal(data.readings.filter(item=>item.lessonNumber===number).length,4);assert.equal(data.exhibits.filter(item=>item.lessonNumber===number).length,5);}
    assert.deepEqual(explorationCourseSamples(locale,"course-a",[]),{readings:[],exhibits:[]});
    assert.deepEqual(explorationCourseSamples(locale,"course-a",[{number:"01",title:"Locked",unlocked:false}]),{readings:[],exhibits:[]});
    assert.notEqual(explorationCourseSamples(locale,"course-b",lessons).exhibits[0].node.id,data.exhibits[0].node.id);
  }
});
