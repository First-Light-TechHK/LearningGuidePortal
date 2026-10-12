import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { build } from "esbuild";
import { chromium } from "playwright";
test("completion Knowledge Test supports six questions, rating gate, results, saved cards and return in both locales", async () => {
  const bundle = await build({ stdin:{contents:`import React from 'react';import {createRoot} from 'react-dom/client';import {LessonCompletedDialog} from './components/portal/LessonCompletedDialog';window.mount=locale=>createRoot(document.getElementById('root')).render(<LessonCompletedDialog locale={locale} lessonNumber="01" onClose={()=>window.closed=true}/>);`,resolveDir:process.cwd(),loader:"tsx"}, bundle:true,write:false,outfile:"test.js",platform:"browser",external:["/portal/*"],jsx:"automatic",loader:{".css":"local-css"},define:{"process.env.NODE_ENV":'"production"'},plugins:[{name:"next-image",setup(b){b.onResolve({filter:/^next\/image$/},()=>({path:"image",namespace:"mock"}));b.onLoad({filter:/.*/,namespace:"mock"},()=>({contents:"import React from 'react';export default function Image(props){return <img {...props}/>}",loader:"tsx",resolveDir:process.cwd()}));}}] });
  const browser = await chromium.launch({channel:"msedge"});
  await mkdir("test-results/knowledge-test",{recursive:true});
  try { for (const locale of ["en-GB", "zh-CN"]) {
    const page = await browser.newPage({viewport:{width:1440,height:1024}});
    await page.route("http://knowledge.test/**",async route=>{const url=new URL(route.request().url());return url.pathname.startsWith("/portal/") ? route.fulfill({body:await readFile(path.join("public",url.pathname)),contentType:"image/svg+xml"}) : route.fulfill({contentType:"text/html",body:'<div id="root"></div>'});});
    await page.goto("http://knowledge.test/");
    await page.addStyleTag({content:bundle.outputFiles.find(f=>f.path.endsWith("css"))!.text});
    for(const weight of [400,500,600,700]) { const font=(await readFile(`node_modules/@fontsource/inter/files/inter-latin-${weight}-normal.woff2`)).toString("base64");await page.addStyleTag({content:`@font-face{font-family:Inter;src:url(data:font/woff2;base64,${font});font-weight:${weight}}`}); }
    await page.addScriptTag({content:bundle.outputFiles.find(f=>f.path.endsWith("js"))!.text});
    await page.evaluate(locale=>(window as unknown as {mount:(locale:string)=>void}).mount(locale),locale);
    const dialog=page.getByRole("dialog"); await dialog.waitFor();await dialog.getByRole("button").first().click();
    const next=page.getByRole("button",{name:locale==="en-GB" ? "Next" : "下一题",exact:true});
    for(let i=0;i<6;i++) {
      await page.getByRole("textbox").fill(`Answer ${i+1}`);
      assert.equal(await dialog.getByText(`${String(i+1).padStart(2,"0")}/06`,{exact:true}).count(),1);
      if(i===0)await page.screenshot({path:`test-results/knowledge-test/${locale}-question.png`});
      await page.getByRole("button",{name:locale==="en-GB" ? "Check answer" : "核对答案",exact:true}).click();
      assert.equal(await next.isDisabled(),true);
      assert.equal(await dialog.getByText(`Answer ${i+1}`,{exact:true}).count(),1);
      if(i===0)await page.screenshot({path:`test-results/knowledge-test/${locale}-answer.png`});
      await page.getByRole("radio",{name:locale==="en-GB" ? (i===0 || i>=4 ? "I got it right" : "I got it wrong") : (i===0 || i>=4 ? "我答对了" : "我答错了")}).check();
      assert.equal(await next.isEnabled(),true);await next.click();
    }
    await dialog.getByRole("heading",{name:locale==="en-GB" ? "Result Review" : "结果回顾"}).waitFor();
    assert.equal(await dialog.getByText("50%",{exact:true}).count(),1);
    assert.equal(await dialog.locator("article").count(),6);
    const sections=dialog.locator("section");assert.equal(await sections.nth(0).locator("article").count(),3);assert.equal(await sections.nth(1).locator("article").count(),3);
    await page.screenshot({path:`test-results/knowledge-test/${locale}-result.png`});
    await dialog.locator("article button").first().click();assert.equal(await dialog.getByText("Answer 1",{exact:true}).count(),1);await next.click();
    await page.setViewportSize({width:390,height:844});
    await page.screenshot({path:`test-results/knowledge-test/${locale}-mobile.png`});
    assert.equal(await dialog.evaluate(element=>element.scrollWidth>element.clientWidth || element.getBoundingClientRect().right>innerWidth),false);
    assert.equal(await sections.nth(0).locator("div[tabindex]").evaluate(element=>element.scrollHeight>element.clientHeight),true);
    await dialog.getByRole("button",{name:locale==="en-GB" ? "Review All Cards >" : "回顾所有卡片 >"}).click();
    assert.equal(await page.getByRole("textbox").inputValue(),"Answer 1");
    for(let i=0;i<6;i++) {
      await page.getByRole("button",{name:locale==="en-GB" ? "Check answer" : "核对答案",exact:true}).click();
      await page.getByRole("radio",{name:locale==="en-GB" ? "I got it right" : "我答对了"}).check();await next.click();
    }
    assert.equal(await dialog.getByText("100%",{exact:true}).count(),1);
    assert.equal(await sections.nth(0).locator("article").count(),6);assert.equal(await sections.nth(1).locator("article").count(),0);
    await dialog.getByRole("button",{name:locale==="en-GB" ? "Done" : "完成",exact:true}).click();
    await dialog.getByRole("button").first().click();await page.getByRole("textbox").waitFor();
    await page.keyboard.press("Escape");await dialog.getByRole("heading",{name:locale==="en-GB" ? "Lesson 1 completed" : "第 1 课时已完成"}).waitFor();
    await dialog.getByRole("button").first().click();await page.getByRole("textbox").waitFor();
    await page.getByRole("button",{name:locale==="en-GB" ? "Exit" : "退出",exact:true}).click();
    assert.equal(await dialog.locator("h2").textContent(),locale==="en-GB" ? "Lesson 1 completed" : "第 1 课时已完成");
    await page.close();
  }} finally { await browser.close(); }
});
