import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import path from "node:path";
import * as migration from "../../db/data-migrations/008_upgrade_modeling_life";
import * as fixExhibits from "../../db/data-migrations/009_fix_modeling_life_exhibits";
import * as logicalMedia from "../../db/data-migrations/013_logical_modeling_life_media";
import { modelingLifeCourse as legacyModelingLifeCourse } from "../../db/data-migrations/006_add_modeling_life_course";
import { dataMigrations } from "../../db/data-migrations";
import { applyOrmMigrations, createMemoryOrm, assertMigrationRegistry } from "../../services/dataMigrations";
import { recordOrm, compileOrmOps } from "../../services/ormRuntime";
import { buildTextLessonPreview } from "../../services/textLessonPreview";
import { validateLessonContents, sanitiseRichHtml } from "../../services/lessonContent";
import { isCourseStaticImage } from "../../lib/courseStaticMedia";
import { courseExploration, lessonAssessmentAvailability } from "../../lib/lessonResources";
import { clearCookies, isolate, jsonRequest, setCookie, SESSION_COOKIE } from "../io/harness";
import { verifiedUser, readProductData, writeProductData } from "./helpers/my-learning";
import type { KnowledgeAttempt } from "../../contracts/lesson-assessment";
import type { ProductCourse } from "../../services/productStore";

const createdAt="2026-10-23T00:00:00.000Z";
const course=migration.modelingLifeCourse(createdAt), [first,second]=course.sections[0].lessons;

test("Modeling life is a registered idempotent ORM course-only migration with portable image references",async()=>{
  assertMigrationRegistry();
  const orm=createMemoryOrm({tables:{users:[{id:"keep-user"}],orders:[{id:"keep-order"}],courses:[{id:"keep-course"}]}});
  const recording=recordOrm(orm);
  const originalUsers=orm.snapshot("users"),originalOrders=orm.snapshot("orders");
  const report=await applyOrmMigrations(recording.orm,[migration],{now:createdAt});
  assert.deepEqual(report.applied,[migration.id]);assert.deepEqual(migration.touches,["courses"]);
  assert.equal(orm.snapshot("users"),originalUsers);assert.equal(orm.snapshot("orders"),originalOrders);
  assert.equal(orm.table("courses").all().length,2);
  const plan=compileOrmOps(recording.ops);
  assert.ok(plan.sql.length);assert.equal(plan.objects.length,0,"images are repository assets, never environment-specific uploads");
  orm.table<ProductCourse>("courses").update(course.id,{title:"Operator-edited title"});
  assert.deepEqual((await applyOrmMigrations(orm,[migration])).applied,[]);
  assert.equal(migration.apply(orm,{now:createdAt,store:"memory",dryRun:true})[0].action,"skip");
  assert.equal(orm.table<ProductCourse>("courses").findById(course.id)?.title,"Operator-edited title");
  const conflictingCourse = {id:"foreign",slug:course.slug};
  assert.throws(()=>migration.apply(createMemoryOrm({tables:{courses:[conflictingCourse]}}),{now:createdAt,store:"memory",dryRun:true}),/identity conflict/);
  assert.equal(course.category,"Science");assert.equal(course.title,"Modeling life");assert.equal(course.sections.flatMap(s=>s.lessons).length,2);
  assert.equal(course.outcomes?.length,6);assert.equal(course.features?.length,6);
  assert.ok(course.subtitle?.startsWith("See how mathematics models life"));
});

test("shipped whole-Lesson courses upgrade without user writes and fresh registries retire old media-copy operations",async()=>{
  const old=legacyModelingLifeCourse(createdAt);old.title="Operator title";
  const keptStudy={id:"keep-study",currentContentId:"modeling-life-lesson-1-text"};
  const orm=createMemoryOrm({tables:{courses:[old],studyRecords:[keptStudy],users:[{id:"keep-user"}]}});
  const study=orm.snapshot("studyRecords"),users=orm.snapshot("users");
  assert.equal(migration.apply(orm,{now:createdAt,store:"memory",dryRun:true})[0].action,"update");
  const next=orm.table<ProductCourse>("courses").findById(course.id)!;
  assert.equal(next.description,course.description);assert.equal(next.title,"Operator title");assert.equal(next.createdAt,old.createdAt);assert.equal(next.sections[0].id,old.sections[0].id);
  assert.deepEqual(next.sections[0].lessons.map(lesson=>lesson.contents!.filter(point=>point.type==="text").length),[5,2]);
  assert.deepEqual(next.sections[0].lessons.map(lesson=>lesson.exploration!.exhibits.length),[2,0]);
  assert.equal(next.sections[0].lessons[0].assessments!.knowledge.length,18);
  assert.equal(orm.snapshot("studyRecords"),study);assert.equal(orm.snapshot("users"),users);
  assert.equal(migration.apply(orm,{now:createdAt,store:"memory",dryRun:true})[0].action,"skip");
  const fresh=createMemoryOrm(),recorded=recordOrm(fresh);
  const report=await applyOrmMigrations(recorded.orm,dataMigrations.filter(item=>Number(item.id.slice(0,3))>=6),{now:createdAt});
  assert.deepEqual(report.applied,[migration.id]);assert.ok(report.skipped.includes("006_add_modeling_life_course"));assert.ok(report.skipped.includes("007_repair_modeling_life_media"));assert.ok(report.skipped.includes("013_logical_modeling_life_media"));
  assert.equal(compileOrmOps(recorded.ops).objects.length,0,"fresh DEV/SIT needs no legacy S3 media copy");
  assert.equal(fresh.table<ProductCourse>("courses").findById(course.id)!.sections[0].lessons[0].contents!.length,10);
});

test("013 rewrites leftover staging and exhibit files to course-media ids without touching users",async()=>{
  const existing=structuredClone(course);
  existing.sections[0].lessons[0].contents!.find(item=>item.type==="video")!.url="https://example.invalid/staging/modeling-life/lesson1.mp4";
  existing.sections[0].lessons[0].contents!.find(item=>item.type==="video")!.nodes[0].url="/courses/modeling-life/lesson1-exhibit-1.png";
  const orm=createMemoryOrm({tables:{courses:[existing],users:[{id:"keep-user"}]}});
  const users=orm.snapshot("users");
  const report=await applyOrmMigrations(orm,[logicalMedia],{now:createdAt});
  assert.deepEqual(report.applied,[logicalMedia.id]);
  const updated=orm.table<ProductCourse>("courses").findById(course.id)!;
  assert.equal(updated.sections[0].lessons[0].contents!.find(item=>item.type==="video")!.url,"/api/course-media/modeling-life/04f0039b-42c7-441b-85b7-fe6e21c6bbe6");
  assert.equal(updated.sections[0].lessons[0].contents!.find(item=>item.type==="video")!.nodes[0].url,"/api/course-media/modeling-life/9a88e350-e44f-47b1-9518-ed8b50cc4d36");
  assert.equal(orm.snapshot("users"),users);
  assert.deepEqual((await applyOrmMigrations(orm,[logicalMedia])).applied,[]);
});

test("exhibit correction migrates existing four-item imports without changing readings, text, other Lessons or user data",async()=>{
  const existing=structuredClone(course),lesson=existing.sections[0].lessons[0];
  existing.title="Operator-edited title";
  lesson.exploration!.exhibits.push(...["1-3","1-8"].map(suffix=>({node:{id:`modeling-life-exhibit-${suffix}`,type:"text" as const,title:"Extra Word exhibit",triggerTime:0,html:"<p>Preserved in the lesson body</p>"},lessonNumber:"01",thumbnail:"/portal/exploration/thumbnail-v2.png"})));
  lesson.exploration!.exhibits[0].node.url="/courses/modeling-life/lesson-1-image2.png";
  const before=structuredClone(existing);
  const orm=createMemoryOrm({tables:{courses:[existing,{...course,id:"another-course",slug:"another-course"}],users:[{id:"keep-user"}],studyRecords:[{id:"keep-progress"}],orders:[{id:"keep-order"}]}});
  const users=orm.snapshot("users"),progress=orm.snapshot("studyRecords"),orders=orm.snapshot("orders");
  const recorded=recordOrm(orm);
  const report=await applyOrmMigrations(recorded.orm,[fixExhibits],{now:createdAt});
  assert.deepEqual(report.applied,[fixExhibits.id]);assert.deepEqual(fixExhibits.touches,["courses"]);
  const updated=orm.table<ProductCourse>("courses").findById(course.id)!;
  const expected=structuredClone(before);expected.sections[0].lessons[0].exploration!.exhibits=structuredClone(first.exploration!.exhibits);expected.updatedAt=updated.updatedAt;
  assert.deepEqual(updated,expected);assert.equal(orm.snapshot("users"),users);assert.equal(orm.snapshot("studyRecords"),progress);assert.equal(orm.snapshot("orders"),orders);
  assert.deepEqual(orm.table<ProductCourse>("courses").findById("another-course"),{...course,id:"another-course",slug:"another-course"});
  assert.equal(compileOrmOps(recorded.ops).objects.length,0);
  assert.equal(fixExhibits.apply(orm,{now:createdAt,store:"memory",dryRun:true})[0].action,"skip");
  assert.deepEqual((await applyOrmMigrations(orm,[fixExhibits])).applied,[]);
  assert.equal(fixExhibits.apply(createMemoryOrm(),{now:createdAt,store:"memory",dryRun:true})[0].reason,"missing");
});

test("all 34 source images are copied exactly and all 29 Word images survive rich-text sanitisation",async()=>{
  for(const image of migration.modelingLifeImport.images){
    const bytes=await readFile(path.join(process.cwd(),"public/courses/modeling-life",image.file));
    assert.equal(createHash("sha256").update(bytes).digest("hex"),image.sha256,image.file);
    assert.equal(bytes.length,image.bytes);assert.equal(bytes.subarray(0,8).toString("hex"),"89504e470d0a1a0a");
  }
  const text=course.sections.flatMap(s=>s.lessons.flatMap(l=>l.contents!.filter(c=>c.type==="text")));
  assert.equal(text.length,7);assert.equal(text.reduce((count,c)=>count+(c.html!.match(/<img\b/g)||[]).length,0),29);
  const imageUrls=text.flatMap(content=>Array.from(content.html!.matchAll(/<img[^>]*src="([^"]+)"/g),match=>match[1]));
  assert.equal(new Set(imageUrls).size,29,"every embedded image is referenced exactly once");
  assert.match(text[0].html!,/状态变量/);assert.match(text[0].html!,/state/);assert.match(text[0].html!,/<table>/);
  for(const content of text){assert.equal(content.exhibitMode,"authored");assert.match(content.html!,/[\u3400-\u9fff]/);assert.doesNotMatch(content.html!,/data:image|file:|D:\\|<script/i);}
  const invalid=["/courses/other/image.png","/courses/modeling-life/../image.png","/courses/modeling-life/%2e%2e/image.png","//host/image.png","/courses/modeling-life/image.svg","/courses/modeling-life/image.png?bypass=1"];
  for(const url of invalid){assert.equal(isCourseStaticImage(url,course.id),false);assert.equal(sanitiseRichHtml(`<p><img src="${url}"></p>`,course.id).includes("<img"),false);}
  const valid="/courses/modeling-life/lesson-1-image2.png";
  assert.ok(isCourseStaticImage(valid,course.id));assert.match(sanitiseRichHtml(`<img src="${valid}">`,course.id),/lesson-1-image2/);
  assert.throws(()=>validateLessonContents([{id:"bad",title:"Bad",type:"text",mode:"lecture",nodes:[],startSeconds:10}],course.id));
});

test("authored points, source video starts, thumbnail pairs, readings and questions match the supplied sources",()=>{
  assert.deepEqual(first.contents!.filter(c=>c.type==="video").map(c=>c.startSeconds),[10,412,587,1026,1175]);
  assert.deepEqual(second.contents!.filter(c=>c.type==="video").map(c=>c.startSeconds),[10,1204]);
  const videos=course.sections.flatMap(s=>s.lessons.flatMap(l=>l.contents!.filter(c=>c.type==="video")));
  assert.equal(new Set(videos.map(v=>v.url)).size,2);
  for(const [lessonNumber,lesson] of [first,second].entries()) {
    const expected=`/api/course-media/modeling-life/${lessonNumber===0?"04f0039b-42c7-441b-85b7-fe6e21c6bbe6":"613a07b1-24e8-4123-ab10-5bd36875293e"}`;
    assert.ok(lesson.contents!.filter(content=>content.type==="video").every(content=>content.url===expected));
    assert.equal(migration.modelingLifeImport.videoUrls[lessonNumber===0?"lesson1":"lesson2"],expected);
  }
  assert.equal(migration.modelingLifeImport.videoIsTemporary,false);
  const nodes=first.contents!.find(c=>c.type==="video")!.nodes;
  assert.deepEqual(nodes.map(n=>[n.title,n.triggerTime]),[["T, W, V, C",37],["Three examples of one-dimensional state spaces",160]]);
  const exhibits=["/api/course-media/modeling-life/9a88e350-e44f-47b1-9518-ed8b50cc4d36","/api/course-media/modeling-life/3d1a37f4-6535-450c-879a-22c3cad48b08"];
  const thumbs=["/api/course-media/modeling-life/1b00006f-08ed-4f77-8285-a4685e3237de","/api/course-media/modeling-life/1d1e5a63-48ef-47b9-aeaf-b4a41b065515"];
  assert.ok(nodes.every((node,i)=>node.url===exhibits[i]&&node.thumbnail===thumbs[i]));
  const exploration=courseExploration(course)!;assert.equal(exploration.readings.length,3);assert.equal(exploration.exhibits.length,2);
  assert.deepEqual(exploration.exhibits.map(exhibit=>({...exhibit.node,id:undefined})),nodes.map(node=>({...node,id:undefined})),"Exploration uses the two confirmed video exhibit titles and original images");
  assert.deepEqual(exploration.exhibits.map(exhibit=>exhibit.thumbnail),nodes.map(node=>node.thumbnail));
  assert.equal(second.exploration!.exhibits.length,0);
  assert.equal(first.assessments?.knowledge.length,18);assert.match(first.assessments!.knowledge[17].prompt,/trajectories/);
  assert.match(first.assessments!.application!.reference.join("\n"),/2\/3 = X/);
  assert.deepEqual(lessonAssessmentAvailability(second),{knowledge:0,application:false});
});

test("preview delivers only 1.1, preserves all metadata and never serialises hidden text or assessment answers",()=>{
  const preview=buildTextLessonPreview(first,course.id,false);
  assert.equal(preview.textPreview?.rule,"configured-points");
  assert.deepEqual(Object.values(preview.textPreview!.points),["full","locked","locked","locked","locked"]);
  assert.equal(preview.contents.length,10);assert.equal(preview.contents[0].html,first.contents![0].html);
  for(const content of preview.contents.filter(c=>c.type==="text").slice(1))assert.deepEqual(Object.keys(content).sort(),["id","mode","nodes","title","type"]);
  assert.equal(preview.body,"");assert.doesNotMatch(JSON.stringify(preview),/modeling-life-l1-knowledge|referenceAnswer|lesson-1-image6/);
  assert.equal(buildTextLessonPreview(first,course.id,true).contents.filter(c=>c.html).length,5);
  assert.ok(Object.values(buildTextLessonPreview(second,course.id,false).textPreview!.points).every(state=>state==="locked"));
});

test("real services and APIs enforce configured preview access and eighteen-question assessment ownership",async()=>{
  const {restore}=await isolate("lg-modeling-life-");
  try{
    const store=await import("../../services/productStore");
    const services=await import("../../services/lessonAssessmentService");
    const routes=await import("../../app/api/courses/[courseId]/lessons/[lessonId]/assessments/[kind]/route");
    const studyRoute=await import("../../app/api/study/preview/route");
    const overview=await import("../../services/understandingOverview");
    const user=await verifiedUser(store,"modeling@example.test"),other=await verifiedUser(store,"other-modeling@example.test");
    assert.equal((await store.getProductCourse(course.id))?.title,course.title,"normal local migrations include the new course");
    const session=await store.createSession(user.id);setCookie(SESSION_COOKIE,session.token);
    const event={courseId:course.id,lessonId:first.id,event:"open",seconds:0,learningMode:"text",contentId:first.contents![0].id,clientEventId:"modeling-preview-first"};
    assert.equal((await studyRoute.POST(jsonRequest("POST","http://localhost/api/study/preview",event))).status,200);
    for(const contentId of [first.contents![1].id,first.contents!.find(c=>c.startSeconds===1026)!.id]){
      const invalid={...event,contentId,learningMode:contentId.includes("video")?"video":"text",clientEventId:randomUUID()};
      assert.equal((await studyRoute.POST(jsonRequest("POST","http://localhost/api/study/preview",invalid))).status,400);
    }
    const context=(kind="knowledge",lessonId=first.id)=>({params:Promise.resolve({courseId:course.id,lessonId,kind})});
    assert.equal((await routes.GET(jsonRequest("GET","http://localhost/api/assessments"),context())).status,403);
    const {quote}=await store.createQuote(user.id,"science-pc-6");await store.completeDemoCheckout(user.id,quote.id);
    assert.equal((await store.checkEntitlement(user.id,course.id)).allowed,true);
    await assert.rejects(()=>services.readAssessment(user.id,course.id,first.id,"knowledge"),{code:"ASSESSMENT_FORBIDDEN"});
    await store.recordStudyEvent({userId:user.id,courseId:course.id,lessonId:first.id,event:"complete",seconds:0,learningMode:"text",completeLesson:true,clientEventId:"modeling-complete-first"});
    const response=await routes.GET(jsonRequest("GET","http://localhost/api/assessments"),context());
    assert.equal(response.status,200);const payload=await response.json();assert.equal(payload.data,null);assert.equal(payload.definition.knowledge.length,18);
    assert.equal((await overview.getUnderstandingOverview(user.id,course.id)).lessons[0].knowledge.total,18);
    assert.equal((await overview.getUnderstandingOverview(user.id,course.id)).total,2,"missing Lesson 2 tests do not become samples");
    const attempt:KnowledgeAttempt={kind:"knowledge",responses:first.assessments!.knowledge.map(()=>({answer:"",rating:null})),phase:"question",index:0};
    await assert.rejects(()=>services.writeAssessment(user.id,course.id,first.id,"knowledge",{expectedVersion:0,clientEventId:randomUUID(),attempt:{...attempt,responses:attempt.responses.slice(0,6)}}),{code:"ASSESSMENT_INVALID"});
    const input={expectedVersion:0,clientEventId:randomUUID(),attempt};const saved=await services.writeAssessment(user.id,course.id,first.id,"knowledge",input);
    assert.deepEqual(await services.writeAssessment(user.id,course.id,first.id,"knowledge",input),saved);
    await assert.rejects(()=>services.readAssessment(other.id,course.id,first.id,"knowledge"),{code:"ASSESSMENT_FORBIDDEN"});
    assert.equal((await routes.GET(jsonRequest("GET","http://localhost/api/assessments"),context("knowledge",second.id))).status,404);
    const data=await readProductData();data.entitlements.filter((row:{userId:string})=>row.userId===user.id).forEach((row:{validTo:string})=>row.validTo="2020-01-01T00:00:00Z");await writeProductData(data);
    assert.equal((await routes.GET(jsonRequest("GET","http://localhost/api/assessments"),context())).status,403);
    clearCookies();assert.equal((await routes.GET(jsonRequest("GET","http://localhost/api/assessments"),context())).status,401);
  }finally{await restore();}
});
