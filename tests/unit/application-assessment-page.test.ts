import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile, mkdir } from "node:fs/promises";
import { build } from "esbuild";
import { chromium } from "playwright";
import { getMessages } from "../../lib/i18n/messages";

test("persisted application evaluates, retries, renders five regions and restores LaTeX in both locales", async () => {
  const bundle=await build({stdin:{contents:`import React from 'react';import{createRoot}from'react-dom/client';import{PersistedAssessmentDialog}from'./components/portal/PersistedAssessmentDialog';const root=createRoot(document.getElementById('root'));let key=0;window.mount=locale=>root.render(<PersistedAssessmentDialog key={++key} locale={locale} courseId="course" lessonId="lesson" lessonNumber="01" kind="application" onExit={()=>{}}/>);`,loader:"tsx",resolveDir:process.cwd()},bundle:true,write:false,outfile:"test.js",platform:"browser",jsx:"automatic",loader:{".css":"local-css",".woff2":"dataurl"},plugins:[{name:"image",setup(b){b.onResolve({filter:/^mathlive$/},()=>({path:"http://assessment.test/mathlive.mjs",external:true}));b.onResolve({filter:/^next\/image$/},()=>({path:"image",namespace:"mock"}));b.onLoad({filter:/.*/,namespace:"mock"},()=>({contents:"export default function Image(){return null}",loader:"tsx"}));}}]});
  const browser=await chromium.launch();await mkdir("test-results/application-assessment",{recursive:true});
  try {for(const locale of ["en-GB","zh-CN"] as const){
    const copy=getMessages(locale),page=await browser.newPage({viewport:{width:1440,height:1024}});
    const errors:string[]=[];page.on("pageerror",error=>errors.push(error.message));
    let record:any={version:1,attempt:{kind:"application",answer:String.raw`\frac{2}{3}`,phase:"answer"}},failed=true,calls=0,writes=0;
    await page.route("http://assessment.test/**",async route=>{
      const url=new URL(route.request().url());
      if(url.pathname==="/mathlive.mjs")return route.fulfill({contentType:"application/javascript",body:await readFile("node_modules/mathlive/mathlive.min.mjs","utf8")});
      if(url.pathname==="/editor.js")return route.fulfill({contentType:"application/javascript",body:bundle.outputFiles.find(file=>file.path.endsWith("js"))!.text});
      if(url.pathname.startsWith('/fonts/'))return route.fulfill({body:await readFile('node_modules/katex/dist'+url.pathname),contentType:'font/woff2'});
      if(!url.pathname.startsWith("/api/"))return route.fulfill({contentType:"text/html",body:'<!doctype html><div id="root"></div>'});
      if(url.pathname.endsWith("/knowledge"))return route.fulfill({json:{ok:true,data:null}});
      if(route.request().method()==="GET")return route.fulfill({json:{ok:true,data:record,definition:{knowledge:[],application:{id:"question",paragraphs:["Question"],reference:["MUST NOT DISPLAY PORTAL REFERENCE"]}}}});
      const body=route.request().postDataJSON();
      if(url.pathname.endsWith("/evaluate")){
        calls++;if(failed){failed=false;return route.fulfill({status:503,json:{ok:false}});}
        record={...record,version:(record?.version||0)+2,attempt:{...body.attempt,phase:"submitted"},evaluation:{status:"done",result:{evaluationId:"fixture",status:"evaluated",yourAnswer:body.attempt.answer,releaseId:"existing",referenceAnswer:{status:"available",contentMarkdown:"Reference $x^2$\n\nThe next paragraph explains the model and remains clearly separated from the preceding paragraph, including when it wraps on a narrow screen.\n\n| A | B |\n|---|---|\n| 1 | 2 |\n\nFinal paragraph after the table.",sourceTitle:"Existing Q&A"},feedback:{schemaVersion:"application_feedback.v2",overallBand:"developing",whatYouDidWell:["Confirmed step $x^2$."],areasToImprove:["Explain the next step."],needsReview:false,reviewReason:null}}}};
      }else{writes++;record={...record,version:body.expectedVersion+1,attempt:body.attempt,completedAt:null};}
      return route.fulfill({json:{ok:true,data:record}});
    });
    await page.goto("http://assessment.test/");
    await page.addStyleTag({content:await readFile("app/styles.css","utf8")});
    await page.addStyleTag({content:await readFile("node_modules/katex/dist/katex.min.css","utf8")});
    await page.addStyleTag({content:bundle.outputFiles.find(file=>file.path.endsWith("css"))!.text});
    await page.addScriptTag({url:"http://assessment.test/editor.js"});
    const mount=()=>page.evaluate(locale=>(window as unknown as {mount:(locale:string)=>void}).mount(locale),locale);
    await mount();
    await page.locator('.tiptap [data-type="block-math"] .katex').waitFor();
    assert.equal(await page.getByRole("switch",{name:copy.assessmentEditor.sourceMode,exact:true}).count(),1,"existing bare LaTeX opens visually");
    assert.equal(record.attempt.answer,String.raw`\frac{2}{3}`);
    assert.equal(writes,0,"opening a visual formula does not save a migration");
    await page.getByRole("textbox").fill("");
    await page.getByRole("textbox").evaluate(el=>{
      const clipboard=new DataTransfer();clipboard.setData("text/plain",String.raw`Result: \(x^2\).`);
      el.dispatchEvent(new ClipboardEvent("paste",{clipboardData:clipboard,bubbles:true,cancelable:true}));
    });
    await page.locator('.tiptap [data-type="inline-math"] .katex').waitFor();
    await page.getByRole("textbox").fill("Visual answer: ");
    await page.getByRole("button",{name:copy.applicationAssessment.formula,exact:true}).click();
    await page.locator("math-field").waitFor({timeout:3000});
    await page.getByRole("button",{name:"a/b",exact:true}).click();
    assert.ok((await page.locator("math-field").evaluate((el:any)=>el.value)).includes("frac"),"template creates an editable fraction");
    await page.getByRole("button",{name:copy.assessmentEditor.mathKeyboard,exact:true}).click();
    await page.waitForTimeout(400);await page.screenshot({path:`test-results/application-assessment/${locale}-formula-editor.png`});
    await page.locator("summary").filter({hasText:"LaTeX"}).click();
    await page.getByLabel("LaTeX",{exact:true}).fill("\\frac{2}{3}");
    await page.getByRole("button",{name:locale === "zh-CN" ? "应用" : "Apply",exact:true}).click();
    await page.locator(".tiptap .katex").first().waitFor({timeout:3000});
    for (let reopen=0;reopen<3;reopen++) {
      await page.locator('.tiptap [data-type="inline-math"]').click();
      await page.locator("math-field").waitFor({timeout:3000});
      assert.equal(await page.locator("math-field").evaluate((el:any)=>el.value),"\\frac{2}{3}","editing an existing formula restores its value after the module is cached");
      await page.getByRole("button",{name:copy.assessmentEditor.mathKeyboard,exact:true}).click();
      assert.equal(await page.evaluate(()=>window.mathVirtualKeyboard.visible),true);
      await page.locator("math-field").focus();
      if (reopen === 2) await page.getByRole("dialog",{name:copy.assessmentEditor.insertEquation,exact:true}).evaluate(el=>el.dispatchEvent(new Event("cancel",{cancelable:true})));
      else await page.keyboard.press("Escape");
      await page.getByRole("dialog",{name:copy.assessmentEditor.insertEquation,exact:true}).waitFor({state:"detached",timeout:3000});
      assert.equal(await page.getByRole("dialog").count(),1,"Escape closes only the equation dialog");
      await page.waitForTimeout(250);
      assert.equal(await page.evaluate(()=>window.mathVirtualKeyboard.visible),false,"Escape leaves no keyboard on the page");
      assert.equal(await page.evaluate(()=>window.mathVirtualKeyboard.container===document.body),true);
    }
    await page.getByRole("button",{name:copy.applicationAssessment.formula,exact:true}).click();
    await page.locator("summary").filter({hasText:"LaTeX"}).click();
    await page.getByLabel("LaTeX",{exact:true}).fill("x^2");
    await page.getByRole("checkbox",{name:copy.assessmentEditor.separateLine}).check();
    await page.setViewportSize({width:390,height:844});
    const equationDialog=page.getByRole("dialog",{name:copy.assessmentEditor.insertEquation,exact:true});
    assert.equal(await equationDialog.evaluate(el=>el.scrollWidth>el.clientWidth),false,"mobile formula dialog fits its viewport");
    await page.screenshot({path:`test-results/application-assessment/${locale}-formula-mobile.png`});
    await page.getByRole("button",{name:copy.assessmentEditor.apply,exact:true}).click();
    await page.locator('.tiptap [data-type="block-math"] .katex').waitFor();
    await page.setViewportSize({width:1440,height:1024});

    await page.getByRole("switch",{name:copy.assessmentEditor.sourceMode,exact:true}).click();const input=page.getByRole("textbox");await input.waitFor();
    await input.fill("x^2");await input.evaluate((field:HTMLTextAreaElement)=>{field.focus();field.select();});
    await page.getByRole("button",{name:copy.applicationAssessment.formula,exact:true}).click();
    await page.locator("summary").filter({hasText:"LaTeX"}).click();await page.getByLabel("LaTeX",{exact:true}).fill("x^2");await page.getByRole("button",{name:locale === "zh-CN" ? "应用" : "Apply",exact:true}).click();
    assert.equal(await input.inputValue(),String.raw`\(x^2\)`);
    const answer=String.raw`My result: \(x^2\).`;
    await input.fill(answer);await page.getByRole("switch",{name:copy.assessmentEditor.sourceMode,exact:true}).click();
    assert.ok(await page.locator(".tiptap .katex").count());
    await page.getByRole("switch",{name:copy.assessmentEditor.sourceMode,exact:true}).click();assert.equal(await input.inputValue(),answer);
    const writesBeforeDebounce=writes;await page.waitForTimeout(1000);assert.equal(writes,writesBeforeDebounce,"autosave waits for three seconds of inactivity");
    await page.waitForTimeout(2200);assert.equal(record.attempt.answer,answer);
    const submit=page.getByRole("button",{name:copy.applicationTest.submit,exact:true});
    await submit.click();await page.getByRole("button",{name:copy.assessmentFlow.cancel,exact:true}).waitFor();assert.equal(await page.getByRole("button",{name:copy.assessmentFlow.cancel,exact:true}).evaluate(el=>el===document.activeElement),true);await page.screenshot({path:`test-results/application-assessment/${locale}-confirm.png`});assert.equal(calls,0);await page.getByRole("button",{name:copy.assessmentFlow.cancel,exact:true}).click();assert.equal(calls,0);assert.equal(await input.inputValue(),answer);
    await submit.click();await page.getByRole("button",{name:copy.assessmentFlow.confirm,exact:true}).click();await page.getByRole("alert").waitFor({timeout:3000});assert.equal(await input.inputValue(),answer);
    assert.equal((await page.getByRole("alert").textContent())?.trim(),copy.assessmentFlow.submissionError);
    await input.fill(answer+" Revised");assert.equal(await page.getByRole("alert").count(),0);
    await page.getByText(copy.assessmentFlow.dirty,{exact:true}).waitFor();await input.fill(answer);
    await submit.click();await page.getByRole("button",{name:copy.assessmentFlow.confirm,exact:true}).click();await page.getByRole("heading",{name:copy.applicationTest.feedback,exact:true}).waitFor();
    assert.equal(calls,2);assert.equal(await page.getByText(copy.applicationAssessment.developing,{exact:true}).count(),1);
    assert.equal(await page.getByText("MUST NOT DISPLAY PORTAL REFERENCE").count(),0);
    assert.ok(await page.locator(".katex").count()>=3);assert.equal(await page.locator("table").count(),1);
    const assertReferenceSpacing = async () => {
      const paragraphs=page.locator('section[class*="reference"] .tutor-answer > p');
      const layout=await paragraphs.evaluateAll(elements=>elements.map(element=>({top:element.getBoundingClientRect().top,bottom:element.getBoundingClientRect().bottom,margin:getComputedStyle(element).marginBottom,lineHeight:getComputedStyle(element).lineHeight})));
      assert.equal(layout.length,3);
      assert.equal(layout[0].margin,"14px");assert.equal(layout[0].lineHeight,"25.5px");
      assert.ok(layout[1].top-layout[0].bottom>=13.9,"reference paragraphs retain a visible gap without overlap");
      assert.equal(layout[2].margin,"0px","the last paragraph adds no trailing gap");
    };
    await assertReferenceSpacing();
    await page.screenshot({path:`test-results/application-assessment/${locale}-desktop.png`});
    await mount();await page.getByRole("heading",{name:copy.applicationTest.feedback,exact:true}).waitFor();assert.equal(calls,2,"reopening never re-evaluates");
    for (const [oldBand, newBand] of [["strong","strong"],["mostly_good","developing"],["partial","developing"],["weak","needs_review"],["insufficient_evidence","needs_review"]] as const) {
      record.evaluation.result.feedback.schemaVersion="application_feedback.v1";
      record.evaluation.result.feedback.overallBand=oldBand;
      const historical=JSON.stringify(record);
      await mount();await page.getByText(copy.applicationAssessment[newBand],{exact:true}).waitFor();
      assert.equal(JSON.stringify(record),historical,"displaying an old grade never rewrites the saved evaluation");
      assert.equal(calls,2,"historical mapping never calls the evaluator again");
    }
    record.evaluation.result.feedback.schemaVersion="application_feedback.v2";
    record.evaluation.result.feedback.overallBand="developing";
    await mount();await page.getByText(copy.applicationAssessment.developing,{exact:true}).waitFor();
    await page.setViewportSize({width:390,height:844});assert.equal(await page.getByRole("dialog").evaluate(e=>e.scrollWidth>e.clientWidth),false);
    await assertReferenceSpacing();
    await page.screenshot({path:`test-results/application-assessment/${locale}-mobile.png`});
    await page.getByRole("button",{name:copy.applicationTest.retake,exact:true}).click();await page.getByRole("switch",{name:copy.assessmentEditor.sourceMode,exact:true}).click();await input.waitFor();assert.equal(await input.inputValue(),answer,"revision starts with the submitted answer");
    await input.fill("x".repeat(2000));assert.equal(await input.inputValue(),"x".repeat(2000));
    record={...record,attempt:{kind:"application",answer:"Expired submission",phase:"evaluating"},evaluation:{id:"expired",eventId:"expired-event",status:"pending",startedAt:new Date(Date.now()-90001).toISOString()}};
    await mount();await page.locator('.tiptap[contenteditable="false"]').waitFor();
    assert.equal(await page.getByRole("button",{name:copy.assessmentRecords.retry,exact:true}).isEnabled(),true,"an expired submission offers retry without unlocking its answer");
    assert.deepEqual(errors,[]);await page.close();
  }}finally{await browser.close();}
});
