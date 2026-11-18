import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile } from "node:fs/promises";
import { build } from "esbuild";
import { chromium } from "playwright";
import { getMessages } from "../../lib/i18n/messages";

test("answer input browser boundary matrix",async t=>{
 const bundle=await build({stdin:{contents:`import React from 'react';import{createRoot}from'react-dom/client';import{AssessmentAnswerInput}from'./components/portal/AssessmentAnswerInput';import{PortalDialog}from'./components/portal/PortalDialog';const root=createRoot(document.getElementById('root'));let key=0;function Demo(p){const[value,setValue]=React.useState(p.value);React.useLayoutEffect(()=>{window.ready=p.id});window.answer=value;return <PortalDialog labelledBy="title" onClose={()=>root.render(null)}><h2 id="title">Answer fixture</h2><AssessmentAnswerInput id="answer" locale={p.locale} value={value} onChange={v=>{window.changes++;setValue(v)}} maxLength={2000} placeholder="Answer" readOnly={p.readOnly}/></PortalDialog>};window.reset=(value,locale,readOnly=false)=>{window.changes=0;const id=++key;root.render(<Demo key={id} id={id} value={value} locale={locale} readOnly={readOnly}/>);return id};window.unmount=()=>root.render(null);`,loader:"tsx",resolveDir:process.cwd()},bundle:true,write:false,outfile:"test.js",platform:"browser",jsx:"automatic",loader:{".css":"local-css",".woff2":"dataurl"},plugins:[{name:"mathlive",setup(b){b.onResolve({filter:/^mathlive$/},()=>({path:"http://input.test/mathlive.mjs",external:true}));}}]});
 const browser=await chromium.launch();
 try{for(const locale of ["en-GB","zh-CN"] as const){
  const page=await browser.newPage({viewport:{width:1440,height:900}}),errors:string[]=[];
  page.on("pageerror",e=>errors.push(e.message));
  await page.route("http://input.test/**",async r=>{
   const path=new URL(r.request().url()).pathname;
   if(path==="/mathlive.mjs")return r.fulfill({contentType:"application/javascript",body:await readFile("node_modules/mathlive/mathlive.min.mjs","utf8")});
   if(path==="/test.js")return r.fulfill({contentType:"application/javascript",body:bundle.outputFiles.find(f=>f.path.endsWith("js"))!.text});
   return r.fulfill({contentType:"text/html",body:'<!doctype html><div id="root"></div>'});
  });
  await page.goto("http://input.test/");
  for(const path of ["app/styles.css","node_modules/katex/dist/katex.min.css"])await page.addStyleTag({content:await readFile(path,"utf8")});
  await page.addStyleTag({content:bundle.outputFiles.find(f=>f.path.endsWith("css"))!.text});
  await page.addScriptTag({url:"http://input.test/test.js"});
  const copy=getMessages(locale),reset=async(value="",readOnly=false)=>{const id=await page.evaluate(({value,locale,readOnly})=>(window as any).reset(value,locale,readOnly),{value,locale,readOnly});await page.waitForFunction(id=>(window as any).ready===id,id);};
  const answer=()=>page.evaluate(()=>(window as any).answer as string);
  const open=async()=>{await page.getByRole("button",{name:copy.applicationAssessment.formula,exact:true}).click();await page.locator("math-field").waitFor();};
  const latex=async(value:string)=>{await page.locator("summary").filter({hasText:"LaTeX"}).click();await page.getByLabel("LaTeX",{exact:true}).fill(value);};
  const apply=()=>page.getByRole("button",{name:copy.assessmentEditor.apply,exact:true}).click();
  const paste=async(text:string)=>page.getByRole("textbox").evaluate((el,text)=>{const data=new DataTransfer();data.setData("text/plain",text);el.dispatchEvent(new ClipboardEvent("paste",{clipboardData:data,bubbles:true,cancelable:true}));},text);
  for(const value of ["","   ","中文🙂",String.raw`\(x^2\)`,String.raw`\frac{2}{3}`,"$5 and $10",String.raw`\(\frac{\)`,"\uFFFC9999\uFFFC","**Bold**\n$x$"]){await t.test(`${locale} load ${JSON.stringify(value)}`,async()=>{await reset(value);assert.equal(await answer(),value);assert.equal(await page.evaluate(()=>(window as any).changes),0);});}
  await t.test(`${locale} 1999/2000/2001 text and continued editing`,async()=>{
   await reset("x".repeat(1999));const input=page.getByRole("textbox");await input.click();await page.keyboard.press("Control+End");await page.keyboard.insertText("y");assert.equal((await answer()).length,2000);await page.keyboard.insertText("z");assert.equal((await answer()).length,2000);await page.getByRole("alert").waitFor();await input.click();await page.keyboard.press("Control+End");await page.keyboard.press("Backspace");assert.equal((await answer()).length,1999);
  });
  await t.test(`${locale} paste formula over limit is atomic`,async()=>{await reset("x".repeat(1999));await paste(String.raw`\(x\)`);assert.equal(await answer(),"x".repeat(1999));await page.getByRole("alert").waitFor();});
  await t.test(`${locale} formula at exact limit undo redo`,async()=>{
   await reset("x".repeat(1995));await page.getByRole("textbox").click();await page.keyboard.press("Control+End");await open();await latex("x");await apply();assert.equal((await answer()).length,2000);
   await page.getByRole("textbox").focus();await page.keyboard.press("Control+z");assert.equal(await answer(),"x".repeat(1995));await page.keyboard.press("Control+Shift+z");assert.equal((await answer()).length,2000);
  });
  await t.test(`${locale} oversized/invalid formula keeps answer`,async()=>{await reset("x".repeat(1998));await open();await latex("x");await apply();await page.getByText(copy.assessmentEditor.theEquationCannotBeRenderedOr,{exact:true}).waitFor();assert.equal(await answer(),"x".repeat(1998));await page.getByLabel("LaTeX",{exact:true}).fill("\\frac{");await apply();assert.equal(await answer(),"x".repeat(1998));await page.getByRole("button",{name:copy.assessmentEditor.cancel,exact:true}).click();});
  await t.test(`${locale} modify existing formula and display conversion`,async()=>{await reset(String.raw`A \(x^2\) B`);await page.locator('[data-type="inline-math"]').click();await page.locator("math-field").waitFor();await latex("x^3");await page.getByRole("checkbox").check();await apply();await page.locator('[data-type="block-math"] .katex').waitFor();assert.ok((await answer()).includes("x^3"));assert.ok((await answer()).includes("A"));assert.ok((await answer()).includes("B"));});
  for(const tex of [String.raw`\frac{a}{b}`,"x^2","x_n",String.raw`\sqrt{x}`,String.raw`\sum_{n=1}^{3} n`,String.raw`\int_0^1 x\,dx`,String.raw`\alpha+\beta`,String.raw`\begin{pmatrix}1&2\\3&4\end{pmatrix}`])await t.test(`${locale} equation structure ${tex}`,async()=>{await reset();await open();await latex(tex);await apply();await page.locator('[data-type="inline-math"] .katex').waitFor();assert.ok((await answer()).includes(tex));await page.locator('[data-type="inline-math"]').click();await page.locator("math-field").waitFor();assert.ok(await page.locator("math-field").evaluate((el:any)=>el.value.length>0));await page.getByRole("button",{name:copy.assessmentEditor.cancel,exact:true}).click();});
  await t.test(`${locale} toolbar and unsupported source safeguards`,async()=>{
   await reset();assert.equal(await page.getByRole("button",{name:copy.assessmentEditor.undo,exact:true}).count(),0);assert.equal(await page.getByRole("button",{name:copy.assessmentEditor.redo,exact:true}).count(),0);
   const toggle=page.getByRole("switch",{name:copy.assessmentEditor.sourceMode,exact:true});assert.equal(await toggle.isChecked(),false);
   const positions=await page.evaluate(()=>{const toggle=document.querySelector('[role="switch"]')!,tools=toggle.parentElement!;return{right:toggle.getBoundingClientRect().right,toolsRight:tools.getBoundingClientRect().right};});assert.ok(Math.abs(positions.toolsRight-positions.right-12)<2,"source mode stays at the right edge");
   await reset("**Bold**\n$x$");assert.equal(await toggle.isChecked(),true);assert.equal(await toggle.isDisabled(),true);await page.getByText(copy.assessmentEditor.sourceRequired,{exact:true}).waitFor();assert.equal(await page.evaluate(()=>(window as any).changes),0);
   await page.getByRole("textbox").fill("Plain answer");assert.equal(await toggle.isEnabled(),true);const changes=await page.evaluate(()=>(window as any).changes);await toggle.focus();await page.keyboard.press("Space");assert.equal(await toggle.isChecked(),false);assert.equal(await answer(),"Plain answer");assert.equal(await page.evaluate(()=>(window as any).changes),changes);
  });
  await t.test(`${locale} source visual toggles preserve raw text`,async()=>{const value=String.raw`Answer \(x^2\) and $5.`;await reset(value);for(let i=0;i<3;i++){await page.getByRole("switch",{name:copy.assessmentEditor.sourceMode,exact:true}).click();assert.equal(await page.getByRole("textbox").inputValue(),value);await page.getByRole("switch",{name:copy.assessmentEditor.sourceMode,exact:true}).click();await page.locator('.katex').waitFor();assert.equal(await answer(),value);}assert.equal(await page.evaluate(()=>(window as any).changes),0);});
  await t.test(`${locale} readonly has no formula editing`,async()=>{await reset(String.raw`\(x^2\)`,true);assert.equal(await page.getByRole("button",{name:copy.applicationAssessment.formula,exact:true}).isDisabled(),true);assert.equal(await page.getByRole("textbox").isEditable(),false);await page.locator('[data-type="inline-math"]').click();assert.equal(await page.locator("math-field").count(),0);});
  for(const width of [320,390,768,1440])await t.test(`${locale} keyboard/unmount at ${width}px`,async()=>{await page.setViewportSize({width,height:844});await reset();await open();await page.getByRole("button",{name:copy.assessmentEditor.mathKeyboard,exact:true}).click();await page.waitForTimeout(250);const dialog=page.getByRole("dialog",{name:copy.assessmentEditor.insertEquation,exact:true});assert.equal(await dialog.evaluate(el=>el.scrollWidth>el.clientWidth),false);await page.evaluate(()=>(window as any).unmount());await page.waitForTimeout(100);assert.equal(await page.evaluate(()=>window.mathVirtualKeyboard.visible),false);});
  assert.deepEqual(errors,[]);await page.close();
 }}finally{await browser.close();}
});
