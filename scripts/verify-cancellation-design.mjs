import assert from "node:assert/strict";
import { chromium } from "playwright";

const base=process.env.BASE_URL || "http://127.0.0.1:3011";
const browser=await chromium.launch();
try {
  for(const locale of ["en-GB","zh-CN"]) {
    const context=await browser.newContext({viewport:{width:1440,height:900}});
    const api=context.request;
    const config=await (await api.get(`${base}/api/health/config`)).json();
    assert.equal(config.environment,"DEV"); assert.equal(config.payment.mode,"demo");
    assert.equal((await api.post(`${base}/api/auth/register`,{data:{email:`cancel.${locale}.${Date.now()}@example.test`,password:"TestPass123!",nickname:"Cancel Test"}})).status(),200);
    const {quote}=await (await api.post(`${base}/api/purchase/quote`,{data:{planId:"epicureanism-pc-6"}})).json();
    const {order}=await (await api.post(`${base}/api/purchase/checkout`,{data:{quoteId:quote.id,consents:{renewal:true,terms:true,refund:true}}})).json();
    assert.equal((await api.post(`${base}/api/purchase/demo/confirm`,{data:{orderId:order.id,action:"complete"}})).status(),200);
    const page=await context.newPage();
    await page.goto(`${base}/${locale}/account/my-learning/subscription`,{waitUntil:"networkidle"});
    await page.locator(".table-actions button").first().click();
    const dialog=page.getByRole("dialog");
    assert.ok(await dialog.isVisible());
    assert.equal(await dialog.locator('input[type="radio"]:checked').count(),0);
    await page.screenshot({path:`/tmp/lg-cancellation-${locale}.png`,fullPage:true});
    for(const width of [390,320]) {
      await page.setViewportSize({width,height:740});
      assert.ok(await dialog.evaluate(el=>el.scrollWidth<=el.clientWidth+1));
    }
    await page.setViewportSize({width:1440,height:900});
    for(let i=0;i<8;i++) {await page.keyboard.press("Tab");assert.ok(await dialog.evaluate(el=>el.contains(document.activeElement)));}
    await page.keyboard.press("Escape");
    assert.equal(await page.getByRole("dialog").count(),0);
    assert.equal((await (await api.get(`${base}/api/subscription`)).json()).subscriptions[0].state,"active");
    await page.locator(".table-actions button").first().click();
    await dialog.locator('input[type="radio"]').last().check();
    await dialog.locator("textarea").fill("This should not be submitted when skipped.");
    const requestPromise=page.waitForRequest(request=>request.url().endsWith("/api/subscription")&&request.method()==="POST");
    await dialog.locator(".cancel-skip").click();
    const request=await requestPromise;
    const payload=request.postDataJSON();
    assert.equal(payload.reasonCode,undefined); assert.equal(payload.reasonText,undefined);
    await dialog.waitFor({state:"detached"});
    assert.equal((await (await api.get(`${base}/api/subscription`)).json()).subscriptions[0].state,"cancel_at_period_end");
    console.log(JSON.stringify({locale,passed:true,optionalReason:true,skipOmitsReason:true}));
    await context.close();
  }
} finally {await browser.close();}
