import assert from "node:assert/strict";
import { test } from "node:test";
import { build } from "esbuild";
import { chromium } from "playwright";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { renderToStaticMarkup } from "react-dom/server";
import path from "node:path";
import { isolate } from "../io/harness";
import { COURSE_ID, PRIVATE_LP, activateThreeDayTrial, openLearningPoint, purchaseCourse, readProductData, verifiedUser, writeProductData } from "./helpers/my-learning";
import { getMessages } from "../../lib/i18n/messages";

test("course detail replaces purchase with the Figma included-plan card only for current course access", async () => {
  const root = process.cwd(), output = path.join(root, "test-results/course-detail-access");
  await mkdir(output, { recursive: true });
  const bundle = await build({ entryPoints: ["app/[locale]/portal/courses/[slug]/page.tsx"], bundle: true, write: false, outfile: path.join(output, "page.cjs"), platform: "node", format: "cjs", jsx: "automatic", external: ["react", "react/jsx-runtime"], loader: { ".css": "local-css" }, plugins: [{ name: "page-context", setup(b) {
    b.onResolve({ filter: /^(next\/|@\/services\/|@\/components\/portal\/(PortalHeader|PortalFooter|StreamedContent|CourseThumbnail|CourseLearningModeDialog)$)/ }, args => ({ path: args.path, namespace: "context" }));
    b.onLoad({ filter: /.*/, namespace: "context" }, args => ({ loader: "tsx", resolveDir: root, contents:
      args.path.endsWith("productStore") ? "export const getCoursePage=(...a)=>globalThis.courseCardTest.store.getCoursePage(...a);export const getProductCourse=(...a)=>globalThis.courseCardTest.store.getProductCourse(...a);export const getCourseLearningMode=(...a)=>globalThis.courseCardTest.store.getCourseLearningMode(...a);export const listPlans=(...a)=>globalThis.courseCardTest.store.listPlans(...a);"
      : args.path.endsWith("productAuth") ? "export const currentProductUser=async()=>globalThis.courseCardTest.user;"
      : args.path.endsWith("/s3") ? "export const signCourseMediaUrl=async()=>'/portal/course-study.jpg';"
      : args.path === "next/navigation" ? "export function redirect(href){throw new Error('redirect:'+href)}"
      : args.path === "next/image" ? "import React from 'react';export default function Image({unoptimized,...p}){return <img {...p}/>;}"
      : args.path === "next/link" ? "import React from 'react';export default function Link({prefetch,...p}){return <a {...p}/>;}"
      : args.path.endsWith("StreamedContent") ? "export const StreamedContent=({children})=>children;"
      : args.path.endsWith("CourseThumbnail") ? "import React from 'react';export const CourseThumbnail=({src,title})=><img src={src} alt={title}/>;"
      : `export const ${args.path.split("/").pop()}=()=>null;` }));
  } }] });
  const compiled = bundle.outputFiles.find(file => file.path.endsWith(".cjs"))!;
  await writeFile(compiled.path, compiled.text);
  const render = createRequire(import.meta.url)(compiled.path).default;
  const css = bundle.outputFiles.find(file => file.path.endsWith(".css"))!.text;
  const { restore } = await isolate("lg-course-detail-access-");
  const browser = await chromium.launch();
  try {
    const store = await import("../../services/productStore");
    const context = { store, user: null as Awaited<ReturnType<typeof verifiedUser>> | null };
    (globalThis as any).courseCardTest = context;
    const buy = async (userId: string, planId: string) => { const { quote } = await store.createQuote(userId, planId); await store.completeDemoCheckout(userId, quote.id); };
    const owner = await verifiedUser(store, "card-course@example.test");await purchaseCourse(store, owner.id);
    const category = await verifiedUser(store, "card-category@example.test");await buy(category.id, "european-humanities-pc-6");
    const everything = await verifiedUser(store, "card-all@example.test");await buy(everything.id, "everything-pc-6");
    const trial = await verifiedUser(store, "card-trial@example.test");await activateThreeDayTrial(store, trial.id);
    const unrelated = await verifiedUser(store, "card-unrelated@example.test");await buy(unrelated.id, "science-pc-6");
    const expired = await verifiedUser(store, "card-expired@example.test");await purchaseCourse(store, expired.id);
    const snapshot = await readProductData();
    for (const row of [...snapshot.subscriptions, ...snapshot.entitlements].filter(row => row.userId === expired.id)) row.validTo = "2020-01-01T00:00:00Z";
    await writeProductData(snapshot);
    const fixtures = [{ name: "visitor", user: null, included: false }, { name: "course", user: owner, included: true }, { name: "category", user: category, included: true }, { name: "everything", user: everything, included: true }, { name: "trial", user: trial, included: true }, { name: "unrelated", user: unrelated, included: false }, { name: "expired", user: expired, included: false }];
    for (const locale of ["en-GB", "zh-CN"] as const) {
      const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } }), copy = getMessages(locale).courseDetailDesign;
      await page.route("http://course-card.test/**", async route => {
        const pathname = new URL(route.request().url()).pathname;
        if (pathname.startsWith("/portal/")) return route.fulfill({ body: await readFile(path.join(root, "public", pathname)), contentType: pathname.endsWith(".svg") ? "image/svg+xml" : "image/jpeg" });
        return route.fulfill({ contentType: "text/html", body: "<!doctype html><div id='root'></div>" });
      });
      await page.goto("http://course-card.test");
      for (const file of ["app/styles.css", "app/portal-design.css"]) await page.addStyleTag({ content: await readFile(path.join(root, file), "utf8") });
      await page.addStyleTag({ content: css });
      for (const fixture of fixtures) {
        context.user = fixture.user;
        const html = renderToStaticMarkup(await render({ params: Promise.resolve({ locale, slug: COURSE_ID }) }));
        await page.locator("#root").evaluate((element, html) => { element.innerHTML = html; }, html);
        assert.equal(await page.locator('[data-course-plan-status="included"]').count(), fixture.included ? 1 : 0, `${locale}/${fixture.name}`);
        assert.equal(await page.locator('[data-course-plan-status="purchase"]').count(), fixture.included ? 0 : 1);
        if (!fixture.included) { assert.equal(await page.getByRole("link", { name: copy.benefits, exact: true }).count(), 1);continue; }
        const card = page.locator('[data-course-plan-status="included"]');
        assert.equal(await card.getByRole("heading").textContent(), copy.includedInPlan);
        assert.equal(await card.getByRole("link").textContent(), copy.startLearning);
        assert.ok((await card.getByRole("link").getAttribute("href"))?.includes(`/account/learn/${COURSE_ID}?lessonId=`));
        assert.equal(await page.getByRole("link", { name: copy.benefits, exact: true }).count(), 0);
        const icon = card.locator("img");await icon.evaluate(image => (image as HTMLImageElement).decode());
        assert.deepEqual(await icon.evaluate(image => ({ width: image.getBoundingClientRect().width, height: image.getBoundingClientRect().height })), { width: 24, height: 24 });
        assert.ok((await readFile(path.join(root,"public/portal/course-detail/plan-check.svg"))).length > 0);
        assert.equal(await card.evaluate(e => getComputedStyle(e).padding), "24px");
        assert.equal(await card.evaluate(e => getComputedStyle(e).gap), "16px");
        assert.equal(await card.getByRole("link").evaluate(e => getComputedStyle(e).backgroundColor), "rgb(29, 107, 255)");
        for (const width of [1440, 390, 320]) {
          await page.setViewportSize({ width, height: 1000 });
          assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
          if (fixture.name === "course") await page.screenshot({ path: path.join(output, `${locale}-${width}.png`), fullPage: true });
        }
      }
      context.user = owner;await openLearningPoint(store, owner.id, PRIVATE_LP, `card-resume-${locale}`);
      await page.locator("#root").evaluate((element, html) => { element.innerHTML = html; }, renderToStaticMarkup(await render({ params: Promise.resolve({ locale, slug: COURSE_ID }) })));
      const action = page.locator('[data-course-plan-status="included"] a');
      assert.equal(await action.textContent(), copy.continueLearning);
      assert.equal(await action.getAttribute("href"), `/${locale}/account/learn/${COURSE_ID}?lessonId=${PRIVATE_LP}`);
      // Restore the fixture's no-record state for the next locale.
      const data = await readProductData();data.studyEvents = data.studyEvents.filter((row: any) => row.userId !== owner.id);data.studyRecords = data.studyRecords.filter((row: any) => row.userId !== owner.id);await writeProductData(data);
      await page.close();
    }
  } finally { delete (globalThis as any).courseCardTest;await browser.close();await restore(); }
});
