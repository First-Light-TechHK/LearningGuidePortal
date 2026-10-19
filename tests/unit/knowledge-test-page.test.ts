import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { getMessages } from "../../lib/i18n/messages";
import { build } from "esbuild";
import { chromium } from "playwright";
test("completion Knowledge Test supports six questions, optional notes, rating gate, read-only detail, result actions and return in both locales", async () => {
  const bundle = await build({ stdin:{contents:`import React from 'react';import {createRoot} from 'react-dom/client';import {LessonCompletedDialog} from './components/portal/LessonCompletedDialog';window.mount=locale=>createRoot(document.getElementById('root')).render(<LessonCompletedDialog locale={locale} lessonNumber="01" lessonTitle="Looking closely" onContinue={()=>window.continued=true} onClose={()=>window.closed=true}/>);`,resolveDir:process.cwd(),loader:"tsx"}, bundle:true,write:false,outfile:"test.js",platform:"browser",external:["/portal/*"],jsx:"automatic",loader:{".css":"local-css"},define:{"process.env.NODE_ENV":'"production"'},plugins:[{name:"next-image",setup(b){b.onResolve({filter:/^next\/image$/},()=>({path:"image",namespace:"mock"}));b.onLoad({filter:/.*/,namespace:"mock"},()=>({contents:"import React from 'react';export default function Image(props){return <img {...props}/>}",loader:"tsx",resolveDir:process.cwd()}));}}] });
  const browser = await chromium.launch({channel:"msedge"});
  await mkdir("test-results/knowledge-test",{recursive:true});
  try { for (const locale of ["en-GB", "zh-CN"] as const) {
    const copy=getMessages(locale).knowledgeTest;
    const page = await browser.newPage({viewport:{width:1440,height:1024}});
    await page.route("http://knowledge.test/**",async route=>{const url=new URL(route.request().url());return url.pathname.startsWith("/portal/") ? route.fulfill({body:await readFile(path.join("public",url.pathname)),contentType:"image/svg+xml"}) : route.fulfill({contentType:"text/html",body:'<div id="root"></div>'});});
    await page.goto("http://knowledge.test/");
    await page.addStyleTag({content:await readFile("app/styles.css","utf8")});
    await page.addStyleTag({content:await readFile("app/portal-design.css","utf8")});
    await page.addStyleTag({content:bundle.outputFiles.find(f=>f.path.endsWith("css"))!.text});
    for(const weight of [400,500,600,700]) { const font=(await readFile(`node_modules/@fontsource/inter/files/inter-latin-${weight}-normal.woff2`)).toString("base64");await page.addStyleTag({content:`@font-face{font-family:Inter;src:url(data:font/woff2;base64,${font});font-weight:${weight}}`}); }
    await page.addScriptTag({content:bundle.outputFiles.find(f=>f.path.endsWith("js"))!.text});
    await page.evaluate(locale=>(window as unknown as {mount:(locale:string)=>void}).mount(locale),locale);
    const dialog=page.getByRole("dialog"); await dialog.waitFor();await dialog.getByRole("button",{name:/Knowledge Test|\u77e5\u8bc6\u6d4b\u8bd5/}).click();
    const geometry=()=>dialog.evaluate(element=>{const r=element.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height};});
    assert.deepEqual(await geometry(),{x:220,y:120,width:1000,height:660});
    const closeIcon=dialog.locator('img[src$="close-v2.svg"]');
    await closeIcon.evaluate(async e=>{await (e as HTMLImageElement).decode();});
    assert.deepEqual(await closeIcon.evaluate(e=>({width:e.getBoundingClientRect().width,height:e.getBoundingClientRect().height})),{width:18,height:18});
    assert.deepEqual(await page.getByRole("textbox").evaluate(e=>({width:e.getBoundingClientRect().width,height:e.getBoundingClientRect().height})),{width:902,height:148});
    const savedIcon=dialog.locator('img[src$="saved-v2.svg"]');
    await savedIcon.evaluate(async e=>{await (e as HTMLImageElement).decode();});
    assert.deepEqual(await savedIcon.evaluate(e=>({width:e.getBoundingClientRect().width,height:e.getBoundingClientRect().height})),{width:6,height:6});
    const next=page.getByRole("button",{name:locale==="en-GB" ? "Next" : "下一题",exact:true});
    for(let i=0;i<6;i++) {
      const check=page.getByRole("button",{name:copy.check,exact:true});
      assert.equal(await check.isEnabled(),true);
      await page.getByRole("textbox").fill(" \n\t ");
      assert.equal(await check.isEnabled(),true);
      await page.getByRole("textbox").fill(i===0 ? "" : `Answer ${i+1}`);
      assert.equal(await check.isEnabled(),true);
      assert.equal(await dialog.getByText(`${String(i+1).padStart(2,"0")}/06`,{exact:true}).count(),1);
      if(i===0){await dialog.getByRole("heading",{level:2}).focus();await page.screenshot({path:`test-results/knowledge-test/${locale}-question.png`});}
      await page.getByRole("button",{name:copy.check,exact:true}).click();
      assert.equal(await next.isDisabled(),true);
      assert.deepEqual(await geometry(),{x:220,y:100,width:1000,height:700});
      assert.equal(await dialog.getByText(i===0 ? copy.emptyAnswer : `Answer ${i+1}`,{exact:true}).count(),1);

      await page.getByRole("radio",{name:locale==="en-GB" ? (i===0 || i>=4 ? "I got it right" : "I got it wrong") : (i===0 || i>=4 ? "我答对了" : "我答错了")}).check();
      assert.equal(await next.isEnabled(),true);if(i===0){await dialog.getByRole("heading",{level:2}).focus();await page.screenshot({path:`test-results/knowledge-test/${locale}-answer.png`});}await next.click();
    }
    await dialog.getByRole("heading",{name:locale==="en-GB" ? "Result Review" : "结果回顾"}).waitFor();
    assert.equal(await dialog.getByText("50%",{exact:true}).count(),1);
    assert.equal(await dialog.locator("button[id^=knowledge-card-]").count(),6);
    const sections=dialog.locator("section");assert.equal(await sections.nth(0).locator("button[id^=knowledge-card-]").count(),3);assert.equal(await sections.nth(1).locator("button[id^=knowledge-card-]").count(),3);
    assert.deepEqual(await geometry(),{x:220,y:150,width:1000,height:730});
    for(const icon of await dialog.locator('img[src*="chevron-"]').all()) {
      await icon.evaluate(async e=>{await (e as HTMLImageElement).decode();});
      assert.deepEqual(await icon.evaluate(e=>({width:e.getBoundingClientRect().width,height:e.getBoundingClientRect().height})),{width:16,height:16});
    }
    await page.screenshot({path:`test-results/knowledge-test/${locale}-result.png`});
    await dialog.getByRole("button",{name:copy.nextLesson,exact:true}).click();
    assert.equal(await page.evaluate(()=>(window as unknown as {continued:boolean}).continued),true);
    const openCard=dialog.locator("button[id^=knowledge-card-]").first();
    await openCard.click();
    assert.equal(await dialog.getByText(copy.emptyAnswer,{exact:true}).count(),1);
    assert.equal(await dialog.getByRole("progressbar").count(),0);
    assert.equal(await dialog.getByRole("radio").count(),2);
    for(const radio of await dialog.getByRole("radio").all()) assert.equal(await radio.isDisabled(),true);
    assert.deepEqual(await geometry(),{x:220,y:100,width:1000,height:700});
    await page.screenshot({path:`test-results/knowledge-test/${locale}-detail.png`});
    await dialog.getByRole("button",{name:copy.backToResults,exact:true}).click();
    assert.equal(await openCard.evaluate(e=>e===document.activeElement),true);
    assert.equal(await dialog.getByText("50%",{exact:true}).count(),1);
    await sections.nth(1).locator("button[id^=knowledge-card-]").first().click();
    assert.equal(await dialog.getByText("Answer 2",{exact:true}).count(),1);
    assert.equal(await dialog.getByRole("radio",{name:copy.wrong,exact:true}).isChecked(),true);
    await page.keyboard.press("Escape");
    await dialog.getByRole("heading",{name:copy.result,exact:true}).waitFor();
    assert.equal(await dialog.getByText("50%",{exact:true}).count(),1);
    await page.setViewportSize({width:390,height:844});
    await page.screenshot({path:`test-results/knowledge-test/${locale}-mobile.png`});
    assert.equal(await dialog.evaluate(element=>element.scrollWidth>element.clientWidth || element.getBoundingClientRect().right>innerWidth),false);
    await dialog.getByRole("button",{name:copy.tryApplication+" \u2192",exact:true}).click();
    await dialog.getByRole("heading",{name:getMessages(locale).applicationTest.title,exact:true}).waitFor();
    await page.keyboard.press("Escape");
    await dialog.getByRole("button",{name:/Knowledge Test|\u77e5\u8bc6\u6d4b\u8bd5/}).click();await page.getByRole("textbox").waitFor();
    await page.keyboard.press("Escape");await dialog.getByRole("heading",{name:locale==="en-GB" ? "Lesson 1 completed" : "第 1 课时已完成"}).waitFor();
    await dialog.getByRole("button",{name:/Knowledge Test|\u77e5\u8bc6\u6d4b\u8bd5/}).click();await page.getByRole("textbox").waitFor();
    await page.getByRole("button",{name:copy.close,exact:true}).click();
    assert.equal(await dialog.locator("h2").textContent(),locale==="en-GB" ? "Lesson 1 completed" : "第 1 课时已完成");
    await page.close();
  }} finally { await browser.close(); }
});
