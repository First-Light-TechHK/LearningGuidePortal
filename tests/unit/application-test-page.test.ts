import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { build } from "esbuild";
import { chromium } from "playwright";
import { getMessages } from "../../lib/i18n/messages";
import { getApplicationTestSample } from "../../services/applicationTestSample";

test("Application Test matches the four page states and retains attempts across both Knowledge completion flows", async () => {
  const bundle=await build({stdin:{contents:`import React from 'react';import {createRoot} from 'react-dom/client';import {LessonCompletedDialog} from './components/portal/LessonCompletedDialog';import previewStyles from './components/portal/preview-lesson.module.css';function Demo({locale}){const [open,setOpen]=React.useState(true);return open ? <div className="la"><header className={previewStyles.heading}><p>01</p><LessonCompletedDialog locale={locale} lessonNumber="01" lessonTitle="Looking closely" onContinue={()=>{window.continued=true;setOpen(false)}} onClose={()=>setOpen(false)}/></header></div> : <button onClick={()=>setOpen(true)}>Reopen</button>};window.mount=locale=>createRoot(document.getElementById('root')).render(<Demo locale={locale}/>);`,resolveDir:process.cwd(),loader:"tsx"},bundle:true,write:false,outfile:"test.js",platform:"browser",external:["/portal/*"],jsx:"automatic",loader:{".css":"local-css"},define:{"process.env.NODE_ENV":'"production"'},plugins:[{name:"next",setup(b){b.onResolve({filter:/^next\/image$/},()=>({path:"image",namespace:"mock"}));b.onLoad({filter:/.*/,namespace:"mock"},()=>({contents:"import React from 'react';export default function Image(props){return <img {...props}/>}",loader:"tsx",resolveDir:process.cwd()}));}}]});
  const browser=await chromium.launch({channel:"msedge"});
  await mkdir("test-results/application-test",{recursive:true});
  try { for(const locale of ["en-GB","zh-CN"] as const) {
    const copy=getMessages(locale), app=copy.applicationTest, common=copy.knowledgeTest;
    const page=await browser.newPage({viewport:{width:1440,height:1024}});
    await page.route("http://application.test/**",async route=>{const url=new URL(route.request().url());return url.pathname.startsWith("/portal/") ? route.fulfill({body:await readFile(path.join("public",url.pathname)),contentType:"image/svg+xml"}) : route.fulfill({contentType:"text/html",body:'<div id="root"></div>'});});
    await page.goto("http://application.test/");
    for (const file of ["app/styles.css","components/portal/lesson-authoring.css"]) await page.addStyleTag({content:await readFile(file,"utf8")});
    await page.addStyleTag({content:bundle.outputFiles.find(f=>f.path.endsWith("css"))!.text});
    for(const weight of [400,500,600,700]){const font=(await readFile(`node_modules/@fontsource/inter/files/inter-latin-${weight}-normal.woff2`)).toString("base64");await page.addStyleTag({content:`@font-face{font-family:Inter;src:url(data:font/woff2;base64,${font});font-weight:${weight}}`});}
    await page.addScriptTag({content:bundle.outputFiles.find(f=>f.path.endsWith("js"))!.text});
    await page.evaluate(locale=>(window as unknown as {mount:(locale:string)=>void}).mount(locale),locale);
    const dialog=page.getByRole("dialog");
    const openApplication=()=>dialog.getByRole("button",{name:new RegExp(copy.lessonCompleted.application)}).click();
    await openApplication();
    await dialog.getByRole("heading",{name:app.title,exact:true}).waitFor();
    const assertPlainText = async () => {
      const backgrounds=await dialog.locator("p, h3").evaluateAll(elements=>elements.map(e=>{const s=getComputedStyle(e);return {background:s.backgroundColor,padding:s.padding,radius:s.borderRadius};}));
      for(const style of backgrounds) assert.deepEqual(style,{background:"rgba(0, 0, 0, 0)",padding:"0px",radius:"0px"},"Application text must not inherit the playback lesson badge");
      assert.deepEqual(await dialog.locator("header p").evaluate(e=>{const s=getComputedStyle(e);return {size:s.fontSize,weight:s.fontWeight,color:s.color,font:s.fontFamily.split(",")[0]};}),{size:"14px",weight:"400",color:"rgb(99, 117, 148)",font:"Inter"});
      assert.equal(await page.locator("#root > .la > header > p").evaluate(e=>getComputedStyle(e).backgroundColor),"rgb(232, 241, 255)","the playback lesson number retains its badge");
    };
    await assertPlainText();
    const input=dialog.getByRole("textbox");
    const submit=dialog.getByRole("button",{name:app.submit,exact:true});
    assert.equal(await submit.isDisabled(),true);
    await input.fill(" \n ");assert.equal(await submit.isDisabled(),true);
    const answer=getApplicationTestSample(locale).sampleAnswer;
    await input.fill(answer);assert.equal(await submit.isEnabled(),true);
    assert.equal(await input.getAttribute("maxlength"),"2000");
    const geometry=await dialog.evaluate(d=>{const q=d.querySelector('section[aria-labelledby="application-question-title"]')!;const a=d.querySelector('textarea')!.parentElement!;return {dialog:[d.getBoundingClientRect().x,d.getBoundingClientRect().y,d.clientWidth,d.clientHeight],question:[q.getBoundingClientRect().x,q.getBoundingClientRect().y,q.getBoundingClientRect().width,q.getBoundingClientRect().height],answer:[a.getBoundingClientRect().x,a.getBoundingClientRect().y,a.getBoundingClientRect().width,a.getBoundingClientRect().height]};});
    assert.deepEqual(geometry,{dialog:[0,0,1440,1024],question:[120,104,480,888],answer:[632,141,688,755]});
    await input.fill("");await input.blur();await page.screenshot({path:`test-results/application-test/${locale}-answer.png`});
    await input.fill(answer);
    await page.keyboard.press("Escape");await openApplication();assert.equal(await input.inputValue(),answer,"Exit retains draft within this lesson");
    await page.clock.install();await page.clock.pauseAt(new Date(Date.now()+1000));
    await submit.click();assert.equal(await submit.count(),0);assert.equal(await input.inputValue(),answer);assert.equal(await input.getAttribute("readonly"),"");
    const progress=dialog.getByRole("progressbar");await progress.waitFor();await page.clock.runFor(1500);
    assert.ok(Number(await progress.getAttribute("aria-valuenow"))>=49);
    await page.screenshot({path:`test-results/application-test/${locale}-evaluating.png`});
    await page.setViewportSize({width:390,height:844});
    await dialog.getByRole("status").scrollIntoViewIfNeeded();
    assert.equal(await dialog.evaluate(e=>e.scrollWidth>e.clientWidth),false);
    await page.screenshot({path:`test-results/application-test/${locale}-evaluating-mobile.png`});
    await page.setViewportSize({width:1440,height:1024});
    await dialog.getByRole("button",{name:common.exit,exact:true}).click();
    await page.clock.runFor(2000);
    assert.equal(await dialog.getByRole("heading",{name:app.feedback,exact:true}).count(),0,"finishing in background never reopens the test");
    await openApplication();
    await dialog.getByRole("heading",{name:app.feedback,exact:true}).waitFor();
    await assertPlainText();
    assert.equal(await dialog.getByText(answer,{exact:true}).count(),1);
    const result=dialog.locator('div[aria-label]').filter({has:page.getByRole("heading",{name:app.feedback,exact:true})});
    const next=dialog.getByRole("button",{name:app.nextLesson,exact:true});
    const knowledge=dialog.getByRole("button",{name:app.tryKnowledge+" →",exact:true});
    assert.equal(await next.isVisible(),true);assert.equal(await knowledge.isVisible(),true);
    assert.equal(await result.evaluate(e=>e.scrollHeight>e.clientHeight),true);
    await page.screenshot({path:`test-results/application-test/${locale}-result-knowledge-pending.png`});
    await dialog.getByRole("button",{name:app.resultBack,exact:true}).click();await openApplication();
    assert.equal(await dialog.getByText(answer,{exact:true}).count(),1,"Back retains the result within this lesson");
    await result.evaluate(e=>e.scrollTop=e.scrollHeight);
    assert.equal(await result.evaluate(e=>e.scrollTop>0),true);
    await knowledge.click();
    for(let i=0;i<6;i++) {
      await dialog.getByRole("textbox").fill(`Answer ${i+1}`);
      await dialog.getByRole("button",{name:common.check,exact:true}).click();
      await dialog.getByRole("radio",{name:common.right,exact:true}).check();
      await dialog.getByRole("button",{name:i===5?common.seeResults:common.next,exact:true}).click();
    }
    await dialog.getByRole("button",{name:common.tryApplication+" →",exact:true}).click();
    await dialog.getByRole("heading",{name:app.feedback,exact:true}).waitFor();
    assert.equal(await dialog.getByText(answer,{exact:true}).count(),1);
    assert.equal(await knowledge.count(),0);
    assert.equal(await dialog.getByRole("button",{name:app.nextLesson+" →",exact:true}).isVisible(),true);
    await page.screenshot({path:`test-results/application-test/${locale}-result-knowledge-done.png`});
    for(const viewport of [{width:1024,height:600},{width:1440,height:450},{width:390,height:844}]) {
      await page.setViewportSize(viewport);
      assert.equal(await dialog.evaluate(e=>e.scrollWidth>e.clientWidth || e.getBoundingClientRect().right>innerWidth),false);
      await dialog.getByRole("button",{name:app.nextLesson+" →",exact:true}).scrollIntoViewIfNeeded();
      assert.equal(await dialog.getByRole("button",{name:app.nextLesson+" →",exact:true}).isVisible(),true);
      await page.screenshot({path:`test-results/application-test/${locale}-result-${viewport.width}x${viewport.height}.png`});
    }
    await dialog.getByRole("button",{name:app.nextLesson+" →",exact:true}).click();
    assert.equal(await dialog.count(),0);assert.equal(await page.evaluate(()=>(window as unknown as {continued:boolean}).continued),true);
    await page.getByRole("button",{name:"Reopen"}).click();await openApplication();await input.fill("x".repeat(2000));
    assert.equal(await dialog.evaluate(e=>e.scrollWidth>e.clientWidth),false);
    await submit.scrollIntoViewIfNeeded();await page.screenshot({path:`test-results/application-test/${locale}-answer-mobile.png`});
    const assets=await dialog.locator('img').evaluateAll(elements=>elements.map(e=>({source:e.getAttribute('src'),loaded:(e as HTMLImageElement).complete&&(e as HTMLImageElement).naturalWidth>0,width:e.getBoundingClientRect().width,height:e.getBoundingClientRect().height})));
    assert.deepEqual(assets,[{source:"/portal/application-test/back-v2.svg",loaded:true,width:18,height:18},{source:"/portal/application-test/saved-v2.svg",loaded:true,width:7,height:7}]);
    await page.keyboard.press("Escape");await dialog.getByRole("heading",{name:copy.lessonCompleted.title.replace("{number}","1"),exact:true}).waitFor();
    await page.close();
  }}finally{await browser.close();}
});
