import assert from 'node:assert/strict';
import { before, after, test } from 'node:test';
import { randomUUID } from 'node:crypto';
import { isolate, clearCookies, setCookie, SESSION_COOKIE, jsonRequest } from '../io/harness';
import { verifiedUser, readProductData, writeProductData, COURSE_ID, PREVIEW_LP, PRIVATE_LP } from './helpers/my-learning';
import { getUnderstandingOverview } from '../../services/understandingOverview';
import { readAssessment, writeAssessment } from '../../services/lessonAssessmentService';
import type { KnowledgeAttempt } from '../../contracts/lesson-assessment';
let restore:()=>Promise<void>, store:typeof import('../../services/productStore'), user:{id:string}, other:{id:string};
let routes:typeof import('../../app/api/courses/[courseId]/lessons/[lessonId]/assessments/[kind]/route');
let overviewRoute:typeof import('../../app/api/courses/[courseId]/understanding/route');
before(async()=>{
  restore=(await isolate('lg-assessment-records-')).restore;
  store=await import('../../services/productStore');
  routes=await import('../../app/api/courses/[courseId]/lessons/[lessonId]/assessments/[kind]/route');
  overviewRoute=await import('../../app/api/courses/[courseId]/understanding/route');
  user=await verifiedUser(store,'assessments@example.test','Learner');other=await verifiedUser(store,'other-assessments@example.test','Other Learner');
  for(const person of [user,other]){const {quote}=await store.createQuote(person.id,'everything-pc-6');await store.completeDemoCheckout(person.id,quote.id);}
  const data=await readProductData(), course=data.courses.find((c:{id:string})=>c.id===COURSE_ID);
  course.sections[0].lessons[0].title='Actual first lesson';course.sections[0].lessons[1].title='Actual second lesson';
  course.sections.push({id:'second-section',title:'Actual section',lessons:[{id:'third-lesson',title:'Actual third lesson',body:'Text',durationMinutes:1,isPublic:false}]});
  await writeProductData(data);
});
after(async()=>{await restore();});
const context=(kind='knowledge',lessonId=PREVIEW_LP)=>({params:Promise.resolve({courseId:COURSE_ID,lessonId,kind})});
const draft=():KnowledgeAttempt=>({kind:'knowledge',responses:Array.from({length:6},()=>({answer:'',rating:null})),index:0,phase:'question'});

test('later Knowledge and Application APIs accept drafts before any Study or preceding tests, without manufacturing progress',async()=>{
  const session=await store.createSession(other.id);setCookie(SESSION_COOKIE,session.token);
  const overviewContext={params:Promise.resolve({courseId:COURSE_ID})};
  const before=await (await overviewRoute.GET(jsonRequest('GET','http://localhost/api/understanding'),overviewContext)).json();
  assert.equal(before.data.completed,0);assert.equal(before.data.percent,0);
  assert.ok(before.data.lessons.every((lesson:{state:string})=>lesson.state==='current'));
  for(const kind of ['knowledge','application'] as const){
    const ctx=context(kind,'third-lesson');
    const empty=await routes.GET(jsonRequest('GET','http://localhost/api/assessments'),ctx);
    assert.equal(empty.status,200);assert.equal((await empty.json()).data,null);
    const attempt=kind==='knowledge'?draft():{kind:'application',answer:'Later Lesson draft',phase:'answer'};
    const input={clientEventId:randomUUID(),expectedVersion:0,attempt};
    const saved=await routes.PUT(jsonRequest('PUT','http://localhost/api/assessments',input),ctx);
    assert.equal(saved.status,200);const record=(await saved.json()).data;
    assert.equal(record.version,1);assert.equal(record.completedAt,null);
    assert.deepEqual((await (await routes.PUT(jsonRequest('PUT','http://localhost/api/assessments',input),ctx)).json()).data,record);
    assert.equal(await readAssessment(user.id,COURSE_ID,'third-lesson',kind),null,'the other account cannot see this draft');
  }
  const view=await getUnderstandingOverview(other.id,COURSE_ID);
  assert.equal(view.completed,0);assert.equal(view.percent,0);
  assert.equal(view.lessons[0].knowledge.status,'not_started');
  assert.equal(view.lessons[2].application.status,'in_progress');
  assert.deepEqual((await store.getLearningOverview(other.id)).courses,[]);
  assert.equal((await store.ensureProductData()).studyEvents.filter(event=>event.userId===other.id).length,0);
  clearCookies();
});

test('Understanding exposes every available test without Study or preceding-test prerequisites',async()=>{
  let view=await getUnderstandingOverview(user.id,COURSE_ID);
  assert.equal(view.total,6);assert.equal(view.completed,0);assert.equal(view.percent,0);
  assert.deepEqual(view.lessons.map(l=>[l.number,l.title,l.state]),[['01','Actual first lesson','current'],['02','Actual second lesson','current'],['03','Actual third lesson','current']]);
  assert.equal(await readAssessment(user.id,COURSE_ID,PREVIEW_LP,'knowledge'),null);
  assert.deepEqual((await store.getLearningOverview(user.id)).courses,[]);
  assert.equal(await readAssessment(user.id,COURSE_ID,'third-lesson','knowledge'),null,'later tests are available before any Study completion');
  const attempt=draft();attempt.responses[0]={answer:'Actual saved note',rating:'right'};attempt.index=1;
  const input={clientEventId:randomUUID(),expectedVersion:0,attempt,latestResult:{completedAt:'2000-01-01',score:100}};
  const first=await writeAssessment(user.id,COURSE_ID,PREVIEW_LP,'knowledge',input);
  assert.equal(first.latestResult,undefined,'client-supplied completion evidence is ignored');
  assert.equal(first.version,1);assert.deepEqual(await writeAssessment(user.id,COURSE_ID,PREVIEW_LP,'knowledge',input),first,'lost-response retries return the original record');
  view=await getUnderstandingOverview(user.id,COURSE_ID);
  assert.deepEqual(view.lessons[0].knowledge,{status:'in_progress',answered:1,total:6,percent:16,score:null,latestResult:null});
  assert.equal(view.lessons[0].application.status,'not_started');assert.equal(view.completed,0);
  assert.equal((await readAssessment(user.id,COURSE_ID,PREVIEW_LP,'knowledge'))!.attempt.kind,'knowledge');
  assert.equal((await getUnderstandingOverview(other.id,COURSE_ID)).lessons[0].knowledge.answered,0,'another user never sees the note or score');
  assert.equal(await readAssessment(other.id,COURSE_ID,PREVIEW_LP,'knowledge'),null);
  const completed=draft();completed.responses.forEach((r,i)=>{r.answer='Note '+i;r.rating=i%2?'wrong':'right';});completed.phase='result';completed.index=5;
  const second=await writeAssessment(user.id,COURSE_ID,PREVIEW_LP,'knowledge',{clientEventId:randomUUID(),expectedVersion:1,attempt:completed});
  assert.equal(second.version,2);
  view=await getUnderstandingOverview(user.id,COURSE_ID);assert.equal(view.completed,1);assert.equal(view.percent,16);assert.equal(view.lessons[1].state,'current');
  assert.equal(await readAssessment(user.id,COURSE_ID,PRIVATE_LP,'knowledge'),null);
  await assert.rejects(()=>writeAssessment(user.id,COURSE_ID,PREVIEW_LP,'application',{clientEventId:randomUUID(),expectedVersion:0,attempt:{kind:'application',answer:'Actual application answer',phase:'submitted'}}),{code:'ASSESSMENT_INVALID'},'a direct submission cannot complete before review');
  const starts=[1,2].map(()=>({clientEventId:randomUUID(),expectedVersion:0,evaluationStartedAt:'2000-01-01',attempt:{kind:'application',answer:'Actual application answer',phase:'evaluating'}}));
  const concurrent=await Promise.allSettled(starts.map(input=>writeAssessment(user.id,COURSE_ID,PREVIEW_LP,'application',input)));
  assert.equal(concurrent.filter(r=>r.status==='fulfilled').length,1);assert.equal(concurrent.filter(r=>r.status==='rejected').length,1);
  const review=(await readAssessment(user.id,COURSE_ID,PREVIEW_LP,'application'))!;
  assert.ok(review.evaluationStartedAt);assert.equal(review.completedAt,null);
  assert.ok(Math.abs(Date.now()-Date.parse(review.evaluationStartedAt))<1000,'the server ignores a browser-supplied review timestamp');
  assert.deepEqual(await writeAssessment(user.id,COURSE_ID,PREVIEW_LP,'application',starts[concurrent.findIndex(item=>item.status==='fulfilled')]),review,'replaying the start cannot reset the review timer');
  assert.equal((await getUnderstandingOverview(user.id,COURSE_ID)).lessons[0].application.percent,0);
  const completion={clientEventId:randomUUID(),expectedVersion:1,attempt:{kind:'application',answer:'Actual application answer',phase:'submitted'}};
  await assert.rejects(()=>writeAssessment(user.id,COURSE_ID,PREVIEW_LP,'application',completion),{code:'ASSESSMENT_INVALID'});
  await assert.rejects(()=>writeAssessment(user.id,COURSE_ID,PREVIEW_LP,'application',{...completion,attempt:{...completion.attempt,answer:'Changed while reviewing'}}),{code:'ASSESSMENT_INVALID'});
  await new Promise(resolve=>setTimeout(resolve,3050));
  const result=await writeAssessment(user.id,COURSE_ID,PREVIEW_LP,'application',completion);
  assert.ok(result.completedAt);assert.deepEqual(await writeAssessment(user.id,COURSE_ID,PREVIEW_LP,'application',completion),result,'result-save retries remain idempotent');
  view=await getUnderstandingOverview(user.id,COURSE_ID);
  assert.equal(view.lessons[0].knowledge.score,50);assert.equal(view.lessons[0].knowledge.percent,100);
  assert.equal(view.lessons[0].application.status,'completed');assert.equal(view.lessons[0].application.score,null,'a simulated review never creates a numeric AI score');
  assert.equal(view.completed,2);assert.equal(view.percent,33);assert.equal(view.lessons[1].knowledge.status,'not_started');assert.equal(view.lessons[1].state,'current');assert.equal(view.lessons[2].state,'current');
  assert.equal(await readAssessment(user.id,COURSE_ID,PRIVATE_LP,'knowledge'),null,'the next tests unlock without requiring another Study completion');
  await writeAssessment(user.id,COURSE_ID,PRIVATE_LP,'knowledge',{clientEventId:randomUUID(),expectedVersion:0,attempt:draft()});
  await assert.rejects(()=>writeAssessment(user.id,COURSE_ID,PREVIEW_LP,'knowledge',{...input,clientEventId:randomUUID()}),{code:'ASSESSMENT_CONFLICT'});
  await assert.rejects(()=>writeAssessment(user.id,COURSE_ID,PREVIEW_LP,'knowledge',{...input,attempt:{...attempt,responses:[]}}),{code:'ASSESSMENT_INVALID'});
  await assert.rejects(()=>readAssessment(user.id,COURSE_ID,'foreign-lesson','knowledge'),{code:'ASSESSMENT_NOT_FOUND'});
  await writeAssessment(user.id,COURSE_ID,PREVIEW_LP,'knowledge',{clientEventId:randomUUID(),expectedVersion:2,attempt:draft()});
  view=await getUnderstandingOverview(user.id,COURSE_ID);assert.equal(view.completed,2);assert.equal(view.lessons[1].state,'current');assert.equal(view.lessons[0].knowledge.latestResult,50,'Retake preserves the latest completed result and unlocked access');
  const wrong=draft();wrong.responses.forEach(response=>response.rating='wrong');wrong.phase='result';wrong.index=5;
  await writeAssessment(user.id,COURSE_ID,PREVIEW_LP,'knowledge',{clientEventId:randomUUID(),expectedVersion:3,attempt:wrong});
  view=await getUnderstandingOverview(user.id,COURSE_ID);assert.equal(view.completed,2);assert.equal(view.lessons[0].knowledge.latestResult,0,'all questions rated counts as one test even if the score is zero');
});

test('authenticated API derives ownership, rejects malformed payloads, invalid kind, expired access and anonymous writes',async()=>{
  clearCookies();
  assert.equal((await routes.GET(jsonRequest('GET','http://localhost/api/assessments'),context())).status,401);
  assert.equal((await routes.PUT(jsonRequest('PUT','http://localhost/api/assessments',{}),context())).status,401);
  assert.equal((await overviewRoute.GET(jsonRequest('GET','http://localhost/api/understanding'),{params:Promise.resolve({courseId:COURSE_ID})})).status,401);
  const session=await store.createSession(user.id);setCookie(SESSION_COOKIE,session.token);
  const response=await routes.GET(jsonRequest('GET','http://localhost/api/assessments'),context());
  assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'private, no-store');
  assert.equal((await response.json()).data.version,4);
  assert.equal((await routes.GET(jsonRequest('GET','http://localhost/api/assessments'),context('invalid'))).status,404);
  assert.equal((await routes.PUT(jsonRequest('PUT','http://localhost/api/assessments',{expectedVersion:-1,clientEventId:'bad',attempt:draft()}),context())).status,400);
  const data=await readProductData();data.entitlements.filter((e:{userId:string})=>e.userId===user.id).forEach((e:{validTo:string})=>e.validTo='2020-01-01');await writeProductData(data);
  assert.equal((await routes.GET(jsonRequest('GET','http://localhost/api/assessments'),context())).status,403);
  assert.equal((await routes.PUT(jsonRequest('PUT','http://localhost/api/assessments',{clientEventId:randomUUID(),expectedVersion:2,attempt:draft()}),context())).status,403);
});

test('unrestricted test entry still rejects absent definitions, foreign Lessons and unpublished Courses',async()=>{
  setCookie(SESSION_COOKIE,(await store.createSession(other.id)).token);
  const original=await readProductData();
  try{
    const data=await readProductData(), course=data.courses.find((item:{id:string})=>item.id===COURSE_ID);
    course.sections.flatMap((section:{lessons:{id:string;assessments?:unknown}[]})=>section.lessons).find((lesson:{id:string})=>lesson.id==='third-lesson').assessments={knowledge:[],application:null};
    await writeProductData(data);
    for(const kind of ['knowledge','application']){
      const ctx=context(kind,'third-lesson');
      assert.equal((await routes.GET(jsonRequest('GET','http://localhost/api/assessments'),ctx)).status,404,'even an existing draft does not expose a removed test');
      const attempt=kind==='knowledge'?draft():{kind:'application',answer:'Draft',phase:'answer'};
      assert.equal((await routes.PUT(jsonRequest('PUT','http://localhost/api/assessments',{clientEventId:randomUUID(),expectedVersion:1,attempt}),ctx)).status,404);
    }
    assert.equal((await routes.GET(jsonRequest('GET','http://localhost/api/assessments'),context('knowledge','foreign-lesson'))).status,404);
    const view=await getUnderstandingOverview(other.id,COURSE_ID);
    assert.equal(view.lessons[2].knowledge.total,0);assert.equal(view.lessons[2].application.total,0);
    course.status='draft';await writeProductData(data);
    assert.equal((await routes.GET(jsonRequest('GET','http://localhost/api/assessments'),context())).status,404);
    assert.equal((await overviewRoute.GET(jsonRequest('GET','http://localhost/api/understanding'),{params:Promise.resolve({courseId:COURSE_ID})})).status,404);
  }finally{await writeProductData(original);clearCookies();}
});
