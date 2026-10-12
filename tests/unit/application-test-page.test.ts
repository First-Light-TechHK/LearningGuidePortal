import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { build } from "esbuild";
import { chromium } from "playwright";
import { getMessages } from "../../lib/i18n/messages";
test("Application Test keeps answers through a three-second evaluation, supports both locales and Done closes all dialogs", async () => {
  const bundle=await build({stdin:{contents:`import React from 'react';import {createRoot} from 'react-dom/client';import {LessonCompletedDialog} from './components/portal/LessonCompletedDialog';function Demo({locale}){const [open,setOpen]=React.useState(true);return open ? <LessonCompletedDialog locale={locale} lessonNumber="01" onClose={()=>setOpen(false)}/> : <button onClick={()=>setOpen(true)}>Reopen</button>};window.mount=locale=>createRoot(document.getElementById('root')).render(<Demo locale={locale}/>);`,resolveDir:process.cwd(),loader:"tsx"},bundle:true,write:false,outfile:"test.js",platform:"browser",external:["/portal/*"],jsx:"automatic",loader:{".css":"local-css"},define:{"process.env.NODE_ENV":'"production"'},plugins:[{name:"next",setup(b){b.onResolve({filter:/^next\/image$/},()=>({path:"image",namespace:"mock"}));b.onLoad({filter:/.*/,namespace:"mock"},()=>({contents:"import React from 'react';export default function Image(props){return <img {...props}/>}",loader:"tsx",resolveDir:process.cwd()}));}}]});
  const browser=await chromium.launch({channel:"msedge"});
  await mkdir("test-results/application-test",{recursive:true});
  try { for(const locale of ["en-GB","zh-CN"] as const) {
    const copy=getMessages(locale), app=copy.applicationTest;
    const page=await browser.newPage({viewport:{width:1440,height:1024}});
    await page.route("http://application.test/**",async route=>{const url=new URL(route.request().url());return url.pathname.startsWith("/portal/") ? route.fulfill({body:await readFile(path.join("public",url.pathname)),contentType:"image/svg+xml"}) : route.fulfill({contentType:"text/html",body:'<div id="root"></div>'});});
    await page.goto("http://application.test/");await page.addStyleTag({content:await readFile("app/styles.css","utf8")});await page.addStyleTag({content:bundle.outputFiles.find(f=>f.path.endsWith("css"))!.text});
    for(const weight of [400,500,600,700]){const font=(await readFile(`node_modules/@fontsource/inter/files/inter-latin-${weight}-normal.woff2`)).toString("base64");await page.addStyleTag({content:`@font-face{font-family:Inter;src:url(data:font/woff2;base64,${font});font-weight:${weight}}`});}
    await page.addScriptTag({content:bundle.outputFiles.find(f=>f.path.endsWith("js"))!.text});await page.evaluate(locale=>(window as unknown as {mount:(locale:string)=>void}).mount(locale),locale);
    const dialog=page.getByRole("dialog");await dialog.waitFor();await dialog.getByRole("button").nth(1).click();
    const submit=dialog.getByRole("button",{name:app.submit,exact:true});assert.equal(await submit.isDisabled(),true);
    const input=dialog.getByRole("textbox");
    const assertSingleBorder=async()=>assert.deepEqual(await input.evaluate(e=>{const field=getComputedStyle(e),box=getComputedStyle(e.parentElement!);return {background:box.backgroundImage,border:box.borderTopWidth,innerBorder:field.borderTopWidth,outline:field.outlineStyle,shadow:field.boxShadow};}),{background:"none",border:"1px",innerBorder:"0px",outline:"none",shadow:"none"});
    await assertSingleBorder();await input.fill("   ");await assertSingleBorder();assert.equal(await submit.isDisabled(),true);
    const answer="Hawks and doves have equal expected payoffs at equilibrium.\nCompare their expected survival rates.";
    await input.fill(answer);assert.equal(await submit.isEnabled(),true);assert.equal(await input.getAttribute("maxlength"),"2000");
    await page.screenshot({path:`test-results/application-test/${locale}-answer.png`});
    await page.clock.install();await page.clock.pauseAt(new Date(Date.now()+1000));await submit.click();
    assert.equal(await submit.count(),0);assert.equal(await input.inputValue(),answer);assert.equal(await input.getAttribute("readonly"),"");await assertSingleBorder();
    const progress=dialog.getByRole("progressbar");await progress.waitFor();await page.clock.runFor(1500);
    const percentage=Number(await progress.getAttribute("aria-valuenow"));assert.ok(percentage>=49 && percentage<=51);
    assert.equal(await dialog.getByRole("heading",{name:app.title,exact:true}).count(),1);
    await page.screenshot({path:`test-results/application-test/${locale}-evaluating.png`});
    await dialog.getByRole("button",{name:app.expand,exact:true}).click();assert.equal(await dialog.getByRole("button",{name:app.restore,exact:true}).getAttribute("aria-pressed"),"true");await dialog.getByRole("button",{name:app.restore,exact:true}).click();
    await page.clock.runFor(1499);assert.equal(await progress.count(),1);await page.clock.runFor(1);
    await dialog.getByRole("heading",{name:copy.knowledgeTest.result,exact:true}).waitFor();assert.equal(await dialog.getByText(answer,{exact:true}).count(),1);
    assert.equal(await dialog.getByRole("heading",{name:app.strengths,exact:true}).count(),1);assert.equal(await dialog.getByRole("heading",{name:app.improvement,exact:true}).count(),1);
    await page.screenshot({path:`test-results/application-test/${locale}-result.png`});await page.setViewportSize({width:390,height:844});await page.screenshot({path:`test-results/application-test/${locale}-mobile.png`});
    assert.equal(await dialog.evaluate(e=>e.scrollWidth>e.clientWidth || e.getBoundingClientRect().right>innerWidth),false);
    await dialog.getByRole("button",{name:copy.knowledgeTest.done,exact:true}).click();assert.equal(await dialog.count(),0);
    await page.getByRole("button",{name:"Reopen"}).click();await dialog.getByRole("button").nth(1).click();await input.fill(answer);await submit.click();await dialog.getByRole("button",{name:app.back,exact:true}).click();
    await page.clock.runFor(4000);assert.equal(await dialog.getByRole("heading",{name:copy.lessonCompleted.title.replace("{number}","1"),exact:true}).count(),1,"returning during evaluation must cancel its timer");
    await dialog.getByRole("button").nth(1).click();assert.equal(await input.inputValue(),"");await page.keyboard.press("Escape");await dialog.getByRole("button").nth(1).click();await page.setViewportSize({width:390,height:844});await input.fill("x".repeat(2000));
    assert.equal(await dialog.evaluate(e=>e.scrollWidth>e.clientWidth),false);await assertSingleBorder();await page.screenshot({path:`test-results/application-test/${locale}-answer-mobile.png`});
    await page.close();
  }}finally{await browser.close();}
});
