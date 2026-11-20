// Course percentage assertions superseded by the 2026-11-11 Lesson-only completion policy.
import assert from "node:assert/strict";
import { before, after, test } from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { COURSE_ID, PREVIEW_LP, PRIVATE_LP, verifiedUser, readProductData, writeProductData } from "./helpers/my-learning";
import { getOverviewDisplay } from "../../services/overviewDisplay";
import type { ProductCourse } from "../../services/productStore";
import { build, stop } from "esbuild";
import { createRequire } from "node:module";

const cwd=process.cwd(), environment={...process.env};
let directory:string, store:typeof import("../../services/productStore");
before(async()=>{
  directory=await mkdtemp(path.join(tmpdir(),"lg-real-overview-"));process.chdir(directory);
  Object.assign(process.env,{STORAGE_BACKEND:"local",APP_ENV:"DEV",PAYMENT_MODE:"demo"});
  store=await import("../../services/productStore");
});
after(async()=>{stop();process.chdir(cwd);process.env=environment;if(directory&&path.dirname(directory)===tmpdir())await rm(directory,{recursive:true,force:true});});

let checkpointId=0;
async function checkpoint(userId:string,courseId:string,lessonId:string,mode:"video"|"text",contentId:string,positionMs=12345){
  const snapshot=await store.getLessonBookmarks(userId,courseId), values=snapshot.bookmarks[lessonId] || {};
  return store.saveLessonBookmark(userId,{courseId,lessonId,mode,contentId,contentVersion:snapshot.versions[lessonId][mode],expectedRevision:values[mode]?.revision || 0,
    expectedLessonRevision:Object.values(values).reduce((sum,item)=>sum+item.revision,0),clientEventId:`overview-checkpoint-${++checkpointId}`,
    ...(mode==="video"?{positionMs}:{paragraphId:`${contentId}:paragraph:0`})});
}

test("three courses with three interleaved lessons retain every event and one current card per course", async () => {
  const user=await verifiedUser(store,"three-courses@example.test"), data=await readProductData();
  const template=data.courses.find((course:ProductCourse)=>course.id===COURSE_ID);
  const courses=[1,2,3].map(number=>({ ...structuredClone(template), id:`parallel-course-${number}`,slug:`parallel-course-${number}`,status:"published",
    sections:[{id:`section-${number}`,title:"Three lessons",lessons:[1,2,3].map(index=>({
      id:`parallel-${number}-lesson-${index}`,title:`Lesson ${index}`,body:"",isPublic:index===1,durationMinutes:1,
      contents:[{id:`parallel-${number}-text-${index}`,title:"Reading",type:"text",mode:"lecture",html:"<p>Reading</p>",nodes:[]}],
    }))}],
  }));
  data.courses.push(...courses);await writeProductData(data);
  const {quote}=await store.createQuote(user.id,"everything-pc-6");await store.completeDemoCheckout(user.id,quote.id);
  let count=0;
  for(const index of [0,1,2,0]) for(const course of courses){
    const lesson=course.sections[0].lessons[index];
    await store.recordStudyEvent({userId:user.id,courseId:course.id,lessonId:lesson.id,learningMode:"text",contentId:lesson.contents[0].id,event:"open",seconds:0,clientEventId:`parallel-${count++}`});
    await checkpoint(user.id,course.id,lesson.id,"text",lesson.contents[0].id);
    const display=await getOverviewDisplay(user.id,user.nickname,"en-GB");
    const card=display.courses.find(item=>item.courseId===course.id)!;
    assert.equal(card.lessonId,lesson.id);assert.equal(card.contentId,lesson.contents[0].id);
    assert.equal(display.syncCourses?.find(item=>item.courseId===course.id)?.currentLessonId,lesson.id);
  }
  const overview=await store.getLearningOverview(user.id), saved=await readProductData();
  assert.equal(overview.courses.length,3);
  assert.equal(saved.studyRecords.filter((row:{userId:string})=>row.userId===user.id).length,3);
  assert.equal(saved.studyEvents.filter((row:{userId:string})=>row.userId===user.id).length,12);
  assert.ok(overview.courses.every(item=>item.progress===0),"reviewing Lesson 1 retains the saved maximum");
});

test("Overview follows the current user's actual video points, metadata, access and completion",async()=>{
  const user=await verifiedUser(store,"real-overview@example.test","Alice"), other=await verifiedUser(store,"other-overview@example.test","Bob");
  const data=await readProductData(), course=data.courses.find((c:ProductCourse)=>c.id===COURSE_ID);
  course.title="Real video course";course.cover="/portal/course-book.jpg";
  const lessons=course.sections.flatMap((s:{lessons:unknown[]})=>s.lessons);
  lessons[0].contents=[{id:"v1",title:"One",type:"video",mode:"lecture",url:"/one.mp4",nodes:[]},{id:"v2",title:"Two",type:"video",mode:"lecture",url:"/two.mp4",nodes:[]}];
  lessons[1].contents=[{id:"v3",title:"Three",type:"video",mode:"lecture",url:"/three.mp4",nodes:[]},{id:"hidden",type:"video",active:false}];
  data.courses.push({...structuredClone(course),id:"unstarted",slug:"unstarted",title:"Never started"});
  await writeProductData(data);
  const {quote}=await store.createQuote(user.id,"everything-pc-6");await store.completeDemoCheckout(user.id,quote.id);
  assert.deepEqual((await getOverviewDisplay(user.id,user.nickname,"en-GB")).courses,[],"owning Everything does not invent study records");
  await store.recordStudyEvent({userId:user.id,courseId:COURSE_ID,lessonId:PREVIEW_LP,learningMode:"video",contentId:"v2",event:"open",seconds:0,clientEventId:"real-point"});
  const legacy=await readProductData();
  Object.assign(legacy.studyRecords.find((record:{userId:string})=>record.userId===user.id),{progress:100,completedAt:"2026-01-01T00:00:00Z"});
  await writeProductData(legacy);
  const fresh=(await getOverviewDisplay(user.id,user.nickname,"en-GB")).courses[0];
  assert.equal(fresh.action,"start");assert.equal(fresh.learningState,"not_started");assert.equal(fresh.bookmark,null);
  await checkpoint(user.id,COURSE_ID,PREVIEW_LP,"video","v2");
  const before=(await readProductData()).studyRecords;
  const display=await getOverviewDisplay(user.id,user.nickname,"en-GB"), card=display.courses[0];
  const raw=(await store.getLearningOverview(user.id)).courses.find(item=>item.courseId===COURSE_ID)!;
  assert.deepEqual(display.syncCourses?.find(item=>item.courseId===COURSE_ID), {
    courseId: raw.courseId, mode: raw.mode, currentLessonId: raw.currentLessonId,
    preferredMode: raw.preferredMode,
    currentContentId: raw.currentContentId, progress: raw.progress, updatedAt: raw.updatedAt,
    bookmarkRevision: raw.bookmarkRevision, completedLessonIds: raw.completedLessonIds,
  }, "cached-page reconciliation uses the raw Study snapshot, not a display fallback");
  assert.equal(display.name,"Alice");assert.equal(display.courses.length,1);
  assert.equal(card.title,"Real video course");assert.equal(card.cover,"/portal/course-book.jpg");
  assert.equal(card.progress,0);assert.equal(card.mode,"video");assert.equal(card.currentLesson,1);assert.equal(card.lessonCount,2);
  assert.equal(card.learningState,"in_progress");assert.equal(card.lessonTitle,lessons[0].title);assert.equal(card.bookmark?.lpNumber,"1.2");
  assert.equal(card.contentId,"v2");assert.equal(card.action,"resume");
  assert.equal(card.href,`/en-GB/account/learn/${COURSE_ID}?viewMode=video&lessonId=${PREVIEW_LP}&contentId=v2`);
  assert.deepEqual((await readProductData()).studyRecords,before,"rendering Overview never rewrites study progress");
  assert.deepEqual((await getOverviewDisplay(other.id,other.nickname,"zh-CN")).courses,[],"another user cannot see the first user's records");
  await store.recordStudyEvent({userId:user.id,courseId:COURSE_ID,lessonId:PRIVATE_LP,learningMode:"video",contentId:"v3",event:"open",seconds:0,clientEventId:"last-point"});
  assert.equal((await getOverviewDisplay(user.id,user.nickname,"en-GB")).courses[0].lessonId,PREVIEW_LP,"an open event cannot replace the latest genuine checkpoint");
  await checkpoint(user.id,COURSE_ID,PRIVATE_LP,"video","v3");
  assert.equal((await getOverviewDisplay(user.id,user.nickname,"en-GB")).courses[0].bookmark?.lpNumber,"2.1");
  assert.equal((await getOverviewDisplay(user.id,user.nickname,"en-GB")).courses[0].progress,0,"the final outline point reaches the saved maximum");
  for(const [lessonId,contentId] of [[PREVIEW_LP,"v1"],[PREVIEW_LP,"v2"],[PRIVATE_LP,"v3"]]){
    await store.recordStudyEvent({userId:user.id,courseId:COURSE_ID,lessonId,learningMode:"video",contentId,event:"complete",seconds:0,clientEventId:`complete-${contentId}`});
    const expected=0;
    assert.equal((await getOverviewDisplay(user.id,user.nickname,"en-GB")).courses[0].progress,expected);
    if(lessonId!==PRIVATE_LP) assert.equal((await getOverviewDisplay(user.id,user.nickname,"en-GB")).courses[0].action,"resume","duplicate completion of one Lesson cannot complete the entire Course");
  }
  const completed=(await getOverviewDisplay(user.id,user.nickname,"zh-CN")).courses[0];
  assert.equal(completed.progress,0);assert.equal(completed.action,"review");assert.equal(completed.learningState,"completed");assert.equal(completed.currentLesson,1);assert.equal(completed.bookmark,null);assert.equal(new URL(completed.href,"http://test").searchParams.get("lessonId"),PREVIEW_LP);assert.equal(new URL(completed.href,"http://test").searchParams.has("contentId"),false);
  await checkpoint(user.id,COURSE_ID,PREVIEW_LP,"video","v1",0);
  assert.equal((await getOverviewDisplay(user.id,user.nickname,"en-GB")).courses[0].action,"review","a new review checkpoint cannot undo Course completion");
  const expanded=await readProductData(), expandedCourse=expanded.courses.find((item:ProductCourse)=>item.id===COURSE_ID);
  expandedCourse.sections[0].lessons.push({...structuredClone(expandedCourse.sections[0].lessons[0]),id:"newly-published-lesson"});
  await writeProductData(expanded);
  assert.equal((await getOverviewDisplay(user.id,user.nickname,"en-GB")).courses[0].learningState,"in_progress","all current Lessons must be completed, including newly added ones");
  expandedCourse.sections[0].lessons.pop();await writeProductData(expanded);
  const expired=await readProductData();expired.entitlements.filter((e:{userId:string})=>e.userId===user.id).forEach((e:{validTo:string})=>e.validTo="2020-01-01T00:00:00Z");await writeProductData(expired);
  const denied=(await getOverviewDisplay(user.id,user.nickname,"en-GB")).courses[0];
  assert.equal(denied.progress,0);assert.equal(denied.action,"plans");assert.equal(denied.href,`/en-GB/subscription?courseId=${COURSE_ID}`);
  const withdrawn=await readProductData();withdrawn.courses.find((c:ProductCourse)=>c.id===COURSE_ID).status="draft";await writeProductData(withdrawn);
  assert.deepEqual((await getOverviewDisplay(user.id,user.nickname,"en-GB")).courses,[]);
});

test("a completed Lesson without a bookmark continues at the unfinished Lesson in both views", async () => {
  const user = await verifiedUser(store, "completion-without-checkpoint@example.test");
  const data = await readProductData();
  const course: ProductCourse = structuredClone(data.courses.find((item: ProductCourse) => item.id === COURSE_ID));
  course.id = course.slug = "completion-without-checkpoint";
  course.status = "published";
  const [firstLesson, unfinishedLesson] = course.sections.flatMap(section => section.lessons);
  firstLesson.contents = [{ id: "first-video", title: "First", type: "video", mode: "lecture", url: "/first.mp4", nodes: [] }];
  unfinishedLesson.contents = [{ id: "next-video", title: "Next", type: "video", mode: "lecture", url: "/next.mp4", nodes: [] }];
  data.courses.push(course);
  await writeProductData(data);
  const { quote } = await store.createQuote(user.id, "everything-pc-6");
  await store.completeDemoCheckout(user.id, quote.id);
  await store.recordStudyEvent({
    userId: user.id, courseId: course.id, lessonId: PREVIEW_LP,
    event: "complete", learningMode: "video", contentId: "first-video", seconds: 0, clientEventId: "complete-without-checkpoint",
  });

  const detail = await store.getCoursePage(course.slug, user.id);
  assert.equal(detail.syllabus.find(item => item.lessonId === PREVIEW_LP)?.completed, true);
  for (const locale of ["en-GB", "zh-CN"] as const) {
    const [card] = (await getOverviewDisplay(user.id, user.nickname, locale)).courses;
    assert.equal(card.learningState, "in_progress");
    assert.equal(card.action, "resume");
    assert.equal(card.lessonId, PRIVATE_LP);
    assert.equal(card.bookmark, null);
    assert.equal(new URL(card.href, "http://test").searchParams.get("lessonId"), PRIVATE_LP);
    assert.equal(new URL(card.href, "http://test").searchParams.has("contentId"), false);
  }
  const eventsOnly = await readProductData();
  eventsOnly.studyRecords = eventsOnly.studyRecords.filter((record: { userId: string }) => record.userId !== user.id);
  await writeProductData(eventsOnly);
  const [recovered] = (await getOverviewDisplay(user.id, user.nickname, "en-GB")).courses;
  assert.equal(recovered.action, "resume");
  assert.equal(recovered.lessonId, PRIVATE_LP);

  // Rebuilding a mixed legacy record keeps the event cursor and timestamp during bookmark-only writes.
  eventsOnly.studyEvents.unshift({
    ...eventsOnly.studyEvents.find((event: { userId: string }) => event.userId === user.id),
    id: "legacy-preview-event", clientEventId: "legacy-preview", event: "open", accessContext: "preview",
  });
  await writeProductData(eventsOnly);
  const first = (await getOverviewDisplay(user.id, user.nickname, "en-GB")).syncCourses![0];
  await checkpoint(user.id, course.id, PRIVATE_LP, "video", "next-video");
  const [updated] = (await store.getLearningOverview(user.id)).courses;
  assert.equal(updated.updatedAt, first.updatedAt);
  assert.equal(updated.currentLessonId, first.currentLessonId);
  assert.equal(updated.bookmarkRevision, 1);
  const display = await getOverviewDisplay(user.id, user.nickname, "en-GB");
  assert.equal(display.syncCourses?.[0].bookmarkRevision, updated.bookmarkRevision);
  assert.equal(display.courses[0].bookmark?.lpNumber, "2.1");
});

test("a Course mode choice survives later checkpoints and drives the overview card", async () => {
  const user = await verifiedUser(store, "saved-course-mode@example.test");
  const data = await readProductData();
  const course: ProductCourse = structuredClone(data.courses.find((item: ProductCourse) => item.id === COURSE_ID));
  course.id = course.slug = "saved-course-mode";
  course.status = "published";
  const [mixed, textOnly] = course.sections.flatMap(section => section.lessons);
  const reading = { id: "mixed-text", type: "text" as const, mode: "lecture" as const, title: "Reading", html: "<p>Reading</p>", nodes: [] };
  mixed.contents = [reading, { id: "mixed-video", type: "video", mode: "lecture", title: "Video", url: "https://example.test/mode.mp4", nodes: [] }];
  textOnly.contents = [{ ...reading, id: "text-only" }];
  data.courses.push(course);
  await writeProductData(data);
  const { quote } = await store.createQuote(user.id, "everything-pc-6");
  await store.completeDemoCheckout(user.id, quote.id);
  await store.saveCourseLearningMode(user.id, course.id, "video", mixed.id, "entitled");
  await checkpoint(user.id, course.id, mixed.id, "text", "mixed-text");
  assert.equal((await store.getCourseLearningModeSelection(user.id, course.id)).preferredMode, "video", "a bookmark cannot replace a choice made before any Study Record exists");
  let [card] = (await getOverviewDisplay(user.id, user.nickname, "en-GB")).courses;
  assert.equal(card.action, "resume");
  assert.equal(card.mode, "video");
  assert.equal(card.bookmark, null, "a checkpoint from the other mode is not advertised");

  await checkpoint(user.id, course.id, mixed.id, "video", "mixed-video");
  await checkpoint(user.id, course.id, mixed.id, "text", "mixed-text");
  [card] = (await getOverviewDisplay(user.id, user.nickname, "zh-CN")).courses;
  assert.equal(card.mode, "video");
  assert.equal(card.contentId, "mixed-video");
  assert.equal(card.bookmark?.mode, "video");

  await checkpoint(user.id, course.id, textOnly.id, "text", "text-only");
  [card] = (await getOverviewDisplay(user.id, user.nickname, "en-GB")).courses;
  assert.equal(card.lessonId, textOnly.id);
  assert.equal(card.mode, "text", "the last Lesson is retained when it only has the other mode");
  assert.equal(card.bookmark?.mode, "text");
  assert.equal((await store.getCourseLearningModeSelection(user.id, course.id)).preferredMode, "video");
  await store.saveCourseLearningMode(user.id, course.id, "text", mixed.id, "entitled");
  assert.equal((await store.getCoursePage(course.slug, user.id)).preferredMode, "text");
  assert.equal((await store.getLearningOverview(user.id)).courses[0].preferredMode, "text");
});

test("preview never creates an Overview card or grants protected access",async()=>{
  const data=await readProductData();data.courses.find((c:ProductCourse)=>c.id===COURSE_ID).status="published";await writeProductData(data);
  const visitor=await verifiedUser(store,"preview-overview@example.test","Visitor");
  await store.recordStudyEvent({userId:visitor.id,courseId:COURSE_ID,lessonId:PREVIEW_LP,learningMode:"video",contentId:"v1",event:"open",seconds:0,clientEventId:"preview-point"},"preview");
  assert.deepEqual((await getOverviewDisplay(visitor.id,visitor.nickname,"zh-CN")).courses,[]);
  assert.equal((await store.checkEntitlement(visitor.id,COURSE_ID)).allowed,false);
});

test("Overview route derives record ownership from session and redirects before reading when signed out",async()=>{
  const state={user:{id:"session-owner",nickname:"Current User"} as {id:string;nickname:string}|null,calls:[] as string[],fail:false};
  const api={state,load:async(id:string,name:string,locale:"en-GB"|"zh-CN")=>{state.calls.push(id);if(state.fail)throw new Error("record-store-unavailable");return getOverviewDisplay(id,name,locale);}};
  (globalThis as unknown as {realOverviewRoute:typeof api}).realOverviewRoute=api;
  const compiled=await build({entryPoints:[path.join(cwd,"app/[locale]/account/my-learning/page.tsx")],bundle:true,write:false,platform:"node",format:"cjs",jsx:"automatic",external:["react/jsx-runtime"],plugins:[{name:"session-and-layout",setup(b){
    b.onResolve({filter:/next\/navigation|services\/(productAuth|overviewDisplay)$|components\/portal\/(OverviewDesign|OverviewModeSync|AccountNav|PortalFooter|PortalHeader)$|overview-design\.module\.css$/},args=>({path:args.path,namespace:"mock"}));
    b.onLoad({filter:/.*/,namespace:"mock"},args=>({contents:args.path==="next/navigation"?"export function redirect(url){throw new Error('redirect:'+url)}":args.path.endsWith("productAuth")?"export async function currentProductUser(){return globalThis.realOverviewRoute.state.user}":args.path.endsWith("overviewDisplay")?"export async function getOverviewDisplay(...args){return globalThis.realOverviewRoute.load(...args)}":args.path.endsWith("css")?"export default {page:'page'}":"export const OverviewDesign=()=>null,OverviewModeSync=()=>null,AccountNav=()=>null,PortalFooter=()=>null,PortalHeader=()=>null;"}));
  }}]});
  const pageModule={exports:{} as {default:(props:{params:Promise<{locale:string}>})=>Promise<{props:{children:Array<{props:{data:{name:string;courses:unknown[]}}}>}}>}};
  new Function("require","module","exports",compiled.outputFiles[0].text)(createRequire(import.meta.url),pageModule,pageModule.exports);
  const invoke=(locale="en-GB")=>pageModule.exports.default({params:Promise.resolve({locale})});
  for(const locale of ["en-GB","zh-CN"]){const page=await invoke(locale);assert.equal(page.props.children[2].props.data.name,"Current User");assert.deepEqual(page.props.children[2].props.data.courses,[]);}
  assert.deepEqual(state.calls,["session-owner","session-owner"]);
  state.user=null;state.calls=[];await assert.rejects(invoke(),/redirect:.*sign-in\?returnTo=/);assert.deepEqual(state.calls,[]);
  state.user={id:"session-owner",nickname:"Current User"};state.fail=true;await assert.rejects(invoke(),/record-store-unavailable/,"a data failure must not become a fabricated empty history");
});

test("preview outline entry cannot create any course history",async()=>{
  const user=await verifiedUser(store,"chinese-preview@example.test","Preview User");
  const data=await readProductData();const template=data.courses.find((course:ProductCourse)=>course.id===COURSE_ID);
  const courses=[0,1,2,3].map(index=>({...structuredClone(template),id:`chinese-preview-${index}`,slug:`chinese-preview-${index}`,title:`Chinese Humanities ${index}`,category:"Chinese Humanities",sections:[{id:"chinese-section",title:"Section",lessons:[0,1,2,3].map(number=>({id:`chinese-lesson-${number}`,title:`Lesson ${number}`,isPublic:number===0,durationMinutes:10,body:"",contents:[{id:`chinese-point-${number}`,title:"Point",type:"video",mode:"lecture",url:number===0?"/video.mp4":undefined,html:number===0?undefined:"Reading",nodes:[]}]}))}]}));
  data.courses.push(...courses);await writeProductData(data);
  await store.recordStudyEvent({userId:user.id,courseId:courses[0].id,lessonId:"chinese-lesson-0",contentId:"chinese-point-0",learningMode:"video",event:"open",seconds:0,clientEventId:"chinese-preview-open"},"preview");
  await store.recordStudyEvent({userId:user.id,courseId:courses[0].id,lessonId:"chinese-lesson-0",contentId:"chinese-point-0",learningMode:"video",event:"video_progress",seconds:10,clientEventId:"chinese-preview-partial"},"preview");
  const saved=(await readProductData()).studyRecords;
  for(const locale of ["en-GB","zh-CN"] as const){
    const display=await getOverviewDisplay(user.id,user.nickname,locale);assert.equal(display.courses.length,0);
  }
  assert.deepEqual((await readProductData()).studyRecords,saved,"Overview reads the saved maximum without deleting history or changing the resume cursor");
  await assert.rejects(()=>store.recordStudyEvent({userId:user.id,courseId:courses[0].id,lessonId:"chinese-lesson-0",contentId:"chinese-point-0",learningMode:"video",event:"complete",seconds:600,clientEventId:"chinese-preview-cannot-complete"},"preview"),/cannot be completed/);
});

test("missing course learning points render unavailable progress and course detail instead of invented completion",async()=>{
  const data=await readProductData();
  const visitor=data.users.find((user:{email:string})=>user.email==="real-overview@example.test");
  data.courses.find((course:ProductCourse)=>course.id===COURSE_ID).sections=[];await writeProductData(data);
  const card=(await getOverviewDisplay(visitor.id,visitor.nickname,"en-GB")).courses[0];
  assert.equal(card.progress,null);assert.equal(card.action,"detail");assert.equal(card.currentLesson,null);
  assert.equal(card.href,`/en-GB/portal/courses/${COURSE_ID}`);
});
