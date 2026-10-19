import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";
import { build } from "esbuild";
test("Understanding page validates login, published course, lesson ownership and server Entitlement before reading personal records",async()=>{
  const state={user:{id:"user",nickname:"Student",avatarPath:null} as unknown,allowed:true,course:{id:"course & one",title:"Actual Course",category:"Art",status:"published",sections:[{lessons:[{id:"lesson & one"}]}]} as unknown,calls:[] as string[]};
  (globalThis as unknown as {understandingState:unknown}).understandingState=state;
  const bundle=await build({entryPoints:["app/[locale]/portal/courses/[slug]/understanding/page.tsx"],bundle:true,write:false,platform:"node",format:"cjs",jsx:"automatic",plugins:[{name:"route-dependencies",setup(b){
    b.onResolve({filter:/next\/navigation|services\/(product(Store|Auth)|understandingOverview)$|components\/portal\/(PortalHeader|UnderstandingOverview)$/},args=>({path:args.path,namespace:"mock"}));
    b.onLoad({filter:/.*/,namespace:"mock"},args=>({contents:args.path==="next/navigation" ? "export function redirect(url){throw new Error('redirect:'+url)};export function notFound(){throw new Error('not-found')}" : args.path.endsWith("productStore") ? "export async function getProductCourse(){return globalThis.understandingState.course};export async function checkEntitlement(user,course){globalThis.understandingState.calls.push(user+':'+course);return {allowed:globalThis.understandingState.allowed}}" : args.path.endsWith("understandingOverview") ? "export async function getUnderstandingOverview(userId,courseId){globalThis.understandingState.calls.push('records:'+userId+':'+courseId);return {lessons:[],completed:0,total:0,percent:0}}" : args.path.endsWith("productAuth") ? "export async function currentProductUser(){return globalThis.understandingState.user}" : "export const PortalHeader=()=>null;export const UnderstandingOverview=()=>null;"}));
  }}]});
  await mkdir("test-results/understanding",{recursive:true});const filename=path.resolve("test-results/understanding/route.cjs");await writeFile(filename,bundle.outputFiles[0].text);
  const route=createRequire(import.meta.url)(filename).default;
  const invoke=(query:unknown={lessonId:"lesson & one"})=>route({params:Promise.resolve({locale:"en-GB",slug:"course-slug"}),searchParams:Promise.resolve(query)});
  const element=await invoke();const props=element.props.children[1].props;
  assert.equal(props.courseId,"course & one");assert.equal(props.courseTitle,"Actual Course");assert.equal(props.data.percent,0);assert.equal(props.backHref,"/en-GB/account/learn/course%20%26%20one?lessonId=lesson%20%26%20one");
  assert.deepEqual(state.calls,["user:course & one","records:user:course & one"]);
  assert.equal((await invoke({lessonId:"lesson & one",from:"preview"})).props.children[1].props.backHref,"/en-GB/portal/courses/course%20%26%20one/public-lesson?lessonId=lesson%20%26%20one");
  state.user=null;state.calls=[];await assert.rejects(invoke(),/redirect:\/en-GB\/portal\/sign-in\?returnTo=/);assert.equal(state.calls.length,0);
  state.user={id:"user"};state.allowed=false;await assert.rejects(invoke(),/redirect:\/en-GB\/portal\/courses\/course%20%26%20one$/);
  state.allowed=true;await assert.rejects(invoke({lessonId:"another-course-lesson"}),/not-found/);
  state.course={id:"course",status:"draft"};await assert.rejects(invoke(),/not-found/);state.course=null;await assert.rejects(invoke(),/not-found/);
});
