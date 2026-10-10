"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import type { Locale } from "@/lib/i18n/config";
import { getMessages } from "@/lib/i18n/messages";
import { sessionStateLabel, studyGroupPane } from "@/modules/group-study/uiState";
import styles from "./study-groups.module.css";
import { DURATION_MINUTE_CHOICES, fill, hostMayOpenRoom, plannedMinutes, scheduleSessionFields, SESSION_TITLE_MAX, sessionDateLabel, sessionNotStarted, sessionScheduleLabel, sessionTimeLabel, sessionTitleCount, studyGroupRequest, type StudyGroupDetail, type StudySession } from "./studyGroupClient";

type CourseOption = { id: string; title: string; slug: string };

function todayDate() {
  const date = new Date();
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function earliestTime(date: string) {
  if (date !== todayDate()) return "";
  const now = new Date();
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${pad(now.getHours())}:${pad(now.getMinutes())}`;
}

function FactIcon({ kind }: { kind: "date" | "time" | "duration" | "people" }) {
  const props = { viewBox: "0 0 16 16", width: 14, height: 14, "aria-hidden": true as const, fill: "none", stroke: "currentColor", strokeWidth: 1.4, strokeLinecap: "round" as const };
  if (kind === "date") return <svg {...props}><rect x="2" y="3" width="12" height="11" rx="1.5" /><path d="M2 6.5h12M5 1.5v2M11 1.5v2" /></svg>;
  if (kind === "time") return <svg {...props}><circle cx="8" cy="8" r="5.5" /><path d="M8 4.5V8l2.2 1.6" /></svg>;
  if (kind === "duration") return <svg {...props}><circle cx="8" cy="8" r="5.5" /><path d="M8 5v3.2" /></svg>;
  return <svg {...props}><circle cx="6" cy="5.5" r="2" /><path d="M2.5 13c.4-2 1.8-3 3.5-3s3.1 1 3.5 3" /></svg>;
}

function localDateTime(startsAt: string) {
  const date = new Date(startsAt);
  const pad = (value: number) => String(value).padStart(2, "0");
  return {
    date: `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`,
    time: `${pad(date.getHours())}:${pad(date.getMinutes())}`
  };
}
type Card = { id: string; title: string; courseTitle: string; role: "host" | "member" | null; memberCount: number; live: boolean; courseId: string };

export function StudyGroupsApp({ locale, signedIn }: { locale: Locale; signedIn: boolean }) {
  const copy = getMessages(locale).studyGroupsPage;
  const router = useRouter();
  const [mine, setMine] = useState<Card[]>([]);
  const [discover, setDiscover] = useState<Card[]>([]);
  const [courses, setCourses] = useState<CourseOption[]>([]);
  const [courseOptions, setCourseOptions] = useState<Array<{ id: string; title: string }>>([]);
  const [mineFilter, setMineFilter] = useState<"all" | "host">("all");
  const [courseFilter, setCourseFilter] = useState("");
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selected, setSelected] = useState<StudyGroupDetail | null>(null);
  const [status, setStatus] = useState<"loading" | "error" | "ready">("loading");
  const [errorCode, setErrorCode] = useState("error");
  const [dialog, setDialog] = useState<"create" | "edit" | "schedule" | "edit-session" | "waiting" | "attendees" | null>(null);
  const [createdGroup, setCreatedGroup] = useState<{ id: string; title: string; courseTitle: string } | null>(null);
  const [editingSession, setEditingSession] = useState<StudySession | null>(null);
  const [waitingSession, setWaitingSession] = useState<StudySession | null>(null);
  const [attendees, setAttendees] = useState<StudySession["attendees"]>([]);
  const [attendeeSessionId, setAttendeeSessionId] = useState<string | null>(null);
  const [sessionTitle, setSessionTitle] = useState("");
  const [sessionFocus, setSessionFocus] = useState("");
  const [sessionDate, setSessionDate] = useState("");
  const [sessionTime, setSessionTime] = useState("");
  const [sessionDuration, setSessionDuration] = useState("");
  const [sessionMax, setSessionMax] = useState("");
  const [sessionTutor, setSessionTutor] = useState(true);
  const [sessionLesson, setSessionLesson] = useState("");
  const [createTitle, setCreateTitle] = useState("");
  const [createAbout, setCreateAbout] = useState("");
  const [reminders, setReminders] = useState<Array<{ body: string; createdAt: string }>>([]);
  const listGeneration = useRef(0);
  const openGroupId = useRef<string | null>(null);
  const waitingHoldRef = useRef<string | null>(null);
  const waitingHandedOffRef = useRef(false);

  async function loadLists() {
    const generation = ++listGeneration.current;
    const [myResult, discoverResult, courseResult, reminderResult] = await Promise.all([
      signedIn ? studyGroupRequest<Card[]>("/api/study-groups?view=mine") : Promise.resolve({ ok: true, code: "ok", message: "", data: [] as Card[] }),
      studyGroupRequest<Card[]>(`/api/study-groups?view=discover&courseId=${encodeURIComponent(courseFilter)}&q=${encodeURIComponent(query)}`),
      signedIn ? studyGroupRequest<CourseOption[]>("/api/study-groups?view=courses") : Promise.resolve({ ok: true, code: "ok", message: "", data: [] as CourseOption[] }),
      signedIn ? studyGroupRequest<Array<{ body: string; createdAt: string }>>("/api/study-groups?view=reminders") : Promise.resolve({ ok: true, code: "ok", message: "", data: [] as Array<{ body: string; createdAt: string }> })
    ]);
    if (generation !== listGeneration.current) return;
    if (!myResult.ok || !discoverResult.ok) {
      setStatus("error");
      setErrorCode(myResult.ok ? discoverResult.code : myResult.code);
      return;
    }
    setMine(myResult.data);
    setDiscover(discoverResult.data);
    if (courseResult.ok) setCourses(courseResult.data);
    if (reminderResult.ok) setReminders(reminderResult.data);
    const incoming = [
      ...(courseResult.ok ? courseResult.data : []),
      ...myResult.data.map((group) => ({ id: group.courseId, title: group.courseTitle })),
      ...discoverResult.data.map((group) => ({ id: group.courseId, title: group.courseTitle }))
    ];
    setCourseOptions((current) => {
      const next = new Map(current.map((item) => [item.id, item.title]));
      for (const item of incoming) if (item.id && item.title) next.set(item.id, item.title);
      return Array.from(next, ([id, title]) => ({ id, title }));
    });
    setStatus("ready");
  }

  async function openGroup(id: string) {
    openGroupId.current = id;
    setSelectedId(id);
    const result = await studyGroupRequest<StudyGroupDetail>(`/api/study-groups/${id}`);
    if (openGroupId.current !== id) return;
    if (!result.ok) {
      setErrorCode(result.code);
      setStatus("error");
      return;
    }
    setSelected(result.data);
    setMine((current) => current.map((group) => group.id === result.data.id ? { ...group, live: result.data.live, memberCount: result.data.memberCount } : group));
    setStatus("ready");
  }

  async function refreshOpenGroup(id: string) {
    const result = await studyGroupRequest<StudyGroupDetail>(`/api/study-groups/${id}`);
    if (openGroupId.current !== id) return;
    if (!result.ok) {
      if (result.code === "not_found") {
        openGroupId.current = null;
        setSelected(null);
        setSelectedId(null);
        setDialog(null);
        setWaitingSession(null);
        setEditingSession(null);
        void loadLists();
      }
      return;
    }
    setSelected(result.data);
    setMine((current) => current.map((group) => group.id === result.data.id ? { ...group, live: result.data.live, memberCount: result.data.memberCount } : group));
  }

  useEffect(() => {
    if (!selectedId || !signedIn) return;
    const timer = window.setInterval(() => { void refreshOpenGroup(selectedId); }, 3000);
    return () => window.clearInterval(timer);
  }, [selectedId, signedIn]);

  useEffect(() => {
    if (dialog !== "attendees" || !attendeeSessionId || !selected?.sessions) return;
    const current = selected.sessions.find((item) => item.id === attendeeSessionId);
    if (current) setAttendees(current.attendees);
    else {
      setDialog(null);
      setAttendeeSessionId(null);
    }
  }, [dialog, attendeeSessionId, selected]);

  useEffect(() => {
    if (dialog !== "edit-session" || !editingSession || !selected?.sessions) return;
    if (!selected.sessions.some((item) => item.id === editingSession.id)) {
      setDialog(null);
      setEditingSession(null);
    }
  }, [dialog, editingSession, selected]);

  useEffect(() => {
    if (dialog !== "waiting" || !waitingSession || !selected?.sessions) return;
    if (!selected.sessions.some((item) => item.id === waitingSession.id)) {
      setDialog(null);
      setWaitingSession(null);
    }
  }, [dialog, waitingSession, selected]);

  useEffect(() => {
    const release = () => {
      if (waitingHandedOffRef.current) return;
      const sessionId = waitingHoldRef.current;
      if (!sessionId) return;
      waitingHoldRef.current = null;
      void fetch(`/api/study-groups/sessions/${sessionId}/leave`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}", keepalive: true });
    };
    window.addEventListener("pagehide", release);
    return () => {
      window.removeEventListener("pagehide", release);
      release();
    };
  }, []);

  useEffect(() => {
    const sessionId = dialog === "waiting" ? waitingSession?.id ?? null : null;
    if (sessionId) {
      waitingHoldRef.current = sessionId;
      return;
    }
    if (waitingHandedOffRef.current) return;
    const held = waitingHoldRef.current;
    if (!held) return;
    waitingHoldRef.current = null;
    void fetch(`/api/study-groups/sessions/${held}/leave`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}", keepalive: true });
  }, [dialog, waitingSession?.id]);

  useEffect(() => {
    void loadLists();
  }, [courseFilter, query, signedIn]);

  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get("group");
    if (id) void openGroup(id);
  }, []);

  useEffect(() => {
    if (!signedIn) return;
    const timer = window.setInterval(() => { void loadLists(); }, 3_000);
    return () => window.clearInterval(timer);
  }, [signedIn, courseFilter, query]);

  useEffect(() => {
    if (!waitingSession || waitingSession.state === "live") return;
    const timer = window.setInterval(async () => {
      const result = await studyGroupRequest<StudySession>(`/api/study-groups/sessions/${waitingSession.id}`);
      if (!result.ok) {
        if (result.code === "not_found") {
          setDialog(null);
          setWaitingSession(null);
          const groupId = openGroupId.current;
          if (groupId) void openGroup(groupId);
          void loadLists();
        }
        return;
      }
      setWaitingSession(result.data);
      if (result.data.state === "live") {
        waitingHandedOffRef.current = true;
        waitingHoldRef.current = null;
        router.push(`/${locale}/portal/study-groups/sessions/${result.data.id}`);
      }
    }, 3000);
    return () => window.clearInterval(timer);
  }, [waitingSession, locale, router]);

  const pane = studyGroupPane({ status, selected: selected ? { role: selected.role, sessions: selected.sessions ?? null } : null });
  const visibleMine = mine.filter((group) => mineFilter === "all" || group.role === "host");
  const errorText = copy.errors[errorCode as keyof typeof copy.errors] || copy.errors.error;

  async function submitCreate(form: FormData) {
    const result = await studyGroupRequest<StudyGroupDetail>("/api/study-groups", {
      method: "POST",
      body: JSON.stringify({ title: form.get("title"), courseId: form.get("courseId"), about: form.get("about") })
    });
    if (!result.ok) {
      setErrorCode(result.code);
      return;
    }
    setDialog(null);
    setCreatedGroup({ id: result.data.id, title: result.data.title, courseTitle: result.data.courseTitle });
    await loadLists();
  }

  function openSchedule() {
    setErrorCode("ok");
    setSessionTitle("");
    setSessionFocus("");
    setSessionDate("");
    setSessionTime("");
    setSessionDuration("");
    setSessionMax("");
    setSessionTutor(true);
    setSessionLesson("");
    setDialog("schedule");
  }

  function openEditSession(session: StudySession) {
    setErrorCode("ok");
    const local = localDateTime(session.startsAt);
    setEditingSession(session);
    setSessionTitle(session.title.slice(0, SESSION_TITLE_MAX));
    setSessionFocus(session.focus || "");
    setSessionDate(local.date);
    setSessionTime(local.time);
    setSessionDuration(String(plannedMinutes(session)));
    setSessionMax(String(session.maxParticipants));
    setSessionTutor(session.aiTutorEnabled);
    setSessionLesson(session.relatedLessonId || "");
    setDialog("edit-session");
  }

  async function submitEdit(form: FormData) {
    if (!selected) return;
    const result = await studyGroupRequest<StudyGroupDetail>(`/api/study-groups/${selected.id}`, {
      method: "PATCH",
      body: JSON.stringify({ title: form.get("title"), about: form.get("about") })
    });
    if (!result.ok) {
      setErrorCode(result.code);
      return;
    }
    setDialog(null);
    await openGroup(selected.id);
    await loadLists();
  }

  async function submitSchedule(form: FormData) {
    if (!selected) return;
    const startsAt = new Date(`${form.get("date")}T${form.get("time")}`).toISOString();
    const result = await studyGroupRequest<StudySession>(`/api/study-groups/${selected.id}/sessions`, {
      method: "POST",
      body: JSON.stringify(scheduleSessionFields({
        title: form.get("title"),
        startsAt,
        durationMinutes: Number(form.get("durationMinutes")),
        maxParticipants: Number(form.get("maxParticipants")),
        focus: form.get("focus"),
        aiTutorEnabled: form.get("aiTutor") === "on",
        relatedLessonId: form.get("lesson")
      }))
    });
    if (!result.ok) {
      setErrorCode(result.code);
      return;
    }
    setDialog(null);
    await openGroup(selected.id);
  }

  async function submitEditSession(form: FormData) {
    if (!selected || !editingSession) return;
    const startsAt = new Date(`${form.get("date")}T${form.get("time")}`).toISOString();
    const result = await studyGroupRequest<StudySession>(`/api/study-groups/sessions/${editingSession.id}`, {
      method: "PATCH",
      body: JSON.stringify({
        groupId: selected.id,
        ...scheduleSessionFields({
          title: form.get("title"),
          startsAt,
          durationMinutes: Number(form.get("durationMinutes")),
          maxParticipants: Number(form.get("maxParticipants")),
          focus: form.get("focus"),
          aiTutorEnabled: form.get("aiTutor") === "on",
          relatedLessonId: form.get("lesson")
        })
      })
    });
    if (!result.ok) {
      setErrorCode(result.code);
      return;
    }
    setDialog(null);
    setEditingSession(null);
    await openGroup(selected.id);
  }

  async function startSession(session: StudySession) {
    const started = await studyGroupRequest(`/api/study-groups/sessions/${session.id}/start`, { method: "POST", body: "{}" });
    if (!started.ok) {
      setErrorCode(started.code);
      return;
    }
    const entered = await studyGroupRequest<{ occupancy: number }>(`/api/study-groups/sessions/${session.id}/enter`, { method: "POST", body: "{}" });
    if (!hostMayOpenRoom(started.ok, entered.ok)) {
      setErrorCode(entered.code);
      if (selected) await openGroup(selected.id);
      return;
    }
    if (selected) await openGroup(selected.id);
    waitingHandedOffRef.current = true;
    waitingHoldRef.current = null;
    router.push(`/${locale}/portal/study-groups/sessions/${session.id}`);
  }

  async function enter(session: StudySession) {
    const result = await studyGroupRequest<{ occupancy: number }>(`/api/study-groups/sessions/${session.id}/enter`, { method: "POST", body: "{}" });
    if (!result.ok) {
      setErrorCode(result.code);
      return;
    }
    if (session.state === "live") router.push(`/${locale}/portal/study-groups/sessions/${session.id}`);
    else {
      waitingHandedOffRef.current = false;
      waitingHoldRef.current = session.id;
      setWaitingSession({ ...session, occupancy: result.data.occupancy });
      setDialog("waiting");
    }
  }

  return (
    <div className={styles.layout}>
      <aside className={styles.sidebar} aria-label={copy.title}>
        <h1 className={styles.title}>{copy.title}</h1>
        {reminders.length ? <ul className={styles.reminders}>{reminders.map((item) => <li role="status" key={`${item.createdAt}-${item.body}`}>{item.body}</li>)}</ul> : null}
        <div className={styles.sectionHead}>
          <h2>{copy.myGroups}</h2>
          {signedIn ? <button className={styles.create} type="button" onClick={() => { setCreateTitle(""); setCreateAbout(""); setDialog("create"); }}>+ {copy.create}</button> : null}
        </div>
        <div className={styles.tabs} role="group" aria-label={copy.myGroups}>
          <button type="button" aria-pressed={mineFilter === "all"} onClick={() => setMineFilter("all")}>{copy.all}</button>
          <button type="button" aria-pressed={mineFilter === "host"} onClick={() => setMineFilter("host")}>{copy.hostedByMe}</button>
        </div>
        {signedIn && visibleMine.length === 0 ? <p className={styles.noMine}>{copy.noMine}</p> : null}
        {visibleMine.map((group) => (
          <button className={styles.card} type="button" key={group.id} aria-current={selectedId === group.id} onClick={() => void openGroup(group.id)}>
            <h3>{group.title}</h3>
            {group.live ? <span className={styles.live}>{copy.live}</span> : null}
            <p className={styles.course}>{group.courseTitle}</p>
            {group.role ? <span className={`${styles.role} ${group.role === "host" ? styles.hosted : styles.joined}`}>{group.role === "host" ? copy.hosted : copy.joined}</span> : null}
            <p className={styles.count}>{fill(copy.learners, { count: group.memberCount })}</p>
          </button>
        ))}
        <hr className={styles.rule} />
        <h2 className={styles.sectionHead}>{copy.discover}</h2>
        <div className={styles.filters}>
          <label>
            <select value={courseFilter} onChange={(event) => setCourseFilter(event.target.value)} aria-label={copy.allCourses}>
              <option value="">{copy.allCourses}</option>
              {courseOptions.map((course) => <option key={course.id} value={course.id}>{course.title}</option>)}
            </select>
          </label>
          <label>
            <input value={query} onChange={(event) => setQuery(event.target.value)} aria-label={copy.keyword} placeholder={copy.keyword} />
          </label>
        </div>
        {discover.map((group) => (
          <button className={styles.card} type="button" key={group.id} aria-current={selectedId === group.id} onClick={() => void openGroup(group.id)}>
            <h3>{group.title}</h3>
            {group.live ? <span className={styles.live}>{copy.live}</span> : null}
            <p className={styles.course}>{group.courseTitle}</p>
            <p className={styles.openLabel}>{copy.openStudyGroup}</p>
            <p className={styles.count}>{fill(copy.learners, { count: group.memberCount })}</p>
          </button>
        ))}
      </aside>
      <section className={styles.main} aria-live="polite">
        {pane.kind === "loading" ? <p className={styles.panel} role="status">{copy.loading}</p> : null}
        {pane.kind === "error" ? <div className={styles.panel} role="alert"><p className={styles.alert}>{errorText}</p><button className={styles.primary} type="button" onClick={() => void loadLists()}>{copy.retry}</button></div> : null}
        {pane.kind === "empty" && dialog !== "create" && !createdGroup ? <div className={styles.empty}><p>{copy.emptyTitle}</p><Image src="/portal/study-groups/empty-illustration.png" width={250} height={150} alt="" /><h2>{copy.emptyLead}</h2><p className={styles.body}>{copy.emptyBody}</p>{signedIn ? null : <p><a href={`/${locale}/portal/sign-in`}>{copy.signIn}</a> {copy.signInRequired}</p>}</div> : null}
        {createdGroup && dialog !== "create" ? <div className={styles.created} role="status"><h2>{copy.createdTitle}</h2><p>{createdGroup.title}</p><h3>{copy.relatedCourse}</h3><p>{createdGroup.courseTitle}</p><p>{copy.createdBody}</p><button className={styles.primary} type="button" onClick={() => { const id = createdGroup.id; setCreatedGroup(null); void openGroup(id); }}>{copy.openGroup}</button></div> : null}
        {dialog === "create" ? <form className={styles.panel} onSubmit={(event) => { event.preventDefault(); void submitCreate(new FormData(event.currentTarget)); }}>
          <h2>{copy.create}</h2>
          <p className={styles.lead}>{copy.createLead}</p>
          <label className={styles.field}><span>{copy.groupTitle} <span className={styles.req}>*</span></span><span className={styles.fieldBox}><input name="title" required maxLength={50} placeholder={copy.enterTitle} value={createTitle} onChange={(event) => setCreateTitle(event.target.value.slice(0, 50))} /><span className={styles.counter}>{createTitle.length}/50</span></span></label>
          <label className={styles.field}><span>{copy.relatedCourse} <span className={styles.req}>*</span></span><select name="courseId" required defaultValue=""><option value="">{copy.selectCourse}</option>{courses.map((course) => <option key={course.id} value={course.id}>{course.title}</option>)}</select></label>
          <label className={styles.field}><span>{copy.about} <span className={styles.req}>*</span></span><span className={styles.fieldBox}><textarea name="about" required maxLength={200} placeholder={copy.enterDescription} value={createAbout} onChange={(event) => setCreateAbout(event.target.value.slice(0, 200))} /><span className={styles.counter}>{createAbout.length}/200</span></span></label>
          <div className={styles.actions}><button className={styles.ghost} type="button" onClick={() => setDialog(null)}>{copy.cancel}</button><button className={styles.primary} type="submit">{copy.create}</button></div>
          {errorCode !== "error" && errorCode !== "ok" ? <p className={styles.alert} role="alert">{errorText}</p> : null}
        </form> : null}
        {selected && pane.kind !== "loading" && pane.kind !== "error" && dialog !== "create" && !createdGroup ? (
          <div className={styles.sheet}>
            <article>
              <h2 className={styles.groupTitle}>{selected.title}</h2>
              {selected.role === "host" ? <span className={styles.hostChip}>{copy.hosting}</span> : null}
              {selected.role === "member" ? <span className={styles.hostChip}>{copy.joined}</span> : null}
              <div className={styles.facts}>
                <div><h3>{copy.relatedCourse}</h3><p>{selected.courseTitle}</p></div>
                <div><h3 className={styles.aboutLabel}>{copy.about}</h3><p className={styles.aboutBody}>{selected.about}</p></div>
              </div>
              <div className={styles.tabRow}><span className={styles.tab}>{copy.liveSessions}</span><span className={styles.countBadge}>{(selected.sessions || []).length}</span></div>
              <h3 className={styles.sectionLabel}>{copy.liveSessions}</h3>
              {pane.kind === "join-gate" ? (
                <>
                  <p className={styles.joinBanner}>{copy.joinBanner}</p>
                  <div className={styles.locked} aria-hidden="true"><span /><span /><span /></div>
                  <div className={styles.locked} aria-hidden="true"><span /><span /><span /></div>
                  <p className={styles.joinNote}>{selected.canJoin ? copy.joinAccess : fill(copy.courseAccessRequired, { course: selected.courseTitle })}</p>
                  <div className={styles.joinAction}>{selected.canJoin ? <button className={styles.primary} type="button" onClick={async () => { const result = await studyGroupRequest(`/api/study-groups/${selected.id}/join`, { method: "POST", body: "{}" }); if (!result.ok) { setErrorCode(result.code); return; } await loadLists(); await openGroup(selected.id); }}>{copy.joinGroup}</button> : <a className={styles.primary} href={signedIn ? `/${locale}/portal/courses/${selected.courseSlug}` : `/${locale}/portal/sign-in`}>{signedIn ? copy.getCourseAccess : copy.signIn}</a>}</div>
                </>
              ) : null}
              {pane.kind === "sessions" && (selected.sessions || []).length === 0 ? <div className={styles.emptySessions}><p>{copy.noSessions}</p><Image src="/portal/study-groups/empty-sessions.png" width={150} height={113} alt="" /></div> : null}
              {pane.kind === "sessions" ? (selected.sessions || []).map((session) => (
                <article className={styles.session} key={session.id}>
                  <p className={styles.sessionState} data-state={sessionNotStarted(session) ? "missed" : session.state}>{sessionNotStarted(session) ? copy.notStarted : copy[session.state === "live" ? "liveNow" : sessionStateLabel(session.state)]}</p>
                  <h3>{session.title}</h3>
                  {session.focus ? <p>{session.focus}</p> : null}
                  {session.relatedLessonId ? <p>{(selected.lessons || []).find((lesson) => lesson.id === session.relatedLessonId)?.title}</p> : null}
                  <ul className={styles.factList}>
                    <li><FactIcon kind="date" />{sessionDateLabel(locale, session.startsAt)}</li>
                    <li><FactIcon kind="time" />{sessionTimeLabel(locale, session)}</li>
                    <li><FactIcon kind="duration" />{fill(copy.plannedDuration, { count: plannedMinutes(session) })}</li>
                    <li data-live={!sessionNotStarted(session) && (session.state === "live" || session.state === "starting_soon") ? "true" : undefined}><FactIcon kind="people" />{sessionNotStarted(session) ? copy.notStartedBody : session.state === "completed" ? <>{fill(copy.attended, { count: session.attendees.length })} · {fill(copy.maximumLine, { count: session.maxParticipants })}</> : session.state === "scheduled" ? <>{fill(copy.plannedCount, { count: session.plannedCount })} · {fill(copy.maximumLine, { count: session.maxParticipants })}</> : fill(copy.currentlyInSession, { count: session.occupancy, max: session.maxParticipants })}</li>
                  </ul>
                  {session.state === "scheduled" && (selected.role === "host" || session.viewerPlanned) ? <p className={styles.reminderHint}>{copy.reminderHint}</p> : null}
                  {session.attendees.length ? <p className={styles.avatarRow}>{session.attendees.slice(0, 4).map((person) => <span key={person.userId}>{person.displayName.slice(0, 1).toUpperCase()}</span>)}{session.attendees.length > 4 ? <span className={styles.avatarMore}>+{session.attendees.length - 4}</span> : null}</p> : null}
                  <div className={styles.row}>
                    {selected.role === "host" && session.state === "starting_soon" && !sessionNotStarted(session) ? <button className={styles.primary} type="button" onClick={() => void startSession(session)}>{copy.start}</button> : null}
                    {(session.state === "starting_soon" || session.state === "live") && !sessionNotStarted(session) ? <button className={styles.primary} type="button" disabled={session.occupancy >= session.maxParticipants} onClick={() => void enter(session)}>{session.occupancy >= session.maxParticipants ? copy.sessionFull : copy.joinNow}</button> : null}
                    {(session.state === "scheduled" || (session.state === "starting_soon" && !sessionNotStarted(session))) && selected.role === "member" && !session.viewerPlanned ? <><button className={styles.primary} type="button" onClick={async () => { await studyGroupRequest(`/api/study-groups/sessions/${session.id}/plan`, { method: "POST", body: "{}" }); await openGroup(selected.id); }}>{copy.plan}</button><p className={styles.planNote}>{copy.planNote}</p></> : null}
                    {(session.state === "scheduled" || (session.state === "starting_soon" && !sessionNotStarted(session))) && session.viewerPlanned ? <><p className={styles.meta}>{copy.planning}</p><button className={styles.danger} type="button" onClick={async () => { await studyGroupRequest(`/api/study-groups/sessions/${session.id}/cancel-attendance`, { method: "POST", body: "{}" }); await openGroup(selected.id); }}>{copy.cancelAttendance}</button></> : null}
                    {selected.role === "host" && (session.state === "scheduled" || session.state === "starting_soon") ? <button className={styles.ghost} type="button" onClick={() => openEditSession(session)}>{copy.editSession}</button> : null}
                    {selected.role === "host" && (session.state === "scheduled" || session.state === "starting_soon") ? <button className={styles.danger} type="button" onClick={async () => { await studyGroupRequest(`/api/study-groups/sessions/${session.id}/cancel`, { method: "POST", body: "{}" }); await openGroup(selected.id); }}>{copy.cancelSession}</button> : null}
                    <button className={styles.textButton} type="button" onClick={() => { setAttendeeSessionId(session.id); setAttendees(session.attendees); setDialog("attendees"); }}>{copy.viewAttendees}<span aria-hidden="true"> ›</span></button>
                  </div>
                </article>
              )) : null}
              {selected.role === "member" ? <button className={styles.danger} type="button" onClick={async () => { await studyGroupRequest(`/api/study-groups/${selected.id}/leave`, { method: "POST", body: "{}" }); setSelected(null); setSelectedId(null); await loadLists(); }}>{copy.leaveGroup}</button> : null}
              {errorCode !== "error" && errorCode !== "ok" ? <p className={styles.alert} role="alert">{errorText}</p> : null}
            </article>
            <aside className={styles.memberCol} aria-label={copy.members}>
              <h3>{copy.members} <span className={styles.countBadge}>{selected.memberCount}</span></h3>
              <ul className={styles.memberList}>
                {(selected.members || []).map((member) => <li key={member.userId}><span className={styles.memberAvatar}>{member.displayName.slice(0, 1)}</span><span>{member.displayName}</span>{member.role === "host" ? <span className={styles.hostTag}>{copy.room.host}</span> : null}</li>)}
              </ul>
              {selected.role === "host" ? <div className={styles.hostFoot}><p>{copy.hostingNote}</p><button className={styles.primary} type="button" onClick={openSchedule}>{copy.schedule}</button><button className={styles.ghost} type="button" onClick={() => setDialog("edit")}>{copy.editGroup}</button><button className={styles.danger} type="button" onClick={async () => { if (!window.confirm(copy.confirmCancelGroup)) return; await studyGroupRequest(`/api/study-groups/${selected.id}/cancel`, { method: "POST", body: "{}" }); setSelected(null); setSelectedId(null); await loadLists(); }}>{copy.cancelGroup}</button></div> : null}
            </aside>
          </div>
        ) : null}
      </section>
      {dialog === "edit" || dialog === "edit-session" || dialog === "schedule" || dialog === "waiting" || dialog === "attendees" ? (
        <dialog open className={styles.modal} aria-modal="true" aria-labelledby="study-group-dialog-title">
          <form method="dialog" onSubmit={(event) => { event.preventDefault(); const formElement = event.currentTarget; if (!formElement.reportValidity()) return; const form = new FormData(formElement); if (dialog === "edit") void submitEdit(form); if (dialog === "edit-session") void submitEditSession(form); if (dialog === "schedule") void submitSchedule(form); }}>
            <h2 id="study-group-dialog-title">{dialog === "schedule" ? copy.schedule : dialog === "waiting" ? copy.waiting : dialog === "attendees" ? copy.viewAttendees : dialog === "edit-session" ? copy.editSession : dialog === "edit" ? copy.editGroup : copy.create}</h2>
            {dialog === "waiting" && waitingSession ? (
              <div role="status">
                <p>{waitingSession.title}</p>
                {waitingSession.focus ? <><h3>{copy.focus}</h3><p>{waitingSession.focus}</p></> : null}
                <p>{sessionScheduleLabel(locale, waitingSession)} · {fill(copy.plannedDuration, { count: plannedMinutes(waitingSession) })}</p>
                <p>{fill(copy.currentlyInSession, { count: waitingSession.occupancy, max: waitingSession.maxParticipants })}</p>
                <p>{fill(copy.upToParticipants, { count: waitingSession.maxParticipants })}</p>
              </div>
            ) : null}
            {dialog === "attendees" ? <ul>{attendees.map((person) => <li key={person.userId}>{person.displayName}</li>)}</ul> : null}
            {dialog === "edit" ? (
              <>
                <label>{copy.groupTitle}<input name="title" required maxLength={50} defaultValue={selected?.title} /></label>
                <p>{selected?.courseTitle}</p>
                <label>{copy.about}<textarea name="about" required maxLength={200} defaultValue={selected?.about} /></label>
              </>
            ) : null}
            {dialog === "schedule" || dialog === "edit-session" ? (
              <>
                <p className={styles.lead}>{copy.arrangeLead}</p>
                <div className={styles.contextCard}><strong>{selected?.title}</strong><span>{selected?.about}</span></div>
                <label className={styles.field}><span>{copy.sessionTitle} <span className={styles.req}>*</span></span><span className={styles.fieldBox}><input name="title" required maxLength={SESSION_TITLE_MAX} value={sessionTitle} onChange={(event) => setSessionTitle(event.target.value.slice(0, SESSION_TITLE_MAX))} /><span className={styles.counter}>{sessionTitleCount(sessionTitle)}</span></span></label>
                <label className={styles.field}>{copy.selectLesson}<select name="lesson" value={sessionLesson} onChange={(event) => setSessionLesson(event.target.value)}><option value="">{copy.selectLesson}</option>{(selected?.lessons || []).map((lesson) => <option key={lesson.id} value={lesson.id}>{lesson.title}</option>)}</select></label>
                <div className={styles.pair}>
                  <label className={styles.field}><span>{copy.date} <span className={styles.req}>*</span></span><input name="date" type="date" required min={todayDate()} value={sessionDate} onChange={(event) => setSessionDate(event.target.value)} /></label>
                  <label className={styles.field}><span>{copy.startTime} <span className={styles.req}>*</span></span><input name="time" type="time" required min={earliestTime(sessionDate) || undefined} value={sessionTime} onChange={(event) => setSessionTime(event.target.value)} /></label>
                  <label className={styles.field}><span>{copy.duration} <span className={styles.req}>*</span></span><select name="durationMinutes" required value={sessionDuration} onChange={(event) => setSessionDuration(event.target.value)}><option value="">{copy.selectDuration}</option>{DURATION_MINUTE_CHOICES.map((minutes) => <option key={minutes} value={minutes}>{fill(copy.plannedDuration, { count: minutes })}</option>)}</select></label>
                  <label className={styles.field}><span>{copy.maxParticipants} <span className={styles.req}>*</span> <span className={styles.hint}>{copy.maximumSix}</span></span><select name="maxParticipants" required value={sessionMax} onChange={(event) => setSessionMax(event.target.value)}><option value="">{copy.selectMaximum}</option>{[2, 3, 4, 5, 6].map((count) => <option key={count} value={count}>{count}</option>)}</select></label>
                </div>
                <label className={styles.field}>{copy.focus}<span className={`${styles.fieldBox} ${styles.focusBox}`}><textarea name="focus" maxLength={50} placeholder={copy.enterDescription} value={sessionFocus} onChange={(event) => setSessionFocus(event.target.value.slice(0, 50))} /><span className={styles.counter}>{sessionFocus.length}/50</span></span></label>
                <label className={styles.switch}><span>{copy.aiTutorLabel}</span><span className={styles.switchText}>{copy.enableAiTutor}</span><input name="aiTutor" type="checkbox" checked={sessionTutor} onChange={(event) => setSessionTutor(event.target.checked)} /></label>
              </>
            ) : null}
            {dialog !== "waiting" && dialog !== "attendees" && errorCode !== "error" && errorCode !== "ok" ? <p className={styles.alert} role="alert">{errorText}</p> : null}
            <div className={styles.dialogActions}>
              {dialog === "waiting" ? <button className={styles.danger} type="button" onClick={() => { const sessionId = waitingSession?.id; setDialog(null); setWaitingSession(null); if (!sessionId) return; void studyGroupRequest(`/api/study-groups/sessions/${sessionId}/leave`, { method: "POST", body: "{}" }).then(() => { if (selected) void openGroup(selected.id); }); }}>{copy.room.leave}</button> : <button className={styles.ghost} type="button" onClick={() => setDialog(null)}>{copy.cancel}</button>}
              {dialog === "edit" || dialog === "edit-session" || dialog === "schedule" ? <button className={styles.primary} type="submit">{dialog === "schedule" ? copy.scheduleAction : copy.save}</button> : null}
            </div>
          </form>
        </dialog>
      ) : null}
    </div>
  );
}
