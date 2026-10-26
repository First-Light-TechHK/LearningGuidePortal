import assert from "node:assert/strict";
import {test} from "node:test";
import {readFile,mkdir} from "node:fs/promises";
import path from "node:path";
import {build} from "esbuild";
import {chromium} from "playwright";

test("text lesson keeps inline exhibit references inert while explicit exhibit dialogs work",async()=>{
  const bundle=await build({stdin:{contents:`import React from 'react';import {createRoot} from 'react-dom/client';import {flushSync} from 'react-dom';import {LessonContentPlayer} from './components/portal/LessonContentPlayer';import {PreviewLessonView} from './components/portal/PreviewLessonView';const root=createRoot(document.getElementById('root'));window.mount=p=>flushSync(()=>root.render(p.view ? <PreviewLessonView key={p.key} {...p}/> : <main className="fixture"><LessonContentPlayer key={p.key} {...p}/></main>));`,resolveDir:process.cwd(),loader:"tsx"},bundle:true,write:false,outfile:"exhibit.js",platform:"browser",external:["/portal/*"],jsx:"automatic",loader:{".css":"local-css"},define:{"process.env.NODE_ENV":'"production"'},plugins:[{name:"next",setup(builder){builder.onResolve({filter:/^next\/(image|dynamic|link|navigation)$/},args=>({path:args.path,namespace:"next"}));builder.onLoad({filter:/.*/,namespace:"next"},args=>({resolveDir:process.cwd(),loader:"tsx",contents:args.path==="next/navigation"?"export function useRouter(){return {refresh(){},push(href){window.destination=href}}}":args.path==="next/link"?"import React from 'react';export default function Link({prefetch,...props}){return <a {...props}/>}":args.path==="next/dynamic"?"import React from 'react';export default function dynamic(factory){const Component=React.lazy(()=>factory().then(defaultExport=>({default:defaultExport})));return props=><React.Suspense fallback={null}><Component {...props}/></React.Suspense>}":"import React from 'react';export default function Image({fill,unoptimized,...props}){return <img {...props} style={{...(fill?{position:'absolute',inset:0,width:'100%',height:'100%'}:{}),...props.style}}/>}"}));builder.onResolve({filter:/CoursePdfPreview$/},args=>({path:args.path,namespace:"pdf"}));builder.onLoad({filter:/.*/,namespace:"pdf"},()=>({contents:"export const CoursePdfPreview=()=>null"}));}}]});
  const browser=await chromium.launch({args:["--use-angle=swiftshader","--enable-unsafe-swiftshader"]});await mkdir("test-results/text-exhibit",{recursive:true});
  try{for(const locale of ["en-GB","zh-CN"]){
    const page=await browser.newPage({viewport:{width:1440,height:1100}});
    await page.route("http://text.test/**",async route=>{const pathname=new URL(route.request().url()).pathname;if(pathname.startsWith("/portal/"))return route.fulfill({body:await readFile(path.join("public",pathname)),contentType:pathname.endsWith("svg")?"image/svg+xml":pathname.endsWith("webm")?"video/webm":pathname.endsWith("obj")?"text/plain":"image/jpeg"});return route.fulfill({contentType:"text/html",body:'<div id="root"></div>'});});
    await page.goto("http://text.test");for(const file of ["app/styles.css","app/portal-design.css","components/portal/lesson-authoring.css"])await page.addStyleTag({content:await readFile(file,"utf8")});await page.addStyleTag({content:bundle.outputFiles.find(file=>file.path.endsWith("css"))!.text});await page.addStyleTag({content:'.fixture{width:940px;max-width:calc(100vw - 40px);margin:40px auto;padding:20px;background:white;border:1px solid #e2e8f0;border-radius:12px;}'});
    for(const weight of [400,500,600,700]){const font=(await readFile(`node_modules/@fontsource/inter/files/inter-latin-${weight}-normal.woff2`)).toString("base64");await page.addStyleTag({content:`@font-face{font-family:Inter;src:url(data:font/woff2;base64,${font});font-weight:${weight}}`});}await page.addScriptTag({content:bundle.outputFiles.find(file=>file.path.endsWith("js"))!.text});
    const html='<h2>Why Close Observation Matters</h2><p>Looking closely is not simply a matter of seeing more detail. It is a way of slowing down, noticing relationships, and allowing meaning to emerge over time. When we encounter an artwork, our first interpretation often arrives quickly. Careful observation asks us to pause before deciding what the work means.</p><p>Context can change what we notice, but attention begins with the visible evidence: shape, scale, texture, colour and the relationship between objects.</p><p><strong>Observe with attention.</strong> Notice the differences between the still image and the moving video.</p><p>Continue reading and explore the form of the three-dimensional object.</p><p>References: <span class="instance-node" data-instance-type="4" data-instance-content="/image.jpg"><strong>&lt;Exh 1&gt;</strong></span> and <span data-node-id="configured"><em>&lt;Exh 2&gt;</em></span> or <a data-node-id="linked" href="https://example.test/exhibit">&lt;Exh 3&gt;</a>. <a href="https://example.test/article">Ordinary reading link</a></p><table><tbody><tr><td>Preserved table content</td></tr></tbody></table><script>window.unsafe=true</script>';
    await page.evaluate(props=>(window as unknown as {mount:(props:unknown)=>void}).mount(props),{locale,key:locale,contents:[{id:"text",title:"Looking closely",type:"text",mode:"lecture",html,nodes:[]}]});
    const bars=page.getByRole("region",{name:locale==="en-GB"?"Exhibit Available":"\u53ef\u67e5\u770b\u5c55\u793a\u5185\u5bb9"});await bars.nth(2).waitFor();assert.equal(await bars.count(),3);assert.equal(await bars.getByRole("button").count(),3,"inline strips have View exhibit only");assert.equal(await page.getByText("Preserved table content").count(),1);assert.equal(await page.evaluate(()=>Object.hasOwn(window,"unsafe")),false);
    async function assertInertReferences() {
      const prose=page.locator('.la-prose');
      assert.equal(await prose.locator('[data-instance-type], [data-node-id], .instance-node, .la-instance, [role="button"], [tabindex], a:has-text("Exh")').count(),0,"inline markers have no interactive semantics or link styling");
      assert.equal(await prose.getByRole('link',{name:'Ordinary reading link'}).getAttribute('href'),'https://example.test/article','ordinary content links remain usable');
      for(const label of ['<Exh 1>','<Exh 2>']) {
        const reference=prose.getByText(label,{exact:true});
        await reference.scrollIntoViewIfNeeded();
        assert.equal(await reference.evaluate(element=>getComputedStyle(element).cursor),'auto');
        await reference.click();await page.keyboard.press('Enter');await page.keyboard.press('Space');
        assert.equal(await page.getByRole('dialog').count(),0);
      }
      await page.evaluate(()=>window.dispatchEvent(new Event('resize')));
      // Let intersection/mutation observers and scroll handlers settle before checking for automatic UI.
      await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
      assert.equal(await page.locator('.la-exhibit-float').count(),0,'reading or clicking never opens a floating exhibit');
    }
    await assertInertReferences();
    const positions=await bars.evaluateAll(elements=>elements.map(element=>({before:element.previousElementSibling?.textContent,after:element.nextElementSibling?.textContent,height:element.getBoundingClientRect().height,thumbnail:element.querySelector("img")!.getBoundingClientRect().width})));for(const position of positions){assert.ok(position.before && position.after);assert.equal(position.height,130);assert.equal(position.thumbnail,104);}
    await page.screenshot({path:`test-results/text-exhibit/${locale}-desktop.png`,fullPage:true});
    const dialog=page.getByRole("dialog");for(let index=0;index<3;index++){await bars.nth(index).getByRole("button").click();await dialog.waitFor();await page.waitForFunction(()=>!document.querySelector('dialog [role="group"] button')?.hasAttribute("disabled"));if(index===0)await dialog.locator('img[alt]:not([alt=""])').waitFor();if(index===1){await dialog.getByRole("button",{name:locale==="en-GB"?"Play":"\u64ad\u653e",exact:true}).click();await page.waitForFunction(()=>{const video=document.querySelector("video");return video && !video.paused && video.currentTime>.1;});}if(index===2)await dialog.locator("canvas").waitFor();await dialog.getByRole("group").getByRole("button").nth(1).click();await page.waitForFunction(()=>document.querySelector("output")?.textContent==="125%");await page.keyboard.press("Escape");assert.equal(await dialog.count(),0);}
    await page.setViewportSize({width:390,height:844});await page.screenshot({path:`test-results/text-exhibit/${locale}-mobile.png`,fullPage:true});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);assert.equal(await bars.count(),3);await assertInertReferences();
    const longHtml=html+'<p>Additional reading content.</p>'.repeat(50);
    const viewProps={view:true,locale,key:'scroll-view',courseId:'course',courseTitle:'The Art of Seeing',category:'Art',description:'Observe with attention.',lesson:{id:'lesson',title:'Looking closely',body:'',durationMinutes:5,contents:[{id:'text',title:'Read visual cues',type:'text',mode:'lecture',html:longHtml,nodes:[]}]},outline:[{id:'lesson',number:'01',title:'Looking closely',href:'/lesson',modes:['text']}],poster:'/portal/course-study.jpg',nextHref:`/${locale}/account/learn/course?lessonId=next`,initialCompleted:false,entitled:true};
    await page.setViewportSize({width:1440,height:1024});
    await page.evaluate(props=>(window as unknown as {mount:(props:unknown)=>void}).mount(props),viewProps);
    await bars.nth(2).waitFor();await assertInertReferences();
    const breadcrumb=page.locator('nav').first();
    async function assertFullWidthBreadcrumb(width:number) {
      const bounds=await breadcrumb.evaluate(element=>{
        const box=element.getBoundingClientRect(),first=element.querySelector('a')!.getBoundingClientRect(),style=getComputedStyle(element);
        return {left:box.left,right:box.right,textLeft:first.left,background:style.backgroundColor};
      });
      assert.equal(bounds.left,0);assert.equal(bounds.right,width,"breadcrumb background reaches both viewport edges");
      assert.equal(bounds.background,'rgb(255, 255, 255)');
      assert.equal(bounds.textLeft,width<=700?20:Math.max(40,(width-1360)/2),"breadcrumb text retains the centred content alignment");
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
    }
    for(const width of [1920,2560]) {
      await page.setViewportSize({width,height:1024});await assertFullWidthBreadcrumb(width);
      if(width===1920)await page.screenshot({path:`test-results/text-exhibit/${locale}-breadcrumb-wide.png`,fullPage:true});
    }
    await page.setViewportSize({width:1440,height:1024});await assertFullWidthBreadcrumb(1440);
    const scroller=page.locator('[tabindex="0"]').filter({has:bars});
    const next=page.getByRole('button',{name:locale==='en-GB'?'Next lesson':'\u4e0b\u4e00\u8bfe\u65f6',exact:true});
    assert.equal(await next.count(),1);assert.equal(await next.isEnabled(),true);
    const geometry=await scroller.evaluate(element=>({height:element.getBoundingClientRect().height,client:element.clientHeight,scroll:element.scrollHeight,overflow:getComputedStyle(element).overflowY,bottom:element.getBoundingClientRect().bottom}));
    assert.equal(geometry.height,674);assert.ok(geometry.scroll>geometry.client);assert.equal(geometry.overflow,'auto');
    assert.ok((await next.boundingBox())!.y>=geometry.bottom,'next lesson remains outside the scroll area');
    await page.screenshot({path:`test-results/text-exhibit/${locale}-reading-desktop.png`,fullPage:true});
    await scroller.focus();await page.keyboard.press('PageDown');await page.waitForFunction(()=>Array.from(document.querySelectorAll('[tabindex="0"]')).some(element=>element.scrollTop>0));
    assert.equal(await next.isVisible(),true);
    await page.setViewportSize({width:390,height:844});await assertFullWidthBreadcrumb(390);assert.equal(await scroller.evaluate(element=>element.getBoundingClientRect().height),674);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
    await page.screenshot({path:`test-results/text-exhibit/${locale}-reading-mobile.png`,fullPage:true});
    await page.evaluate(props=>(window as unknown as {mount:(props:unknown)=>void}).mount(props),{...viewProps,key:'legacy',nextHref:null,lesson:{...viewProps.lesson,contents:[],body:'<Exh 1>\n\n'+'Legacy reading paragraph.\n\n'.repeat(60)}});
    await page.getByText('Legacy reading paragraph.',{exact:true}).first().waitFor();assert.equal(await next.count(),1,'final legacy Lesson retains its completion action');
    await page.getByText('<Exh 1>',{exact:true}).click();assert.equal(await page.getByRole('dialog').count(),0);assert.equal(await page.locator('.la-exhibit-float').count(),0);
    assert.equal(await page.locator('[tabindex="0"]').evaluate(element=>element.scrollHeight>element.clientHeight),true);
    await page.close();
  }}finally{await browser.close();}
});
