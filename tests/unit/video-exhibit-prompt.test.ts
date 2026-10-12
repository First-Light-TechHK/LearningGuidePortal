import assert from "node:assert/strict";
import { test } from "node:test";
import { dueVideoNodes } from "../../lib/videoExhibitPrompt";
import type { LessonNode } from "../../contracts/lesson-content";
import { videoExhibitNodes } from "../../lib/videoExhibitSamples";
import type { LessonContent } from "../../contracts/lesson-content";

test("unconfigured videos offer image/video/model display samples at 20/40/60 seconds", () => {
  for (const locale of ["en-GB", "zh-CN"] as const) {
    const content: LessonContent = {id:"video",title:"Lesson",type:"video",mode:"lecture",nodes:[]};
    const nodes = videoExhibitNodes(content, locale);
    assert.deepEqual(nodes.map(node => [node.type,node.triggerTime]),[["image",20],["video",40],["model3d",60]]);
    for (const time of [20,40,60]) {
      assert.equal(dueVideoNodes(nodes,time-1,time-.01,new Set(),false).length,0);
      assert.equal(dueVideoNodes(nodes,time-1,time,new Set(),false)[0].triggerTime,time);
    }
    const configured: LessonNode = {id:"configured",title:"Actual exhibit",type:"image",url:"/actual.jpg",triggerTime:12};
    assert.deepEqual(videoExhibitNodes({...content,nodes:[configured]},locale),[configured]);
    assert.deepEqual(videoExhibitNodes({...content,type:"text"},locale),[]);
    assert.equal(content.nodes.length,0);
  }
});

test("timed exhibits include the boundary, exclude inactive/seen/invalid nodes and preserve interactive exercises", () => {
  const node: LessonNode = {id:"a",title:"Exhibit",type:"model3d",triggerTime:10};
  const nodes: LessonNode[] = [node,{...node,id:"off",active:false},{...node,id:"invalid",triggerTime:NaN},{...node,id:"negative",triggerTime:-1},{...node,id:"quiz",type:"exercise"}];
  assert.deepEqual(dueVideoNodes(nodes,0,9.99,new Set(),true),[]);
  assert.deepEqual(dueVideoNodes(nodes,0,10,new Set(),false).map(n=>n.id),["a"]);
  assert.deepEqual(dueVideoNodes(nodes,0,10,new Set(["a"]),true).map(n=>n.id),["quiz"]);
  assert.deepEqual(dueVideoNodes(nodes,11,20,new Set(),true),[]);
  assert.deepEqual(dueVideoNodes(nodes,20,10,new Set(),true),[]);
  assert.deepEqual(dueVideoNodes(nodes,0,Infinity,new Set(),true),[]);
});
