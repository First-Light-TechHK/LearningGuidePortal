import assert from "node:assert/strict";
import { test } from "node:test";
import { randomUUID } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { isolate, clearCookies, setCookie, SESSION_COOKIE } from "./harness";

test("contact service/API persists guests and Users, validates consent, and deduplicates retries", async () => {
  const { restore } = await isolate("lg-contact-");
  try {
    const { submitContactRequest } = await import("../../services/contactService");
    const route = await import("../../app/api/contact/route");
    const { systemRoot } = await import("../../services/fileStore");
    const input = { clientEventId: randomUUID(), firstName: "小明", lastName: "张", email: " learner@example.test ", phone: "", subject: "Course question", message: "Please help with my course.", consent: true, locale: "zh-CN" };
    const post = (data: unknown) => route.POST(new Request("http://localhost/api/contact", { method: "POST", body: JSON.stringify(data) }));
    clearCookies();
    const first = await post({ ...input, userId: "forged" });assert.equal(first.status, 201);
    const original = await first.json();assert.deepEqual(Object.keys(original.data).sort(), ["duplicate", "id"]);
    const duplicate = await post(input);assert.equal(duplicate.status, 200);assert.equal((await duplicate.json()).data.id, original.data.id);
    const directory=path.join(systemRoot(),"contact_requests");
    let saved=JSON.parse(await readFile(path.join(directory,`${input.clientEventId}.json`),"utf8"));
    assert.equal(saved.userId,null);assert.equal(saved.email,"learner@example.test");assert.equal(saved.message,input.message);
    const changed = await post({ ...input, message: "changed" });assert.equal(changed.status,409);
    const concurrent={...input,clientEventId:randomUUID()};const attempts=await Promise.all(Array.from({length:6},()=>submitContactRequest(concurrent,null)));
    assert.equal(new Set(attempts.map(a=>a.id)).size,1);assert.equal(attempts.filter(a=>!a.duplicate).length,1);
    for(const invalid of [{consent:false},{subject:"   "},{message:""},{message:"x".repeat(5001)},{email:"invalid"},{email:"x".repeat(255)+"@a.test"},{firstName:"🙂"},{phone:"1".repeat(41)},{clientEventId:"../path"}]){
      await assert.rejects(()=>submitContactRequest({...input,...invalid},null),{code:"CONTACT_INVALID"});
      assert.equal((await post({...input,...invalid})).status,400);
    }
    assert.equal((await route.POST(new Request("http://localhost/api/contact",{method:"POST",body:"{"}))).status,400);
    const store=await import("../../services/productStore");const user=await store.registerUser({email:"contact-user@example.test",password:"Password123!",nickname:"Contact User"});
    await store.verifyEmailToken(await store.issueEmailVerificationToken(user.id));setCookie(SESSION_COOKIE,(await store.createSession(user.id)).token);
    const signed={...input,clientEventId:randomUUID()};assert.equal((await post(signed)).status,201);
    saved=JSON.parse(await readFile(path.join(directory,`${signed.clientEventId}.json`),"utf8"));assert.equal(saved.userId,user.id);
    assert.equal((await readdir(directory)).filter(name=>name.endsWith(".json")).length,3);
    process.env.STORAGE_BACKEND="unconfigured";
    const unavailable=await post({...input,clientEventId:randomUUID()});assert.equal(unavailable.status,503);assert.equal((await unavailable.json()).code,"CONTACT_UNAVAILABLE");
  } finally { await restore(); }
});
