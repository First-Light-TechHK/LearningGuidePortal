import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import en from "../../messages/en-GB.json";
import zh from "../../messages/zh-CN.json";

// The room page's round-2 client fixes (SG / AI Tutor QA of 2026-10-19 and its
// final review): source locks for the wiring that has no pure helper to call.

const room = readFileSync(new URL("../../components/portal/StudySessionRoom.tsx", import.meta.url), "utf8");
const css = readFileSync(new URL("../../components/portal/study-groups.module.css", import.meta.url), "utf8");

function between(source: string, start: string, end: string) {
  const from = source.indexOf(start);
  assert.notEqual(from, -1, start);
  const to = source.indexOf(end, from + start.length);
  assert.notEqual(to, -1, end);
  return source.slice(from, to);
}

test("r2-B4: the seat heartbeat renews at once when the tab is visible again or back online", () => {
  const effect = between(room, "const beat = async () => {", "}, [seated, left, blocked, accessLost, session?.state, sessionId]);");
  assert.match(effect, /document\.addEventListener\("visibilitychange", beatWhenVisible\);/);
  assert.match(effect, /if \(document\.visibilityState === "visible"\) void beat\(\);/);
  assert.match(effect, /window\.addEventListener\("online", beatNow\);/);
  assert.match(effect, /document\.removeEventListener\("visibilitychange", beatWhenVisible\);/);
  assert.match(effect, /window\.removeEventListener\("online", beatNow\);/);
  // One heartbeat at a time: an extra trigger never doubles a re-entry.
  assert.match(effect, /if \(heartbeatBusy\.current \|\| leftRef\.current\) return;/);
});

test("X-4: a heartbeat re-entry refused as full keeps a still-connected call", () => {
  const effect = between(room, "const beat = async () => {", "const timer = window.setInterval(() => void beat(), SEAT_HEARTBEAT_MS);");
  assert.match(effect, /if \(seatReentryAction\(entered\.code, roomRef\.current\?\.state === "connected"\) === "keep"\) return;/);
  assert.match(effect, /setSeated\(false\);\s*setErrorCode\(entered\.code\);\s*await releaseRoom\(\);/);
});

test("r4-N13-a: the 'turn sound on' button goes with the call", () => {
  const reset = between(room, "function resetCall() {", "async function releaseRoom() {");
  assert.match(reset, /setAudioBlocked\(false\);/);
  assert.match(reset, /setHands\(\[\]\);/);
  const release = between(room, "async function releaseRoom() {", "async function exitTo");
  assert.match(release, /resetCall\(\);/);
  const disconnected = between(room, "room.on(RoomEvent.Disconnected, (reason) => {", "const reasonName");
  assert.match(disconnected, /resetCall\(\);/);
});

test("r3-B2 / M21 / X-5: tutor questions keep their event id, say why they were not sent, and ask again after an unavailable answer", () => {
  // The question line remembers which answer it waits on.
  assert.match(room, /tutorChatLines\(items\.map\(\(item\) => item\.id === lineId \? \{ \.\.\.item, tutorAnswerId: answerId \} : item\)/);
  // A refusal: "Not sent to AI Tutor: <reason>", retried under the same id.
  assert.match(room, /fill\(roomCopy\.tutorNotSent, \{ reason: tutorRefusalReason\(line\.tutorError, \{ errors: copy\.errors, notLive: roomCopy\.tutorNotLive \}\) \}\)/);
  assert.match(room, /onClick=\{\(\) => void askTutor\(line\.id, line\.tutorAsk!\)\}/);
  // An unavailable answer: ask again under a new id.
  assert.match(room, /tutorAskAgain\(chat, line\.tutorAnswerId\) \? [^\n]*askTutor\(line\.id, \{ question: line\.tutorAsk!\.question, clientEventId: tutorClientEventId\(\) \}\)/);
  assert.equal(en.studyGroupsPage.room.tutorNotSent, "Not sent to AI Tutor: {reason}");
  assert.equal(zh.studyGroupsPage.room.tutorNotSent, "未发送给 AI Tutor：{reason}");
  assert.ok(en.studyGroupsPage.errors.seat_lapsed);
  assert.ok(zh.studyGroupsPage.errors.seat_lapsed);
});

test("M13: the Host's Start shows progress, shows its own failure, and the failure stays out of the live room", () => {
  assert.match(room, /disabled=\{starting\} aria-busy=\{starting\} onClick=\{\(\) => void startSession\(\)\}>\{starting \? roomCopy\.starting : copy\.start\}<\/button>/);
  assert.match(room, /\{startError \? <p className=\{styles\.alert\} role="alert">/);
  const start = between(room, "async function startSession() {", "function retryLoad()");
  assert.match(start, /setStartError\(""\);/);
  assert.match(start, /if \(!started\.ok\) setStartError\(started\.code\);/);
  assert.doesNotMatch(start, /setErrorCode/);
  assert.match(room, /if \(session\?\.state === "live"\) setStartError\(""\);/);
  assert.equal(en.studyGroupsPage.room.starting, "Starting…");
});

test("M15: Leave Session asks first, says when the last person ends the session, and the left page can rejoin", () => {
  assert.match(room, /className=\{styles\.leaveControl\} type="button" onClick=\{\(\) => \{ setLeaveError\(""\); setLeaveAsked\(true\); \}\}/);
  assert.match(room, /\{session\.occupancy <= 1 \? roomCopy\.leaveConfirmLast : roomCopy\.leaveConfirmBody\}/);
  assert.match(room, /\{leaveError \? copy\.retry : roomCopy\.confirmLeave\}/);
  // The leave flag is set by hand, never re-derived on render (a re-render
  // during the leave request used to clear it).
  assert.equal(room.includes("leftRef.current = left;"), false);
  const rejoin = between(room, "function rejoin() {", "async function startSession()");
  assert.match(rejoin, /leftRef\.current = false;/);
  assert.match(rejoin, /setSeated\(false\);/);
  assert.match(rejoin, /setLeft\(false\);/);
  assert.match(en.studyGroupsPage.room.leaveConfirmLast, /ends the Live Session/);
  assert.equal(en.studyGroupsPage.room.rejoin, "Rejoin");
  assert.equal(zh.studyGroupsPage.room.rejoin, "重新加入");
});

test("M17 / M20: a page that may not show the session offers sign-in, the way back, or a retry", () => {
  const gate = between(room, "function gate(code: string) {", "const loadError = pollError || errorCode;");
  assert.match(gate, /href=\{roomSignInHref\(locale, sessionId\)\}>\{copy\.signIn\}/);
  assert.match(gate, /href=\{`\/\$\{locale\}\/portal\/study-groups`\}>\{roomCopy\.backToGroups\}/);
  assert.match(gate, /onClick=\{retryLoad\}>\{copy\.retry\}/);
  assert.match(room, /if \(!session\) return loadError \? <>\{path\(\)\}\{gate\(loadError\)\}<\/> : /);
  // No longer a member: the call is released and the room is replaced.
  const load = between(room, "async function load() {", "async function connect(");
  assert.match(load, /current\.code === "forbidden" \|\| current\.code === "unauthenticated"\) \{[\s\S]*?await releaseRoom\(\);/);
  assert.match(room, /const accessLost = pollError === "forbidden" \|\| pollError === "unauthenticated";/);
  assert.match(room, /if \(session\?\.state !== "live" \|\| connected \|\| left \|\| leftRef\.current \|\| !seated \|\| blocked \|\| accessLost\) return;/);
});

test("M18: the sharer never sees their own share in the main view; failure says so; no Share without getDisplayMedia", () => {
  const share = between(room, "const showShare = () => {", "setSharing(");
  assert.match(share, /const remote = Array\.from\(room\.remoteParticipants\.values\(\)\)/);
  assert.doesNotMatch(share, /localParticipant/);
  assert.match(room, /controls\.includes\("share"\) && canShare \?/);
  assert.match(room, /setCanShare\(screenShareSupported\(navigator\.mediaDevices\)\);/);
  // Closing the picker is the person's choice, not a failure (BUG-0199).
  assert.match(room, /if \(start && !screenShareCancelled\(error\)\) setShareFailed\(true\);/);
  assert.match(room, /\{shareFailed \? <p className=\{styles\.alert\} role="alert">\{roomCopy\.shareFailed\}/);
});

test("M1 / M23: long titles wrap in the room and the room fits a 375 px screen", () => {
  assert.match(css, /\.stageHead \{ flex-wrap: wrap; \}/);
  assert.match(css, /\.stageHead h1, \.empty h1, \.empty p, \.endCard h1, \.endCard p,[^{]*\{ min-width: 0; overflow-wrap: anywhere; \}/);
  const narrow = between(css, "@media (max-width: 720px) {", "\n}");
  assert.match(narrow, /\.crumb \{ flex-wrap: wrap;/);
  assert.match(narrow, /\.endCard \{ box-sizing: border-box; \}/);
  assert.match(css, /\.controls \{ display: flex; flex-wrap: wrap;/);
});
