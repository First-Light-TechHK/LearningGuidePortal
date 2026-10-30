import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { build } from "esbuild";
import { chromium, type Page } from "playwright";
import { expect } from "playwright/test";
import { getMessages } from "../../lib/i18n/messages";
import { getCourseManagementMessages } from "../../lib/i18n/courseManagementMessages";
import { defaultPortalContent } from "../../lib/portalContent";
import type { BackofficeOrder } from "../../contracts/backoffice-ui";

type Mount = { kind: string; locale: "en-GB" | "zh-CN"; key: number; operator?: boolean };
type TestWindow = Window & { __backofficeMount(input: Mount): void };

test("Backoffice Ant Design retains bilingual actions, retries, popup scope, mobile cards and teacher navigation", { timeout: 180_000 }, async () => {
  const bundle = await build({
    stdin: { resolveDir: process.cwd(), loader: "tsx", contents: `
      import React from 'react'; import {createRoot} from 'react-dom/client';
      import {BackofficeProvider} from './components/backoffice/BackofficeProvider';
      import {BackofficeShell} from './components/portal/BackofficeShell';
      import {OrderManager} from './components/portal/OrderManager';
      import {PaymentSettingsForm} from './components/portal/PaymentSettingsForm';
      import {PortalContentEditor} from './components/portal/PortalContentEditor';
      import {CourseManager} from './components/portal/CourseManager';
      import {AdminSignInForm} from './components/portal/AdminSignInForm';
      import {getMessages} from './lib/i18n/messages';
      import {defaultPortalContent} from './lib/portalContent';
      const root=createRoot(document.getElementById('root'));
      window.__backofficeMount=p=>{const m=getMessages(p.locale);root.render(<BackofficeProvider key={p.key} locale={p.locale}><BackofficeShell locale={p.locale} operator={p.operator!==false} user={{nickname:'Operator',email:'operator@fixture.test',role:'Operator'}}>
        {p.kind==='orders'?<OrderManager locale={p.locale} copy={m.backoffice.orders}/>:p.kind==='payment'?<PaymentSettingsForm initialSettings={{name:'Stripe',publishableKey:'pk_test_fixture',returnUrl:'',paymentNotifications:true,secretConfigured:false}} copy={m.backoffice.payment}/>:p.kind==='portal'?<PortalContentEditor initial={defaultPortalContent} locale={p.locale}/>:p.kind==='auth'?<AdminSignInForm locale={p.locale}/>:<CourseManager locale={p.locale} operator={p.operator!==false} copy={m.backoffice}/>}
      </BackofficeShell></BackofficeProvider>)};
    ` },
    bundle: true, write: false, outfile: "backoffice.js", platform: "browser", format: "esm", jsx: "automatic",
    loader: { ".css": "css" }, define: { "process.env.NODE_ENV": '"production"' },
    plugins: [{ name: "next-and-modules", setup(builder) {
      builder.onResolve({ filter: /^next\/(navigation|link|image)$/ }, args => ({path:args.path,namespace:"next-mock"}));
      builder.onLoad({filter:/.*/,namespace:"next-mock"},args=>({resolveDir:process.cwd(),loader:"tsx",contents:args.path==="next/navigation"
        ? `export const usePathname=()=>location.pathname;export const useRouter=()=>({refresh(){},push(){},replace(){},prefetch(){}});export const useSearchParams=()=>new URLSearchParams(location.search);export function useServerInsertedHTML(){};`
        : args.path==="next/link" ? `import React from 'react';export default function Link({prefetch,...p}){return <a {...p}/>}` : `import React from 'react';export default function Image({unoptimized,...p}){return <img {...p}/>}` }));
      builder.onLoad({filter:/\.module\.css$/},async args=>({contents:await readFile(args.path,"utf8"),loader:"local-css"}));
    }}],
  });
  const output = path.resolve("test-results/backoffice-ant-design"); await mkdir(output,{recursive:true});
  const browser = await chromium.launch({ channel: existsSync("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome") ? "chrome" : undefined, headless: true });
  let lastPage: Page | undefined;
  try {
    for (const locale of ["en-GB","zh-CN"] as const) {
      const copy=getMessages(locale), common=getCourseManagementMessages(locale);
      const page=await browser.newPage({viewport:{width:1440,height:1000},reducedMotion:"reduce"});
      lastPage=page;
      page.setDefaultTimeout(6000);
      const errors:string[]=[];page.on("pageerror",e=>errors.push(e.message));
      const order:BackofficeOrder={id:"fixture-order",userEmail:"learner@fixture.test",amountMinor:3900,currency:"usd",status:"paid",paymentMode:"demo",createdAt:"2026-10-20T10:00:00Z",plan:{name:"Science plan"},activities:[]};
      const course={id:"fixture-course",slug:"fixture-course",title:"Fixture course",description:"Course description",category:"Science",status:"draft",sections:[],createdAt:"2026-10-20T10:00:00Z",updatedAt:"2026-10-20T10:00:00Z"};
      let failOrders=true,failRefund=true,failPayment=true,failLibrary=true,failCms=true;
      const writes:Array<{path:string;body:Record<string,unknown>}>=[];
      let lastOrdersQuery="";
      await page.route("http://backoffice.test/**",async route=>{
        const req=route.request(),url=new URL(req.url()),pathname=url.pathname;
        if(pathname==="/api/backoffice/orders"&&req.method()==="GET") {
          lastOrdersQuery=url.search;
          return route.fulfill({status:failOrders?503:200,json:failOrders?{error:"Orders unavailable"}:{orders:[{...order}]}});
        }
        if(pathname==="/api/backoffice/orders") {
          writes.push({path:pathname,body:req.postDataJSON()});
          if(failRefund)return route.fulfill({status:503,json:{error:"Refund unavailable"}});
          order.status="refunded";return route.fulfill({json:{ok:true}});
        }
        if(pathname==="/api/backoffice/payment") {
          const body=req.postDataJSON();writes.push({path:pathname,body});
          return route.fulfill({status:failPayment?503:200,json:failPayment?{error:"Payment unavailable"}:{ok:true,settings:{...body,secretConfigured:false}}});
        }
        if(pathname==="/api/backoffice/portal/media")return route.fulfill({status:failLibrary?503:200,json:failLibrary?{error:"Library unavailable"}:{library:[{id:"image-fixture",url:"/portal/course-book.jpg",fileName:"Fixture image"}]}});
        if(pathname==="/api/backoffice/portal") {
          const body=req.postDataJSON();writes.push({path:pathname,body});
          return route.fulfill({status:failCms?503:200,json:failCms?{error:"CMS unavailable"}:{content:body}});
        }
        if(pathname==="/api/backoffice/courses/catalogue")return route.fulfill({json:{entries:[{id:"science",name:"Science",status:"active",parentId:null,description:"",updatedAt:course.updatedAt}]}});
        if(pathname==="/api/backoffice/courses") {
          if(req.method()==="POST") {writes.push({path:pathname,body:req.postDataJSON()});return route.fulfill({json:{course:{...course,title:req.postDataJSON().title}}});}
          return route.fulfill({json:{courses:[course],total:1,page:1,pages:1,counts:{total:1,draft:1,published:0,archived:0,lessons:0}}});
        }
        if(pathname.startsWith("/portal/"))return route.fulfill({body:await readFile(path.join("public",pathname)),contentType:pathname.endsWith("svg")?"image/svg+xml":"image/jpeg"});
        return route.fulfill({contentType:"text/html",body:'<div id="root"></div>'});
      });
      await page.goto(`http://backoffice.test/${locale}/backoffice/orders`);
      for(const css of ["app/styles.css","app/portal-design.css"])await page.addStyleTag({content:await readFile(css,"utf8")});
      await page.addStyleTag({content:bundle.outputFiles.find(file=>file.path.endsWith(".css"))!.text});
      await page.addScriptTag({content:bundle.outputFiles.find(file=>file.path.endsWith(".js"))!.text,type:"module"});
      await page.waitForFunction(()=>typeof (window as unknown as TestWindow).__backofficeMount === 'function');
      let key=0;
      const mount=async(kind:string,operator=true)=>{await page.evaluate(input=>(window as unknown as TestWindow).__backofficeMount(input),{kind,locale,key:++key,operator});};
      await mount("orders");
      await expect(page.getByRole("alert")).toContainText("Orders unavailable");
      failOrders=false;await page.getByRole("button",{name:copy.backoffice.orders.refresh,exact:true}).click();
      await expect(page.locator(".bo-desktop .lg-ant-table-content > table")).toContainText("Science plan");
      await expect(page.locator(".bo-desktop .lg-ant-table-content > table")).toContainText("39.00");
      await page.locator(".lg-ant-table-row-expand-icon").first().click();
      await page.locator(".bo-desktop").getByRole("button",{name:copy.backoffice.orders.refund,exact:true}).click();
      const dialog=page.getByRole("dialog");await expect(dialog).toBeVisible();
      await expect.poll(()=>page.evaluate(()=>document.body.style.overflow)).toBe("hidden");
      assert.equal(await dialog.evaluate(el=>Boolean(el.closest(".backoffice-ui"))),true,"Confirmation must share the backend style scope");
      await dialog.getByRole("button",{name:common.cancel,exact:true}).click();await expect(dialog).toBeHidden();assert.equal(writes.length,0);
      await expect.poll(()=>page.evaluate(()=>document.body.style.overflow)).toBe("");
      await page.locator(".bo-desktop").getByRole("button",{name:copy.backoffice.orders.refund,exact:true}).click();
      await dialog.getByRole("button",{name:copy.backoffice.orders.refund,exact:true}).click();
      await expect(page.getByRole("alert")).toContainText("Refund unavailable");
      await page.screenshot({path:path.join(output,`${locale}-refund-failure.png`),fullPage:true});
      await expect(dialog).toBeHidden();
      failRefund=false;await page.locator(".bo-desktop").getByRole("button",{name:copy.backoffice.orders.refund,exact:true}).click();
      await dialog.getByRole("button",{name:copy.backoffice.orders.refund,exact:true}).click();
      await expect(page.locator(".bo-desktop > .lg-ant-table-wrapper")).toContainText(copy.backoffice.orders.paymentStatus.refunded);
      await page.locator("#order-search-desktop").fill("fixture order");
      await page.locator(".bo-desktop form").getByRole("button",{name:copy.backoffice.orders.search,exact:true}).click();
      await expect.poll(()=>lastOrdersQuery).toContain("search=fixture+order");
      await expect(page.getByRole("link",{name:copy.backoffice.orders.export})).toHaveAttribute("href",/search=fixture\+order/);
      await page.screenshot({path:path.join(output,`${locale}-orders-desktop.png`),fullPage:true});
      await page.setViewportSize({width:390,height:844});
      await expect(page.locator(".bo-mobile-cards")).toBeVisible();
      assert.equal(await page.locator(".bo-desktop .lg-ant-table-content > table").isVisible(),false);
      await page.locator(".bo-heading").getByRole("button",{name:copy.backoffice.orders.search,exact:true}).click();
      await expect(dialog).toBeVisible();await page.locator("#order-status-mobile").click();
      await expect(page.locator(".lg-ant-select-dropdown:visible")).toBeVisible();
      assert.equal(await page.locator(".lg-ant-select-dropdown:visible").evaluate(el=>Boolean(el.closest(".backoffice-ui"))),true);
      await page.keyboard.press("Escape");await expect(page.locator(".lg-ant-select-dropdown:visible")).toHaveCount(0);
      await page.locator("#order-search-mobile").focus();await page.keyboard.press("Escape");
      await expect(dialog).toBeHidden();
      await noOverflow(page);
      await expect(page.getByRole("button",{name:common.menu,exact:true})).toHaveAttribute("aria-expanded","false");
      await page.getByRole("button",{name:common.menu,exact:true}).click();await expect(dialog).toBeVisible();
      await expect(page.getByRole("button",{name:common.menu,exact:true})).toHaveAttribute("aria-expanded","true");
      await expect(dialog.getByRole("link")).toHaveCount(5);await page.keyboard.press("Escape");await expect(dialog).toBeHidden();
      await page.screenshot({path:path.join(output,`${locale}-orders-mobile.png`),fullPage:true});

      await mount("payment");
      await page.getByLabel(copy.backoffice.payment.name,{exact:true}).fill("Local Stripe");
      await page.getByRole("button",{name:copy.backoffice.payment.save,exact:true}).click();
      await expect(page.getByRole("alert")).toContainText("Payment unavailable");
      failPayment=false;await page.getByRole("button",{name:copy.backoffice.payment.save,exact:true}).click();
      await expect(page.getByRole("alert")).toContainText(copy.backoffice.payment.saved);
      const paymentWrite=writes.filter(write=>write.path==="/api/backoffice/payment").at(-1)!;
      assert.deepEqual(Object.keys(paymentWrite.body).sort(),["name","paymentNotifications","publishableKey","returnUrl"]);
      assert.equal(await page.getByLabel(copy.backoffice.payment.name,{exact:true}).evaluate(el=>getComputedStyle(el).borderTopWidth),"1px");
      await noOverflow(page);await page.screenshot({path:path.join(output,`${locale}-payment-mobile.png`),fullPage:true});

      await mount("portal");
      const picker=page.getByRole("button",{name:copy.portalEditor.chooseImage,exact:true}).first();
      await picker.click();await expect(dialog).toBeVisible();await expect(dialog.getByRole("alert")).toContainText("Library unavailable");
      failLibrary=false;await dialog.getByRole("button",{name:locale==="zh-CN"?"重试":"Retry",exact:true}).click();
      await dialog.getByRole("button",{name:"Fixture image",exact:true}).click();await expect(dialog).toBeHidden();
      await expect(picker).toBeFocused();
      await expect.poll(()=>page.evaluate(()=>document.body.style.overflow)).toBe("");
      await page.getByRole("button",{name:copy.portalEditor.save,exact:true}).click();await expect(page.getByRole("alert")).toContainText("CMS unavailable");
      failCms=false;await page.getByRole("button",{name:copy.portalEditor.save,exact:true}).click();await expect(page.getByRole("status")).toContainText(copy.portalEditor.saved);
      const cms=writes.filter(write=>write.path==="/api/backoffice/portal").at(-1)!.body as typeof defaultPortalContent;
      assert.equal(cms.banners["en-GB"][0].image,"/portal/course-book.jpg");assert.equal(cms.banners["zh-CN"][0].image,"/portal/course-book.jpg");
      await noOverflow(page);

      await mount("courses");await expect(page.locator(".bo-mobile-cards")).toContainText("Fixture course");
      await page.getByRole("button",{name:copy.backoffice.create,exact:true}).click();
      await page.locator("#new-course-title").fill("New fixture course");
      await page.locator("#new-course-title").press("Enter");
      await expect.poll(()=>writes.filter(write=>write.path==="/api/backoffice/courses").length).toBe(1);
      assert.equal(writes.filter(write=>write.path==="/api/backoffice/courses")[0].body.title,"New fixture course");
      await expect(page.getByRole('heading',{level:1,name:'New fixture course',exact:true})).toBeVisible();
      await noOverflow(page);
      await mount("courses",false);await expect(page.locator("aside nav a")).toHaveCount(1);
      assert.equal(await page.getByRole("button",{name:common.ownership,exact:true}).count(),0);
      await noOverflow(page);
      assert.deepEqual(errors,[]);
      await page.close();
    }
  } catch(error) {
    if(lastPage && !lastPage.isClosed()) {
      await lastPage.screenshot({path:path.join(output,'failure.png'),fullPage:true});
    }
    throw error;
  } finally { await browser.close(); }
});

async function noOverflow(page: Page) {
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,"No horizontal viewport overflow");
}
