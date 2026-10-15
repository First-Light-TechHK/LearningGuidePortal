import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";
import { build } from "esbuild";

test("subscribed learning renders the shared preview player after session and Entitlement checks", async () => {
  const course = { id:"course", slug:"course", title:"Actual Course", description:"Course description", category:"Science", status:"published", cover:"/cover.jpg", sections:[{lessons:[
    {id:"public",title:"First",body:"Public",isPublic:true,durationMinutes:1},
    {id:"private",title:"Second",summary:"Current lesson summary",body:"Protected",isPublic:false,durationMinutes:2,contents:[
      {id:"point-one",title:"2.1",type:"video",url:"/point-one.mp4",nodes:[]},
      {id:"point-two",title:"2.2",type:"video",url:"/point-two.mp4",nodes:[]},
      {id:"text",title:"2.3",type:"text",html:"Protected content",nodes:[]},
    ]},
  ]}] };
  const state = { user:{id:"user",nickname:"Learner",avatarPath:null} as unknown, allowed:true, course:course as unknown, calls:[] as string[] };
  (globalThis as unknown as {learningRouteState:unknown}).learningRouteState = state;
  const bundle = await build({entryPoints:["app/[locale]/account/learn/[courseId]/page.tsx"],bundle:true,write:false,platform:"node",format:"cjs",jsx:"automatic",external:["react/jsx-runtime"],plugins:[{name:"route-dependencies",setup(b){
    b.onResolve({filter:/next\/navigation|services\/(productStore|productAuth|lessonContent|courseMediaSigning|persistence\/s3)$|components\/portal\/(PreviewLessonView|PortalHeader|CourseThumbnail)$/},args=>({path:args.path,namespace:"mock"}));
    b.onLoad({filter:/.*/,namespace:"mock"},args=>({contents:
      args.path==="next/navigation" ? "export function redirect(url){throw new Error('redirect:'+url)};export function notFound(){throw new Error('not-found')}"
      : args.path.endsWith("productStore") ? "export async function getProductCourse(){return globalThis.learningRouteState.course};export async function checkEntitlement(user,course){globalThis.learningRouteState.calls.push(user+':'+course);return {allowed:globalThis.learningRouteState.allowed}};export async function getCourseLearningMode(){return 'text'};export async function getLearningOverview(){return {courses:[{courseId:'course',completedLessonIds:['private']}]}}"
      : args.path.endsWith("productAuth") ? "export async function currentProductUser(){return globalThis.learningRouteState.user}"
      : args.path.endsWith("lessonContent") ? "export function sanitiseLessonContents(contents){return contents}"
      : args.path.endsWith("courseMediaSigning") ? "export async function signCourseMediaReferences(contents){globalThis.learningRouteState.calls.push('sign');return contents}"
      : args.path.endsWith("/s3") ? "export async function signCourseMediaUrl(url){return url}"
      : args.path.endsWith("CourseThumbnail") ? "export function courseImageFor(){return '/fallback.jpg'}"
      : "export const PreviewLessonView=()=>null;export const PortalHeader=()=>null;"}));
  }}]});
  await mkdir("test-results/subscribed-learning",{recursive:true});
  const filename=path.resolve("test-results/subscribed-learning/route.cjs");await writeFile(filename,bundle.outputFiles[0].text);
  const route=createRequire(import.meta.url)(filename).default;
  const invoke=(locale="en-GB",lessonId="private",viewMode?:string,contentId?:string)=>route({params:Promise.resolve({locale,courseId:"course"}),searchParams:Promise.resolve({lessonId,viewMode,contentId})});
  for(const locale of ["en-GB","zh-CN"]) {
    const element=await invoke(locale);
    const props=element.props.children[1].props;
    assert.equal(props.lesson.id,"private");assert.equal(props.courseTitle,"Actual Course");assert.equal(props.entitled,true);
    assert.equal(props.description,"Current lesson summary");
    assert.equal(props.studyEndpoint,"/api/study/events");assert.equal(props.preferredMode,"text");assert.equal(props.initialCompleted,true);assert.deepEqual(props.completedContentIds,[]);
    assert.equal(props.trialGate,undefined);assert.equal(props.poster,"/cover.jpg");
    assert.deepEqual(props.lesson.contents.map((content:{id:string})=>content.id),["point-one","point-two","text"],"lesson access includes every knowledge point without completion gates");
    assert.ok(props.outline.every((item:{href:string})=>item.href.startsWith(`/${locale}/account/learn/course?lessonId=`)));
    const first=(await invoke(locale,"public")).props.children[1].props;
    assert.equal(first.description,"");
    assert.equal(first.nextHref,`/${locale}/account/learn/course?lessonId=private`);
    assert.equal((await invoke(locale,"private","video")).props.children[1].props.preferredMode,"video");
    assert.equal((await invoke(locale,"private","video","point-two")).props.children[1].props.initialContentId,"point-two");
    assert.equal((await invoke(locale,"private","invalid")).props.children[1].props.preferredMode,"text");
  }
  state.user=null;state.calls=[];await assert.rejects(invoke(),/redirect:.*sign-in\?returnTo=/);assert.equal(state.calls.length,0);
  state.user={id:"user"};state.allowed=false;state.calls=[];await assert.rejects(invoke(),/redirect:\/en-GB\/portal\/courses\/course$/);assert.ok(!state.calls.includes("sign"));
  state.allowed=true;await assert.rejects(()=>invoke("en-GB","foreign-lesson"),/not-found/);
  state.course={...course,status:"draft"};await assert.rejects(invoke(),/not-found/);state.course=null;await assert.rejects(invoke(),/not-found/);
});
