import assert from "node:assert/strict";
import { chromium, firefox, webkit } from "playwright";

const base = process.env.BASE_URL || "http://127.0.0.1:3011";
const matchesBox = (actual, expected) => {
  for (const [key,value] of Object.entries(expected)) assert.ok(Math.abs(actual[key]-value)<0.1, `${key}: ${actual[key]} != ${value}`);
};
for (const [engineName, engine] of Object.entries({ chromium, firefox, webkit })) {
  const browser = await engine.launch();
  try {
    const context = await browser.newContext({ viewport: { width:1440, height:1000 } });
    const api = context.request;
    assert.equal((await (await api.get(`${base}/api/health/config`)).json()).environment, "DEV");
    const email = `settings.${engineName}.${Date.now()}@example.test`;
    assert.equal((await api.post(`${base}/api/auth/register`, { data:{ email, password:"TestPass123!", nickname:"Settings Test" } })).status(),200);
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.goto(`${base}/en-GB/account/my-learning/settings`, { waitUntil:"networkidle" });
    await page.getByRole("button", {name:"Use essential cookies only"}).click();
    await page.evaluate(() => document.fonts.ready);
    const profile = await page.locator(".settings-profile-section").boundingBox();
    const details = await page.locator(".settings-details-section").boundingBox();
    matchesBox(profile,{x:344,y:214,width:946,height:300});
    matchesBox(details,{x:344,y:534,width:946,height:337});
    assert.ok(await page.getByLabel("Email", {exact:true}).isDisabled());
    await page.locator('input[type="file"]').setInputFiles({name:"invalid.txt",mimeType:"text/plain",buffer:Buffer.from("invalid image")});
    assert.equal(await page.locator(".settings-profile-section").getByRole("alert").textContent(),"Use a JPG or PNG image.");
    await page.getByLabel("Name", {exact:true}).fill("Updated Name");
    await page.getByLabel("Country", {exact:true}).selectOption("Ireland");
    await page.locator(".settings-interest-menu summary").click();
    const options = page.locator(".settings-interest-menu input");
    for (let i=0;i<5;i++) await options.nth(i).check();
    assert.ok(await options.nth(5).isDisabled());
    await options.nth(0).uncheck();
    assert.ok(await options.nth(5).isEnabled());
    await options.nth(5).check();
    await page.locator(".settings-interest-menu summary").click();
    await page.getByRole("button", {name:"Save changes",exact:true}).click();
    await page.getByRole("status").filter({hasText:"Settings saved."}).waitFor();
    await page.reload({waitUntil:"networkidle"});
    assert.equal(await page.getByLabel("Name",{exact:true}).inputValue(),"Updated Name");
    assert.equal(await page.getByLabel("Country",{exact:true}).inputValue(),"Ireland");
    const user = (await (await api.get(`${base}/api/me/profile`)).json()).user;
    assert.deepEqual(user.areasOfInterest,["Science","History","Philosophy","Mathematics","Literature"]);
    await page.screenshot({path:`/tmp/lg-settings-${engineName}.png`,fullPage:true});
    for (const locale of ["en-GB","zh-CN"]) {
      await page.goto(`${base}/${locale}/account/my-learning/settings`,{waitUntil:"networkidle"});
      for (const width of [768,390,320]) {
        await page.setViewportSize({width,height:1000});
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth<=innerWidth+1),`${locale} overflow ${width}`);
      }
    }
    assert.deepEqual(errors,[]);
    console.log(JSON.stringify({browser:engineName,passed:true,profile,details}));
  } finally {await browser.close();}
}
