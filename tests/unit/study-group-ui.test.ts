import assert from "node:assert/strict";
import { test } from "node:test";
import { participantStatus, raisedHands, sessionControls, sessionStateLabel, studyGroupErrorPlace, studyGroupHasError, studyGroupMutation, studyGroupPane, uniqueReminderBodies } from "../../modules/group-study/uiState";
import { readFileSync } from "node:fs";
import en from "../../messages/en-GB.json";
import zh from "../../messages/zh-CN.json";
import { clampGroupAbout, DURATION_MINUTE_CHOICES, fill, fillCount, GROUP_ABOUT_MAX, hostMayOpenRoom, scheduleSessionFields, SESSION_TITLE_MAX, sessionNotStarted, sessionScheduleLabel, sessionTitleCount, studyGroupRequest, tutorQueueBody } from "../../components/portal/studyGroupClient";

test("schedule duration is a required dropdown of 30, 45, 60, and 90 minutes", () => {
  assert.deepEqual([...DURATION_MINUTE_CHOICES], [30, 45, 60, 90]);
  assert.equal(en.studyGroupsPage.duration, "Duration");
  assert.equal(zh.studyGroupsPage.duration, "时长");
  assert.deepEqual(DURATION_MINUTE_CHOICES.map((minutes) => fill(en.studyGroupsPage.plannedDuration, { count: minutes })), ["30 mins", "45 mins", "60 mins", "90 mins"]);
  assert.deepEqual(DURATION_MINUTE_CHOICES.map((minutes) => fill(zh.studyGroupsPage.plannedDuration, { count: minutes })), ["30 分钟", "45 分钟", "60 分钟", "90 分钟"]);
  const source = readFileSync(new URL("../../components/portal/StudyGroupsApp.tsx", import.meta.url), "utf8");
  assert.match(source, /select name="durationMinutes" required/);
  assert.match(source, /type="date" required min=\{todayDate\(\)\}/);
  assert.match(source, /min=\{earliestTime\(sessionDate\) \|\| undefined\}/);
  assert.match(source, /DURATION_MINUTE_CHOICES\.map/);
  assert.match(source, /\(selected\?\.lessons \|\| \[\]\)\.map/);
  assert.equal(en.studyGroupsPage.relatedLesson, "Related Lesson");
  assert.equal(zh.studyGroupsPage.relatedLesson, "相关课时");
  assert.match(source, /copy\.relatedLesson/);
  assert.match(source, /<option value="">\{copy\.selectLesson\}<\/option>/);
  assert.equal(scheduleSessionFields({ title: "Road", startsAt: "2026-09-19T02:05:00.000Z", durationMinutes: 45, maxParticipants: 4, focus: null, aiTutorEnabled: true, relatedLessonId: "lesson-1" }).relatedLessonId, "lesson-1");
  assert.equal(scheduleSessionFields({ title: "Road", startsAt: "2026-09-19T02:05:00.000Z", durationMinutes: 45, maxParticipants: 4, focus: null, aiTutorEnabled: true, relatedLessonId: "" }).relatedLessonId, null);
  assert.equal(source.includes("durationSeconds"), false);
  assert.equal(source.includes('type="number"'), false);
});

test("the chat control queues the user's text and does not carry a system prompt or an answer", () => {
  assert.deepEqual(tutorQueueBody("Why did 1928 look stable?"), { message: "Why did 1928 look stable?" });
  assert.equal("prompt" in tutorQueueBody("Why did 1928 look stable?"), false);
  const room = readFileSync(new URL("../../components/portal/StudySessionRoom.tsx", import.meta.url), "utf8");
  assert.match(room, /askTutor\(line\.id, \{ question: \(hasPrefix \? text\.slice\(prefix\.length\) : text\)\.trim\(\), clientEventId: tutorClientEventId\(\) \}\)/);
  assert.match(room, /JSON\.stringify\(tutorQueueBody\(ask\.question, ask\.clientEventId\)\)/);
  assert.match(room, /<time dateTime=\{line\.at\}>/);
  assert.match(room, /session\.aiTutorEnabled \?/);
  assert.equal(room.includes("/api/ai-tutor"), false);
  assert.equal(room.includes("prompts/"), false);
  assert.equal(room.includes("You are"), false);
  // The queue response only names the pending line; the answer arrives through the room.
  assert.equal(room.replace(/queued\.data\.id/g, "").includes("queued.data"), false);
});

test("host start opens the room only after entry succeeds", () => {
  assert.equal(hostMayOpenRoom(true, true), true);
  assert.equal(hostMayOpenRoom(true, false), false);
  assert.equal(hostMayOpenRoom(false, false), false);
  const page = readFileSync(new URL("../../components/portal/StudyGroupsApp.tsx", import.meta.url), "utf8");
  assert.match(page, /copy\.createdTitle/);
  assert.match(page, /copy\.openGroup/);
  assert.match(page, /copy\.editSession/);
  assert.match(page, /\/enter/);
  const css = readFileSync(new URL("../../components/portal/study-groups.module.css", import.meta.url), "utf8");
  assert.match(css, /\.memberList[\s\S]*overflow-y: auto/);
  assert.match(css, /\.shareMain/);
  assert.match(readFileSync(new URL("../../components/portal/StudySessionRoom.tsx", import.meta.url), "utf8"), /styles\.shareMain\} autoPlay playsInline muted/);
  assert.match(readFileSync(new URL("../../components/portal/StudySessionRoom.tsx", import.meta.url), "utf8"), /TrackUnpublished/);
  assert.match(readFileSync(new URL("../../components/portal/StudySessionRoom.tsx", import.meta.url), "utf8"), /RoomEvent\.Disconnected/);
  assert.match(readFileSync(new URL("../../components/portal/StudySessionRoom.tsx", import.meta.url), "utf8"), /recovery: true/);
});

test("the room distinguishes SDK reconnection, terminal disconnects, and verified token recovery", () => {
  const room = readFileSync(new URL("../../components/portal/StudySessionRoom.tsx", import.meta.url), "utf8");
  assert.match(room, /transitionLiveKitClient/);
  assert.match(room, /RoomEvent\.Reconnecting/);
  assert.match(room, /RoomEvent\.Reconnected/);
  assert.match(room, /ConnectionQualityChanged/);
  assert.match(room, /recoveryRequired/);
});

test("session title counter matches the 50 character limit (owner ruling 2026-10-15)", () => {
  // Owner ruling 2026-10-15 (BUG-0128): the Schedule Live Session title allows 50
  // characters like the Study Group Title / Session Focus, so a real sample like
  // "Classical Poetry Reading Session" (32 characters) fits. This supersedes the
  // earlier 20 character alignment.
  const app = readFileSync(new URL("../../components/portal/StudyGroupsApp.tsx", import.meta.url), "utf8");
  assert.equal(SESSION_TITLE_MAX, 50);
  assert.equal(sessionTitleCount(""), "0/50");
  assert.equal(sessionTitleCount("1234567"), "7/50");
  assert.equal(sessionTitleCount("Classical Poetry Reading Session"), "32/50");
  assert.equal(sessionTitleCount("x".repeat(50)), "50/50");
  assert.equal(sessionTitleCount("x".repeat(51)), "50/50");
  // The dialog input follows the constant for both its maxLength and its slice.
  assert.match(app, /<input name="title" required disabled=\{timeOnly\} maxLength=\{SESSION_TITLE_MAX\} value=\{sessionTitle\} onChange=\{\(event\) => setSessionTitle\(event\.target\.value\.slice\(0, SESSION_TITLE_MAX\)\)\} \/><span className=\{styles\.counter\}>\{sessionTitleCount\(sessionTitle\)\}<\/span>/);
});

test("study group pane shows empty, error, and a selected group without inventing sessions for a visitor", () => {
  assert.equal(studyGroupPane({ status: "loading", selected: null }).kind, "loading");
  assert.equal(studyGroupPane({ status: "error", selected: null }).kind, "error");
  assert.equal(studyGroupPane({ status: "ready", selected: null }).kind, "empty");
  assert.equal(studyGroupPane({ status: "ready", selected: { role: null, sessions: null } }).kind, "join-gate");
  assert.equal(studyGroupPane({ status: "ready", selected: { role: "member", sessions: [] } }).kind, "sessions");
});

test("the join label reads Join Now and Hosting is only for the Host", () => {
  assert.equal(en.studyGroupsPage.joinGroup, "Join Now");
  assert.equal(zh.studyGroupsPage.joinGroup, "立即加入");
  const source = readFileSync(new URL("../../components/portal/StudyGroupsApp.tsx", import.meta.url), "utf8");
  assert.match(source, /\{copy\.joinGroup\}/);
  assert.match(source, /selected\.role === "host" \? <span className=\{styles\.hostChip\}>\{copy\.hosting\}<\/span> : null/);
  assert.match(source, /selected\.role === "host" \? <div className=\{`\$\{styles\.hostFoot\} \$\{styles\.hostFootWithCopy\}`\}>/);
  assert.equal(source.includes("{copy.hosting}</span> : null"), true);
});

test("in-room controls stay the same for host and participant, and a full session disables entry", () => {
  assert.deepEqual(sessionControls({ role: "host", state: "live", occupancy: 2, maxParticipants: 6 }), ["mic", "camera", "share", "participants", "raise-hand", "leave"]);
  assert.deepEqual(sessionControls({ role: "member", state: "live", occupancy: 2, maxParticipants: 6 }), ["mic", "camera", "share", "participants", "raise-hand", "leave"]);
  assert.equal(sessionControls({ role: "member", state: "starting_soon", occupancy: 6, maxParticipants: 6 }).includes("join"), false);
  assert.equal(sessionControls({ role: "host", state: "starting_soon", occupancy: 1, maxParticipants: 6 }).includes("start"), true);
  assert.equal(sessionControls({ role: "member", state: "starting_soon", occupancy: 1, maxParticipants: 6 }).includes("join"), true);
  assert.equal(sessionControls({ role: "member", state: "scheduled", occupancy: 0, maxParticipants: 6 }).includes("plan"), true);
});

test("a live tile says who is speaking, who has a microphone, and who is muted", () => {
  assert.equal(participantStatus({ mic: false, speaking: true }), "muted");
  assert.equal(participantStatus({ mic: true, speaking: true }), "speaking");
  assert.equal(participantStatus({ mic: true, speaking: false }), "mic-on");
  assert.deepEqual(raisedHands(["host"], "host", false), []);
  assert.deepEqual(raisedHands([], "guest", true), ["guest"]);
  assert.deepEqual(raisedHands(["guest"], "guest", true), ["guest"]);
  assert.equal(en.studyGroupsPage.room.muted, "Muted");
  assert.equal(en.studyGroupsPage.room.speaking, "Speaking");
  assert.equal(en.studyGroupsPage.room.micOn, "Mic on");
  assert.equal(zh.studyGroupsPage.room.muted, "已静音");
  assert.equal(zh.studyGroupsPage.room.speaking, "正在发言");
  const room = readFileSync(new URL("../../components/portal/StudySessionRoom.tsx", import.meta.url), "utf8");
  assert.match(room, /styles\.roster/);
  assert.match(room, /ControlIcon kind="mic"/);
  assert.match(room, /styles\.rosterStatus/);
  assert.match(room, /data-status=\{person\.status\}/);
  assert.match(room, /styles\.tabCount/);
  assert.match(room, /role="tablist"/);
  assert.match(room, /setSideTab\("participants"\)/);
  assert.match(room, /setSideTab\("chat"\)/);
  assert.match(room, /sideTab === "participants"/);
  assert.match(room, /ActiveSpeakersChanged/);
  assert.match(room, /person\.isSpeaking/);
  assert.match(room, /type: "raise-hand", raised/);
  assert.match(room, /raise-hand"\) \? <button type="button" aria-pressed=\{Boolean\(roomApi\?\.localParticipant\.identity && hands\.includes\(roomApi\.localParticipant\.identity\)\)\} disabled=\{!connected\}/);
  // A hand goes down with the person who leaves; a newcomer hears raised hands from their owners (QA M19).
  assert.match(room, /ParticipantDisconnected, live\(\(participant\) => \{\s*setHands\(\(items\) => raisedHands\(items, participant\.identity, false\)\);\s*paint\(\);\s*window\.setTimeout\(\(\) => void load\(\), 400\);\s*\}/);
  assert.match(room, /ParticipantConnected, live\(\(participant\) => \{[\s\S]*?sendRaisedHand\(participant\.identity\);/);
  assert.match(room, /const sendRaisedHand = \(identity: string\) => \{[\s\S]*?destinationIdentities: \[identity\]/);
  // The newcomer asks once its own connection is up; a raiser answers it alone.
  assert.match(room, /setConnected\(true\);\s*setReconnecting\(false\);\s*void room\.localParticipant\.publishData\(new TextEncoder\(\)\.encode\(JSON\.stringify\(\{ type: "hands-query" \}\)\)/);
  assert.match(room, /if \(message\.type === "hands-query"\) sendRaisedHand\(data\.senderIdentity\);/);
  assert.match(room, /connected && tiles\.length > 0 \? tiles\.length : session\.occupancy/);
  assert.match(room, /controls\.includes\("participants"\)/);
  assert.match(room, /data-participants=\{present\}/);
  // A dropped connection keeps retrying with a capped backoff while the page is open (QA N1).
  assert.match(room, /reconnectDelayMs\(failuresRef\.current\)/);
  assert.match(room, /releaseRoom\(\)/);
  assert.match(room, /session\?\.state === "completed"\) void releaseRoom\(\)/);
  assert.match(room, /seatIntent\("enter"\)/);
  assert.match(room, /session\.state === "scheduled"/);
  assert.match(room, /copy\.errors\.session_not_open/);
  assert.match(room, /copy\.enterWindow/);
  assert.equal(en.studyGroupsPage.errors.start_in_past, "Start Time must be in the future.");
  assert.equal(zh.studyGroupsPage.errors.start_in_past, "开始时间必须还在将来。");
  assert.match(readFileSync(new URL("../../components/portal/StudyGroupsApp.tsx", import.meta.url), "utf8"), /\{errorPlace === "dialog" \? <p className=\{styles\.alert\} role="alert">\{errorText\}<\/p> : null\}/); // BUG-0100: one slot-gated alert per dialog
  assert.equal(en.studyGroupsPage.courseAccessRequired, "Course access required. You don't currently have access to {course}.\nGet Course access to join this Study Group.");
  assert.equal(fill(en.studyGroupsPage.courseAccessRequired, { course: "German History" }), "Course access required. You don't currently have access to German History.\nGet Course access to join this Study Group.");
  assert.equal(zh.studyGroupsPage.courseAccessRequired, "需要课程访问权限，你目前没有{course}的访问权限。\n获取课程访问权限后才能加入这个学习小组。");
  assert.equal(en.studyGroupsPage.joinAccess, "You have access to this Course.\nJoin this Study Group to view and take part in its Live Sessions.");
  assert.equal(zh.studyGroupsPage.joinAccess, "你有这门课的访问权限。\n加入学习小组后可以查看并参加直播课。");
  assert.match(readFileSync(new URL("../../components/portal/study-groups.module.css", import.meta.url), "utf8"), /\.joinNote \{[^}]*white-space: pre-line[^}]*\}/);
  assert.match(readFileSync(new URL("../../components/portal/StudyGroupsApp.tsx", import.meta.url), "utf8"), /copy\.courseAccessRequired/);
  assert.equal(en.studyGroupsPage.getCourseAccess, "View Course");
  assert.equal(en.studyGroupsPage.enableAiTutor, "Enable AI Tutor for this session");
  assert.equal(zh.studyGroupsPage.enableAiTutor, "为本节启用 AI Tutor");
  assert.match(readFileSync(new URL("../../components/portal/StudyGroupsApp.tsx", import.meta.url), "utf8"), /styles\.switchText\}>\{copy\.enableAiTutor\}/);
  assert.equal(en.studyGroupsPage.enterWindow, "You can enter from 10 minutes before the start.");
  assert.equal(en.studyGroupsPage.notStartedBody, "This Live Session was not started.");
  assert.match(readFileSync(new URL("../../components/portal/StudyGroupsApp.tsx", import.meta.url), "utf8"), /sessionNotStarted\(session\) \? copy\.notStartedBody/);
  assert.equal(zh.studyGroupsPage.notStarted, "未开始");
  assert.equal(sessionNotStarted({ state: "starting_soon", occupancy: 0, startsAt: "2020-01-01T00:00:00.000Z", durationSeconds: 1800 }, Date.parse("2026-01-01T00:00:00.000Z")), true);
  assert.equal(sessionNotStarted({ state: "starting_soon", occupancy: 1, startsAt: "2020-01-01T00:00:00.000Z", durationSeconds: 1800 }, Date.parse("2026-01-01T00:00:00.000Z")), false);
  assert.equal(zh.studyGroupsPage.enterWindow, "开始前 10 分钟可以进入。");
  assert.match(room, /group\?\.role === "host" \? <button className=\{styles\.primary\} type="button"/);
  assert.match(room, /sessions\/\$\{sessionId\}\/start/);
  // A refused entry: a full session offers to try again, missing Course access points to it (QA3 F7).
  assert.match(room, /const refusalOffer = seated \? null : seatRefusalOffer\(errorCode\);/);
  assert.match(room, /refusalOffer === "retry" \? <button className=\{styles\.primary\} type="button" onClick=\{retryEntry\}>\{copy\.retry\}<\/button> : null/);
  assert.match(room, /copy\.getCourseAccess/);
  assert.match(room, /!seated && !entryDone/);
  assert.equal(en.studyGroupsPage.start, "Start Live Session");
  assert.match(room, /room\?\.disconnect\(\)/);
  // pagehide only closes the media connection; no leave beacon (QA 2026-10-19 seat lease).
  assert.match(room, /pagehide/);
  assert.equal(room.includes("/leave`, { method: \"POST\", headers"), false);
  assert.equal(room.includes("reason: \"unload\""), false);
  assert.match(room, /setConnectAttempt\(\(attempt\) => attempt \+ 1\)/);
  assert.match(room, /connectAttempt/);
  assert.equal(en.studyGroupsPage.errors.connect_failed, "The Live Session could not connect. Check the connection and try again.");
  assert.equal(zh.studyGroupsPage.errors.connect_failed, "直播课无法连接。请检查连接后重试。");
});

test("a starting-soon Live Session shows its title, time, duration, and occupancy while waiting", () => {
  const label = sessionScheduleLabel("en-GB", { startsAt: "2026-09-19T09:00:00.000Z", durationSeconds: 2700 });
  assert.match(label, /2026/);
  assert.match(label, /–/);
  const start = new Date("2026-09-19T09:00:00.000Z");
  const end = new Date(start.getTime() + 2700 * 1000);
  const clock = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit" });
  assert.equal(label, `${new Intl.DateTimeFormat("en-GB", { dateStyle: "medium" }).format(start)} · ${clock.format(start)} – ${clock.format(end)}`);
  const app = readFileSync(new URL("../../components/portal/StudyGroupsApp.tsx", import.meta.url), "utf8");
  assert.equal(en.studyGroupsPage.waiting, "Waiting for the host to start the session...");
  assert.equal(fill(en.studyGroupsPage.upToParticipants, { count: 6 }), "Up to 6 participants");
  assert.equal(zh.studyGroupsPage.waiting, "等待主持人开始本节...");
  assert.equal(fill(zh.studyGroupsPage.upToParticipants, { count: 6 }), "最多 6 人");
  assert.match(app, /copy\.upToParticipants/);
  assert.match(app, /waitingSession\.title/);
  assert.match(app, /waitingSession\.focus/);
  assert.match(app, /sessionDateLabel\(locale, waitingSession\.startsAt\)/);
  assert.match(app, /sessionTimeLabel\(locale, waitingSession\)/);
  const room = readFileSync(new URL("../../components/portal/StudySessionRoom.tsx", import.meta.url), "utf8");
  assert.match(room, /sessionScheduleLabel\(locale, session\)/);
  assert.match(room, /copy\.currentlyInSession/);
  assert.match(room, /copy\.upToParticipants/);
  // The seat is held by the heartbeat while the room page is open (QA 2026-10-19 seat lease).
  assert.match(room, /session\?\.state !== "live" && session\?\.state !== "starting_soon"\)\) return;/);
  assert.match(room, /await seatIntent<\{ seated: boolean \}>\("heartbeat"\);/);
  assert.match(app, /waitingHoldRef/);
  assert.match(app, /waitingHandedOffRef\.current = true/);
  // The waiting popup keeps its seat by heartbeat; closing the popup releases it.
  assert.equal(app.includes('addEventListener("pagehide"'), false);
  assert.match(app, /keepalive: true/);
  assert.match(app, /setWaitingSession\(null\)/);
  assert.match(app, /if \(step === "cancelled"\)/);
  assert.match(room, /current\.code === "not_found"/);
  assert.match(room, /setSession\(null\)/);
});

test("a Live Session card names its state, attendance, and the plan reminder", () => {
  assert.equal(sessionStateLabel("scheduled"), "upcoming");
  assert.equal(sessionStateLabel("starting_soon"), "startingSoon");
  assert.equal(sessionStateLabel("live"), "live");
  assert.equal(en.studyGroupsPage.liveNow, "Live now");
  assert.equal(zh.studyGroupsPage.liveNow, "正在直播");
  assert.equal(sessionStateLabel("completed"), "completed");
  assert.equal(fillCount("en-GB", en.studyGroupsPage.attended, 4), "4 members attended");
  assert.equal(fill(en.studyGroupsPage.maximumLine, { count: 6 }), "Maximum 6 participants");
  assert.equal(en.studyGroupsPage.planNote, "Planning to attend does not reserve a place.");
  assert.equal(en.studyGroupsPage.planning, "You are planning to attend this session.");
  assert.equal(zh.studyGroupsPage.planNote, "计划参加不保留座位。");
  assert.equal(zh.studyGroupsPage.planning, "你已计划参加本节。");
  assert.equal(en.studyGroupsPage.reminderHint, "You'll get a reminder before it starts");
  assert.equal(fillCount("zh-CN", zh.studyGroupsPage.attended, 4), "4 人参加过");
  assert.equal(zh.studyGroupsPage.reminderHint, "开始前你会收到提醒");
  const app = readFileSync(new URL("../../components/portal/StudyGroupsApp.tsx", import.meta.url), "utf8");
  assert.match(app, /sessionStateLabel\(session\.state\)/);
  assert.match(app, /copy\.attended/);
  assert.match(app, /session\.state === "scheduled" && \(selected\.role === "host" \|\| session\.viewerPlanned\)/);
  assert.match(app, /copy\.reminderHint/);
  assert.match(app, /styles\.reminderHint/);
  assert.match(app, /copy\.planNote/);
  assert.match(app, /styles\.planNote/);
  assert.match(app, /styles\.factList/);
  assert.match(app, /copy\.openStudyGroup/);
  assert.match(app, /sessionDateLabel\(locale, session\.startsAt\)/);
  assert.match(app, /sessionTimeLabel\(locale, session\)/);
  assert.equal(en.studyGroupsPage.openStudyGroup, "Open Study Group");
  assert.equal(zh.studyGroupsPage.openStudyGroup, "打开学习小组");
  assert.equal(en.studyGroupsPage.hostingNote, "You are hosting this Study Group.");
  assert.equal(zh.studyGroupsPage.hostingNote, "你正在主持这个学习小组。");
  assert.match(app, /copy\.maximumLine/);
  assert.match(app, /view=reminders/);
  assert.match(app, /void readOpenGroup\(selectedId, true\)/);
  assert.match(app, /void loadLists\(\{ poll: true \}\); \}, 3_000\)/);
  assert.match(app, /if \(!listRequests\.isLatest\(ticket\)\) return;/);
  assert.match(app, /openGroupId\.current !== id/);
  assert.match(app, /setAttendeeSessionId\(session\.id\)/);
  assert.match(app, /session\.attendees\.slice\(0, 4\)/);
  assert.match(app, /session\.attendees\.length - 4/);
  assert.match(app, /styles\.avatarRow/);
  assert.match(app, /setAttendeeSessionId\(null\)/);
  assert.match(app, /setEditingSession\(null\)/);
  assert.match(app, /setAttendees\(current\.attendees\)/);
  assert.match(app, /dialog !== "waiting" \? \(/);
  assert.match(app, /styles\.waitingBanner/);
  assert.match(app, /sessions\/\$\{held\}\/leave/);
  assert.match(app, /sessions\/\$\{sessionId\}\/heartbeat/);
  assert.match(app, /groupAnswerStep\(\{ ok: result\.ok, code: result\.code/);
  assert.match(app, /live: result\.data\.live/);
  assert.match(app, /styles\.reminders/);
});

test("the ended screen and live clock follow the Live Session frames", () => {
  assert.equal(en.studyGroupsPage.room.endedBody, "The Session has ended. You can return to the lesson and continue learning.");
  assert.equal(en.studyGroupsPage.room.chatPlaceholder, "Type your message or @AI Tutor...");
  assert.equal(zh.studyGroupsPage.room.chatPlaceholder, "输入消息或 @AI Tutor...");
  assert.equal(en.studyGroupsPage.room.tutorName, "AI Tutor");
  assert.equal(fill(en.studyGroupsPage.room.groupStudy, { count: 45 }), "45-minute Group Study");
  assert.equal(fill(en.studyGroupsPage.room.liveClock, { time: "32:18" }), "● Live 32:18");
  assert.equal(fill(zh.studyGroupsPage.room.groupStudy, { count: 45 }), "45 分钟学习小组");
  assert.equal(fill(zh.studyGroupsPage.room.liveClock, { time: "32:18" }), "● 直播中 32:18");
  const room = readFileSync(new URL("../../components/portal/StudySessionRoom.tsx", import.meta.url), "utf8");
  assert.match(room, /elapsedClock\(session\.startedAt\)/);
  assert.match(room, /group\?\.title \|\| session\.title/);
  assert.match(room, /roomCopy\.groupStudy/);
  assert.match(room, /roomCopy\.liveClock/);
  assert.match(room, /styles\.stageHead/);
  assert.match(room, /styles\.coursePill/);
  assert.match(room, /styles\.speakingPill/);
  assert.match(room, /TileMic status=\{participantStatus\(tile\)\}/);
  assert.match(room, /styles\.tileMic/);
  assert.match(room, /styles\.leaveControl/);
  assert.match(room, /styles\.endMark/);
  assert.match(room, /styles\.endTitle/);
  assert.match(room, /styles\.chatHead/);
  assert.match(room, /roomCopy\.tutorName/);
  assert.match(room, /aria-label=\{roomCopy\.send\}/);
  assert.match(room, /roomCopy\.crumbHome/);
  assert.match(room, /study-groups\?group=/);
  assert.equal(en.studyGroupsPage.room.crumbHome, "Home");
  assert.equal(zh.studyGroupsPage.room.crumbGroups, "学习小组");
  const app = readFileSync(new URL("../../components/portal/StudyGroupsApp.tsx", import.meta.url), "utf8");
  assert.match(app, /session\.state === "live" \? "liveNow"/);
  assert.match(app, /studyGroupIdFromQuery\(window\.location\.search\)/);
});

test("the Host starts from the session controls instead of waiting in the member flow", () => {
  const app = readFileSync(new URL("../../components/portal/StudyGroupsApp.tsx", import.meta.url), "utf8");
  assert.match(app, /session\.state === "live" \|\| \(session\.state === "starting_soon" && selected\.role !== "host"\)/);
  const room = readFileSync(new URL("../../components/portal/StudySessionRoom.tsx", import.meta.url), "utf8");
  assert.match(room, /group\?\.role === "host" \? copy\.hostWaiting : copy\.waiting/);
  assert.equal(en.studyGroupsPage.hostWaiting, "You are the Host. Start the session when you are ready.");
  assert.equal(zh.studyGroupsPage.hostWaiting, "你是本节主持人，准备好后点击开始。");
});

test("the active navigation underline tracks the active link instead of a fixed offset", () => {
  const css = readFileSync(new URL("../../components/portal/study-groups.module.css", import.meta.url), "utf8");
  assert.equal(css.includes("left: 338px"), false);
  assert.equal(css.includes(".mark"), false);
  assert.match(css, /\.nav a \{[^}]*position: relative[^}]*\}/);
  assert.match(css, /\.nav a\.active::after \{[^}]*left: 0;[^}]*right: 0;[^}]*bottom: 0;[^}]*\}/);
  const header = readFileSync(new URL("../../components/portal/StudyGroupHeader.tsx", import.meta.url), "utf8");
  assert.equal(header.includes("styles.mark"), false);
  assert.equal(header.includes('className="active"'), false);
  assert.match(header, /className=\{styles\.active\} href=\{`\/\$\{locale\}\/portal\/study-groups`\}/);
  // Design source (LG-YL · Study_Group_UIFinal header): nav starts at x=252 with the
  // brand text ending at 219 (margin 33px); the active label (599:25) and its 4px bar
  // (599:42, 95x4 at 338,64) are #155dfc.
  assert.match(css, /\.nav \{[^}]*margin-left: 33px[^}]*\}/);
  assert.match(css, /\.nav a\.active \{ color: #155dfc; font-weight: 700[^}]*\}/);
  assert.match(css, /\.nav a\.active::after \{[^}]*background: #155dfc[^}]*\}/);
});

test("the join gate call-to-action centres its label for the sign-in link", () => {
  const css = readFileSync(new URL("../../components/portal/study-groups.module.css", import.meta.url), "utf8");
  assert.match(css, /\n\.primary \{[^}]*display: inline-flex;[^}]*align-items: center;[^}]*justify-content: center;[^}]*text-decoration: none;[^}]*\}/);
  const app = readFileSync(new URL("../../components/portal/StudyGroupsApp.tsx", import.meta.url), "utf8");
  assert.match(app, /<a className=\{styles\.primary\} href=\{gate\.action === "get-course" \?/);
});

test("the final design tokens pin the join gate, session chips, and secondary buttons", () => {
  // LG-YL / Study_Group_UIFinal (page 599:2), 1440x1024 frames.
  const css = readFileSync(new URL("../../components/portal/study-groups.module.css", import.meta.url), "utf8");
  assert.match(css, /\.tools \{[^}]*gap: 20px[^}]*\}/); // 599:930 header EN/bell/avatar gaps
  assert.match(css, /\.sheet \{ display: grid; grid-template-columns: minmax\(0, 1fr\) 230px; gap: 30px;[^}]*padding: 8px 8px 30px 30px/); // 599:930 article 510..1152, Detail Side 1182..1412
  assert.match(css, /\.sheet > article \{ margin-top: 22px; \}/);
  assert.match(css, /\.memberCol \{[^}]*padding: 20px[^}]*\}/);
  assert.match(css, /\.hostFoot \{ margin: auto -20px 0/);
  assert.match(css, /\.hostFoot p \{[^}]*text-align: center[^}]*\}/); // 599:770 hosting note
  assert.match(css, /\.joinAction \.primary \{ min-width: 230px; height: 36px; font-size: 12px; \}/); // 599:1035 CTA 230x36, 599:1036 12px SemiBold
  assert.match(css, /\.sessionState\[data-state="scheduled"\] \{[^}]*background: #e0f5e5;[^}]*color: #26ad61/); // 599:685 Upcoming badge
  assert.match(css, /\.sessionState\[data-state="live"\], \.sessionState\[data-state="starting_soon"\] \{[^}]*background: rgba\(245,70,73,\.2\)/); // 599:702 Live now badge
  assert.match(css, /\.reminderHint \{[^}]*background: #fff9f1[^}]*\}/); // 599:721 reminder pill
  assert.match(css, /\.planningTag \{[^}]*border-radius: 4px;[^}]*background: #eef9f3[^}]*\}/); // 599:744 r4 pill
  assert.match(css, /\.endCard \{ width: min\(640px, 100%\)/); // 599:1398 card 433..1072
  assert.match(css, /\.endCard h1 \{ font-size: 28px; font-weight: 700; color: #000; \}/); // 599:1448 h1 28px/700 #000
  assert.match(css, /\.endCard \.primary \{ min-width: 152px; height: 36px; font-size: 12px; \}/); // 599:1455
  assert.match(css, /\.ghost \{[^}]*color: #111827[^}]*\}/); // 599:627 Button/Edit Group label
  assert.match(css, /\.signInLink \{[^}]*color: #4a5565[^}]*\}/); // 599:971 header Sign In variant
  assert.match(css, /\.live \{ position: absolute; top: 8px; right: 8px/); // 599:44 sidebar Live chip inset
  assert.match(css, /\.joined \{ background: #d1f1dd; color: #16a34a; \}/); // 599:47 sidebar Joined chip text #16a34a
  assert.match(css, /\.empty \{[^}]*padding-top: 130px; \}/); // 599:8 rhythm: title 218, art 395, h2 573, body 614
  assert.match(css, /\.empty img \{ width: 250px; height: 150px; margin-top: 160px/);
  assert.match(css, /\.joinBanner \{[^}]*margin: 0 0 12px;[^}]*\}/);
  assert.match(css, /\.locked \{ position: relative; height: 175px; background: #fff; border: 1px solid #e4e7ec; border-radius: 8px/); // 599:932 Rectangle 112 642x175 r8
  assert.match(css, /\.lockedAvatars i \{ width: 26px; height: 26px;[^}]*background: #ebedf2/);
  assert.match(css, /\.session \{ display: grid; grid-template-columns: minmax\(0, 1fr\) 152px; column-gap: 16px; align-items: center;[^}]*padding: 16px 25px 16px 16px/); // 599:315 action column
  assert.match(css, /\.row \{ display: flex; flex-direction: column; align-items: stretch; gap: 8px; \}/);
  assert.match(css, /\.modal \.waitingBanner \{[^}]*border: 1px solid #1d6bff;[^}]*background: #f1f7ff;/); // 599:752
  assert.match(css, /\.waitingFacts \{[^}]*background: #fbfbfb;[^}]*border: 1px solid #e4e7ec;[^}]*border-radius: 8px/); // 599:751
  assert.match(css, /\.createdPanel \{ width: min\(450px, 100%\); display: grid; justify-items: center; gap: 12px; text-align: center; \}/); // BUG-0097 success page: 450px card on the panel flow
  assert.equal(css.includes(".createdToast"), false);
  assert.match(css, /\.controls button \{ flex-direction: column;[^}]*min-height: 51px;[^}]*font-weight: 500; color: rgba\(0,0,0,\.4\); background: #fbfbfb/); // 599:1210-1234 51px #fbfbfb 12px Medium black/40
  assert.match(css, /\.controls \.shareControl svg \{ color: #f54649; \}/);
  assert.match(css, /\.chatForm \{ position: relative; display: block; min-height: 100px;[^}]*border: 1px solid #e4e7ed; border-radius: 8px/); // 599:1392 266x100 r8 #e4e7ed
  assert.match(css, /\.sendButton \{ position: absolute; right: 4px; bottom: 4px; width: 24px; height: 24px/); // 599:1394 24x24 inset 4/4
  assert.match(css, /\.participantBadge \{ width: 16px; height: 16px;/); // 599:1224-29 16x16 badge beside the 16px icon
  assert.match(css, /\.divider \{ display: inline-block; width: 1px; height: 10px; background: #d0d5dd/); // 599:503/475/516/1454 divider rules
  assert.match(css, /\.crumb \{[^}]*font-weight: 400; color: #7c7c7c; \}/); // 599:1156 breadcrumb items
  assert.match(css, /\.crumbChevron \{ width: 12px; height: 12px/); // 599:1157/1160/1163 chevrons
  assert.match(css, /\.joinNote \{[^}]*margin: 40px 0 20px/); // 599:930/1457 cards->note 40, note->CTA 20
  assert.match(css, /\.endMark \{ width: 60px; height: 60px;[^}]*background: #f6f9fd; color: #1d6bff;[^}]*font-size: 32px/); // 599:1445
  assert.match(css, /\.meta \{ display: inline-flex; align-items: center; gap: 8px; \}/); // 599:1454 end-card meta divider
  assert.match(css, /\.sessionState\[data-state="scheduled"\] \{ padding: 4px 10px;/); // 599:685 px-10
  const app = readFileSync(new URL("../../components/portal/StudyGroupsApp.tsx", import.meta.url), "utf8");
  assert.match(app, /styles\.planningTag/);
  assert.match(app, /session\.viewerPlanned \? <p className=\{styles\.planningTag\}>\{copy\.planning\}<\/p> : null/); // 599:744 pill sits in the card body at rel(16,133)
  assert.match(app, /<FactIcon kind="date" \/>\{sessionDateLabel\(locale, session\.startsAt\)\}<span className=\{styles\.divider\} aria-hidden="true" \/>\{sessionTimeLabel\(locale, session\)\}/); // 599:693-4 date | time one row
  assert.match(app, /styles\.hostFoot\}><button className=\{styles\.ghost\} type="button"/); // member Leave Study Group sits in the Members column
  assert.match(app, /study-groups\/\$\{selected\.id\}\/leave/);
  assert.match(app, /<LockedCard \/>/); // 599:930 skeletons keep fact rows + avatar row
  assert.match(app, /styles\.createdPanel/); // BUG-0097 success state takes the whole panel over
  assert.equal(app.includes('className={styles.created}'), false);
  assert.equal(app.includes("waitingSession.occupancy"), false); // 599:531 shows no occupancy line
  assert.equal(app.includes('dialog === "waiting" ? <button'), false); // 599:531 has no footer action
  const room = readFileSync(new URL("../../components/portal/StudySessionRoom.tsx", import.meta.url), "utf8");
  assert.match(room, /line\.tutor \? null : <time dateTime=\{line\.at\}>/); // 599:1276 tutor line has no timestamp
  assert.match(room, /roomCopy\.crumbGroupInfo/);
  assert.match(room, /roomCopy\.crumbSession/);
  assert.match(room, /CrumbChevron/); // 599:1117 breadcrumb chevron separators
  assert.match(room, /styles\.divider\} aria-hidden="true" \/>\{fill\(roomCopy\.groupStudy/); // 599:1454 end-card meta divider
  assert.match(room, /styles\.shareControl/);
  assert.match(room, /styles\.controlGlyph/);
  // both locales carry the design copy and the new breadcrumb keys
  assert.equal(en.studyGroupsPage.room.crumbGroups, "Study Group");
  assert.equal(en.studyGroupsPage.room.crumbGroupInfo, "Study Group Info");
  assert.equal(en.studyGroupsPage.room.crumbSession, "Session");
  assert.equal(zh.studyGroupsPage.room.crumbGroups, "学习小组");
  assert.equal(zh.studyGroupsPage.room.crumbGroupInfo, "学习小组信息");
  assert.equal(zh.studyGroupsPage.room.crumbSession, "直播课");
  assert.equal(en.portal.signIn, "Sign In");
  assert.equal(zh.portal.signIn, "登录");
});

test("the retained create form cannot submit twice while the request is in flight", () => {
  const app = readFileSync(new URL("../../components/portal/StudyGroupsApp.tsx", import.meta.url), "utf8");
  assert.match(app, /const \[creating, setCreating\] = useState\(false\)/);
  assert.match(app, /if \(creating\) return;/);
  assert.match(app, /type="submit" disabled=\{creating \|\| noCourseAccess\}/);
  // QA M26: Cancel cannot close the dialog under a request still in flight either.
  assert.match(app, /onClick=\{closeDialog\} disabled=\{creating\}>\{copy\.cancel\}/);
  const css = readFileSync(new URL("../../components/portal/study-groups.module.css", import.meta.url), "utf8");
  assert.match(css, /\.sessionBody \{ min-width: 0;[^}]*\}/);
});

test("the live stage is a 2x2 tile grid and the chat follows 599:1276 with tutor modes", () => {
  // 599:1117: equal 7:4 tiles, ~10px gaps, left-aligned 2x2 grid; a single
  // participant keeps one standard 490px tile instead of a stretched strip.
  const css = readFileSync(new URL("../../components/portal/study-groups.module.css", import.meta.url), "utf8");
  assert.match(css, /\.videos \{ display: grid; grid-template-columns: repeat\(2, minmax\(0, 1fr\)\); gap: 10px; max-width: 990px; \}/);
  assert.match(css, /\.videosSingle \{ grid-template-columns: minmax\(0, 490px\); justify-content: center; \}/);
  assert.match(css, /\.tile \{ position: relative; overflow: hidden; aspect-ratio: 7 \/ 4; min-height: 0;/);
  assert.match(css, /\.room \{[^}]*align-items: start;[^}]*\}/);
  // 599:1276: chat body is flush-left across the whole column at 13px, the
  // tutor avatar is 20px, and the tutor name is #111827 instead of blue.
  assert.match(css, /\.chatBody \{ margin: 4px 0 0; color: #344054; font-size: 13px; \}/);
  assert.equal(css.includes("margin: 4px 0 0 36px"), false);
  assert.match(css, /\.tutorAvatar \{ width: 20px; height: 20px; border-radius: 10px;[^}]*font-size: 11px; \}/);
  assert.match(css, /\.tutorName \{ color: #111827; \}/);
  assert.match(css, /\.tutorBody \{ color: #1d6bff; \}/);
  assert.match(css, /\.tutorLead \{ color: #111827; \}/);
  assert.match(css, /\.tutorDisclosure \{ color: #9a3412; font-size: 12px; font-weight: 600; \}/);

  const room = readFileSync(new URL("../../components/portal/StudySessionRoom.tsx", import.meta.url), "utf8");
  assert.match(room, /mode\?: "course" \| "general" \| "unavailable"/);
  // The forged-tutor fix moved the dispatch (and the mode normalisation plus the
  // empty-text "unavailable" contract) into the pure room-data parser; the room
  // now hands it the payload and renders what the parser returns.
  assert.match(room, /parseRoomDataMessage\(data\.payload, data\.fromServer\)/);
  const roomData = readFileSync(new URL("../../modules/group-study/roomData.ts", import.meta.url), "utf8");
  assert.match(roomData, /if \(!message\.text && message\.mode !== "unavailable"\) return null;/);
  assert.match(roomData, /mode: message\.mode === "general" \|\| message\.mode === "unavailable" \? message\.mode : "course"/);
  assert.match(room, /line\.mode === "unavailable"\s*\?\s*roomCopy\.tutorUnavailable/);
  assert.match(room, /line\.mode === "general" \? <span className=\{styles\.tutorDisclosure\}>\{roomCopy\.tutorGeneral\}<\/span>/);
  assert.match(room, /index === 0\s*\?\s*<strong key="lead" className=\{styles\.tutorLead\}>\{row\}<\/strong>/);
  assert.match(room, /<span key=\{index\} className=\{styles\.tutorRow\}>\{row\}<\/span>/);
  assert.match(room, /line\.text\.split\("\\n"\)\.filter\(\(row\) => row\.trim\(\)\)/);

  assert.equal(en.studyGroupsPage.room.tutorGeneral, "Not covered in the course material — a general answer:");
  assert.equal(en.studyGroupsPage.room.tutorUnavailable, "AI Tutor is temporarily unavailable. Please try again.");
  assert.equal(zh.studyGroupsPage.room.tutorGeneral, "课程材料未覆盖此内容，以下为一般性解答。");
  assert.equal(zh.studyGroupsPage.room.tutorUnavailable, "AI Tutor 暂时不可用，请稍后重试。");
});

test("the Host Control frame pins the placeholder tile, name strip, hand badge, and centred controls", () => {
  // GS / 10 Live Session - Host Control: camera-off tiles are light grey with a
  // centred grey person, the caption is a full-width strip, and the control
  // group (Leave Session included) is centred on the stage.
  const css = readFileSync(new URL("../../components/portal/study-groups.module.css", import.meta.url), "utf8");
  assert.match(css, /\.tile\[data-video="off"\] \{ background: #f2f4f7; \}/);
  assert.match(css, /\.tile \.tilePlaceholder \{ position: absolute; inset: 0; display: grid; place-items: center; \}/);
  assert.match(css, /\.tilePlaceholder i \{ width: 90px; height: 90px; border-radius: 45px; background: #e4e7ec; color: #98a2b3;/);
  assert.match(css, /\.tile \.tileCaption \{ position: absolute; left: 0; right: 0; bottom: 0; z-index: 1; display: flex; align-items: center; justify-content: space-between; gap: 8px; background: rgba\(17, 24, 39, \.55\); padding: 6px 12px; \}/);
  assert.match(css, /\.tile \.speakingDot \{ display: inline-block; width: 6px; height: 6px; margin-left: 6px; border-radius: 3px; background: #4ade80;/);
  assert.match(css, /\.tile \.tileHand \{ position: absolute; top: 8px; right: 8px; z-index: 2;/);
  // 599:1117 renders the host suffix in caps ("Anna Williams · HOST").
  assert.match(css, /\.tile \.tileHost \{ text-transform: uppercase; \}/);
  assert.match(css, /\.tile \.tileMic\[data-status="muted"\] \{ background: #f54649; color: #fff; \}/);
  assert.match(css, /\.controls \{ display: flex; flex-wrap: wrap; gap: 10px; align-items: center; justify-content: center; margin-top: 16px; \}/);
  assert.equal(/\.controls \.leaveControl \{[^}]*margin-left/.test(css), false);

  const room = readFileSync(new URL("../../components/portal/StudySessionRoom.tsx", import.meta.url), "utf8");
  assert.match(room, /const camera = cameraTracks\[tile\.identity\] \?\? null;/);
  assert.match(room, /data-video=\{camera \? "on" : "off"\}/);
  assert.match(room, /<span className=\{styles\.tilePlaceholder\} aria-hidden="true"><i><PersonGlyph \/><\/i><\/span>/);
  assert.match(room, /hands\.includes\(tile\.identity\) \? <span className=\{styles\.tileHand\} role="img" aria-label=\{roomCopy\.raiseHand\}>✋<\/span> : null/);
  assert.equal(room.includes('" · " + roomCopy.raiseHand'), false); // the caption no longer carries a Raise Hand suffix
  assert.match(room, /\{tile\.speaking \? <i className=\{styles\.speakingDot\} aria-hidden="true" \/> : null\}/);
  assert.match(room, /\{tile\.host \? <span className=\{styles\.tileHost\}> · \{roomCopy\.host\}<\/span> : ""\}/);
  // The focus line moved from under the title to directly above the controls.
  assert.match(room, /\{session\.focus \? <p>\{session\.focus\}<\/p> : null\}\s*<div className=\{styles\.controls\}>/);
  // One banner at a time: a reconnect in progress, then the error with its
  // retry. A poll that says this page may not stay (signed out, no longer a
  // member) replaces the room with its own page instead (QA M17).
  assert.match(room, /<\/div>\s*\{reconnecting \? <p className=\{styles\.alert\}/);
  assert.match(room, /\{!reconnecting && errorText \? /);
  assert.match(room, /if \(accessLost\) return <>\{path\(\)\}\{gate\(pollError\)\}<\/>;/);
});

test("typing @ in the chat opens a mention list for AI Tutor and the present members", () => {
  const css = readFileSync(new URL("../../components/portal/study-groups.module.css", import.meta.url), "utf8");
  assert.match(css, /\.chatForm input::placeholder \{ color: #98a2b3; \}/);
  assert.match(css, /\.mentionMenu \{ position: absolute; left: 0; right: 0; bottom: calc\(100% \+ 6px\);[^}]*background: #fff;[^}]*border-radius: 10px;[^}]*box-shadow: 0 10px 24px rgba\(16, 24, 40, \.14\); \}/);
  assert.match(css, /\.mentionMenu button \{ display: flex; align-items: center; gap: 8px; width: 100%; min-height: 36px;[^}]*\}/);
  assert.match(css, /\.mentionMenu button:hover, \.mentionMenu button\[aria-selected="true"\] \{ background: #f5f7fa; \}/);

  const room = readFileSync(new URL("../../components/portal/StudySessionRoom.tsx", import.meta.url), "utf8");
  // "@" opens the list only at the start of the draft or after a space.
  assert.match(room, /const at = upToCaret\.lastIndexOf\("@"\);/);
  assert.match(room, /if \(at < 0 \|\| \(at > 0 && upToCaret\[at - 1\] !== " "\)\) \{/);
  assert.match(room, /setMention\(\{ start: at, query: upToCaret\.slice\(at \+ 1\), index: 0 \}\);/);
  // Candidates: AI Tutor first (only when enabled), members in roster order,
  // deduplicated, without the local participant, prefix-filtered, capped at 6.
  assert.match(room, /session\.aiTutorEnabled \? \[\{ key: "tutor", name: roomCopy\.tutorName, tutor: true \}\] : \[\]/);
  assert.match(room, /person\.key === roomApi\?\.localParticipant\.identity \|\| seenNames\.has\(person\.name\)/);
  assert.match(room, /row\.name\.toLowerCase\(\)\.startsWith\(fragment\)/);
  assert.match(room, /if \(mentionRows\.length === 6\) break;/);
  // Rendering: white card listbox above the input, star avatar for AI Tutor.
  assert.match(room, /styles\.mentionMenu\} role="listbox" aria-label=\{roomCopy\.mentionList\}/);
  assert.match(room, /role="option" aria-selected=\{index === mentionIndex\}/);
  assert.match(room, /row\.tutor \? styles\.tutorAvatar : styles\.rosterInitial/);
  // Picking replaces the "@fragment" with "@name ", returns focus, and marks the tutor switch.
  assert.match(room, /const next = `\$\{draft\.slice\(0, mention\.start\)\}@\$\{row\.name\} \$\{draft\.slice\(mention\.start \+ 1 \+ mention\.query\.length\)\}`;/);
  assert.match(room, /caretRef\.current = mention\.start \+ row\.name\.length \+ 2;/);
  assert.match(room, /input\.setSelectionRange\(caretRef\.current, caretRef\.current\)/);
  assert.match(room, /if \(row\.tutor\) setAddressTutor\(true\);/);
  assert.match(room, /onMouseDown=\{\(event\) => \{ event\.preventDefault\(\); chooseMention\(row\); \}\}/);
  // Keyboard: arrows move, Escape closes, Enter selects instead of sending.
  assert.match(room, /if \(!mention \|\| mentionRows\.length === 0\) return;/);
  // IME composition (Chinese/Japanese input) must not lose Enter/Escape/arrows to the popup.
  assert.match(room, /if \(event\.nativeEvent\.isComposing \|\| event\.keyCode === 229\) return;/);
  assert.match(room, /event\.key === "ArrowDown"/);
  assert.match(room, /event\.key === "ArrowUp"/);
  assert.match(room, /event\.key === "Escape"/);
  assert.match(room, /event\.key === "Enter"\) \{ event\.preventDefault\(\); chooseMention\(mentionRows\[mentionIndex\]\); \}/);
  // Submission: a typed "@AI Tutor " prefix queues the body without the prefix.
  assert.match(room, /const mentionsTutor = \(addressTutor \|\| hasPrefix\) && session\.aiTutorEnabled/);
  assert.match(room, /askTutor\(line\.id, \{ question: \(hasPrefix \? text\.slice\(prefix\.length\) : text\)\.trim\(\), clientEventId: tutorClientEventId\(\) \}\)/);
  assert.match(room, /JSON\.stringify\(tutorQueueBody\(ask\.question, ask\.clientEventId\)\)/);

  assert.equal(en.studyGroupsPage.room.mentionList, "Mention AI Tutor or a participant");
  assert.equal(zh.studyGroupsPage.room.mentionList, "提及 AI Tutor 或参与者");
});

test("the Live Session end card follows 599:1398 and its CTA never overlaps the meta row", () => {
  const css = readFileSync(new URL("../../components/portal/study-groups.module.css", import.meta.url), "utf8");
  // The CTA moved into its own centred block row: as an inline element after
  // the inline-flex meta line it shared that line and collided with it.
  assert.match(css, /\.endActions \{ display: flex; justify-content: center; margin-top: 28px; \}/);
  assert.match(css, /\.endCard h1 \{ margin: 0 0 18px; \}/);
  assert.match(css, /\.endCard \.meta \{ display: flex; justify-content: center; margin: 4px 0 0; color: #000; \}/);
  assert.match(css, /\.endCard \.endBody \{ margin: 0; color: rgba\(0, 0, 0, \.4\); font-size: 14px; line-height: 17px; \}/);
  assert.match(css, /\.endCard \.meta \+ \.endBody \{ margin-top: 48px; \}/);
  // Narrow screens reset the desktop-only offsets so the card cannot overflow.
  assert.match(css, /@media \(max-width: 800px\) \{[\s\S]*\.endCard \{ margin: -35px auto 0; \}[\s\S]*\}/);
  assert.match(css, /@media \(max-width: 800px\) \{[\s\S]*\.hostFootWithCopy \{ margin-bottom: 0; \}[\s\S]*\}/);

  const room = readFileSync(new URL("../../components/portal/StudySessionRoom.tsx", import.meta.url), "utf8");
  // 599:1398 shows no focus row in the end card; only the live stage keeps one.
  assert.equal(room.split("{session.focus ? <p>{session.focus}</p> : null}").length - 1, 1);
  assert.match(room, /endedParts\(roomCopy\.endedBody\)\.map\(\(line\) => <p className=\{styles\.endBody\} key=\{line\}>\{line\}<\/p>\)/);
  assert.match(room, /<div className=\{styles\.endActions\}>\{!ended && session\.state === "live" \? <button className=\{styles\.primary\} type="button" onClick=\{rejoin\}>\{roomCopy\.rejoin\}<\/button> : null\}<a className=\{styles\.primary\} href=\{group \?/);
});

test(":has() is gone from the stylesheet and the single-tile layout is a plain class", () => {
  // Legacy-browser safety: the layout hooks are rendered in JSX instead of :has().
  const css = readFileSync(new URL("../../components/portal/study-groups.module.css", import.meta.url), "utf8");
  assert.equal(css.includes(":has("), false);
  assert.match(css, /\.videosSingle \{ grid-template-columns: minmax\(0, 490px\); justify-content: center; \}/);
  assert.match(css, /\.hostFootWithCopy \{ margin-bottom: -42px; \}/);
  const room = readFileSync(new URL("../../components/portal/StudySessionRoom.tsx", import.meta.url), "utf8");
  assert.match(room, /\$\{styles\.videos\}\$\{tiles\.length <= 1 \? ` \$\{styles\.videosSingle\}` : ""\}/);
  const app = readFileSync(new URL("../../components/portal/StudyGroupsApp.tsx", import.meta.url), "utf8");
  assert.match(app, /selected\.role === "host" \? <div className=\{`\$\{styles\.hostFoot\} \$\{styles\.hostFootWithCopy\}`\}><p>\{copy\.hostingNote\}<\/p>/);
});

test("creating a group hands the whole panel to the success state and reopening Create is clean", () => {
  const app = readFileSync(new URL("../../components/portal/StudyGroupsApp.tsx", import.meta.url), "utf8");
  // BUG-0097: success closes the create dialog, clears any stale error and the form
  // values, and refreshes the lists; the panel then shows only the created state.
  assert.match(app, /setCreatedGroup\(\{ id: result\.data\.id, title: result\.data\.title, courseTitle: result\.data\.courseTitle \}\);\s*setDialog\(null\);\s*setErrorCode\("idle"\);\s*setCreateTitle\(""\);\s*setCreateAbout\(""\);\s*await loadLists\(\);/);
  // The empty pane and the group sheet step aside while the success state owns the panel.
  assert.match(app, /pane\.kind === "empty" && !selectedId && dialog !== "create" && !createdGroup/);
  assert.match(app, /dialog !== "create" && !createdGroup \? \(/);
  assert.match(app, /className=\{`\$\{styles\.panel\} \$\{styles\.createdPanel\}`\} role="status"/);
  assert.match(app, /copy\.createdTitle/);
  // QA M26: the card names the new group and its Course (PRD GS-CREATE-006).
  assert.match(app, /<span className=\{styles\.createdName\}>\{createdGroup\.title\}<\/span><span className=\{styles\.createdBody\}>\{createdGroup\.courseTitle\}<\/span>/);
  assert.match(app, /copy\.openGroup/);
  // Opening a group from the sidebar while the success state is showing resolves that state.
  assert.match(app, /openGroupId\.current = id;\s*setSelectedId\(id\);\s*showGroupInAddress\(id\);\s*setCreatedGroup\(null\);/);
  // BUG-0110: closing the success page resets the form and errorCode, so the next
  // Create dialog opens clean and the same name cannot be resubmitted by accident.
  assert.match(app, /const id = createdGroup\.id; setCreatedGroup\(null\); setErrorCode\("idle"\); setCreateTitle\(""\); setCreateAbout\(""\); void openGroup\(id\);/);
  assert.match(app, /setCreatedGroup\(null\); setCreateTitle\(""\); setCreateAbout\(""\); setErrorCode\("idle"\); setDialog\("create"\);/);
});

test("identical reminder messages render as one row on the Study Groups sidebar", () => {
  // BUG-0100 (screenshot): the sidebar rendered two identical "这个学习小组已经不再可用。"
  // rows because the reminder list carried the same body twice. The list view collapses
  // identical bodies, keeping the first (newest) entry; distinct bodies are untouched.
  const reminders = [
    { body: "这个学习小组已经不再可用。", createdAt: "2026-10-14T10:00:00.000Z" },
    { body: "这个学习小组已经不再可用。", createdAt: "2026-10-14T10:00:00.000Z" },
    { body: "Life of Horace starts in 10 minutes.", createdAt: "2026-10-14T09:50:00.000Z" }
  ];
  assert.deepEqual(uniqueReminderBodies(reminders), [reminders[0], reminders[2]]);
  assert.deepEqual(uniqueReminderBodies([]), []);
  assert.deepEqual(uniqueReminderBodies([{ body: "One" }, { body: "Two" }, { body: "One" }]), [{ body: "One" }, { body: "Two" }]);
  const app = readFileSync(new URL("../../components/portal/StudyGroupsApp.tsx", import.meta.url), "utf8");
  assert.match(app, /if \(reminderResult\.ok\) setReminders\(uniqueReminderBodies\(reminderResult\.data\)\);/);
  assert.match(app, /<ul className=\{styles\.reminders\}>\{reminders\.map\(\(item\) => <li role="status" key=\{`\$\{item\.createdAt\}-\$\{item\.body\}`\}>\{item\.body\}<\/li>\)\}<\/ul>/);
});

test("one error is shown in exactly one place: the failing pane, create form, dialog, or sheet", () => {
  assert.equal(studyGroupErrorPlace({ status: "error", dialog: null, hasSelected: false, hasError: true }), "pane");
  assert.equal(studyGroupErrorPlace({ status: "ready", dialog: "create", hasSelected: false, hasError: true }), "create");
  assert.equal(studyGroupErrorPlace({ status: "ready", dialog: "schedule", hasSelected: true, hasError: true }), "dialog");
  assert.equal(studyGroupErrorPlace({ status: "ready", dialog: "edit-session", hasSelected: true, hasError: true }), "dialog");
  assert.equal(studyGroupErrorPlace({ status: "ready", dialog: "edit", hasSelected: true, hasError: true }), "dialog");
  assert.equal(studyGroupErrorPlace({ status: "ready", dialog: null, hasSelected: true, hasError: true }), "sheet");
  assert.equal(studyGroupErrorPlace({ status: "ready", dialog: "waiting", hasSelected: true, hasError: true }), "sheet");
  assert.equal(studyGroupErrorPlace({ status: "ready", dialog: "edit", hasSelected: true, hasError: false }), "none");
  assert.equal(studyGroupErrorPlace({ status: "loading", dialog: null, hasSelected: false, hasError: true }), "none");
  // The reported duplicate: the schedule dialog rendered its own alert while the group
  // sheet behind it rendered the same message again. The dialog slot suppresses the
  // sheet copy, and a failed pane owns the screen over any dialog slot.
  assert.notEqual(studyGroupErrorPlace({ status: "ready", dialog: "schedule", hasSelected: true, hasError: true }), "sheet");
  assert.notEqual(studyGroupErrorPlace({ status: "error", dialog: "edit", hasSelected: true, hasError: true }), "dialog");

  const app = readFileSync(new URL("../../components/portal/StudyGroupsApp.tsx", import.meta.url), "utf8");
  assert.match(app, /const errorPlace = studyGroupErrorPlace\(\{ status, dialog, hasSelected: Boolean\(selected\), hasError: studyGroupHasError\(errorCode\) \}\);/);
  // create form, sheet, the form dialogs and the confirm dialogs (one slot each, never two at once).
  assert.equal(app.split('{errorPlace === "').length - 1, 4);
  assert.match(app, /\{errorPlace === "create" \? <p className=\{styles\.alert\} role="alert">\{errorText\}<\/p> : null\}/);
  assert.match(app, /\{errorPlace === "sheet" \? <p className=\{styles\.alert\} role="alert">\{errorText\}<\/p> : null\}/);
  assert.match(app, /\{errorPlace === "dialog" \? <p className=\{styles\.alert\} role="alert">\{errorText\}<\/p> : null\}/);
  assert.equal(app.includes('dialog !== "waiting" && dialog !== "attendees"'), false); // superseded by the dialog slot
  // Dismissing any dialog retires its error so the same message cannot reappear in the sheet.
  assert.match(app, /function closeDialog\(\) \{\s*setErrorCode\("idle"\);\s*setDialog\(null\);\s*\}/);
  assert.match(app, /onClick=\{closeDialog\}/);
  // Retry clears the stale code before reloading: a recovered list must not leave a ghost alert.
  assert.match(app, /onClick=\{\(\) => \{ setErrorCode\("idle"\); void loadLists\(\); \}\}>\{copy\.retry\}/);
});

test("the waiting dialog offers a Close control that releases the hold without breaking the enter flow", () => {
  const app = readFileSync(new URL("../../components/portal/StudyGroupsApp.tsx", import.meta.url), "utf8");
  // BUG-0107: the join/waiting popup had no way out; it now carries a Close button.
  assert.match(app, /function closeWaiting\(\) \{\s*setErrorCode\("idle"\);\s*setDialog\(null\);\s*setWaitingSession\(null\);\s*\}/);
  assert.match(app, /\) : \(\n\s*<div className=\{styles\.dialogActions\}>\n\s*<button className=\{styles\.ghost\} type="button" onClick=\{closeWaiting\}>\{copy\.close\}<\/button>\n\s*<\/div>\n\s*\)\}/);
  // The enter flow itself is untouched: the poll only follows a live waitingSession and
  // pushes into the room, so clearing it on close just stops the poll and releases the hold.
  assert.match(app, /if \(!waitingSession \|\| waitingSession\.state === "live"\) return;/);
  assert.match(app, /const step = waitingDialogStep\(result\);\s*if \(step\.kind === "keep" && result\.ok\) setWaitingSession\(result\.data\);\s*else settleWaiting\(step, sessionId\);/);
  assert.match(app, /if \(step\.kind === "open-room"\) \{\s*waitingHandedOffRef\.current = true;\s*waitingHoldRef\.current = null;\s*router\.push\(`\/\$\{locale\}\/portal\/study-groups\/sessions\/\$\{sessionId\}`\);/);
  assert.match(app, /const held = waitingHoldRef\.current;\s*if \(!held\) return;\s*waitingHoldRef\.current = null;\s*void fetch\(`\/api\/study-groups\/sessions\/\$\{held\}\/leave`/);
});

test("a successful Session mutation clears the stale errorCode so the old alert cannot linger", () => {
  const app = readFileSync(new URL("../../components/portal/StudyGroupsApp.tsx", import.meta.url), "utf8");
  // BUG-0106: after a failed attempt, a later successful Schedule Live Session kept the
  // previous errorCode, so the sheet kept re-rendering the old alert although the session
  // had been created. Every dialog submit now resets the errorCode before closing the
  // dialog and refreshing the open group.
  assert.match(app, /setErrorCode\("idle"\);\s*setDialog\(null\);\s*await openGroup\(selected\.id\);\s*\}/);
  assert.match(app, /setErrorCode\("idle"\);\s*setDialog\(null\);\s*await openGroup\(selected\.id\);\s*await loadLists\(\);/);
  assert.match(app, /setErrorCode\("idle"\);\s*setDialog\(null\);\s*setEditingSession\(null\);\s*await openGroup\(selected\.id\);/);
});

test("the Schedule dialog keeps long Study Group copy inside its context card", () => {
  const css = readFileSync(new URL("../../components/portal/study-groups.module.css", import.meta.url), "utf8");
  // BUG-0102: the context card repeats the Group title and About (up to 50/200 chars,
  // possibly one unbroken word or URL); without a wrap rule that text escaped the 540px
  // dialog. The rest of the dialog audited clean: centring comes from the shared fixed
  // overlay, the form is height-capped with internal scrolling, and the 2x2 field grid
  // stacks to one column below 800px.
  assert.match(css, /\.contextCard \{[^}]*overflow-wrap: anywhere;[^}]*\}/);
  assert.match(css, /\.modal \{ position: fixed; inset: 0;[^}]*display: grid; place-items: center; \}/);
  assert.match(css, /\.modal form \{[^}]*max-height: calc\(100vh - 48px\); overflow: auto;[^}]*\}/);
  assert.match(css, /@media \(max-width: 800px\) \{[\s\S]*\.pair[\s\S]*grid-template-columns: 1fr;/);
});

test("a long About this Study Group string wraps instead of overflowing its column", () => {
  const css = readFileSync(new URL("../../components/portal/study-groups.module.css", import.meta.url), "utf8");
  // BUG-0101: the About body sits in the second facts column (minmax(0, 1fr)); a long
  // unbroken word or URL must break inside the column instead of escaping the sheet.
  assert.match(css, /\.aboutBody \{[^}]*overflow-wrap: anywhere;[^}]*\}/);
});

test("editing a Study Group clamps About to the create form's 200 character limit", () => {
  const app = readFileSync(new URL("../../components/portal/StudyGroupsApp.tsx", import.meta.url), "utf8");
  // BUG-0116 (SIT): the Edit Group dialog's About textarea was uncontrolled
  // (defaultValue={selected?.about}) with no counter and no clamp, so text beyond the
  // create form's 200 limit rendered in full and went back to the server untouched.
  // It now mirrors the create field: controlled value clamped through the shared
  // helper, the same maxLength and the same 0/200 counter.
  assert.equal(GROUP_ABOUT_MAX, 200);
  assert.equal(clampGroupAbout("x".repeat(250)).length, GROUP_ABOUT_MAX);
  assert.equal(clampGroupAbout("short"), "short");
  assert.match(app, /const \[editAbout, setEditAbout\] = useState\(""\)/);
  assert.match(app, /function openEditGroup\(\) \{\s*setErrorCode\("idle"\);\s*setEditTitle\(\(selected\?\.title \|\| ""\)\.slice\(0, 50\)\);\s*setEditAbout\(clampGroupAbout\(selected\?\.about \|\| ""\)\);\s*setDialog\("edit"\);\s*\}/);
  assert.match(app, /onClick=\{openEditGroup\}>\{copy\.editGroup\}<\/button>/);
  assert.match(app, /<textarea name="about" required maxLength=\{GROUP_ABOUT_MAX\} placeholder=\{copy\.enterDescription\} value=\{editAbout\} onChange=\{\(event\) => setEditAbout\(clampGroupAbout\(event\.target\.value\)\)\} \/>/);
  assert.match(app, /\{editAbout\.length\}\/\{GROUP_ABOUT_MAX\}/);
  assert.equal(/<textarea name="about"[^>]*defaultValue=/.test(app), false);
  // The create form keeps the same 200 boundary through the shared helper.
  assert.match(app, /value=\{createAbout\} onChange=\{\(event\) => setCreateAbout\(clampGroupAbout\(event\.target\.value\)\)\}/);
  assert.equal((app.match(/maxLength=\{GROUP_ABOUT_MAX\}/g) || []).length, 2);
});

test("the Study Groups sidebar scrolls inside the viewport instead of stretching the page", () => {
  const css = readFileSync(new URL("../../components/portal/study-groups.module.css", import.meta.url), "utf8");
  // BUG-0129 (SIT): the sidebar had overflow:auto but no height cap, so the grid let it
  // grow card by card and the whole page stretched as Study Groups piled up. Capping it
  // to the viewport (the header is 68px tall) turns the column into its own scroll area;
  // the stacked mobile layout resets the cap so the page keeps scrolling normally there.
  assert.match(css, /\.sidebar \{ background: #fff; box-shadow: 0 1px 3px rgba\(0,0,0,\.1\), 0 1px 2px -1px rgba\(0,0,0,\.1\); padding: 32px 30px 40px; overflow: auto; max-height: calc\(100vh - 68px\); \}/);
  assert.match(css, /@media \(max-width: 800px\) \{[\s\S]*\.sidebar \{ max-height: none; \}[\s\S]*\}/);
});

test("signed-out visitors see only Discover Study Groups, without the My Study Groups controls", () => {
  const app = readFileSync(new URL("../../components/portal/StudyGroupsApp.tsx", import.meta.url), "utf8");
  // BUG-0130 (SIT): a signed-out visitor still saw the "My Study Groups" heading and the
  // All / Hosted by Me tabs above Discover, though neither can hold anything for them.
  // The whole block (heading, Create button, tabs) now renders only when signed in;
  // Discover keeps its heading and filters for everyone.
  assert.match(app, /\{signedIn \? <div className=\{styles\.sectionHead\}>\s*<h2>\{copy\.myGroups\}<\/h2>\s*<button className=\{styles\.create\}/);
  assert.match(app, /\{signedIn \? <div className=\{styles\.tabs\} role="group" aria-label=\{copy\.myGroups\}>/);
  assert.equal(app.includes("<h2 className={styles.sectionHead}>{copy.discover}</h2>"), true);
});

test("an empty Create Study Group submit reports through the app's own validation slot", () => {
  const app = readFileSync(new URL("../../components/portal/StudyGroupsApp.tsx", import.meta.url), "utf8");
  // BUG-0125 (SIT, 小智双核浏览器): submitting the empty create form surfaced the
  // browser's own bubble in the browser's UI language ("请填写此字段。" on an EN page)
  // instead of the module's localised copy. The submit button now gates the click on
  // form.checkValidity() (no native UI) and routes the failure into the existing
  // single error slot as "validation" - the same surface server rejections already use.
  // QA 2026-10-19 (BUG-0125 rest): every Study Group form is noValidate and goes through
  // one shared check (studyGroupFormProblem), so no dialog shows the browser's bubble.
  assert.match(app, /<button className=\{styles\.primary\} type="submit" disabled=\{creating \|\| noCourseAccess\}>\{copy\.create\}<\/button>/);
  // The create form and the shared edit/schedule/edit-session form.
  assert.equal(app.split("noValidate onSubmit").length - 1, 2);
  assert.equal(app.includes("reportValidity"), false);
  assert.equal(app.includes("checkValidity"), false);
  assert.equal(en.studyGroupsPage.errors.validation, "Check the required fields and try again.");
  assert.equal(zh.studyGroupsPage.errors.validation, "请检查必填项后重试。");
  assert.equal(studyGroupErrorPlace({ status: "ready", dialog: "create", hasSelected: false, hasError: studyGroupHasError("validation") }), "create");
});

test("Cancel Group confirms in the module's own dialog with cancel/confirm buttons and a busy state", () => {
  const app = readFileSync(new URL("../../components/portal/StudyGroupsApp.tsx", import.meta.url), "utf8");
  const css = readFileSync(new URL("../../components/portal/study-groups.module.css", import.meta.url), "utf8");
  // BUG-0099: the native browser confirm is gone; the module's modal carries the copy.
  assert.equal(app.includes("window.confirm(copy.confirmCancelGroup)"), false);
  assert.match(app, /const \[cancelling, setCancelling\] = useState\(false\)/);
  assert.match(app, /<button className=\{styles\.danger\} type="button" onClick=\{\(\) => setDialog\("cancel-group"\)\}>\{copy\.cancelGroup\}<\/button>/);
  assert.match(app, /async function submitCancelGroup\(\) \{\s*if \(!selected \|\| cancelling\) return;/);
  // L2: the confirm renders through the shared native modal (PortalDialog) with the module's centred overlay.
  assert.match(app, /\{dialog === "cancel-group" \? \(\n\s*<PortalDialog className=\{styles\.modal\} labelledBy="study-group-dialog-title" onClose=\{closeDialog\} busy=\{cancelling\}>/);
  assert.match(app, /<h2 id="study-group-dialog-title">\{copy\.cancelGroupConfirmTitle\}<\/h2>/);
  assert.match(app, /<p className=\{styles\.confirmBody\}>\{copy\.confirmCancelGroup\}<\/p>/);
  // BUG-0099 follow-up: the two buttons no longer both read "Cancel" (取消 / 取消小组).
  assert.match(app, /<button className=\{styles\.ghost\} type="button" onClick=\{closeDialog\} disabled=\{cancelling\}>\{copy\.confirmBack\}<\/button><button className=\{styles\.danger\} type="submit" disabled=\{cancelling\}>\{copy\.confirmCancelGroupAction\}<\/button>/);
  assert.equal(zh.studyGroupsPage.confirmBack.includes("取消"), false);
  assert.notEqual(zh.studyGroupsPage.confirmBack, zh.studyGroupsPage.confirmCancelGroupAction);
  assert.notEqual(en.studyGroupsPage.confirmBack, en.studyGroupsPage.confirmCancelGroupAction);
  // A failed cancellation keeps the sheet selected so studyGroupErrorPlace has a home for the error.
  assert.match(app, /if \(!result\.ok\) \{\s*setErrorCode\(result\.code\);\s*return;\s*\}\s*setErrorCode\("idle"\);(?:\s*\/\/[^\n]*)*\s*forgetOpenGroup\(\);\s*await loadLists\(\);/);
  assert.match(app, /function forgetOpenGroup\(\) \{\s*openGroupId\.current = null;\s*shownGroupId\.current = null;\s*setSelected\(null\);\s*setSelectedId\(null\);\s*showGroupInAddress\(null\);\s*\}/);
  assert.match(css, /\.confirmBody \{ margin: 12px 0 24px; color: #111827; font-size: 14px; line-height: 20px; \}/);
  assert.match(css, /\.dialogActions \.danger:disabled \{ opacity: \.45; cursor: not-allowed; \}/);
  assert.equal(en.studyGroupsPage.cancelGroupConfirmTitle, "Cancel this Study Group?");
  assert.equal(zh.studyGroupsPage.cancelGroupConfirmTitle, "取消这个学习小组？");
  assert.equal(en.studyGroupsPage.confirmCancelGroup, "Upcoming Live Sessions will be removed, a Live Session that is already open will end, and members will be notified.");
  assert.equal(zh.studyGroupsPage.confirmCancelGroup, "未开始的直播课会被移除，已经开始的直播课会结束，并通知成员。");
});

test("Plan, Cancel Attendance, Cancel Session, and Leave Group only advance the UI after the server confirms", () => {
  // M3: a failed mutation reports its code through the one errorCode slot and leaves
  // the sheet alone; only a successful Leave Group may clear the selected panel.
  assert.deepEqual(studyGroupMutation({ action: "plan", result: { ok: false, code: "forbidden" } }), { ok: false, errorCode: "forbidden" });
  assert.deepEqual(studyGroupMutation({ action: "cancel-attendance", result: { ok: false, code: "conflict" } }), { ok: false, errorCode: "conflict" });
  assert.deepEqual(studyGroupMutation({ action: "cancel-session", result: { ok: false, code: "forbidden" } }), { ok: false, errorCode: "forbidden" });
  assert.deepEqual(studyGroupMutation({ action: "leave", result: { ok: false, code: "error" } }), { ok: false, errorCode: "error" });
  assert.deepEqual(studyGroupMutation({ action: "plan", result: { ok: true, code: "ok" } }), { ok: true, clearSelection: false });
  assert.deepEqual(studyGroupMutation({ action: "cancel-attendance", result: { ok: true, code: "ok" } }), { ok: true, clearSelection: false });
  assert.deepEqual(studyGroupMutation({ action: "cancel-session", result: { ok: true, code: "ok" } }), { ok: true, clearSelection: false });
  assert.deepEqual(studyGroupMutation({ action: "leave", result: { ok: true, code: "ok" } }), { ok: true, clearSelection: true });

  const app = readFileSync(new URL("../../components/portal/StudyGroupsApp.tsx", import.meta.url), "utf8");
  // One guarded runner serves the three session mutations and disables its button
  // while the request is in flight (the Cancel Group cancelling pattern).
  assert.match(app, /const \[mutating, setMutating\] = useState<string \| null>\(null\)/);
  assert.match(app, /async function runSessionMutation\(action: "plan" \| "cancel-attendance" \| "cancel-session", session: StudySession\) \{\s*if \(!selected \|\| mutating\) return;/);
  assert.match(app, /disabled=\{mutating !== null\} onClick=\{\(\) => void runSessionMutation\("plan", session\)\}/);
  assert.match(app, /disabled=\{mutating !== null\} onClick=\{\(\) => void runSessionMutation\("cancel-attendance", session\)\}/);
  // Cancel Session and Leave Group ask first in the module's own confirm dialog (QA 2026-10-19).
  assert.match(app, /disabled=\{mutating !== null\} onClick=\{\(\) => \{ setErrorCode\("idle"\); setConfirmSession\(session\); setDialog\("cancel-session"\); \}\}/);
  assert.match(app, /disabled=\{mutating !== null\} onClick=\{\(\) => \{ setErrorCode\("idle"\); setDialog\("leave-group"\); \}\}/);
  assert.match(app, /if \(dialog === "leave-group"\) void runLeaveGroup\(\); else if \(confirmSession\) void runSessionMutation\("cancel-session", confirmSession\);/);
  assert.match(app, /async function runLeaveGroup\(\) \{\s*if \(!selected \|\| mutating\) return;/);
  // Every failure lands only in the shared slot; the unconditional panel wipe is gone.
  assert.equal(app.split("setErrorCode(outcome.errorCode)").length - 1, 2);
  assert.match(app, /if \(outcome\.clearSelection\) forgetOpenGroup\(\);/);
  // The silent fire-and-forget handlers are gone.
  assert.equal(app.includes("onClick={async () => { await studyGroupRequest("), false);
  assert.equal(app.includes("}); await openGroup(selected.id); }}"), false);
  // The five button labels are still rendered from copy.
  assert.match(app, /runSessionMutation\("plan", session\)\}>\{copy\.plan\}/);
  assert.match(app, /runSessionMutation\("cancel-attendance", session\)\}>\{copy\.cancelAttendance\}/);
  assert.match(app, /setDialog\("cancel-session"\); \}\}>\{copy\.cancelSession\}/);
  assert.match(app, /setDialog\("leave-group"\); \}\}>\{copy\.leaveGroup\}/);
});

test("the Create Study Group dialog is centred on the viewport like the module's other dialogs", () => {
  const app = readFileSync(new URL("../../components/portal/StudyGroupsApp.tsx", import.meta.url), "utf8");
  const css = readFileSync(new URL("../../components/portal/study-groups.module.css", import.meta.url), "utf8");
  // BUG-0096: the create form was an inline page panel (160px top margin inside the
  // column right of the 460px sidebar), so it sat below/right of the viewport centre.
  // It now renders inside the shared native modal (PortalDialog) with the same fixed, centred overlay.
  assert.match(app, /\{dialog === "create" \? \(\n\s*<PortalDialog className=\{styles\.modal\} labelledBy="study-group-dialog-title" onClose=\{closeDialog\} busy=\{creating\}>/);
  assert.match(app, /<form className=\{styles\.createForm\} noValidate onSubmit=\{\(event\) => \{ event\.preventDefault\(\); submitDialogForm\(event\.currentTarget, submitCreate\); \}\}>/);
  assert.equal(app.includes("<form className={styles.panel} onSubmit"), false);
  // Centring comes from the shared overlay: fixed full-viewport backdrop, grid centre.
  assert.match(css, /\.modal \{ position: fixed; inset: 0; width: 100vw; height: 100vh; max-width: none; max-height: none; margin: 0; border: 0; padding: 24px; background: rgba\(16, 24, 40, \.45\); display: grid; place-items: center; \}/);
  // The create card keeps the design's 760px width without the old inline page margins.
  assert.match(css, /\.modal \.createForm \{ width: min\(760px, 100%\); margin: 0; \}/);
});

test("camera and microphone buttons check permission state and surface targeted guidance", () => {
  const room = readFileSync(new URL("../../components/portal/StudySessionRoom.tsx", import.meta.url), "utf8");
  assert.match(room, /navigator\.permissions\.query\(\{ name: kind === "mic" \? "microphone" : "camera" \}\)/);
  // denied never re-prompts: skip the doomed call and point at the browser controls.
  assert.match(room, /if \(permission\.state === "denied"\) \{\s*watchMediaPermission\(permission\.status\);\s*setMediaNotice\(\{ kind, device: false \}\);\s*return;\s*\}/);
  assert.match(room, /onClick=\{\(\) => void toggleMedia\("mic", !micOn\)\}/);
  assert.match(room, /onClick=\{\(\) => void toggleMedia\("camera", !cameraOn\)\}/);
  // Failure fallback keeps the state reset; permission errors get the address-bar
  // guidance and missing/busy devices get the device guidance.
  assert.match(room, /if \(kind === "mic"\) setMicOn\(false\);\s*if \(kind === "camera"\) setCameraOn\(false\);/);
  assert.match(room, /if \(isPermissionMediaError\(error\) \|\| isDeviceMediaError\(error\)\) \{\s*watchMediaPermission\(permission\.status\);\s*setMediaNotice\(\{ kind, device: isDeviceMediaError\(error\) \}\);\s*\}/);
  assert.match(room, /name === "NotAllowedError" \|\| name === "PermissionDeniedError";/);
  assert.match(room, /name === "NotFoundError" \|\| name === "NotReadableError";/);
  // Once the browser reports the grant, the notice dismisses itself.
  assert.match(room, /if \(status\.state === "granted"\) setMediaNotice\(null\);/);
  assert.match(room, /\{mediaNotice \? <p className=\{styles\.alert\} role="alert">\{mediaNotice\.device \? roomCopy\.mediaDeviceBlocked : mediaNotice\.kind === "camera" \? roomCopy\.mediaBlockedCamera : roomCopy\.mediaBlockedMic\}/);
  assert.match(room, /onClick=\{\(\) => setMediaNotice\(null\)\}>\{copy\.close\}<\/button>/);
  assert.match(room, /permissionWatchRef\.current\.onchange = null/);

  // Browser-neutral guidance: Safari, Firefox, Windows and phone users get
  // steps that apply to them too (QA 2026-10-19 M12).
  assert.equal(en.studyGroupsPage.room.mediaBlockedCamera, "Your browser is blocking camera access for this site. Allow the camera in the browser's site settings (usually the icon beside the address), then try again. If it stays blocked, allow the browser to use the camera in your device's privacy settings.");
  assert.equal(zh.studyGroupsPage.room.mediaBlockedCamera, "浏览器已阻止本站点使用摄像头。请在浏览器的网站设置中允许使用摄像头（通常在地址栏旁的图标里），然后重试；如果仍被阻止，请在设备的隐私设置中允许浏览器使用摄像头。");
  assert.equal(en.studyGroupsPage.room.mediaBlockedMic, "Your browser is blocking microphone access for this site. Allow the microphone in the browser's site settings (usually the icon beside the address), then try again. If it stays blocked, allow the browser to use the microphone in your device's privacy settings.");
  assert.equal(zh.studyGroupsPage.room.mediaBlockedMic, "浏览器已阻止本站点使用麦克风。请在浏览器的网站设置中允许使用麦克风（通常在地址栏旁的图标里），然后重试；如果仍被阻止，请在设备的隐私设置中允许浏览器使用麦克风。");
  for (const text of [en.studyGroupsPage.room.mediaBlockedCamera, en.studyGroupsPage.room.mediaBlockedMic, zh.studyGroupsPage.room.mediaBlockedCamera, zh.studyGroupsPage.room.mediaBlockedMic]) {
    assert.equal(/Chrome|macOS|Safari|Windows/.test(text), false);
  }
  assert.equal(en.studyGroupsPage.room.mediaDeviceBlocked, "No camera or microphone was found, or the device is in use by another application. Close the other app and try again.");
  assert.equal(zh.studyGroupsPage.room.mediaDeviceBlocked, "未找到摄像头或麦克风，或设备正被其他应用占用。请关闭占用后重试。");
});

test("a rejected list fetch lands the anonymous first screen on the error pane instead of a permanent Loading", () => {
  const app = readFileSync(new URL("../../components/portal/StudyGroupsApp.tsx", import.meta.url), "utf8");
  // M6: loadLists had no catch, so a rejected fetch (network blip, a non-JSON gateway
  // page) left status "loading" forever for the anonymous visitor - the signed-in 3s
  // poll is the only self-healing path and it does not run for guests. The catch lands
  // on the existing pane error, whose Retry button re-runs loadLists.
  // The lists load through latestOnly (QA3 groups #5 / N-d, behaviour in
  // study-group-groups-page.test.ts): a poll never supersedes a load in flight.
  assert.match(app, /if \(options\.poll && listRequests\.busy\) return;/);
  assert.match(app, /\} finally \{\s*listRequests\.settle\(ticket\);\s*\}/);
  // Only a list that never loaded, a lost sign-in or a load the viewer asked for
  // shows its failure; a failed poll keeps the screen (QA N10, studyGroupListFailurePlace).
  assert.match(app, /\} catch \{\n(?:\s*\/\/[^\n]*\n)*\s*if \(!listRequests\.isLatest\(ticket\)\) return;\s*showFailure\("error"\);\s*\}/);
  // The same landing covers the ?group= deep link: a rejected detail fetch must not
  // leave a silently empty pane with no way to retry (groupAnswerStep "error").
  assert.match(app, /if \(step === "error"\) setGroupError\(result\.code\);/);
  // The pane error is driven by status (studyGroupPane), so the synthetic code still
  // renders the generic copy and the Retry button.
  assert.match(app, /\{pane\.kind === "error" \? <div className=\{styles\.panel\} role="alert"><p className=\{styles\.alert\}>\{errorText\}<\/p>(?:\{errorCode === "unauthenticated" \? <a className=\{styles\.primary\} href=\{signInHref\}>\{copy\.signIn\}<\/a> : )?<button className=\{styles\.primary\} type="button" onClick=\{\(\) => \{ setErrorCode\("idle"\); void loadLists\(\); \}\}>\{copy\.retry\}<\/button>\}?<\/div> : null\}/);
  assert.equal(en.studyGroupsPage.errors.error, "Something went wrong. Try again.");
  assert.equal(zh.studyGroupsPage.errors.error, "出了点问题。请重试。");
});

test("the Study Group popups are real modals: showModal, Escape close, focus in, focus back, Tab contained", () => {
  const app = readFileSync(new URL("../../components/portal/StudyGroupsApp.tsx", import.meta.url), "utf8");
  // L2: a bare <dialog open> overlay has no modal semantics - Tab walked into the page
  // behind, aria-modal="true" was a lie, and Escape did nothing. Every popup now renders
  // through the shared native modal (PortalDialog), which calls showModal() and owns
  // focus containment and Escape for the whole module.
  assert.match(app, /import \{ PortalDialog \} from "\.\/PortalDialog";/);
  assert.equal(app.includes("<dialog open"), false);
  assert.match(app, /<PortalDialog className=\{styles\.modal\} labelledBy="study-group-dialog-title" onClose=\{dialog === "waiting" \? closeWaiting : closeDialog\} busy=\{submitting\}>/);
  // The waiting Close control and the Cancel Group confirm controls keep their closers.
  // Their busy states make PortalDialog ignore Escape, mirroring the disabled buttons.
  assert.match(app, /onClick=\{closeWaiting\}>\{copy\.close\}<\/button>/);
  assert.match(app, /onClose=\{closeDialog\} busy=\{creating\}>/);
  assert.match(app, /onClose=\{closeDialog\} busy=\{cancelling\}>/);
  // PortalDialog is where the modal semantics live; pin them so a regression in the
  // shared component cannot silently turn these popups into fake modals again.
  const modal = readFileSync(new URL("../../components/portal/PortalDialog.tsx", import.meta.url), "utf8");
  assert.match(modal, /node\?\.showModal\(\)/);
  assert.match(modal, /previousFocus\?\.focus\(\)/);
  assert.match(modal, /onCancel=\{event => \{ event\.preventDefault\(\); if \(!busy\) onClose\(\); \}\}/);
  assert.match(modal, /onKeyDown=\{keepFocusInDialog\}/);
});

test("a rejected fetch or a non-JSON body resolves as a network failure instead of an unhandled rejection", async () => {
  // F-1 (dev audit 2026-10-14): studyGroupRequest awaited fetch and response.json()
  // unguarded, so an offline click (Plan / Cancel / Leave / Create / Join) rejected at
  // the await, skipped every !ok branch, and produced an unhandled rejection with no
  // visible feedback. The wrapper now synthesises {ok:false, code:"network"} so the
  // existing single error slot (fe40699) renders it; callers that still carry a catch
  // keep it as belt-and-braces only.
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = (() => Promise.reject(new TypeError("Failed to fetch"))) as typeof fetch;
    assert.deepEqual(await studyGroupRequest("/api/study-groups?view=mine"), { ok: false, code: "network", message: "", data: null });
    globalThis.fetch = (() => Promise.resolve(new Response("<html>502 Bad Gateway</html>", { status: 502 }))) as typeof fetch;
    assert.deepEqual(await studyGroupRequest("/api/study-groups?view=mine"), { ok: false, code: "network", message: "", data: null });
    globalThis.fetch = (() => Promise.resolve(new Response(JSON.stringify({ ok: false, code: "error", message: "Study Group request failed.", data: null }), { status: 500 }))) as typeof fetch;
    assert.deepEqual(await studyGroupRequest("/api/study-groups?view=mine"), { ok: false, code: "error", message: "Study Group request failed.", data: null });
  } finally {
    globalThis.fetch = originalFetch;
  }
  const client = readFileSync(new URL("../../components/portal/studyGroupClient.ts", import.meta.url), "utf8");
  assert.match(client, /catch \{[\s\S]{0,500}?return \{ ok: false, code: "network", message: "", data: null as T \};/);
  // The change-path handlers keep the fe40699 contract: the synthesised failure lands in
  // the one error slot, no new display point is added, and "network" renders the generic
  // copy (there is deliberately no copy.errors.network key; the lookup falls back).
  const app = readFileSync(new URL("../../components/portal/StudyGroupsApp.tsx", import.meta.url), "utf8");
  // create form, sheet, the form dialogs and the confirm dialogs (one slot each, never two at once).
  assert.equal(app.split('{errorPlace === "').length - 1, 4);
  assert.match(app, /if \(!outcome\.ok\) \{\s*setErrorCode\(outcome\.errorCode\);\s*return;\s*\}/);
  assert.match(app, /if \(!result\.ok\) \{\s*setErrorCode\(result\.code\);\s*return;\s*\}\s*await loadLists\(\);\s*await openGroup\(group\.id\);/);
  assert.equal(en.studyGroupsPage.errors.error, "Something went wrong. Try again.");
  assert.equal(zh.studyGroupsPage.errors.error, "出了点问题。请重试。");
});

test("the idle sentinel is its own value so a generic 500 error code renders in the one error slot", () => {
  // F-2 (dev audit 2026-10-14): http.ts maps unexpected failures to code "error" (500)
  // while the component used "error" as its no-error sentinel, so a real 500 was
  // swallowed and the click appeared to do nothing. The sentinel is now "idle" (owned by
  // studyGroupHasError); "error" is an ordinary renderable code with the generic copy.
  assert.equal(studyGroupHasError("idle"), false);
  assert.equal(studyGroupHasError("error"), true);
  assert.equal(studyGroupHasError("network"), true);
  assert.equal(studyGroupHasError("not_found"), true);
  assert.equal(studyGroupErrorPlace({ status: "ready", dialog: null, hasSelected: true, hasError: studyGroupHasError("error") }), "sheet");
  const app = readFileSync(new URL("../../components/portal/StudyGroupsApp.tsx", import.meta.url), "utf8");
  assert.match(app, /const \[errorCode, setErrorCode\] = useState\("idle"\)/);
  assert.match(app, /hasError: studyGroupHasError\(errorCode\)/);
  assert.equal(app.includes('errorCode !== "error"'), false);
  assert.equal(app.includes('setErrorCode("ok")'), false);
  assert.equal(en.studyGroupsPage.errors.error, "Something went wrong. Try again.");
  assert.equal(zh.studyGroupsPage.errors.error, "出了点问题。请重试。");
});

test("the background group refresh and the unload release beacons never surface unhandled rejections", () => {
  // F-7/F-8 (dev audit 2026-10-14): the 3s group refresh (readOpenGroup) and the pagehide /
  // effect-cleanup leave beacons could reject on a dying network with nothing to catch
  // them. The request wrapper no longer rejects (F-1), so the poll keeps its silent
  // failure handling (groupAnswerStep) - the next tick self-heals -
  // while the beacons, which run as the page unloads where no UI could ever render,
  // swallow their rejection explicitly instead of getting a feedback surface.
  const app = readFileSync(new URL("../../components/portal/StudyGroupsApp.tsx", import.meta.url), "utf8");
  assert.match(app, /async function readOpenGroup\(id: string, poll: boolean\) \{\n\s*const ticket = groupRequests\.start\(\);\n\s*const result = await studyGroupRequest<StudyGroupDetail>\(studyGroupPath\(id\)\);/);
  // Closing the waiting popup is the one remaining release beacon; the room page
  // sends none (its seat lapses on the server, QA 2026-10-19 seat lease).
  assert.equal(app.split("keepalive: true }).catch(() => undefined)").length - 1, 1);
  assert.equal(app.includes("keepalive: true });"), false);
});
