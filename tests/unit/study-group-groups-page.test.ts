import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import en from "../../messages/en-GB.json";
import zh from "../../messages/zh-CN.json";
import { fillCount, studyGroupFormProblem, studyGroupSignInHref, studyGroupsPageHref } from "../../components/portal/studyGroupClient";
import { discoverEmptyCopy, mineEmptyCopy, studyGroupListFailureShown, waitingDialogStep } from "../../modules/group-study/uiState";

// Round 2 of the SG groups-page QA fixes (lg-qa/sg-tutor-qa-2026-10-19.md
// section 二 and the final review's r1/r2/r4 items). Each test names its item.

const app = readFileSync(new URL("../../components/portal/StudyGroupsApp.tsx", import.meta.url), "utf8");
const header = readFileSync(new URL("../../components/portal/StudyGroupHeader.tsx", import.meta.url), "utf8");
const signInLink = readFileSync(new URL("../../components/portal/StudyGroupSignInLink.tsx", import.meta.url), "utf8");
const css = readFileSync(new URL("../../components/portal/study-groups.module.css", import.meta.url), "utf8");

function form(fields: Array<{ valueMissing?: boolean; rangeUnderflow?: boolean }>) {
  return { checkValidity: () => fields.every((field) => !field.valueMissing && !field.rangeUnderflow), elements: fields.map((validity) => ({ validity })) };
}

// The media block for phones (max-width: 800px).
function phoneRules() {
  return css.slice(css.indexOf("@media (max-width: 800px)"));
}

test("r2-B4 / r1-F-4: the waiting dialog renews at once when visible or online, and a terminal re-enter closes it", () => {
  assert.deepEqual(waitingDialogStep({ ok: true, code: "ok", data: { seated: true } }), { kind: "keep" });
  assert.deepEqual(waitingDialogStep({ ok: true, code: "ok", data: { seated: false, occupancy: 1, state: "starting_soon" } }), { kind: "reenter" });
  for (const code of ["session_full", "session_unavailable", "session_not_open", "forbidden", "unauthenticated", "course_access_required"]) {
    assert.deepEqual(waitingDialogStep({ ok: false, code, data: null }), { kind: "close", errorCode: code, notice: null }, code);
  }
  // A transient failure keeps waiting; the next beat tries again.
  for (const code of ["network", "error", "unavailable"]) assert.deepEqual(waitingDialogStep({ ok: false, code, data: null }), { kind: "keep" }, code);
  // A successful re-enter answers { occupancy }: keep waiting.
  assert.deepEqual(waitingDialogStep({ ok: true, code: "ok", data: { occupancy: 2 } }), { kind: "keep" });
  assert.match(app, /document\.addEventListener\("visibilitychange", wake\);\s*window\.addEventListener\("online", wake\);/);
  assert.match(app, /const wake = \(\) => \{ if \(document\.visibilityState === "visible"\) void beat\(\); \};/);
  assert.match(app, /document\.removeEventListener\("visibilitychange", wake\);\s*window\.removeEventListener\("online", wake\);/);
  assert.match(app, /if \(!stopped\) settleWaiting\(waitingDialogStep\(entered\), sessionId\);/);
  assert.match(app, /setDialog\(null\);\s*setWaitingSession\(null\);\s*setNotice\(step\.notice\);\s*setErrorCode\(step\.errorCode \?\? "idle"\);/);
});

test("r1-F-3: a missing field is reported before a Start Time in the past", () => {
  assert.equal(studyGroupFormProblem(form([{ valueMissing: true }, { rangeUnderflow: true }])), "validation");
  assert.equal(studyGroupFormProblem(form([{ rangeUnderflow: true }, { valueMissing: true }])), "validation");
  assert.equal(studyGroupFormProblem(form([{}, { rangeUnderflow: true }])), "start_in_past");
  assert.equal(studyGroupFormProblem(form([{}, {}])), null);
});

test("r4-N10: group refresh clears its error, a lost sign-in always shows, asked-for loads show, the error code clears", () => {
  // N10-a: a refresh that loads the group drops the failed-open panel.
  assert.match(app, /setSelected\(result\.data\);\s*\/\/[^\n]*\n\s*setGroupError\(null\);/);
  // N10-b / N10-c: only a poll after the first load swallows its failure, and never a lost sign-in.
  assert.equal(studyGroupListFailureShown({ poll: true, loadedOnce: true, code: "error" }), false);
  assert.equal(studyGroupListFailureShown({ poll: true, loadedOnce: true, code: "network" }), false);
  assert.equal(studyGroupListFailureShown({ poll: true, loadedOnce: true, code: "unauthenticated" }), true);
  assert.equal(studyGroupListFailureShown({ poll: false, loadedOnce: true, code: "error" }), true);
  assert.equal(studyGroupListFailureShown({ poll: true, loadedOnce: false, code: "error" }), true);
  assert.match(app, /showFailure\(myResult\.ok \? discoverResult\.code : myResult\.code\);/);
  // N10-d: back from the error pane to the lists, the stale code goes.
  assert.match(app, /setStatus\("ready"\);\s*if \(listFailed\.current\) \{\s*\/\/[^\n]*\n\s*listFailed\.current = false;\s*setErrorCode\("idle"\);\s*\}/);
});

test("r4-N12-a: on a phone the details scroll into view before the group request", () => {
  const scroll = app.indexOf('mainRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })');
  const request = app.indexOf("const result = await studyGroupRequest<StudyGroupDetail>(`/api/study-groups/${id}`);");
  assert.ok(scroll > 0 && request > 0);
  assert.ok(scroll < request, "the scroll comes before the await");
});

test("M1: long unbroken titles wrap on the groups page and About keeps its line breaks", () => {
  for (const selector of [".card h3", ".course", ".groupTitle", ".facts p", ".sessionBody", ".waitingTitle", ".waitingFocus + p", ".memberCol li", ".attendeeList"]) {
    const rule = new RegExp(`(?:^|\\n)${selector.replace(/[.+]/g, (char) => `\\${char}`)} \\{[^}]*overflow-wrap: anywhere[^}]*\\}`);
    assert.match(css, rule, selector);
  }
  assert.match(css, /\.aboutBody \{[^}]*overflow-wrap: anywhere;[^}]*white-space: pre-line;[^}]*\}/);
});

test("M2: Hosted by Me has its own empty line, and no empty line shows before the lists load", () => {
  assert.equal(mineEmptyCopy({ signedIn: true, listsLoaded: false, filter: "all", count: 0 }), null);
  assert.equal(mineEmptyCopy({ signedIn: true, listsLoaded: true, filter: "all", count: 0 }), "noMine");
  assert.equal(mineEmptyCopy({ signedIn: true, listsLoaded: true, filter: "host", count: 0 }), "noHosted");
  assert.equal(mineEmptyCopy({ signedIn: true, listsLoaded: true, filter: "host", count: 1 }), null);
  assert.equal(mineEmptyCopy({ signedIn: false, listsLoaded: true, filter: "all", count: 0 }), null);
  assert.equal(en.studyGroupsPage.noHosted, "You aren't hosting any Study Group yet.");
  assert.equal(zh.studyGroupsPage.noHosted, "你还没有主持任何学习小组");
  assert.match(app, /\{mineEmpty \? <p className=\{styles\.noMine\}>\{copy\[mineEmpty\]\}<\/p> : null\}/);
});

test("M3: Discover says when nothing matches, and the search waits 300 ms and asks for Discover only", () => {
  assert.equal(discoverEmptyCopy({ listsLoaded: false, count: 0, filtered: true }), null);
  assert.equal(discoverEmptyCopy({ listsLoaded: true, count: 0, filtered: true }), "noDiscoverMatch");
  assert.equal(discoverEmptyCopy({ listsLoaded: true, count: 0, filtered: false }), "noDiscover");
  assert.equal(discoverEmptyCopy({ listsLoaded: true, count: 2, filtered: true }), null);
  assert.equal(en.studyGroupsPage.noDiscoverMatch, "No Study Groups match your search.");
  assert.match(app, /const SEARCH_DEBOUNCE_MS = 300;/);
  assert.match(app, /window\.setTimeout\(\(\) => setQuery\(queryInput\), SEARCH_DEBOUNCE_MS\)/);
  assert.match(app, /<input value=\{queryInput\} onChange=\{\(event\) => setQueryInput\(event\.target\.value\)\}/);
  assert.match(app, /void loadLists\(\{ discoverOnly: true \}\);\s*\}, \[courseFilter, query\]\);/);
  assert.match(app, /const fetchAll = signedIn && !discoverOnly;/);
  // The first load still asks for everything.
  assert.match(app, /useEffect\(\(\) => \{\s*void loadLists\(\);\s*\}, \[signedIn\]\);/);
});

test("M4: without Course access the Create dialog explains it, links to Courses and disables Create", () => {
  assert.match(app, /const noCourseAccess = courses !== null && courses\.length === 0;/);
  assert.match(app, /\{noCourseAccess \? <p className=\{styles\.noCourses\}>\{copy\.noCourseAccess\} <a href=\{`\/\$\{locale\}\/portal\/courses`\}>\{copy\.viewCourses\}<\/a><\/p> : null\}/);
  assert.match(app, /type="submit" disabled=\{creating \|\| noCourseAccess\}/);
  assert.equal(en.studyGroupsPage.noCourseAccess, "You need access to a Course before you can create a Study Group for it.");
  assert.equal(zh.studyGroupsPage.viewCourses, "查看课程");
});

test("M5: the join gate shows no Live Sessions count", () => {
  assert.match(app, /\{pane\.kind === "sessions" \? <span className=\{styles\.countBadge\}>\{\(selected\.sessions \|\| \[\]\)\.length\}<\/span> : null\}/);
});

test("M6: every sign-in link comes back to the open group, and a signed-out visitor is asked to sign in to join", () => {
  assert.equal(studyGroupsPageHref("en-GB", null), "/en-GB/portal/study-groups");
  assert.equal(studyGroupsPageHref("zh-CN", "g-1"), "/zh-CN/portal/study-groups?group=g-1");
  assert.equal(studyGroupSignInHref("en-GB", "/en-GB/portal/study-groups?group=g-1"), "/en-GB/portal/sign-in?returnTo=%2Fen-GB%2Fportal%2Fstudy-groups%3Fgroup%3Dg-1");
  assert.match(app, /const signInHref = studyGroupSignInHref\(locale, studyGroupsPageHref\(locale, selectedId\)\);/);
  assert.equal(app.includes("href={`/${locale}/portal/sign-in`}"), false);
  // The open group lives in the address, so the header link (which reads it) returns to it.
  assert.match(app, /setSelectedId\(id\);\s*showGroupInAddress\(id\);/);
  assert.match(header, /<StudyGroupSignInLink locale=\{locale\} className=\{styles\.signInLink\} label=\{copy\.signIn\} \/>/);
  assert.match(signInLink, /studyGroupSignInHref\(locale, pathname \+ \(query \? `\?\$\{query\}` : ""\)\)/);
  assert.match(app, /selected\.canJoin \? copy\.joinAccess : !signedIn \? copy\.signInToJoin : selected\.courseAvailable === false \? copy\.courseUnavailable : fill\(copy\.courseAccessRequired, \{ course: selected\.courseTitle \}\)/);
  // Next.js only syncs useSearchParams (the header link) when replaceState gets a state of its own.
  assert.match(app, /window\.history\.replaceState\(null, "", url\.pathname \+ url\.search \+ url\.hash\);/);
  assert.equal(en.studyGroupsPage.signInToJoin, "Sign in to join this Study Group.");
});

test("M8: the English copy reads correctly and counts take their singular", () => {
  const page = en.studyGroupsPage;
  assert.equal(page.noSessions, "There are no Live Sessions yet.");
  assert.equal(page.noMine, "You haven't joined any Study Group yet.");
  assert.equal(page.keyword, "Keyword search...");
  assert.match(page.courseAccessRequired, /^Course access required\. You don't/);
  assert.equal(fillCount("en-GB", page.learners, 1), "1 learner");
  assert.equal(fillCount("en-GB", page.learners, 3), "3 learners");
  assert.equal(fillCount("en-GB", page.attended, 1), "1 member attended");
  assert.equal(fillCount("en-GB", page.attended, 0), "0 members attended");
  assert.equal(fillCount("zh-CN", zh.studyGroupsPage.learners, 1), "1 位学习者");
  assert.equal(fillCount("zh-CN", zh.studyGroupsPage.attended, 1), "1 人参加过");
  assert.equal((app.match(/fillCount\(locale, copy\.learners, group\.memberCount\)/g) || []).length, 2);
  assert.match(app, /fillCount\(locale, copy\.attended, session\.attendees\.length\)/);
});

test("M9: a cancelled group or session, or a session moved later, closes with a notice", () => {
  assert.deepEqual(waitingDialogStep({ ok: false, code: "not_found", data: null }), { kind: "close", errorCode: null, notice: "sessionCancelled" });
  assert.deepEqual(waitingDialogStep({ ok: true, code: "ok", data: { state: "scheduled" } }), { kind: "close", errorCode: null, notice: "sessionRescheduled" });
  assert.deepEqual(waitingDialogStep({ ok: true, code: "ok", data: { seated: false, state: "scheduled" } }), { kind: "close", errorCode: null, notice: "sessionRescheduled" });
  assert.deepEqual(waitingDialogStep({ ok: true, code: "ok", data: { state: "completed" } }), { kind: "close", errorCode: "session_unavailable", notice: null });
  assert.deepEqual(waitingDialogStep({ ok: true, code: "ok", data: { state: "live" } }), { kind: "open-room" });
  assert.deepEqual(waitingDialogStep({ ok: true, code: "ok", data: { state: "starting_soon" } }), { kind: "keep" });
  // The group open on screen was cancelled.
  assert.match(app, /if \(result\.code === "not_found"\) \{\s*\/\/[^\n]*\n\s*forgetOpenGroup\(\);\s*setNotice\("groupCancelled"\);/);
  // The waiting, edit-session and attendees dialogs lose their session.
  assert.equal((app.match(/setNotice\("sessionCancelled"\);/g) || []).length, 3);
  // Closing the waiting dialog releases its seat (the hold effect calls leave).
  assert.match(app, /const held = waitingHoldRef\.current;\s*if \(!held\) return;\s*waitingHoldRef\.current = null;\s*void fetch\(`\/api\/study-groups\/sessions\/\$\{held\}\/leave`/);
  assert.match(app, /\{notice \? <p className=\{styles\.notice\} role="status"><span>\{copy\.notices\[notice\]\}<\/span>/);
  assert.equal(en.studyGroupsPage.notices.groupCancelled, "This Study Group has been cancelled.");
  assert.equal(zh.studyGroupsPage.notices.sessionRescheduled, "这节直播课已改到更晚的时间，你的座位已释放。");
});

test("M23: at phone width the session card is one column, the member column has no fixed height, and a menu replaces the nav", () => {
  const phone = phoneRules();
  assert.match(phone, /\.session \{ grid-template-columns: minmax\(0, 1fr\);[^}]*\}/);
  assert.match(phone, /\.memberCol \{ min-height: 0; \}/);
  assert.match(phone, /\.nav \{ display: none; \}/);
  assert.match(phone, /\.menu \{ display: block; \}/);
  assert.match(css, /\n\.menu \{ display: none;[^}]*\}/);
  assert.match(header, /<details className=\{styles\.menu\}>\s*<summary aria-label=\{page\.menu\}>/);
  assert.match(header, /<nav aria-label=\{page\.primaryNavigation\}>\{links\}<\/nav>/);
  assert.match(header, /href=\{`\/\$\{locale\}\/portal\/courses`\}/);
  assert.match(header, /href=\{`\/\$\{locale\}\/subscription`\}/);
});

test("M24: the attendees dialog says Nobody yet when empty and its button closes", () => {
  assert.match(app, /attendees\.length \? <ul className=\{styles\.attendeeList\}>[^\n]*: <p className=\{styles\.attendeeEmpty\}>\{copy\.nobodyYet\}<\/p>/);
  assert.match(app, /\{dialog === "attendees" \? copy\.close : copy\.cancel\}/);
  assert.equal(en.studyGroupsPage.nobodyYet, "Nobody yet");
  assert.equal(zh.studyGroupsPage.nobodyYet, "暂时没有人");
});

test("M25: Edit Group uses the create form's fields with a title counter; Session Focus has its own placeholder", () => {
  assert.match(app, /<label className=\{styles\.field\}><span>\{copy\.groupTitle\} <span className=\{styles\.req\}>\*<\/span><\/span><span className=\{styles\.fieldBox\}><input name="title" required maxLength=\{50\} placeholder=\{copy\.enterTitle\} value=\{editTitle\}[^\n]*<span className=\{styles\.counter\}>\{editTitle\.length\}\/50<\/span>/);
  assert.match(app, /<label className=\{styles\.field\}><span>\{copy\.about\} <span className=\{styles\.req\}>\*<\/span><\/span><span className=\{styles\.fieldBox\}><textarea name="about"/);
  assert.match(app, /<textarea name="focus" disabled=\{timeOnly\} maxLength=\{50\} placeholder=\{copy\.enterFocus\}/);
  assert.equal(en.studyGroupsPage.enterFocus, "Enter the session focus...");
  assert.equal(zh.studyGroupsPage.enterFocus, "输入本节重点…");
});

test("M26: the created card names the group and Course, and Cancel waits for the create request", () => {
  assert.match(app, /<span className=\{styles\.createdName\}>\{createdGroup\.title\}<\/span><span className=\{styles\.createdBody\}>\{createdGroup\.courseTitle\}<\/span>/);
  assert.match(app, /<button className=\{styles\.ghost\} type="button" onClick=\{closeDialog\} disabled=\{creating\}>\{copy\.cancel\}<\/button>/);
});

test("M27: the header speaks the page's language, the avatar has a name, the language chip is right at first paint, and the chat box shows focus", () => {
  assert.equal(header.includes('aria-label="Primary navigation"'), false);
  assert.match(header, /<nav className=\{styles\.nav\} aria-label=\{page\.primaryNavigation\}>/);
  assert.equal(zh.studyGroupsPage.primaryNavigation, "主导航");
  assert.match(header, /className=\{styles\.avatar\} href=\{`\/\$\{locale\}\/account\/my-learning`\} prefetch=\{false\} aria-label=\{copy\.myLearning\}>/);
  assert.match(header, /<Suspense fallback=\{<span className=\{styles\.lang\}>\{languageLabel\}<\/span>\}>\s*<PortalLanguageLink locale=\{locale\} label=\{languageLabel\} \/>/);
  assert.match(css, /\.chatForm:focus-within \{[^}]*border-color: #1d6bff;[^}]*box-shadow:[^}]*\}/);
});
