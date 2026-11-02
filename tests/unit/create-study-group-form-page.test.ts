import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile, mkdir } from "node:fs/promises";
import { build } from "esbuild";
import { chromium } from "playwright";
import { getMessages } from "../../lib/i18n/messages";

test("Ant Design create-group form validates, counts, selects inside the modal and preserves retry/busy behavior", async () => {
  const bundle=await build({stdin:{resolveDir:process.cwd(),loader:"tsx",contents:`import React from 'react';import {createRoot} from 'react-dom/client';import {flushSync} from 'react-dom';import {CreateStudyGroupForm} from './components/portal/CreateStudyGroupForm';import {PortalDialog} from './components/portal/PortalDialog';import styles from './components/portal/study-groups.module.css';const root=createRoot(document.getElementById('root'));function Fixture(p){const [open,setOpen]=React.useState(true),[busy,setBusy]=React.useState(false),[error,setError]=React.useState('');return open?<PortalDialog className={styles.modal} labelledBy="study-group-dialog-title" busy={busy} onClose={()=>setOpen(false)}><CreateStudyGroupForm {...p} className={styles.createForm} creating={busy} error={error} onInvalid={()=>{}} onCancel={()=>setOpen(false)} onSubmit={async data=>{setBusy(true);setError('');try{const response=await fetch('/api/study-groups',{method:'POST',body:JSON.stringify(Object.fromEntries(data))});if(response.ok)setOpen(false);else setError('Please try again');}finally{setBusy(false)}}}/></PortalDialog>:<p role="status">Closed</p>};window.mount=p=>flushSync(()=>root.render(<Fixture key={p.key} {...p}/>));`},bundle:true,write:false,outfile:"create-group.js",platform:"browser",jsx:"automatic",loader:{".css":"local-css"},define:{"process.env.NODE_ENV":'"production"'}});
  const browser=await chromium.launch();await mkdir("test-results/create-study-group-antd",{recursive:true});
  try {for(const locale of ["en-GB","zh-CN"] as const) {
    const page=await browser.newPage({viewport:{width:1280,height:900}}),copy=getMessages(locale).studyGroupsPage;
    const payloads:unknown[]=[];let release:(()=>void)|undefined;
    await page.route('http://group.test/**',async route=>{
      if(route.request().method()==='POST') {payloads.push(route.request().postDataJSON());await new Promise<void>(resolve=>release=resolve);return route.fulfill({status:payloads.length===1?503:200,json:{ok:payloads.length!==1}});}
      return route.fulfill({contentType:'text/html',body:'<!doctype html><div id="root"></div>'});
    });
    await page.goto('http://group.test');
    for(const file of ['app/styles.css','app/portal-design.css'])await page.addStyleTag({content:await readFile(file,'utf8')});
    await page.addStyleTag({content:bundle.outputFiles.find(file=>file.path.endsWith('css'))!.text});
    await page.addScriptTag({content:bundle.outputFiles.find(file=>file.path.endsWith('js'))!.text});
    const mount=(key:string,courses=[{id:'course-1',title:'Course One'},{id:'course-2',title:'Course Two'}])=>page.evaluate(props=>(window as unknown as {mount:(props:unknown)=>void}).mount(props),{key,locale,courses});
    await mount('start');const dialog=page.getByRole('dialog'),submit=dialog.getByRole('button',{name:copy.create,exact:true}),cancel=dialog.getByRole('button',{name:copy.cancel,exact:true});
    await submit.click();await dialog.locator('.lg-ant-form-item-explain-error').first().waitFor();assert.equal(payloads.length,0);
    const title=dialog.locator('input[name="title"]'),about=dialog.locator('textarea[name="about"]');
    await title.fill('a'.repeat(60));assert.equal((await title.inputValue()).length,50);
    await about.fill('b'.repeat(300));assert.equal((await about.inputValue()).length,200);
    await title.fill('Shared learning');await about.fill('Read and discuss together.');
    await dialog.getByRole('combobox').click();
    await dialog.locator('.lg-ant-select-dropdown').waitFor({state:'visible'});
    await dialog.locator('.lg-ant-select-item-option').filter({hasText:'Course One'}).click();
    await page.screenshot({path:`test-results/create-study-group-antd/${locale}-desktop.png`});
    await page.setViewportSize({width:320,height:844});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
    await dialog.getByRole('combobox').click();await dialog.locator('.lg-ant-select-dropdown').waitFor({state:'visible'});
    const popup=await dialog.locator('.lg-ant-select-dropdown').boundingBox();assert.ok(popup && popup.x>=0 && popup.x+popup.width<=320,'course popup stays inside the phone viewport');
    await page.keyboard.press('Escape');assert.equal(await dialog.isVisible(),true,'Escape closes only the course menu');await dialog.locator('.lg-ant-select-dropdown').waitFor({state:'hidden'});await page.screenshot({path:`test-results/create-study-group-antd/${locale}-mobile.png`});
    const formBox=(await dialog.locator('form').boundingBox())!;
    for(const action of [cancel,submit]) {const box=(await action.boundingBox())!;assert.ok(box.x>=formBox.x && box.x+box.width<=formBox.x+formBox.width,'mobile form actions stay inside the card');}
    const posting=page.waitForRequest(request=>request.method()==='POST');await submit.click();await posting;
    assert.equal(await cancel.isDisabled(),true);assert.equal(await submit.isDisabled(),true);
    await page.keyboard.press('Escape');assert.equal(await dialog.count(),1,'Escape cannot dismiss an in-flight create');
    release!();await dialog.getByRole('alert').filter({hasText:'Please try again'}).waitFor();
    assert.equal(await title.inputValue(),'Shared learning');assert.equal(await about.inputValue(),'Read and discuss together.');
    const retry=page.waitForRequest(request=>request.method()==='POST');await submit.click();await retry;release!();await page.getByRole('status',{name:''}).waitFor();
    assert.deepEqual(payloads,[{title:'Shared learning',courseId:'course-1',about:'Read and discuss together.'},{title:'Shared learning',courseId:'course-1',about:'Read and discuss together.'}]);
    await mount('empty',[]);assert.equal(await submit.isDisabled(),true);assert.equal(await dialog.getByRole('link',{name:copy.viewCourses}).getAttribute('href'),`/${locale}/portal/courses`);await cancel.click();await page.getByText('Closed',{exact:true}).waitFor();
    await mount('reopen');assert.equal(await title.inputValue(),'');assert.equal(await about.inputValue(),'');
    await page.close();
  }} finally {await browser.close();}
});
