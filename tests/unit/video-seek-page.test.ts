import assert from "node:assert/strict";
import { test } from "node:test";
import { build } from "esbuild";
import { chromium } from "playwright";
import { readFile } from "node:fs/promises";

test("video toolbar reveals on hover or keyboard focus during playback and preserves mouse/touch seeking", async () => {
  const bundle=await build({stdin:{contents:`import React from 'react';import {createRoot} from 'react-dom/client';import {ControlledVideo} from './components/portal/ControlledVideo';window.mount=locale=>createRoot(document.getElementById('root')).render(<div className="la" style={{width:'100%'}}><ControlledVideo locale={locale}/></div>);`,resolveDir:process.cwd(),loader:"tsx"},bundle:true,write:false,platform:"browser",jsx:"automatic"});
  const browser=await chromium.launch();
  try{for(const locale of ["en-GB","zh-CN"]) for(const touch of [false,true]){
    const context=await browser.newContext({viewport:{width:touch?390:1100,height:800},hasTouch:touch});const page=await context.newPage();
    await page.setContent('<div id="root"></div>');await page.addScriptTag({content:'window.__name=value=>value'});for(const file of ["app/styles.css","app/portal-design.css","components/portal/lesson-authoring.css"])await page.addStyleTag({content:await readFile(file,"utf8")});
    await page.addScriptTag({content:bundle.outputFiles[0].text});await page.evaluate(locale=>(window as any).mount(locale),locale);
    const seek=page.locator(".la-video-seek");await seek.waitFor();assert.equal(await seek.isDisabled(),true);
    await page.locator("video").evaluate(video=>{Object.defineProperty(video,"duration",{value:120});let position=0;Object.defineProperty(video,"currentTime",{get:()=>position,set:value=>{position=value;video.dataset.seeks=String(Number(video.dataset.seeks||0)+1);},configurable:true});video.dispatchEvent(new Event("loadedmetadata"));});
    const controls=page.locator(".la-video-controls");
    const opacity=()=>controls.evaluate(element=>getComputedStyle(element).opacity);
    assert.equal(await opacity(),"1","paused video keeps its controls visible");
    await page.mouse.move(0,790);
    await page.locator("video").evaluate(video=>video.dispatchEvent(new Event("play")));
    await page.waitForFunction(expected=>getComputedStyle(document.querySelector(".la-video-controls")!).opacity===expected,touch?"1":"0");
    if(!touch){
      assert.equal(await controls.evaluate(element=>getComputedStyle(element).pointerEvents),"none","hidden controls do not capture pointer input");
      await page.locator(".la-video-surface").hover();assert.equal(await opacity(),"1","hovering anywhere on the video reveals the controls");
      // Pointer clicks may retain focus, but leaving the video must still hide the bar.
      await controls.getByRole("button").first().click();
      await page.mouse.move(0,790);assert.equal(await opacity(),"0","pointer focus does not pin the controls open");
      await page.keyboard.press("Tab");assert.equal(await opacity(),"1","keyboard navigation reveals the focused control");
      await page.locator(":focus").evaluate(element=>(element as HTMLElement).blur());
      assert.equal(await opacity(),"0");
      await page.locator("video").evaluate(video=>video.dispatchEvent(new Event("pause")));
      await page.waitForFunction(()=>getComputedStyle(document.querySelector(".la-video-controls")!).opacity==="1");
      await page.locator("video").evaluate(video=>video.dispatchEvent(new Event("play")));
      await page.locator(".la-video-surface").hover();
    }else{
      assert.equal(await opacity(),"1","touch devices retain controls without hover");
    }
    await seek.waitFor({state:"visible"});const box=(await seek.boundingBox())!;const y=box.y+box.height/2,start=box.x+8,end=box.x+box.width*.75;
    const session=await context.newCDPSession(page);
    if(touch)await session.send("Input.dispatchTouchEvent",{type:"touchStart",touchPoints:[{x:start,y}]});else{await page.mouse.move(start,y);await page.mouse.down();}
    for(let i=1;i<=8;i++){
      const x=start+(end-start)*i/8;
      if(touch)await session.send("Input.dispatchTouchEvent",{type:"touchMove",touchPoints:[{x,y}]});else await page.mouse.move(x,y);
      if(i===4)await page.locator("video").evaluate(v=>v.dispatchEvent(new Event("timeupdate")));
    }
    assert.ok(Number(await seek.inputValue())>75,"thumb must follow a continuous drag despite delayed media events");
    const selected=Number(await seek.inputValue());
    assert.equal(await page.locator("video").evaluate(v=>(v as HTMLVideoElement).currentTime),0,"dragging previews without repeatedly seeking the decoder");
    assert.equal(await page.locator("video").getAttribute("data-seeks"),null);
    assert.equal(await seek.evaluate(el=>getComputedStyle(el).paddingLeft),"0px");
    if(touch)await session.send("Input.dispatchTouchEvent",{type:"touchEnd",touchPoints:[]});else await page.mouse.up();
    assert.equal(await page.locator("video").evaluate(v=>(v as HTMLVideoElement).currentTime),selected);
    assert.equal(await page.locator("video").getAttribute("data-seeks"),"1","pointer release commits once");
    await seek.focus();await page.keyboard.press("ArrowLeft");assert.ok(Number(await seek.inputValue())<selected);
    if(!touch){await seek.click({position:{x:box.width*.25,y:box.height/2}});assert.ok(Number(await seek.inputValue())<40);}
    await page.locator("video").evaluate(v=>{(v as HTMLVideoElement).currentTime=20;v.dispatchEvent(new Event("timeupdate"));});
    await page.waitForFunction(()=>document.querySelector('.la-video-seek')?.getAttribute('value')==='20');
    await seek.evaluate(element=>(element as HTMLElement).blur());await page.mouse.move(0,790);
    await page.locator("video").evaluate(video=>video.dispatchEvent(new Event("ended")));
    await page.waitForFunction(()=>getComputedStyle(document.querySelector(".la-video-controls")!).opacity==="1");
    await context.close();
  }}finally{await browser.close();}
});
