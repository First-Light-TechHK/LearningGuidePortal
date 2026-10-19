import assert from "node:assert/strict";
import { chromium, firefox, webkit } from "playwright";

const base=process.env.BASE_URL || "http://127.0.0.1:3011";
for(const [name,engine] of Object.entries({chromium,firefox,webkit})) {
  const browser=await engine.launch();
  try {
    const context=await browser.newContext({viewport:{width:1440,height:1162}});
    const api=context.request;
    const config=await (await api.get(`${base}/api/health/config`)).json();
    assert.equal(config.environment,"DEV"); assert.equal(config.payment.mode,"demo");
    assert.equal((await api.post(`${base}/api/auth/register`,{data:{email:`confirm.${name}.${Date.now()}@example.test`,password:"TestPass123!",nickname:"Confirm Test"}})).status(),200);
    const {plans}=await (await api.get(`${base}/api/portal/plans`)).json();
    const plan=plans.find(p=>p.scope==="category"&&p.device==="pc");
    const {quote}=await (await api.post(`${base}/api/purchase/quote`,{data:{planId:plan.id}})).json();
    const page=await context.newPage();
    for(const locale of ["en-GB","zh-CN"]) {
      await page.setViewportSize({width:1440,height:1162});
      await page.goto(`${base}/${locale}/portal/subscription/confirmation?quoteId=${quote.id}`,{waitUntil:"networkidle"});
      const dialog=page.getByRole("dialog");
      assert.ok(await dialog.isVisible());
      assert.ok(await page.evaluate(()=>document.querySelector("dialog").contains(document.activeElement)));
      const box=await dialog.boundingBox();
      assert.equal(box.width,720); assert.equal(box.x,360); assert.equal(box.y,72);
      const sections={};
      for(const selector of [".confirmation-plan",".confirmation-payment",".subscription-consents",".confirmation-actions"]) {
        const rect=await dialog.locator(selector).boundingBox();
        sections[selector]={x:rect.x-box.x,y:rect.y-box.y,width:rect.width,height:rect.height};
      }
      assert.equal(box.height,894);
      assert.deepEqual(sections,{
        ".confirmation-plan":{x:32,y:104,width:656,height:237},
        ".confirmation-payment":{x:32,y:359,width:656,height:228},
        ".subscription-consents":{x:32,y:605,width:656,height:178},
        ".confirmation-actions":{x:32,y:801,width:656,height:46}
      });
      assert.equal(await dialog.locator(".confirmation-payment-grid dd").first().textContent(),`${new Intl.NumberFormat(locale,{style:"currency",currency:quote.currency,currencyDisplay:"narrowSymbol"}).format(quote.amountMinor/100)} ${quote.currency.toUpperCase()}`);
      const submit=dialog.locator(".portal-button-primary");
      assert.ok(await submit.isDisabled());
      const consents=dialog.locator('input[type="checkbox"]');
      for(let i=0;i<2;i++)await consents.nth(i).check();
      assert.ok(await submit.isDisabled()); await consents.nth(2).check(); assert.ok(await submit.isEnabled());
      for(let i=0;i<8;i++) {
        const before=await page.evaluate(()=>({tag:document.activeElement?.tagName,text:document.activeElement?.textContent?.slice(0,60)}));
        await page.keyboard.press("Tab");
        assert.ok(await dialog.evaluate(el=>el.contains(document.activeElement)),`Keyboard focus must remain in the modal: ${name} step ${i}, before ${JSON.stringify(before)}`);
      }
      await page.screenshot({path:`/tmp/lg-confirmation-${name}-${locale}.png`,fullPage:true});
      for(const width of [768,390,320]) {
        await page.setViewportSize({width,height:740});
        assert.ok(await dialog.evaluate(el=>el.scrollWidth<=el.clientWidth+1),`dialog overflow ${width}`);
        await submit.scrollIntoViewIfNeeded();
        const action=await submit.boundingBox();
        assert.ok(action.y>=0 && action.y+action.height<=740);
      }
      await page.keyboard.press("Escape");
      await page.waitForURL(`**/${locale}/pricing?planId=${encodeURIComponent(plan.id)}`);
      console.log(JSON.stringify({browser:name,locale,passed:true,box,sections}));
    }
  } finally {await browser.close();}
}
