import assert from "node:assert/strict";
import { test } from "node:test";
import { build } from "esbuild";
import { chromium } from "playwright";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import path from "node:path";
import { isolate } from "../io/harness";
import { COURSE_ID, PRIVATE_LP, activateThreeDayTrial, openLearningPoint, purchaseCourse, readProductData, verifiedUser, writeProductData } from "./helpers/my-learning";
import { getMessages } from "../../lib/i18n/messages";

test("course detail replaces purchase with the Figma included-plan card only for current course access", async () => {
  const root = process.cwd(), output = path.join(root, "test-results/course-detail-access");
  await mkdir(output, { recursive: true });
  const bundle = await build({ stdin: { contents: 'export { default } from "./app/[locale]/portal/courses/[slug]/page"; export { CatalogueCourseCard } from "./components/portal/CatalogueCourseCard";', resolveDir: root, loader: "tsx" }, bundle: true, write: false, outfile: path.join(output, "page.cjs"), platform: "node", format: "cjs", jsx: "automatic", external: ["react", "react/jsx-runtime"], loader: { ".css": "local-css" }, plugins: [{ name: "page-context", setup(b) {
    b.onResolve({ filter: /^(next\/|@\/services\/|@\/components\/portal\/(PortalHeader|PortalFooter|StreamedContent|CourseThumbnail|CourseLearningModeDialog|CourseDetailSync)$)/ }, args => ({ path: args.path, namespace: "context" }));
    b.onLoad({ filter: /.*/, namespace: "context" }, args => ({ loader: "tsx", resolveDir: root, contents:
      args.path.endsWith("productStore") ? "export const getLessonBookmarks=(...a)=>globalThis.courseCardTest.store.getLessonBookmarks(...a);export const getCoursePage=(...a)=>globalThis.courseCardTest.store.getCoursePage(...a);export const getProductCourse=(...a)=>globalThis.courseCardTest.store.getProductCourse(...a);export const getCourseLearningMode=(...a)=>globalThis.courseCardTest.store.getCourseLearningMode(...a);export const listPlans=(...a)=>globalThis.courseCardTest.store.listPlans(...a);"
      : args.path.endsWith("productAuth") ? "export const currentProductUser=async()=>globalThis.courseCardTest.user;"
      : args.path.endsWith("/s3") ? "export const signCourseMediaUrl=async value=>value?.startsWith('/courses/')?value:'/portal/course-study.jpg';"
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
  const Card = createRequire(import.meta.url)(compiled.path).CatalogueCourseCard;
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
    const fixtureCourse=snapshot.courses.find((course:{id:string})=>course.id===COURSE_ID);
    fixtureCourse.sections[0].lessons.push({...structuredClone(fixtureCourse.sections[0].lessons[0]),id:'unstarted-fixture',title:'Unstarted fixture lesson',isPublic:false});
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
        const syllabus = page.locator('[data-syllabus]');
        const entries = syllabus.locator('[data-course-cta-link]');
        const coursePage = await store.getCoursePage(COURSE_ID, fixture.user?.id);
        assert.equal(await entries.count(), fixture.included ? coursePage.syllabus.length : 1, `${locale}/${fixture.name}: each entitled Lesson has its own entry; previews retain one`);
        for (const lesson of coursePage.syllabus) {
          const row = syllabus.locator(`[data-lesson-id="${lesson.lessonId}"]`);
          if (fixture.included) {
            const entry = row.getByRole('link', { name: copy.start, exact: true });
            assert.equal(await entry.count(), 1);
            assert.equal(await entry.getAttribute('href'), `/${locale}/account/learn/${COURSE_ID}?lessonId=${encodeURIComponent(lesson.lessonId)}`);
          } else if (!lesson.openable) assert.equal(await row.getByRole('link').count(), 0);
        }
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
      assert.equal(await page.locator('[data-syllabus]').getByRole('link', { name: copy.start, exact: true }).count(), (await store.getCoursePage(COURSE_ID, owner.id)).syllabus.length, 'review progress does not hide earlier Lesson buttons');
      const course = (await store.getProductCourse(COURSE_ID))!;
      const lesson = course.sections.flatMap(section => section.lessons).find(lesson => lesson.id === PRIVATE_LP)!;
      const point = lesson.contents?.find(point => point.active !== false && point.type !== 'video');
      const bookmarks = await store.getLessonBookmarks(owner.id, COURSE_ID);
      const saved = await store.saveLessonBookmark(owner.id, { courseId: COURSE_ID, lessonId: PRIVATE_LP, mode: 'text', contentId: point?.id || null,
        paragraphId: `${point?.id || 'body'}:paragraph:0`, contentVersion: bookmarks.versions[PRIVATE_LP].text, expectedRevision: 0, expectedLessonRevision: 0, clientEventId: `card-bookmark-${locale}` });
      await store.recordStudyEvent({userId:owner.id,courseId:COURSE_ID,lessonId:course.sections[0].lessons[0].id,event:'complete',seconds:0,clientEventId:`first-complete-${locale}`});
      await store.saveLessonBookmark(owner.id,{courseId:COURSE_ID,lessonId:PRIVATE_LP,mode:'text',contentId:point?.id||null,paragraphId:`${point?.id||'body'}:paragraph:0`,contentVersion:bookmarks.versions[PRIVATE_LP].text,expectedRevision:saved.revision,expectedLessonRevision:saved.revision,clientEventId:`last-studied-${locale}`});
      await page.locator('#root').evaluate((element, html) => { element.innerHTML = html; }, renderToStaticMarkup(await render({ params: Promise.resolve({ locale, slug: COURSE_ID }) })));
      const bookmark = page.locator(`[data-lesson-bookmark="${PRIVATE_LP}"]`);
      assert.equal(await bookmark.textContent(), getMessages(locale).lessonBookmark.text.replace('{lp}', saved.lpNumber));
      const lessonRow=page.locator(`[data-lesson-id="${PRIVATE_LP}"]`);
      assert.equal(await lessonRow.getByRole('link',{name:copy.continue,exact:true}).count(),1);
      assert.equal(await lessonRow.getByRole('link',{name:copy.start,exact:true}).count(),0);
      assert.equal(await lessonRow.getByRole('link',{name:copy.continue,exact:true}).getAttribute('data-course-primary'),'true');
      assert.equal(await page.locator('[data-course-primary="true"]').count(),1);
      assert.equal(await page.locator('[data-lesson-id="unstarted-fixture"]').getByRole('link',{name:copy.start,exact:true}).getAttribute('data-course-primary'),'false');
      assert.equal(await page.locator(`[data-lesson-id="${course.sections[0].lessons[0].id}"]`).getByRole('link',{name:copy.review,exact:true}).getAttribute('data-course-primary'),'false');
      assert.deepEqual(await lessonRow.getByRole('link',{name:copy.continue,exact:true}).evaluate(link=>({width:link.getBoundingClientRect().width,height:link.getBoundingClientRect().height})),{width:110,height:40});
      for (const width of [1440, 390, 320]) {
        await page.setViewportSize({ width, height: 1000 });
        await bookmark.scrollIntoViewIfNeeded();
        const image = bookmark.locator('img'); await image.evaluate(image => (image as HTMLImageElement).decode());
        assert.deepEqual(await image.evaluate(image => ({ width: image.getBoundingClientRect().width, height: image.getBoundingClientRect().height })), { width: 16, height: 16 });
        assert.equal(await bookmark.evaluate(e => getComputedStyle(e).fontSize), '13px');
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
        await page.screenshot({ path: path.join(output, `${locale}-bookmark-${width}.png`) });
      }
      await store.recordStudyEvent({userId:owner.id,courseId:COURSE_ID,lessonId:PRIVATE_LP,event:'complete',seconds:0,clientEventId:`completed-label-${locale}`});
      await page.locator('#root').evaluate((element, html) => { element.innerHTML = html; }, renderToStaticMarkup(await render({ params: Promise.resolve({ locale, slug: COURSE_ID }) })));
      assert.equal(await lessonRow.getByRole('link',{name:copy.continue,exact:true}).count(),0,'completed reentry keeps its existing label');
      assert.equal(await lessonRow.getByRole('link',{name:copy.review,exact:true}).count(),1);
      assert.equal(await lessonRow.locator('[data-lesson-completed]').textContent(),copy.completed);
      assert.equal(await lessonRow.locator('[data-lesson-bookmark]').count(),0);
      const completedIcon=lessonRow.locator('[data-lesson-completed] img');await completedIcon.evaluate(image=>(image as HTMLImageElement).decode());
      assert.deepEqual(await completedIcon.evaluate(image=>({width:image.getBoundingClientRect().width,height:image.getBoundingClientRect().height})),{width:16,height:16});
      assert.equal(await lessonRow.getByRole('link',{name:copy.review,exact:true}).getAttribute('data-course-primary'),'false');
      const nextStart = page.locator('[data-lesson-id="unstarted-fixture"]').getByRole('link', { name: copy.start, exact: true });
      assert.equal(await nextStart.getAttribute('data-course-primary'), 'true', 'completion promotes the next unfinished Lesson');
      assert.equal(await page.locator('[data-course-primary="true"]').count(), 1);
      assert.equal(await nextStart.evaluate(link => getComputedStyle(link).backgroundColor), 'rgb(29, 107, 255)');
      await page.screenshot({path:path.join(output,`${locale}-completed-review.png`)});

      // Real service completion data with gaps across five Lessons: 1/3/5 complete, 2/4 unstarted.
      const gapData = await readProductData();
      const gapCourse = gapData.courses.find((item: { id: string }) => item.id === COURSE_ID);
      const originalSections = structuredClone(gapCourse.sections);
      const template = gapCourse.sections[0].lessons[0];
      for (const number of [4, 5]) gapCourse.sections[0].lessons.push({ ...structuredClone(template), id: `gap-${number}`, title: `Gap Lesson ${number}`, isPublic: false });
      gapData.studyEvents = gapData.studyEvents.filter((row: { userId: string }) => row.userId !== owner.id);
      gapData.studyRecords = gapData.studyRecords.filter((row: { userId: string }) => row.userId !== owner.id);
      await writeProductData(gapData);
      for (const lessonId of [template.id, 'unstarted-fixture', 'gap-5']) await store.recordStudyEvent({ userId: owner.id, courseId: COURSE_ID, lessonId, event: 'complete', seconds: 0, clientEventId: `gap-complete-${locale}-${lessonId}` });
      await page.locator('#root').evaluate((element, html) => { element.innerHTML = html; }, renderToStaticMarkup(await render({ params: Promise.resolve({ locale, slug: COURSE_ID }) })));
      assert.equal(await lessonRow.getByRole('link', { name: copy.start, exact: true }).getAttribute('data-course-primary'), 'true');
      assert.equal(await page.locator('[data-course-primary="true"]').count(), 1);
      assert.equal(await lessonRow.getByRole('link', { name: copy.start, exact: true }).evaluate(link => getComputedStyle(link).backgroundColor), 'rgb(29, 107, 255)');
      assert.equal(await page.locator('[data-course-plan-status="included"] a').getAttribute('href'), `/${locale}/account/learn/${COURSE_ID}?lessonId=${PRIVATE_LP}`, 'the main entry follows the blue Lesson button');
      await page.screenshot({ path: path.join(output, `${locale}-gapped-completion.png`), fullPage: true });
      for (const lessonId of [PRIVATE_LP, 'gap-4']) await store.recordStudyEvent({ userId: owner.id, courseId: COURSE_ID, lessonId, event: 'complete', seconds: 0, clientEventId: `gap-all-complete-${locale}-${lessonId}` });
      await page.locator('#root').evaluate((element, html) => { element.innerHTML = html; }, renderToStaticMarkup(await render({ params: Promise.resolve({ locale, slug: COURSE_ID }) })));
      assert.equal(await page.locator('[data-course-primary="true"]').count(), 1);
      assert.equal(await page.locator('[data-course-primary="true"]').textContent(), copy.review);
      const restored = await readProductData();
      restored.courses.find((item: { id: string }) => item.id === COURSE_ID).sections = originalSections;
      await writeProductData(restored);
      // Restore the fixture's no-record state for the next locale.
      const data = await readProductData();data.studyEvents = data.studyEvents.filter((row: { userId: string }) => row.userId !== owner.id);data.studyRecords = data.studyRecords.filter((row: { userId: string }) => row.userId !== owner.id);await writeProductData(data);
      const modeling = await store.getProductCourse("modeling-life");assert.ok(modeling);context.user = null;
      await page.route("http://course-card.test/courses/**", async route => route.fulfill({body:await readFile(path.join(root,"public",new URL(route.request().url()).pathname)),contentType:"image/png"}));
      await page.locator("#root").evaluate((element, html) => { element.innerHTML = html; }, renderToStaticMarkup(await render({params:Promise.resolve({locale,slug:modeling.id})})));
      await page.getByRole("heading",{name:"Modeling life",exact:true}).waitFor();
      const homeCopy = getMessages(locale).homeDesign;
      const durationLabel = `0${homeCopy.hourShort}51${homeCopy.minuteShort}`;
      assert.equal(await page.locator('[data-total-minutes="51"]').textContent(), durationLabel);
      for (const variant of ["catalogue", "home"]) {
        const card = renderToStaticMarkup(createElement(Card, { course: modeling, category: modeling.category || "", locale, variant }));
        await page.evaluate(html => document.body.insertAdjacentHTML("beforeend", `<div id="duration-card">${html}</div>`), card);
        const meta = await page.locator('#duration-card .portal-course-meta, #duration-card .home-course-meta').textContent();
        assert.ok(meta?.replaceAll(" ", "").endsWith(durationLabel), `${locale}/${variant}: ${meta}`);
        await page.locator('#duration-card').evaluate(element => element.remove());
      }
      assert.equal(await page.getByText(modeling.description,{exact:true}).count(),1);
      for(const outcome of modeling.outcomes!)assert.equal(await page.getByText(outcome,{exact:true}).count(),1);
      for(const feature of modeling.features!)assert.equal(await page.getByText(feature,{exact:true}).count(),1);
      assert.equal(await page.locator("[data-syllabus] article").count(),2);
      for(const lesson of modeling.sections[0].lessons)assert.equal(await page.getByText(lesson.summary!,{exact:true}).count(),1);
      await page.locator('img[src="/courses/modeling-life/cover.png"]').evaluate(image=>(image as HTMLImageElement).decode());
      for(const width of [1440,390]){
        await page.setViewportSize({width,height:1000});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
        await page.screenshot({path:path.join(output,`modeling-life-${locale}-${width}.png`),fullPage:true});
      }
      await page.close();
    }
  } finally { delete (globalThis as any).courseCardTest;await browser.close();await restore(); }
});
