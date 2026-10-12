import assert from "node:assert/strict";
import {test} from "node:test";
import {textExhibitPositions} from "../../lib/textExhibitLayout";
import {textExhibitSamples} from "../../lib/textExhibitSamples";
import {readFile} from "node:fs/promises";

test("three sample resource types use local assets and appear between paragraphs",async()=>{
 assert.deepEqual(textExhibitPositions(4),[1,2,3]);assert.deepEqual(textExhibitPositions(10),[1,4,7]);assert.deepEqual(textExhibitPositions(1),[1,1,1]);assert.deepEqual(textExhibitPositions(0),[0,0,0]);
 const samples=textExhibitSamples("en-GB");assert.deepEqual(samples.map(sample=>sample.type),["image","video","model3d"]);
 for(const sample of samples)assert.ok((await readFile("public"+sample.url)).length>0);
 assert.notEqual(textExhibitSamples("zh-CN")[0].title,samples[0].title);
});
