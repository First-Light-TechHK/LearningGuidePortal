import assert from "node:assert/strict";
import { test } from "node:test";
import { participantStatus, raisedHands, sessionControls, sessionStateLabel, studyGroupPane } from "../../modules/group-study/uiState";
import { readFileSync } from "node:fs";
import en from "../../messages/en-GB.json";
import zh from "../../messages/zh-CN.json";
import { DURATION_MINUTE_CHOICES, fill, hostMayOpenRoom, scheduleSessionFields, SESSION_TITLE_MAX, sessionNotStarted, sessionScheduleLabel, sessionTitleCount, tutorQueueBody } from "../../components/portal/studyGroupClient";

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
  assert.match(room, /tutorQueueBody\(text\)/);
  assert.match(room, /<time dateTime=\{line\.at\}>/);
  assert.match(room, /session\.aiTutorEnabled \?/);
  assert.equal(room.includes("/api/ai-tutor"), false);
  assert.equal(room.includes("prompts/"), false);
  assert.equal(room.includes("You are"), false);
  assert.equal(room.includes("queued.data"), false);
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

test("session title counter matches the 20 character Figma limit", () => {
  assert.equal(SESSION_TITLE_MAX, 20);
  assert.equal(sessionTitleCount(""), "0/20");
  assert.equal(sessionTitleCount("1234567"), "7/20");
  assert.equal(sessionTitleCount("x".repeat(20)), "20/20");
  assert.equal(sessionTitleCount("x".repeat(21)), "20/20");
});

test("study group pane shows empty, error, and a selected group without inventing sessions for a visitor", () => {
  assert.equal(studyGroupPane({ status: "loading", selected: null }).kind, "loading");
  assert.equal(studyGroupPane({ status: "error", selected: null }).kind, "error");
  assert.equal(studyGroupPane({ status: "ready", selected: null }).kind, "empty");
  assert.equal(studyGroupPane({ status: "ready", selected: { role: null, sessions: null } }).kind, "join-gate");
  assert.equal(studyGroupPane({ status: "ready", selected: { role: "member", sessions: [] } }).kind, "sessions");
});

test("Join Study Group is the join label and Hosting is only for the Host", () => {
  assert.equal(en.studyGroupsPage.joinGroup, "Join Now");
  assert.equal(zh.studyGroupsPage.joinGroup, "立即加入");
  const source = readFileSync(new URL("../../components/portal/StudyGroupsApp.tsx", import.meta.url), "utf8");
  assert.match(source, /\{copy\.joinGroup\}/);
  assert.match(source, /selected\.role === "host" \? <span className=\{styles\.hostChip\}>\{copy\.hosting\}<\/span> : null/);
  assert.match(source, /selected\.role === "host" \? <div className=\{styles\.hostFoot\}>/);
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
  assert.match(room, /ParticipantDisconnected, \(\) => \{ paint\(\); window\.setTimeout\(\(\) => void load\(\), 400\); \}/);
  assert.match(room, /connected && tiles\.length > 0 \? tiles\.length : session\.occupancy/);
  assert.match(room, /controls\.includes\("participants"\)/);
  assert.match(room, /data-participants=\{present\}/);
  assert.match(room, /triesLeft > 0/);
  assert.match(room, /releaseRoom\(\)/);
  assert.match(room, /session\?\.state === "completed"\) void releaseRoom\(\)/);
  assert.match(room, /sessions\/\$\{sessionId\}\/enter/);
  assert.match(room, /session\.state === "scheduled"/);
  assert.match(room, /copy\.errors\.session_not_open/);
  assert.match(room, /copy\.enterWindow/);
  assert.equal(en.studyGroupsPage.errors.start_in_past, "Start Time must be in the future.");
  assert.equal(zh.studyGroupsPage.errors.start_in_past, "开始时间必须还在将来。");
  assert.match(readFileSync(new URL("../../components/portal/StudyGroupsApp.tsx", import.meta.url), "utf8"), /dialog !== "waiting" && dialog !== "attendees"/);
  assert.equal(en.studyGroupsPage.courseAccessRequired, "Course access required, You don't currently have access to {course}.\nGet Course access to join this Study Group.");
  assert.equal(fill(en.studyGroupsPage.courseAccessRequired, { course: "German History" }), "Course access required, You don't currently have access to German History.\nGet Course access to join this Study Group.");
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
  assert.match(room, /errorCode === "session_full"/);
  assert.match(room, /errorCode === "course_access_required"/);
  assert.match(room, /copy\.getCourseAccess/);
  assert.match(room, /!seated && !entryDone/);
  assert.equal(en.studyGroupsPage.start, "Start Live Session");
  assert.match(room, /room\?\.disconnect\(\)/);
  assert.match(room, /pagehide/);
  assert.match(room, /keepalive: true/);
  assert.match(room, /seatedRef\.current/);
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
  assert.match(room, /session\.state === "live" \|\| session\.state === "starting_soon"/);
  assert.match(app, /waitingHoldRef/);
  assert.match(app, /waitingHandedOffRef\.current = true/);
  assert.match(app, /addEventListener\("pagehide"/);
  assert.match(app, /keepalive: true/);
  assert.match(app, /setWaitingSession\(null\)/);
  assert.match(app, /if \(result\.code === "not_found"\)/);
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
  assert.equal(fill(en.studyGroupsPage.attended, { count: 4 }), "4 members attended");
  assert.equal(fill(en.studyGroupsPage.maximumLine, { count: 6 }), "Maximum 6 participants");
  assert.equal(en.studyGroupsPage.planNote, "Planning to attend does not reserve a place.");
  assert.equal(en.studyGroupsPage.planning, "You are planning to attend this session.");
  assert.equal(zh.studyGroupsPage.planNote, "计划参加不保留座位。");
  assert.equal(zh.studyGroupsPage.planning, "你已计划参加本节。");
  assert.equal(en.studyGroupsPage.reminderHint, "You'll get a reminder before it starts");
  assert.equal(fill(zh.studyGroupsPage.attended, { count: 4 }), "4 人参加过");
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
  assert.match(app, /void refreshOpenGroup\(selectedId\)/);
  assert.match(app, /void loadLists\(\); \}, 3_000\)/);
  assert.match(app, /generation !== listGeneration\.current/);
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
  assert.match(app, /sessions\/\$\{sessionId\}\/leave/);
  assert.match(app, /result\.code === "not_found"/);
  assert.match(app, /live: result\.data\.live/);
  assert.match(app, /styles\.reminders/);
});

test("the ended screen and live clock follow the Live Session frames", () => {
  assert.equal(en.studyGroupsPage.room.endedBody, "The Session has ended. You can return to the lesson and continue learning.");
  assert.equal(en.studyGroupsPage.room.chatPlaceholder, "Type your message...");
  assert.equal(zh.studyGroupsPage.room.chatPlaceholder, "输入消息...");
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
  assert.match(app, /URLSearchParams\(window\.location\.search\)\.get\("group"\)/);
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
  // brand text ending at 219 (margin 33px), and the active item and its 4px bar are #1d6bff.
  assert.match(css, /\.nav \{[^}]*margin-left: 33px[^}]*\}/);
  assert.match(css, /\.nav a\.active \{[^}]*color: #1d6bff[^}]*\}/);
  assert.match(css, /\.nav a\.active::after \{[^}]*background: #1d6bff[^}]*\}/);
  assert.equal(css.includes("#155dfc"), false);
});

test("the join gate call-to-action centres its label for the sign-in link", () => {
  const css = readFileSync(new URL("../../components/portal/study-groups.module.css", import.meta.url), "utf8");
  assert.match(css, /\n\.primary \{[^}]*display: inline-flex;[^}]*align-items: center;[^}]*justify-content: center;[^}]*text-decoration: none;[^}]*\}/);
  const app = readFileSync(new URL("../../components/portal/StudyGroupsApp.tsx", import.meta.url), "utf8");
  assert.match(app, /<a className=\{styles\.primary\} href=\{signedIn \?/);
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
  assert.match(css, /\.joinAction \.primary \{ min-width: 230px; \}/); // 599:1035 CTA 230x36
  assert.match(css, /\.sessionState\[data-state="scheduled"\] \{[^}]*background: #e0f5e5;[^}]*color: #26ad61/); // 599:685 Upcoming badge
  assert.match(css, /\.sessionState\[data-state="live"\], \.sessionState\[data-state="starting_soon"\] \{[^}]*background: rgba\(245,70,73,\.2\)/); // 599:702 Live now badge
  assert.match(css, /\.reminderHint \{[^}]*background: #fff9f1[^}]*\}/); // 599:721 reminder pill
  assert.match(css, /\.planningTag \{[^}]*background: #eef9f3[^}]*\}/); // 599:744 planning pill
  assert.match(css, /\.endCard \{ width: min\(640px, 100%\)/); // 599:1398 card 433..1072
  assert.match(css, /\.endCard h1 \{ font-size: 28px; \}/);
  assert.match(css, /\.endCard \.primary \{ min-width: 152px; \}/);
  assert.match(css, /\.ghost \{[^}]*color: #111827[^}]*\}/); // 599:627 Button/Edit Group label
  assert.match(css, /\.signInLink \{[^}]*color: #4a5565[^}]*\}/); // 599:971 header Sign In variant
  assert.match(css, /\.live \{ position: absolute; top: 8px; right: 8px/); // 599:44 sidebar Live chip inset
  assert.match(css, /\.joined \{ background: #d1f1dd; color: #2dad5c; \}/);
  assert.match(css, /\.empty \{[^}]*padding-top: 130px; \}/); // 599:8 rhythm: title 218, art 395, h2 573, body 614
  assert.match(css, /\.empty img \{ width: 250px; height: 150px; margin-top: 160px/);
  assert.match(css, /\.joinBanner \{[^}]*margin: 0 0 12px;[^}]*\}/);
  assert.match(css, /\.locked \{ position: relative; height: 175px;/); // 599:930 Rectangle 112 642x175
  assert.match(css, /\.lockedAvatars i \{ width: 26px; height: 26px;[^}]*background: #ebedf2/);
  assert.match(css, /\.session \{ display: grid; grid-template-columns: minmax\(0, 1fr\) 152px; column-gap: 16px; align-items: center;[^}]*padding: 16px 25px 16px 16px/); // 599:315 action column
  assert.match(css, /\.row \{ display: flex; flex-direction: column; align-items: stretch; gap: 8px; \}/);
  assert.match(css, /\.modal \.waitingBanner \{[^}]*border: 1px solid #1d6bff;[^}]*background: #f1f7ff;/); // 599:752
  assert.match(css, /\.waitingFacts \{[^}]*background: #fbfbfb;[^}]*border: 1px solid #e4e7ec;[^}]*border-radius: 8px/); // 599:751
  assert.match(css, /\.createdToast \{ position: absolute; top: 10px; left: 50%;[^}]*width: min\(450px/); // 599:2083 toast 450x78 at 725,98
  assert.match(css, /\.controls button \{ flex-direction: column;[^}]*min-height: 56px/); // 599:1276 icon-over-label controls
  assert.match(css, /\.controls \.shareControl svg \{ color: #f54649; \}/);
  assert.match(css, /\.chatForm \{ position: relative; display: block; min-height: 72px/); // 599:1276
  assert.match(css, /\.sendButton \{ position: absolute; right: 8px; bottom: 8px;/);
  const app = readFileSync(new URL("../../components/portal/StudyGroupsApp.tsx", import.meta.url), "utf8");
  assert.match(app, /styles\.planningTag/);
  assert.match(app, /styles\.hostFoot\}><button className=\{styles\.ghost\} type="button"/); // member Leave Study Group sits in the Members column
  assert.match(app, /study-groups\/\$\{selected\.id\}\/leave/);
  assert.match(app, /<LockedCard \/>/); // 599:930 skeletons keep fact rows + avatar row
  assert.match(app, /className=\{styles\.createdToast\}/); // 599:1975 created toast over the form
  assert.equal(app.includes('className={styles.created}'), false);
  assert.equal(app.includes("waitingSession.occupancy"), false); // 599:531 shows no occupancy line
  assert.equal(app.includes('dialog === "waiting" ? <button'), false); // 599:531 has no footer action
  const room = readFileSync(new URL("../../components/portal/StudySessionRoom.tsx", import.meta.url), "utf8");
  assert.match(room, /line\.tutor \? null : <time dateTime=\{line\.at\}>/); // 599:1276 tutor line has no timestamp
  assert.match(room, /roomCopy\.crumbGroupInfo/);
  assert.match(room, /roomCopy\.crumbSession/);
  assert.match(room, /&gt;/); // 599:1117 breadcrumb separators
  assert.match(room, /\.join\(" \| "\)/); // 599:1398 end-card meta separator
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
