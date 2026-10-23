import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { createServer } from 'node:http';
import { build } from 'esbuild';
import { chromium } from 'playwright';
import { getMessages } from '../../lib/i18n/messages';
import { isolate } from '../io/harness';
import { verifiedUser, readProductData, writeProductData, COURSE_ID, PREVIEW_LP, PRIVATE_LP } from './helpers/my-learning';

test('Understanding reads real API records, saves/resumes both tests, retries failures and isolates users in both locales', {timeout:120000}, async()=>{
  const originalCwd=process.cwd();
  const bundle=await build({stdin:{contents:`import React from 'react';import {createRoot} from 'react-dom/client';import {UnderstandingOverview} from './components/portal/UnderstandingOverview';const root=createRoot(document.getElementById('root'));window.mount=(locale,data)=>root.render(<main className="portal-page portal-public-lesson-page"><UnderstandingOverview locale={locale} courseId="${COURSE_ID}" courseTitle="Actual Course" category="Science" backHref={'/'+locale+'/account/learn/${COURSE_ID}'} data={data}/></main>);`,resolveDir:originalCwd,loader:'tsx'},bundle:true,write:false,outfile:'overview.js',platform:'browser',external:['/portal/*'],jsx:'automatic',loader:{'.css':'local-css'},plugins:[{name:'next',setup(b){b.onResolve({filter:/^next\/(image|link)$/},args=>({path:args.path,namespace:'mock'}));b.onLoad({filter:/.*/,namespace:'mock'},args=>({contents:args.path.endsWith('image')?"import React from 'react';export default function Image(props){return <img {...props}/>}":"import React from 'react';export default function Link({prefetch,...props}){return <a {...props}/>}",loader:'tsx',resolveDir:originalCwd}));}}]});
  await mkdir(path.join(originalCwd,'test-results/understanding-real'),{recursive:true});
  const {restore}=await isolate('lg-understanding-browser-');
  const store=await import('../../services/productStore');
  await store.ensureProductData();const catalogue=await readProductData();catalogue.courses.find(course=>course.id===COURSE_ID).sections.push({id:'extra-section',title:'Further lessons',lessons:[3,4,5].map(number=>({id:`lesson-${number}`,title:`Actual Lesson ${number}`,body:'Reading',durationMinutes:1,isPublic:false}))});await writeProductData(catalogue);
  const routes=await import('../../app/api/courses/[courseId]/lessons/[lessonId]/assessments/[kind]/route');
  const overview=await import('../../app/api/courses/[courseId]/understanding/route');
  let failNextWrite=false, failNextRead=false, holdNextRead=false;let releaseRead:()=>void=()=>{};
  const server=createServer(async(req,res)=>{
    try{
      const url=new URL(req.url!,'http://localhost');let response:Response;
      if(url.pathname.startsWith('/api/')){
        const chunks:Buffer[]=[];for await(const chunk of req)chunks.push(Buffer.from(chunk));
        const request=new Request(url,{method:req.method,headers:new Headers(req.headers as Record<string,string>),...(req.method==='PUT'?{body:Buffer.concat(chunks).toString()}: {})});
        const match=url.pathname.match(/^\/api\/courses\/([^/]+)\/lessons\/([^/]+)\/assessments\/([^/]+)$/);
        if(match){
          if(req.method==='GET'&&holdNextRead){holdNextRead=false;await new Promise<void>(resolve=>{releaseRead=resolve;});}
          if(req.method==='GET'&&failNextRead){failNextRead=false;response=Response.json({ok:false},{status:503});}
          else if(req.method==='PUT'&&failNextWrite){failNextWrite=false;response=Response.json({ok:false},{status:503});}
          else response=await routes[req.method==='PUT'?'PUT':'GET'](request,{params:Promise.resolve({courseId:decodeURIComponent(match[1]),lessonId:decodeURIComponent(match[2]),kind:match[3]})});
        }else response=await overview.GET(request,{params:Promise.resolve({courseId:COURSE_ID})});
        res.writeHead(response.status,Object.fromEntries(response.headers));res.end(await response.text());return;
      }
      if(url.pathname==='/bundle.js'){res.setHeader('content-type','text/javascript');res.end(bundle.outputFiles.find(f=>f.path.endsWith('js'))!.text);return;}
      const font=url.pathname.match(/^\/font-(400|500|600|700)\.woff2$/);
      if(font){res.setHeader('content-type','font/woff2');res.end(await readFile(path.join(originalCwd,`node_modules/@fontsource/inter/files/inter-latin-${font[1]}-normal.woff2`)));return;}
      if(url.pathname==='/shared.css'){res.setHeader('content-type','text/css');res.end((await Promise.all(['app/styles.css','app/portal-design.css','components/portal/lesson-authoring.css'].map(file=>readFile(path.join(originalCwd,file),'utf8')))).join('\n'));return;}
      if(url.pathname==='/bundle.css'){res.setHeader('content-type','text/css');res.end(bundle.outputFiles.find(f=>f.path.endsWith('css'))!.text);return;}
      if(url.pathname.startsWith('/portal/')){res.setHeader('content-type',url.pathname.endsWith('.png')?'image/png':'image/svg+xml');res.end(await readFile(path.join(originalCwd,'public',url.pathname)));return;}
      const locale=url.pathname.includes('zh-CN')?'zh-CN':'en-GB';
      res.setHeader('content-type','text/html');res.end(`<!doctype html><html><head><meta charset="utf-8"><style>${[400,500,600,700].map(weight=>`@font-face{font-family:Inter;src:url('/font-${weight}.woff2');font-weight:${weight}}`).join('')}body{margin:0}*{box-sizing:border-box}</style><link rel="stylesheet" href="/shared.css"><link rel="stylesheet" href="/bundle.css"></head><body><div style="height:68px;background:white"></div><div id="root"></div><script src="/bundle.js"></script><script>fetch('/api/courses/${COURSE_ID}/understanding').then(r=>r.json()).then(r=>window.mount('${locale}',r.data));</script></body></html>`);
    }catch{res.statusCode=500;res.end('Test server failure');}
  });
  await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
  const base=`http://127.0.0.1:${(server.address() as import('node:net').AddressInfo).port}`;
  const browser=await chromium.launch();
  try{for(const locale of ['en-GB','zh-CN'] as const){
    const labels=getMessages(locale).understandingOverview, copy=getMessages(locale).knowledgeTest, records=getMessages(locale).assessmentRecords;
    const user=await verifiedUser(store,`browser-${locale.toLowerCase()}@example.test`,'Actual Learner');
    const {quote}=await store.createQuote(user.id,'everything-pc-6');await store.completeDemoCheckout(user.id,quote.id);
    await store.recordStudyEvent({userId:user.id,courseId:COURSE_ID,lessonId:PREVIEW_LP,event:'complete',seconds:0,clientEventId:`complete-${locale}`});
    const session=await store.createSession(user.id), context=await browser.newContext({viewport:{width:1440,height:1200}});
    await context.addCookies([{name:'learning_guide_session',value:session.token,url:base}]);
    const page=await context.newPage();await page.goto(base+'/'+locale);
    const lesson=page.locator(`section[data-lesson-id="${PREVIEW_LP}"]`), knowledge=lesson.locator('[data-assessment-kind="knowledge"]'), application=lesson.locator('[data-assessment-kind="application"]');
    await knowledge.waitFor();assert.equal(await knowledge.getByText(labels.available,{exact:true}).count(),1);
    const progress=page.getByRole('progressbar',{name:labels.progress,exact:true});assert.equal(await progress.getAttribute('aria-valuemax'),'10');assert.equal(await progress.getAttribute('aria-valuenow'),'0');
    const locked=page.locator('section[data-lesson-id="lesson-3"]');await locked.getByRole('button',{expanded:false}).click();assert.equal(await locked.getByText('—',{exact:true}).count(),6);assert.equal(await locked.locator('[data-assessment-kind] button').count(),0);await locked.getByRole('button',{expanded:true}).click();
    for(const width of [1440,1920,2560]){
      await page.setViewportSize({width,height:1200});
      assert.equal((await page.locator('nav a').first().boundingBox())?.x,Math.max(40,(width-1360)/2));
    }
    await page.screenshot({path:path.join(originalCwd,`test-results/understanding-real/${locale}-wide.png`),fullPage:true});
    await page.setViewportSize({width:1440,height:1200});
    const arrow=lesson.locator('button[aria-expanded] [aria-hidden="true"]');await arrow.locator('img').evaluate(e=>(e as HTMLImageElement).decode());
    assert.deepEqual(await arrow.locator('img').evaluate(e=>({width:e.getBoundingClientRect().width,height:e.getBoundingClientRect().height})),{width:11,height:7});
    await page.screenshot({path:path.join(originalCwd,`test-results/understanding-real/${locale}-initial.png`),fullPage:true});
    holdNextRead=true;failNextRead=true;
    await knowledge.getByRole('button',{name:labels.start,exact:true}).click();
    const dialog=page.getByRole('dialog');await dialog.getByRole('heading',{name:records.loading,exact:true}).waitFor();
    assert.equal(await dialog.evaluate(e=>e.parentElement===document.body),true);
    assert.equal((await dialog.boundingBox())?.width,420);
    assert.equal((await dialog.boundingBox())?.x,510);
    assert.equal(await dialog.locator('.portal-dialog-spinner').evaluate(e=>(e as HTMLElement).offsetWidth),28);
    await page.screenshot({path:path.join(originalCwd,`test-results/understanding-real/${locale}-loading.png`)});
    await page.setViewportSize({width:390,height:844});
    assert.equal((await dialog.boundingBox())?.width,358);
    assert.equal(await dialog.evaluate(e=>e.scrollWidth>e.clientWidth),false);
    await page.screenshot({path:path.join(originalCwd,`test-results/understanding-real/${locale}-loading-mobile.png`)});
    releaseRead();await dialog.getByRole('alert').waitFor();
    assert.equal(await dialog.getByRole('alert').textContent(),records.loadError);
    await page.screenshot({path:path.join(originalCwd,`test-results/understanding-real/${locale}-loading-error.png`)});
    await dialog.getByRole('button',{name:records.retry,exact:true}).click();await dialog.getByRole('textbox').waitFor();
    await page.setViewportSize({width:1440,height:1200});
    failNextWrite=true;await dialog.getByRole('textbox').fill('My persisted note');
    await dialog.getByRole('button',{name:copy.close,exact:true}).click();
    await dialog.getByRole('alert').waitFor();assert.equal(await dialog.getByRole('textbox').inputValue(),'My persisted note');
    await dialog.getByRole('button',{name:records.retry,exact:true}).click();
    await dialog.getByRole('button',{name:copy.close,exact:true}).click();await dialog.waitFor({state:'detached'});
    await knowledge.getByRole('button',{name:labels.continue,exact:true}).click();await dialog.getByRole('textbox').waitFor();assert.equal(await dialog.getByRole('textbox').inputValue(),'My persisted note');
    for(let i=0;i<6;i++){
      await dialog.getByRole('button',{name:copy.check,exact:true}).click();
      await dialog.getByRole('radio',{name:i%2?copy.wrong:copy.right,exact:true}).check();
      await dialog.getByRole('button',{name:i===5?copy.seeResults:copy.next,exact:true}).click();
      if(i===0){await dialog.getByRole('textbox').waitFor();await dialog.getByRole('button',{name:copy.close,exact:true}).click();await dialog.waitFor({state:'detached'});await page.reload();await knowledge.getByRole('button',{name:labels.continue,exact:true}).click();await dialog.getByText('02/06',{exact:true}).waitFor();}
    }
    await dialog.getByRole('heading',{name:copy.result,exact:true}).waitFor();await dialog.getByText('50%',{exact:true}).waitFor();
    await dialog.getByRole('button',{name:copy.close,exact:true}).click();await dialog.waitFor({state:'detached'});
    await knowledge.getByRole('button',{name:labels.viewResult,exact:true}).waitFor();assert.equal(await knowledge.locator('[data-latest-result]').textContent(),'50%');assert.equal(await knowledge.getByText('100%',{exact:true}).count(),0);assert.equal(await progress.getAttribute('aria-valuenow'),'1');
    await knowledge.getByRole('button',{name:labels.viewResult,exact:true}).click();await dialog.getByRole('button',{name:getMessages(locale).applicationTest.retake,exact:true}).waitFor();assert.equal(await dialog.locator('footer button').count(),1);
    const retakeBox=(await dialog.locator('footer button').boundingBox())!,dialogBox=(await dialog.boundingBox())!;assert.ok(retakeBox.x>dialogBox.x+dialogBox.width/2,'Retake is at the right of the result footer');
    await dialog.getByRole('button',{name:getMessages(locale).applicationTest.retake,exact:true}).click();await dialog.getByText('01/06',{exact:true}).waitFor();assert.equal(await dialog.getByRole('textbox').inputValue(),'');
    await dialog.getByRole('button',{name:copy.close,exact:true}).click();await dialog.waitFor({state:'detached'});await page.reload();await knowledge.getByRole('button',{name:labels.continue,exact:true}).waitFor();assert.equal(await knowledge.locator('[data-latest-result]').textContent(),'50%');assert.equal(await progress.getAttribute('aria-valuenow'),'1');
    await knowledge.getByRole('button',{name:labels.continue,exact:true}).click();await dialog.getByRole('textbox').waitFor();for(let i=0;i<6;i++){await dialog.getByRole('button',{name:copy.check,exact:true}).click();await dialog.getByRole('radio',{name:copy.wrong,exact:true}).check();await dialog.getByRole('button',{name:i===5?copy.seeResults:copy.next,exact:true}).click();}await dialog.getByRole('button',{name:copy.close,exact:true}).click();await dialog.waitFor({state:'detached'});await knowledge.getByRole('button',{name:labels.viewResult,exact:true}).waitFor();assert.equal(await knowledge.locator('[data-latest-result]').textContent(),'0%');
    await application.getByRole('button',{name:labels.start,exact:true}).click();await dialog.getByRole('textbox').fill('Actual application draft');
    await dialog.getByRole('button',{name:copy.exit,exact:true}).click();await dialog.waitFor({state:'detached'});
    await application.getByRole('button',{name:labels.continue,exact:true}).click();await dialog.getByRole('textbox').waitFor();assert.equal(await dialog.getByRole('textbox').inputValue(),'Actual application draft');
    const app=getMessages(locale).applicationTest;
    await page.screenshot({path:path.join(originalCwd,`test-results/understanding-real/${locale}-application-answer.png`)});
    failNextWrite=true;
    await dialog.getByRole('button',{name:app.submit,exact:true}).click();await dialog.getByRole('alert').waitFor();
    assert.equal(await dialog.getByRole('progressbar').count(),0);
    assert.equal(await dialog.getByRole('textbox').inputValue(),'Actual application draft');
    await dialog.getByRole('button',{name:app.submit,exact:true}).click();
    await dialog.getByRole('progressbar').waitFor();
    assert.equal(await dialog.getByRole('textbox').getAttribute('readonly'),'');
    const reviewing=await (await context.request.get(base+`/api/courses/${COURSE_ID}/understanding`)).json();
    assert.equal(reviewing.data.lessons[0].application.percent,0);
    assert.equal(reviewing.data.completed,1);
    await page.screenshot({path:path.join(originalCwd,`test-results/understanding-real/${locale}-application-reviewing.png`)});
    await dialog.getByRole('button',{name:copy.exit,exact:true}).click();await dialog.waitFor({state:'detached'});
    await page.reload();await application.getByRole('button',{name:labels.continue,exact:true}).click();
    await dialog.getByRole('heading',{name:app.feedback,exact:true}).waitFor();
    assert.equal(await dialog.getByText(app.strongResponse,{exact:true}).count(),1);
    assert.equal(await dialog.getByRole('button',{name:app.tryKnowledge,exact:true}).count(),0);
    assert.equal(await dialog.getByRole('button',{name:app.retake,exact:true}).count(),1);assert.equal(await dialog.getByRole('button',{name:app.nextLesson,exact:true}).count(),0);
    const completedView=await (await context.request.get(base+`/api/courses/${COURSE_ID}/understanding`)).json();
    assert.equal(completedView.data.lessons[0].application.percent,100);assert.equal(completedView.data.completed,2);assert.equal(completedView.data.percent,20);assert.equal(completedView.data.lessons[1].state,'current');
    await page.screenshot({path:path.join(originalCwd,`test-results/understanding-real/${locale}-application-result.png`)});
    await dialog.getByRole('button',{name:getMessages(locale).applicationTest.back,exact:true}).click();await dialog.waitFor({state:'detached'});
    await application.getByText(labels.completed,{exact:true}).waitFor();await page.reload();await application.getByRole('button',{name:labels.viewResult,exact:true}).waitFor();
    assert.equal(await lesson.getByText(labels.completed,{exact:true}).count(),3);
    assert.equal(await application.locator('[data-latest-result]').textContent(),labels.strong);
    const nextLesson=page.locator(`section[data-lesson-id="${PRIVATE_LP}"]`);await nextLesson.locator('[data-assessment-kind="knowledge"]').getByRole('button',{name:labels.start,exact:true}).waitFor();
    await page.screenshot({path:path.join(originalCwd,`test-results/understanding-real/${locale}-overview-aligned.png`),fullPage:true});
    await application.getByRole('button',{name:labels.viewResult,exact:true}).click();
    await dialog.getByRole('button',{name:app.retake,exact:true}).click();await dialog.getByRole('textbox').waitFor();assert.equal(await dialog.getByRole('textbox').inputValue(),'');
    await dialog.getByRole('button',{name:copy.exit,exact:true}).click();await dialog.waitFor({state:'detached'});
    await page.goto(base+'/'+locale);await lesson.waitFor();
    assert.equal(await progress.getAttribute('aria-valuenow'),'2');assert.equal(await application.locator('[data-latest-result]').textContent(),labels.strong);await application.getByRole('button',{name:labels.continue,exact:true}).waitFor();
    await locked.getByRole('button',{expanded:false}).click();assert.equal(await locked.getByText('—',{exact:true}).count(),6);
    await page.setViewportSize({width:390,height:844});await page.screenshot({path:path.join(originalCwd,`test-results/understanding-real/${locale}-mobile.png`),fullPage:true});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
    await context.close();
    const other=await verifiedUser(store,`different-${locale.toLowerCase()}@example.test`,'Other Learner');const otherQuote=await store.createQuote(other.id,'everything-pc-6');await store.completeDemoCheckout(other.id,otherQuote.quote.id);await store.recordStudyEvent({userId:other.id,courseId:COURSE_ID,lessonId:PREVIEW_LP,event:'complete',seconds:0,clientEventId:`other-${locale}`});
    const otherSession=await store.createSession(other.id), otherContext=await browser.newContext();await otherContext.addCookies([{name:'learning_guide_session',value:otherSession.token,url:base}]);const otherPage=await otherContext.newPage();await otherPage.goto(base+'/'+locale);await otherPage.locator('[data-assessment-kind="knowledge"]').getByRole('button',{name:labels.start,exact:true}).waitFor();assert.equal(await otherPage.getByRole('button',{name:labels.viewResult,exact:true}).count(),0);
    await otherPage.locator('[data-assessment-kind="application"]').first().getByRole('button',{name:labels.start,exact:true}).click();
    const otherDialog=otherPage.getByRole('dialog');await otherDialog.getByRole('textbox').fill('A separate answer for this learner');
    await otherDialog.getByRole('button',{name:app.submit,exact:true}).click();await otherDialog.getByRole('progressbar').waitFor();
    // If the final save fails, retain the review and retry the same operation.
    failNextWrite=true;await otherDialog.getByRole('alert').waitFor();
    assert.equal(await otherDialog.getByRole('heading',{name:app.feedback,exact:true}).count(),0);
    await otherDialog.getByRole('button',{name:records.retry,exact:true}).click();await otherDialog.getByRole('heading',{name:app.feedback,exact:true}).waitFor();
    assert.equal(await otherDialog.getByRole('button',{name:app.retake,exact:true}).count(),1);
    assert.equal(await otherDialog.getByRole('button',{name:app.tryKnowledge,exact:true}).count(),0);
    const independent=await (await otherContext.request.get(base+`/api/courses/${COURSE_ID}/understanding`)).json();
    assert.equal(independent.data.lessons[0].application.percent,100);assert.equal(independent.data.lessons[0].knowledge.answered,0);assert.equal(independent.data.completed,1);assert.equal(independent.data.lessons[1].state,'locked');
    await otherDialog.getByRole('button',{name:app.back,exact:true}).click();await otherDialog.waitFor({state:'detached'});await otherPage.locator('[data-assessment-kind="knowledge"]').getByRole('button',{name:labels.start,exact:true}).click();
    await otherDialog.getByText('01/06',{exact:true}).waitFor();assert.equal(await otherDialog.getByRole('textbox').inputValue(),'');
    await otherContext.close();
  }}finally{releaseRead();await browser.close();await new Promise<void>(resolve=>server.close(()=>resolve()));await restore();}
});
