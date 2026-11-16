import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { isolate, jsonRequest, setCookie, clearCookies, SESSION_COOKIE } from "../io/harness";
import { verifiedUser } from "./helpers/my-learning";

test("application evaluation uses real persistence, enforces access, replays, retries and rejects forged completion", async t => {
  const {restore}=await isolate("lg-app-evaluation-");
  try {
    process.env.KS_TUTOR_BASE_URL="https://ks.example.test";process.env.KS_TUTOR_API_KEY="test-key";
    const store=await import("../../services/productStore");
    const route=await import("../../app/api/courses/[courseId]/lessons/[lessonId]/assessments/application/evaluate/route");
    const records=await import("../../services/lessonAssessmentService");
    const {submitApplicationAssessment}=await import("../../services/applicationAssessmentService");
    const user=await verifiedUser(store,"assessment@example.test");
    const courseId="modeling-life",lessonId="modeling-life-lesson-1";
    const context={params:Promise.resolve({courseId,lessonId})};
    const value={clientEventId:randomUUID(),expectedVersion:0,attempt:{kind:"application",answer:String.raw`My answer: $x=\frac{2}{3}$.`,phase:"answer"},locale:"en-GB"};
    const post=(body:unknown=value)=>route.POST(jsonRequest("POST","http://localhost/api/evaluate",body),context);
    assert.equal((await post()).status,401);
    setCookie(SESSION_COOKIE,(await store.createSession(user.id)).token);
    assert.equal((await post()).status,403);
    const {quote}=await store.createQuote(user.id,"science-pc-6");await store.completeDemoCheckout(user.id,quote.id);
    let calls=0,fail=false,release: (()=>void)|undefined;
    t.mock.method(globalThis,"fetch",async (_url: unknown,init: RequestInit)=>{
      calls++;assert.equal(new Headers(init.headers).get("X-API-Key"),process.env.KS_TUTOR_API_KEY || null);if(release) await new Promise<void>(resolve=>{release=resolve;});
      if(fail) return Response.json({message:"provider unavailable"},{status:503});
      const input=JSON.parse(String(init.body));
      assert.equal(input.externalCourseId,courseId);assert.equal(input.userId,user.id);assert.ok(input.question.includes("hawks"));
      return Response.json({data:{evaluationId:input.evaluationId,status:"evaluated",yourAnswer:input.answer,releaseId:"existing-live",referenceAnswer:{status:"unavailable",contentMarkdown:null,sourceTitle:null},feedback:{schemaVersion:"application_feedback.v2",overallBand:"developing",whatYouDidWell:[],areasToImprove:["Explain the model."],needsReview:false,reviewReason:null}}});
    });
    const response=await post();assert.equal(response.status,200);
    let saved=(await response.json()).data;
    assert.equal(saved.attempt.answer,value.attempt.answer);assert.equal(saved.evaluation.result.feedback.overallBand,"developing");
    assert.deepEqual((await (await post()).json()).data,saved);assert.equal(calls,1,"same event reuses saved result");
    assert.equal((await post({...value,locale:"zh-CN"})).status,409,"changed payload cannot reuse an event");
    assert.equal((await post({...value,attempt:{...value.attempt,answer:"changed"}})).status,409);
    await assert.rejects(records.writeAssessment(user.id,courseId,lessonId,"application",{...value,expectedVersion:saved.version,attempt:{...value.attempt,phase:"submitted"}}),{code:"ASSESSMENT_INVALID"});
    const draft={...value,clientEventId:randomUUID(),expectedVersion:saved.version,attempt:{...value.attempt,answer:"Retake"}};
    saved=await records.writeAssessment(user.id,courseId,lessonId,"application",draft);
    assert.equal(saved.latestResult?.band,"developing");
    assert.equal(saved.submissions?.[0].answer,value.attempt.answer);assert.ok(saved.submissions?.[0].result,"autosaving a revision preserves submitted feedback");
    fail=true;
    const retry={...draft,clientEventId:randomUUID(),expectedVersion:saved.version};
    assert.equal((await post(retry)).status,503);
    saved=await records.readAssessment(user.id,courseId,lessonId,"application");
    assert.equal(saved?.evaluation?.status,"failed");assert.equal(saved?.attempt.answer,"Retake");
    fail=false;
    assert.equal((await post({...retry,expectedVersion:saved!.version})).status,200);
    saved=await records.readAssessment(user.id,courseId,lessonId,"application");
    const concurrent={...value,clientEventId:randomUUID(),expectedVersion:saved!.version,attempt:{...value.attempt,answer:"Concurrent"}};
    release=()=>{};
    const first=submitApplicationAssessment(user.id,courseId,lessonId,concurrent);
    while(calls<4) await new Promise(resolve=>setTimeout(resolve,5));
    await assert.rejects(submitApplicationAssessment(user.id,courseId,lessonId,concurrent),{code:"ASSESSMENT_CONFLICT"});
    release!();release=undefined;await first;
    saved=await records.readAssessment(user.id,courseId,lessonId,"application");
    const repository=await import("../../repositories/lessonAssessmentRepository");
    const abandoned={...saved!,version:saved!.version+1,evaluation:{id:randomUUID(),eventId:randomUUID(),requestHash:"abandoned",status:"pending" as const,startedAt:new Date(Date.now()-90001).toISOString()}};
    await repository.saveLessonAssessment(user.id,courseId,lessonId,"application",saved!.version,randomUUID(),"abandoned",abandoned);
    delete process.env.KS_TUTOR_API_KEY;
    assert.equal((await post({...value,clientEventId:randomUUID(),expectedVersion:abandoned.version})).status,200,"expired pending claims recover without waiting forever");
    assert.equal((await post({...value,clientEventId:randomUUID(),attempt:{...value.attempt,answer:" "}})).status,400);
    assert.equal((await route.POST(jsonRequest("POST","http://localhost/api/evaluate",value),{params:Promise.resolve({courseId,lessonId:"foreign"})})).status,404);
    for(const [oldBand,expected] of [["strong","strong"],["mostly_good","developing"],["partial","developing"],["weak","needs_review"],["insufficient_evidence","needs_review"]]) {
      const historical=JSON.parse(JSON.stringify(saved));
      historical.evaluation.result.feedback.overallBand=oldBand;
      const before=JSON.stringify(historical);
      assert.equal(records.summariseAssessment(historical,"application").latestResult,expected);
      assert.equal(JSON.stringify(historical),before,"summary display does not rewrite history");
      delete historical.evaluation;historical.latestResult.band=oldBand;
      assert.equal(records.summariseAssessment(historical,"application").latestResult,expected,"Retake history also uses three bands");
    }
    clearCookies();assert.equal((await post()).status,401);
  } finally {t.mock.restoreAll();await restore();}
});
