import assert from "node:assert/strict";
import { test } from "node:test";
import { build } from "esbuild";
import { chromium } from "playwright";
import { readFile } from "node:fs/promises";

test("video seek tracks mouse/touch drags without waiting for media timeupdate", async () => {
  const bundle=await build({stdin:{contents:`import React from 'react';import {createRoot} from 'react-dom/client';import {ControlledVideo} from './components/portal/ControlledVideo';window.mount=locale=>createRoot(document.getElementById('root')).render(<div className="la" style={{width:'100%'}}><ControlledVideo locale={locale}/></div>);`,resolveDir:process.cwd(),loader:"tsx"},bundle:true,write:false,platform:"browser",jsx:"automatic"});
  const browser=await chromium.launch({channel:"msedge"});
  try{for(const locale of ["en-GB","zh-CN"]) for(const touch of [false,true]){
    const context=await browser.newContext({viewport:{width:touch?390:1100,height:800},hasTouch:touch});const page=await context.newPage();
    await page.setContent('<div id="root"></div>');await page.addScriptTag({content:'window.__name=value=>value'});await page.addStyleTag({content:await readFile("components/portal/lesson-authoring.css","utf8")});
    await page.addScriptTag({content:bundle.outputFiles[0].text});await page.evaluate(locale=>(window as any).mount(locale),locale);
    const seek=page.getByRole("slider");await seek.waitFor();assert.equal(await seek.isDisabled(),true);
    await page.locator("video").evaluate(video=>{Object.defineProperty(video,"duration",{value:120});let position=0;Object.defineProperty(video,"currentTime",{get:()=>position,set:value=>{position=value;},configurable:true});video.dispatchEvent(new Event("loadedmetadata"));});
    await seek.waitFor({state:"visible"});const box=(await seek.boundingBox())!;const y=box.y+box.height/2,start=box.x+8,end=box.x+box.width*.75;
    const session=await context.newCDPSession(page);
    if(touch)await session.send("Input.dispatchTouchEvent",{type:"touchStart",touchPoints:[{x:start,y}]});else{await page.mouse.move(start,y);await page.mouse.down();}
    for(let i=1;i<=8;i++){
      const x=start+(end-start)*i/8;
      if(touch)await session.send("Input.dispatchTouchEvent",{type:"touchMove",touchPoints:[{x,y}]});else await page.mouse.move(x,y);
      if(i===4)await page.locator("video").evaluate(v=>v.dispatchEvent(new Event("timeupdate")));
    }
    assert.ok(Number(await seek.inputValue())>75,"thumb must follow a continuous drag despite delayed media events");
    const selected=Number(await seek.inputValue());assert.equal(await page.locator("video").evaluate(v=>(v as HTMLVideoElement).currentTime),selected);
    if(touch)await session.send("Input.dispatchTouchEvent",{type:"touchEnd",touchPoints:[]});else await page.mouse.up();
    await seek.focus();await page.keyboard.press("ArrowLeft");assert.ok(Number(await seek.inputValue())<selected);
    if(!touch){await seek.click({position:{x:box.width*.25,y:box.height/2}});assert.ok(Number(await seek.inputValue())<40);}
    await page.locator("video").evaluate(v=>{(v as HTMLVideoElement).currentTime=20;v.dispatchEvent(new Event("timeupdate"));});
    await page.waitForFunction(()=>document.querySelector('input[type="range"]')?.getAttribute('value')==='20');
    await context.close();
  }}finally{await browser.close();}
});
