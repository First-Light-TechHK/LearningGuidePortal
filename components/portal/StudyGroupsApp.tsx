"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import type { Locale } from "@/lib/i18n/config";
import { getMessages } from "@/lib/i18n/messages";
import { sessionStateLabel, studyGroupErrorPlace, studyGroupHasError, studyGroupMutation, studyGroupPane, uniqueReminderBodies } from "@/modules/group-study/uiState";
import { PortalDialog } from "./PortalDialog";
import styles from "./study-groups.module.css";
import { DURATION_MINUTE_CHOICES, clampGroupAbout, fill, GROUP_ABOUT_MAX, hostMayOpenRoom, plannedMinutes, scheduleSessionFields, SEAT_HEARTBEAT_MS, SESSION_TITLE_MAX, sessionDateLabel, sessionNotStarted, sessionScheduleLabel, sessionTimeLabel, sessionTitleCount, studyGroupFormProblem, studyGroupRequest, type StudyGroupDetail, type StudySession } from "./studyGroupClient";

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

function HourglassIcon() {
  return (
    <svg viewBox="0 0 28 28" width={28} height={28} aria-hidden="true" fill="currentColor">
      <path d="M15 20H13C12.4 20 12 20.4 12 21C12 21.6 12.4 22 13 22H15C15.6 22 16 21.6 16 21C16 20.4 15.6 20 15 20ZM23 24H22C22 19.8 19.6 17.4 18 15.6C17.4 15 16.6 14.4 16.6 14C16.6 13.8 17.2 13.4 17.6 13.2C19.2 12 22 9.8 22 4H23C23.6 4 24 3.6 24 3C24 2.4 23.6 2 23 2H5C4.4 2 4 2.4 4 3C4 3.6 4.4 4 5 4H6C6 9.8 8.8 12 10.4 13.2C10.8 13.4 11.4 13.8 11.4 14C11.4 14.4 10.6 15 10 15.8C8.4 17.4 6 19.8 6 24H5C4.4 24 4 24.4 4 25C4 25.6 4.4 26 5 26H23C23.6 26 24 25.6 24 25C24 24.4 23.6 24 23 24ZM8 24C8 20.6 10 18.6 11.4 17C12.4 16 13.4 15 13.4 14C13.4 12.8 12.6 12.2 11.6 11.6C10 10.4 8 8.8 8 4H20C20 8.8 18 10.4 16.4 11.6C15.4 12.2 14.6 12.8 14.6 14C14.6 15.2 15.6 16 16.6 17C18 18.6 20 20.6 20 24H8Z" />
    </svg>
  );
}

function LockedCard() {
  return (
    <div className={styles.locked} aria-hidden="true">
      <span className={styles.lockedTitle} />
      <span className={styles.lockedSub} />
      <span className={styles.lockedFact1} />
      <span className={styles.lockedFact2} />
      <span className={styles.lockedFact3} />
      <span className={styles.lockedFactBox} />
      <span className={styles.lockedAvatars}><i /><i /><i /><i /><i /></span>
    </div>
  );
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
  const [errorCode, setErrorCode] = useState("idle");
  const [dialog, setDialog] = useState<"create" | "edit" | "schedule" | "edit-session" | "waiting" | "attendees" | "cancel-group" | "cancel-session" | "leave-group" | null>(null);
  // The one in-flight write of the shared dialogs, Join and the confirms: its
  // buttons are disabled and the dialog is busy until it settles (QA N8).
  const [submitting, setSubmitting] = useState(false);
  const [confirmSession, setConfirmSession] = useState<StudySession | null>(null);
  // Opening one group failed: the pane shows the error with a Retry that opens
  // that same group again (QA N10), while the lists stay as they are.
  const [groupError, setGroupError] = useState<string | null>(null);
  const loadedOnce = useRef(false);
  const mainRef = useRef<HTMLElement>(null);
  const [createdGroup, setCreatedGroup] = useState<{ id: string; title: string; courseTitle: string } | null>(null);
  const [creating, setCreating] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [mutating, setMutating] = useState<string | null>(null);
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
  const [editAbout, setEditAbout] = useState("");
  const [reminders, setReminders] = useState<Array<{ body: string; createdAt: string }>>([]);
  const listGeneration = useRef(0);
  const listLoading = useRef(false);
  const openGroupId = useRef<string | null>(null);
  const waitingHoldRef = useRef<string | null>(null);
  const waitingHandedOffRef = useRef(false);

  // Runs one write at a time for the shared dialogs, Join and the confirms.
  async function guarded(run: () => Promise<void>) {
    if (submitting) return;
    setSubmitting(true);
    try {
      await run();
    } finally {
      setSubmitting(false);
    }
  }

  async function loadLists(options: { poll?: boolean } = {}) {
    // A poll never supersedes a load still in flight: when the lists take
    // longer than the poll interval, superseding every answer would leave the
    // page on "loading" for good. An explicit load (after a change) still does.
    if (options.poll && listLoading.current) return;
    const generation = ++listGeneration.current;
    listLoading.current = true;
    try {
      const [myResult, discoverResult, courseResult, reminderResult] = await Promise.all([
        signedIn ? studyGroupRequest<Card[]>("/api/study-groups?view=mine") : Promise.resolve({ ok: true, code: "ok", message: "", data: [] as Card[] }),
        studyGroupRequest<Card[]>(`/api/study-groups?view=discover&courseId=${encodeURIComponent(courseFilter)}&q=${encodeURIComponent(query)}`),
        signedIn ? studyGroupRequest<CourseOption[]>("/api/study-groups?view=courses") : Promise.resolve({ ok: true, code: "ok", message: "", data: [] as CourseOption[] }),
        signedIn ? studyGroupRequest<Array<{ body: string; createdAt: string }>>("/api/study-groups?view=reminders") : Promise.resolve({ ok: true, code: "ok", message: "", data: [] as Array<{ body: string; createdAt: string }> })
      ]);
      if (generation !== listGeneration.current) return;
      if (!myResult.ok || !discoverResult.ok) {
        // Only a list that never loaded is an error page; a failed 3 s poll
        // keeps what is on screen and the next poll heals it (QA N10).
        if (loadedOnce.current) return;
        setStatus("error");
        setErrorCode(myResult.ok ? discoverResult.code : myResult.code);
        return;
      }
      loadedOnce.current = true;
      setMine(myResult.data);
      setDiscover(discoverResult.data);
      if (courseResult.ok) setCourses(courseResult.data);
      if (reminderResult.ok) setReminders(uniqueReminderBodies(reminderResult.data));
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
    } catch {
      // M6: a rejected fetch (offline, a non-JSON gateway page) must land the screen
      // on the pane error with its Retry button instead of staying on "loading"
      // forever - the anonymous visitor has no 3s poll to self-heal.
      if (generation !== listGeneration.current || loadedOnce.current) return;
      setStatus("error");
      setErrorCode("error");
    } finally {
      if (generation === listGeneration.current) listLoading.current = false;
    }
  }

  async function openGroup(id: string, options: { reveal?: boolean } = {}) {
    const switching = openGroupId.current !== id;
    openGroupId.current = id;
    setSelectedId(id);
    setCreatedGroup(null);
    setGroupError(null);
    // A mutation error belongs to the group it came from: opening another
    // group starts clean (QA N10).
    if (switching) setErrorCode("idle");
    if (switching) setSelected(null);
    const result = await studyGroupRequest<StudyGroupDetail>(`/api/study-groups/${id}`);
    if (openGroupId.current !== id) return;
    if (!result.ok) {
      setGroupError(result.code);
      return;
    }
    setSelected(result.data);
    setMine((current) => current.map((group) => group.id === result.data.id ? { ...group, live: result.data.live, memberCount: result.data.memberCount } : group));
    if (status === "loading") setStatus("ready");
    // Single-column (phone) layout: the detail renders under the whole list,
    // so a tap looked like it did nothing (QA N12). Bring it into view.
    if (options.reveal && window.matchMedia("(max-width: 800px)").matches) mainRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
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

  // While the waiting dialog holds a seat, its heartbeat keeps it. Closing the
  // page simply stops the heartbeat and the server releases the seat one
  // lease later (modules/group-study/presence.ts); only the explicit Close
  // below releases it at once.
  useEffect(() => {
    if (dialog !== "waiting" || !waitingSession) return;
    const sessionId = waitingSession.id;
    const timer = window.setInterval(() => {
      void studyGroupRequest<{ seated: boolean }>(`/api/study-groups/sessions/${sessionId}/heartbeat`, { method: "POST", body: "{}" }).then((result) => {
        if (result.ok && !result.data.seated && waitingHoldRef.current === sessionId) {
          void studyGroupRequest(`/api/study-groups/sessions/${sessionId}/enter`, { method: "POST", body: "{}" });
        }
      });
    }, SEAT_HEARTBEAT_MS);
    return () => window.clearInterval(timer);
  }, [dialog, waitingSession?.id]);

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
    void fetch(`/api/study-groups/sessions/${held}/leave`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}", keepalive: true }).catch(() => undefined);
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
    const timer = window.setInterval(() => { void loadLists({ poll: true }); }, 3_000);
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
  const timeOnly = dialog === "edit-session";
  const signInHref = `/${locale}/portal/sign-in?returnTo=${encodeURIComponent(`/${locale}/portal/study-groups${selectedId ? `?group=${selectedId}` : ""}`)}`;
  const errorPlace = studyGroupErrorPlace({ status, dialog, hasSelected: Boolean(selected), hasError: studyGroupHasError(errorCode) });

  async function submitCreate(form: FormData) {
    if (creating) return;
    setCreating(true);
    try {
      const result = await studyGroupRequest<StudyGroupDetail>("/api/study-groups", {
        method: "POST",
        body: JSON.stringify({ title: form.get("title"), courseId: form.get("courseId"), about: form.get("about") })
      });
      if (!result.ok) {
        setErrorCode(result.code);
        return;
      }
      setCreatedGroup({ id: result.data.id, title: result.data.title, courseTitle: result.data.courseTitle });
      setDialog(null);
      setErrorCode("idle");
      setCreateTitle("");
      setCreateAbout("");
      await loadLists();
    } finally {
      setCreating(false);
    }
  }

  async function submitCancelGroup() {
    if (!selected || cancelling) return;
    setCancelling(true);
    try {
      const result = await studyGroupRequest(`/api/study-groups/${selected.id}/cancel`, { method: "POST", body: "{}" });
      setDialog(null);
      if (!result.ok) {
        setErrorCode(result.code);
        return;
      }
      setErrorCode("idle");
      // Forget the open group too, so a group refresh still in flight cannot
      // bring the cancelled group back (QA BUG-0099 follow-up).
      openGroupId.current = null;
      setSelected(null);
      setSelectedId(null);
      await loadLists();
    } finally {
      setCancelling(false);
    }
  }

  async function runSessionMutation(action: "plan" | "cancel-attendance" | "cancel-session", session: StudySession) {
    if (!selected || mutating) return;
    const groupId = selected.id;
    setMutating(`${action}:${session.id}`);
    try {
      // Cancelling a Session is POST …/cancel; the action name is the UI's.
      const route = action === "cancel-session" ? "cancel" : action;
      const result = await studyGroupRequest(`/api/study-groups/sessions/${session.id}/${route}`, { method: "POST", body: "{}" });
      const outcome = studyGroupMutation({ action, result });
      if (!outcome.ok) {
        setErrorCode(outcome.errorCode);
        return;
      }
      setErrorCode("idle");
      setDialog((current) => current === "cancel-session" ? null : current);
      await openGroup(groupId);
    } finally {
      setMutating(null);
    }
  }

  async function runLeaveGroup() {
    if (!selected || mutating) return;
    setMutating("leave");
    try {
      const result = await studyGroupRequest(`/api/study-groups/${selected.id}/leave`, { method: "POST", body: "{}" });
      const outcome = studyGroupMutation({ action: "leave", result });
      if (!outcome.ok) {
        setErrorCode(outcome.errorCode);
        return;
      }
      setErrorCode("idle");
      setDialog(null);
      if (outcome.clearSelection) {
        openGroupId.current = null;
        setSelected(null);
        setSelectedId(null);
      }
      await loadLists();
    } finally {
      setMutating(null);
    }
  }

  function closeDialog() {
    setErrorCode("idle");
    setDialog(null);
  }

  function closeWaiting() {
    setErrorCode("idle");
    setDialog(null);
    setWaitingSession(null);
  }

  function openEditGroup() {
    setErrorCode("idle");
    setEditAbout(clampGroupAbout(selected?.about || ""));
    setDialog("edit");
  }

  function openSchedule() {
    setErrorCode("idle");
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
    setErrorCode("idle");
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
    await guarded(async () => {
      const result = await studyGroupRequest<StudyGroupDetail>(`/api/study-groups/${selected.id}`, {
        method: "PATCH",
        body: JSON.stringify({ title: form.get("title"), about: form.get("about") })
      });
      if (!result.ok) {
        setErrorCode(result.code);
        return;
      }
      setErrorCode("idle");
      setDialog(null);
      await openGroup(selected.id);
      await loadLists();
    });
  }

  async function submitSchedule(form: FormData) {
    if (!selected) return;
    await guarded(async () => {
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
      setErrorCode("idle");
      setDialog(null);
      await openGroup(selected.id);
    });
  }

  async function submitEditSession(form: FormData) {
    if (!selected || !editingSession) return;
    await guarded(async () => {
      const startsAt = new Date(`${form.get("date")}T${form.get("time")}`).toISOString();
      const result = await studyGroupRequest<StudySession>(`/api/study-groups/sessions/${editingSession.id}`, {
        method: "PATCH",
        // Only the Start Time of an upcoming Session can change (BUG-0157).
        body: JSON.stringify({ groupId: selected.id, startsAt })
      });
      if (!result.ok) {
        setErrorCode(result.code);
        return;
      }
      setErrorCode("idle");
      setDialog(null);
      setEditingSession(null);
      await openGroup(selected.id);
    });
  }

  async function startSession(session: StudySession) {
    await guarded(async () => {
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
    });
  }

  async function joinGroup(group: StudyGroupDetail) {
    await guarded(async () => {
      const result = await studyGroupRequest(`/api/study-groups/${group.id}/join`, { method: "POST", body: "{}" });
      if (!result.ok) {
        setErrorCode(result.code);
        return;
      }
      await loadLists();
      await openGroup(group.id);
    });
  }

  // Runs the shared validation before a dialog form submits (BUG-0125): the
  // form is noValidate, so a problem becomes the page's own message.
  function submitDialogForm(formElement: HTMLFormElement, submit: (form: FormData) => Promise<void>) {
    const problem = studyGroupFormProblem(formElement);
    if (problem) {
      setErrorCode(problem);
      return;
    }
    void submit(new FormData(formElement));
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
        {/* BUG-0130: a signed-out visitor has no "My" Study Groups — the heading, Create
            button and All / Hosted by Me tabs render only for signed-in users. */}
        {signedIn ? <div className={styles.sectionHead}>
          <h2>{copy.myGroups}</h2>
          <button className={styles.create} type="button" onClick={() => { setCreatedGroup(null); setCreateTitle(""); setCreateAbout(""); setErrorCode("idle"); setDialog("create"); }}>+ {copy.create}</button>
        </div> : null}
        {signedIn ? <div className={styles.tabs} role="group" aria-label={copy.myGroups}>
          <button type="button" aria-pressed={mineFilter === "all"} onClick={() => setMineFilter("all")}>{copy.all}</button>
          <button type="button" aria-pressed={mineFilter === "host"} onClick={() => setMineFilter("host")}>{copy.hostedByMe}</button>
        </div> : null}
        {signedIn && visibleMine.length === 0 ? <p className={styles.noMine}>{copy.noMine}</p> : null}
        {visibleMine.map((group) => (
          <button className={styles.card} type="button" key={group.id} aria-current={selectedId === group.id} onClick={() => void openGroup(group.id, { reveal: true })}>
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
          <button className={styles.card} type="button" key={group.id} aria-current={selectedId === group.id} onClick={() => void openGroup(group.id, { reveal: true })}>
            <h3>{group.title}</h3>
            {group.live ? <span className={styles.live}>{copy.live}</span> : null}
            <p className={styles.course}>{group.courseTitle}</p>
            <p className={styles.openLabel}>{copy.openStudyGroup}</p>
            <p className={styles.count}>{fill(copy.learners, { count: group.memberCount })}</p>
          </button>
        ))}
      </aside>
      <section className={styles.main} aria-live="polite" ref={mainRef}>
        {pane.kind === "loading" ? <p className={styles.panel} role="status">{copy.loading}</p> : null}
        {pane.kind === "error" ? <div className={styles.panel} role="alert"><p className={styles.alert}>{errorText}</p>{errorCode === "unauthenticated" ? <a className={styles.primary} href={signInHref}>{copy.signIn}</a> : <button className={styles.primary} type="button" onClick={() => { setErrorCode("idle"); void loadLists(); }}>{copy.retry}</button>}</div> : null}
        {pane.kind !== "error" && pane.kind !== "loading" && groupError && selectedId ? <div className={styles.panel} role="alert"><p className={styles.alert}>{copy.errors[groupError as keyof typeof copy.errors] || copy.errors.error}</p>{groupError === "unauthenticated" ? <a className={styles.primary} href={signInHref}>{copy.signIn}</a> : <button className={styles.primary} type="button" onClick={() => void openGroup(selectedId)}>{copy.retry}</button>}</div> : null}
        {pane.kind === "empty" && selectedId && !groupError && !createdGroup && dialog !== "create" ? <p className={styles.panel} role="status">{copy.loading}</p> : null}
        {pane.kind === "empty" && !selectedId && dialog !== "create" && !createdGroup ? <div className={styles.empty}><p>{copy.emptyTitle}</p><Image src="/portal/study-groups/empty-illustration.png" width={250} height={150} alt="" /><h2>{copy.emptyLead}</h2><p className={styles.body}>{copy.emptyBody}</p>{signedIn ? null : <p><a href={`/${locale}/portal/sign-in`}>{copy.signIn}</a> {copy.signInRequired}</p>}</div> : null}
        {createdGroup ? <div className={`${styles.panel} ${styles.createdPanel}`} role="status"><span className={styles.createdIcon} aria-hidden="true"><Image src="/portal/study-groups/success.svg" width={32} height={32} alt="" /><i>✓</i></span><div><strong>{copy.createdTitle}</strong><span className={styles.createdBody}>{copy.createdBody}</span></div><button className={styles.primary} type="button" onClick={() => { const id = createdGroup.id; setCreatedGroup(null); setErrorCode("idle"); setCreateTitle(""); setCreateAbout(""); void openGroup(id); }}>{copy.openGroup}</button></div> : null}
        {dialog === "create" ? (
          <PortalDialog className={styles.modal} labelledBy="study-group-dialog-title" onClose={closeDialog} busy={creating}>
            <form className={styles.createForm} noValidate onSubmit={(event) => { event.preventDefault(); submitDialogForm(event.currentTarget, submitCreate); }}>
              <h2 id="study-group-dialog-title">{copy.create}</h2>
              <p className={styles.lead}>{copy.createLead}</p>
              <label className={styles.field}><span>{copy.groupTitle} <span className={styles.req}>*</span></span><span className={styles.fieldBox}><input name="title" required maxLength={50} placeholder={copy.enterTitle} value={createTitle} onChange={(event) => setCreateTitle(event.target.value.slice(0, 50))} /><span className={styles.counter}>{createTitle.length}/50</span></span></label>
              <label className={styles.field}><span>{copy.relatedCourse} <span className={styles.req}>*</span></span><select name="courseId" required defaultValue=""><option value="">{copy.selectCourse}</option>{courses.map((course) => <option key={course.id} value={course.id}>{course.title}</option>)}</select></label>
              <label className={styles.field}><span>{copy.about} <span className={styles.req}>*</span></span><span className={styles.fieldBox}><textarea name="about" required maxLength={GROUP_ABOUT_MAX} placeholder={copy.enterDescription} value={createAbout} onChange={(event) => setCreateAbout(clampGroupAbout(event.target.value))} /><span className={styles.counter}>{createAbout.length}/{GROUP_ABOUT_MAX}</span></span></label>
              <div className={styles.actions}><button className={styles.ghost} type="button" onClick={closeDialog}>{copy.cancel}</button><button className={styles.primary} type="submit" disabled={creating}>{copy.create}</button></div>
              {errorPlace === "create" ? <p className={styles.alert} role="alert">{errorText}</p> : null}
            </form>
          </PortalDialog>
        ) : null}
        {selected && pane.kind !== "loading" && pane.kind !== "error" && dialog !== "create" && !createdGroup ? (
          <div className={styles.sheet}>
            <article>
              <h2 className={styles.groupTitle}>{selected.title}</h2>
              {selected.role === "host" ? <span className={styles.hostChip}>{copy.hosting}</span> : null}
              {selected.role === "member" ? <span className={`${styles.hostChip} ${styles.joinedChip}`}>{copy.joined}</span> : null}
              <div className={styles.facts}>
                <div><h3>{copy.relatedCourse}</h3><p>{selected.courseTitle}</p></div>
                <div><h3 className={styles.aboutLabel}>{copy.about}</h3><p className={styles.aboutBody}>{selected.about}</p></div>
              </div>
              <div className={styles.tabRow}><span className={styles.tab}>{copy.liveSessions}</span><span className={styles.countBadge}>{(selected.sessions || []).length}</span></div>
              <h3 className={styles.sectionLabel}>{copy.liveSessions}</h3>
              {errorPlace === "sheet" ? <p className={styles.alert} role="alert">{errorText}</p> : null}
              {pane.kind === "join-gate" ? (
                <>
                  <p className={styles.joinBanner}>{copy.joinBanner}</p>
                  <LockedCard />
                  <LockedCard />
                  <p className={styles.joinNote}>{selected.canJoin ? copy.joinAccess : fill(copy.courseAccessRequired, { course: selected.courseTitle })}</p>
                  <div className={styles.joinAction}>{selected.canJoin ? <button className={styles.primary} type="button" disabled={submitting} onClick={() => void joinGroup(selected)}>{copy.joinGroup}</button> : <a className={styles.primary} href={signedIn ? `/${locale}/portal/courses/${selected.courseSlug}` : signInHref}>{signedIn ? copy.getCourseAccess : copy.signIn}</a>}</div>
                </>
              ) : null}
              {pane.kind === "sessions" && (selected.sessions || []).length === 0 ? <div className={styles.emptySessions}><p>{copy.noSessions}</p><Image src="/portal/study-groups/empty-sessions.png" width={150} height={113} alt="" /></div> : null}
              {pane.kind === "sessions" ? (selected.sessions || []).map((session) => (
                <article className={styles.session} key={session.id}>
                  <div className={styles.sessionBody}>
                  <p className={styles.sessionState} data-state={sessionNotStarted(session) ? "missed" : session.state}>{sessionNotStarted(session) ? copy.notStarted : copy[session.state === "live" ? "liveNow" : sessionStateLabel(session.state)]}</p>
                  <h3>{session.title}</h3>
                  {session.focus ? <p>{session.focus}</p> : null}
                  {session.relatedLessonId ? <p>{(selected.lessons || []).find((lesson) => lesson.id === session.relatedLessonId)?.title}</p> : null}
                  <ul className={styles.factList}>
                    <li><FactIcon kind="date" />{sessionDateLabel(locale, session.startsAt)}<span className={styles.divider} aria-hidden="true" />{sessionTimeLabel(locale, session)}</li>
                    <li><FactIcon kind="duration" />{fill(copy.plannedDuration, { count: plannedMinutes(session) })}</li>
                    <li data-live={!sessionNotStarted(session) && (session.state === "live" || session.state === "starting_soon") ? "true" : undefined}><FactIcon kind="people" />{sessionNotStarted(session) ? copy.notStartedBody : session.state === "completed" ? <>{fill(copy.attended, { count: session.attendees.length })}<span className={styles.divider} aria-hidden="true" />{fill(copy.maximumLine, { count: session.maxParticipants })}</> : session.state === "scheduled" ? <>{fill(copy.plannedCount, { count: session.plannedCount })}<span className={styles.divider} aria-hidden="true" />{fill(copy.maximumLine, { count: session.maxParticipants })}</> : fill(copy.currentlyInSession, { count: session.occupancy, max: session.maxParticipants })}</li>
                  </ul>
                  {session.state === "scheduled" && (selected.role === "host" || session.viewerPlanned) ? <p className={styles.reminderHint}>{copy.reminderHint}</p> : null}
                  {session.attendees.length ? <p className={styles.avatarRow}>{session.attendees.slice(0, 4).map((person) => <span key={person.userId}>{person.displayName.slice(0, 1).toUpperCase()}</span>)}{session.attendees.length > 4 ? <span className={styles.avatarMore}>+{session.attendees.length - 4}</span> : null}</p> : null}
                  {(session.state === "scheduled" || (session.state === "starting_soon" && !sessionNotStarted(session))) && session.viewerPlanned ? <p className={styles.planningTag}>{copy.planning}</p> : null}
                  </div>
                  <div className={styles.row}>
                    {selected.role === "host" && session.state === "starting_soon" && !sessionNotStarted(session) ? <button className={styles.primary} type="button" disabled={submitting} onClick={() => void startSession(session)}>{copy.start}</button> : null}
                    {!sessionNotStarted(session) && (session.state === "live" || (session.state === "starting_soon" && selected.role !== "host")) ? <button className={styles.primary} type="button" disabled={session.occupancy >= session.maxParticipants} onClick={() => void enter(session)}>{session.occupancy >= session.maxParticipants ? copy.sessionFull : copy.joinNow}</button> : null}
                    {(session.state === "scheduled" || (session.state === "starting_soon" && !sessionNotStarted(session))) && selected.role === "member" && !session.viewerPlanned ? <><button className={styles.primary} type="button" disabled={mutating !== null} onClick={() => void runSessionMutation("plan", session)}>{copy.plan}</button><p className={styles.planNote}>{copy.planNote}</p></> : null}
                    {(session.state === "scheduled" || (session.state === "starting_soon" && !sessionNotStarted(session))) && session.viewerPlanned ? <button className={styles.danger} type="button" disabled={mutating !== null} onClick={() => void runSessionMutation("cancel-attendance", session)}>{copy.cancelAttendance}</button> : null}
                    {selected.role === "host" && (session.state === "scheduled" || session.state === "starting_soon") ? <button className={styles.ghost} type="button" onClick={() => openEditSession(session)}>{copy.editSession}</button> : null}
                    {selected.role === "host" && (session.state === "scheduled" || session.state === "starting_soon") ? <button className={styles.danger} type="button" disabled={mutating !== null} onClick={() => { setErrorCode("idle"); setConfirmSession(session); setDialog("cancel-session"); }}>{copy.cancelSession}</button> : null}
                    <button className={styles.textButton} type="button" onClick={() => { setAttendeeSessionId(session.id); setAttendees(session.attendees); setDialog("attendees"); }}>{copy.viewAttendees}<span aria-hidden="true"> ›</span></button>
                  </div>
                </article>
              )) : null}
            </article>
            <aside className={styles.memberCol} aria-label={copy.members}>
              <h3>{copy.members} <span className={styles.countBadge}>{selected.memberCount}</span></h3>
              <ul className={styles.memberList}>
                {(selected.members || []).map((member) => <li key={member.userId}><span className={styles.memberAvatar}>{member.displayName.slice(0, 1)}</span><span>{member.displayName}</span>{member.role === "host" ? <span className={styles.hostTag}>{copy.room.host}</span> : null}</li>)}
              </ul>
              {selected.role === "host" ? <div className={`${styles.hostFoot} ${styles.hostFootWithCopy}`}><p>{copy.hostingNote}</p><button className={styles.primary} type="button" onClick={openSchedule}>{copy.schedule}</button><button className={styles.ghost} type="button" onClick={openEditGroup}>{copy.editGroup}</button><button className={styles.danger} type="button" onClick={() => setDialog("cancel-group")}>{copy.cancelGroup}</button></div> : null}
              {selected.role === "member" ? <div className={styles.hostFoot}><button className={styles.ghost} type="button" disabled={mutating !== null} onClick={() => { setErrorCode("idle"); setDialog("leave-group"); }}>{copy.leaveGroup}</button></div> : null}
            </aside>
          </div>
        ) : null}
      </section>
      {dialog === "edit" || dialog === "edit-session" || dialog === "schedule" || dialog === "waiting" || dialog === "attendees" ? (
        <PortalDialog className={styles.modal} labelledBy="study-group-dialog-title" onClose={dialog === "waiting" ? closeWaiting : closeDialog} busy={submitting}>
          <form method="dialog" noValidate onSubmit={(event) => { event.preventDefault(); if (dialog === "edit") submitDialogForm(event.currentTarget, submitEdit); if (dialog === "edit-session") submitDialogForm(event.currentTarget, submitEditSession); if (dialog === "schedule") submitDialogForm(event.currentTarget, submitSchedule); }}>
            {dialog !== "waiting" ? <h2 id="study-group-dialog-title">{dialog === "schedule" ? copy.schedule : dialog === "attendees" ? copy.viewAttendees : dialog === "edit-session" ? copy.editSession : dialog === "edit" ? copy.editGroup : copy.create}</h2> : null}
            {dialog === "waiting" && waitingSession ? (
              <div role="status">
                <h2 id="study-group-dialog-title" className={styles.waitingBanner}><HourglassIcon /><span>{copy.waiting}</span></h2>
                <p className={styles.waitingTitle}>{waitingSession.title}</p>
                <ul className={styles.waitingFacts}>
                  <li><FactIcon kind="date" />{sessionDateLabel(locale, waitingSession.startsAt)}<span className={styles.divider} aria-hidden="true" />{sessionTimeLabel(locale, waitingSession)}<FactIcon kind="duration" />{fill(copy.plannedDuration, { count: plannedMinutes(waitingSession) })}</li>
                  <li><FactIcon kind="people" />{fill(copy.upToParticipants, { count: waitingSession.maxParticipants })}</li>
                </ul>
                {waitingSession.focus ? <><h3 className={styles.waitingFocus}>{copy.focus}</h3><p>{waitingSession.focus}</p></> : null}
              </div>
            ) : null}
            {dialog === "attendees" ? <ul>{attendees.map((person) => <li key={person.userId}>{person.displayName}</li>)}</ul> : null}
            {dialog === "edit" ? (
              <>
                <label>{copy.groupTitle}<input name="title" required maxLength={50} defaultValue={selected?.title} /></label>
                <p>{selected?.courseTitle}</p>
                <label>{copy.about}<span className={styles.fieldBox}><textarea name="about" required maxLength={GROUP_ABOUT_MAX} value={editAbout} onChange={(event) => setEditAbout(clampGroupAbout(event.target.value))} /><span className={styles.counter}>{editAbout.length}/{GROUP_ABOUT_MAX}</span></span></label>
              </>
            ) : null}
            {dialog === "schedule" || dialog === "edit-session" ? (
              <>
                <p className={styles.lead}>{dialog === "edit-session" ? copy.editSessionLead : copy.arrangeLead}</p>
                <div className={styles.contextCard}><strong>{selected?.title}</strong><span>{selected?.about}</span></div>
                <label className={styles.field}><span>{copy.sessionTitle} <span className={styles.req}>*</span></span><span className={styles.fieldBox}><input name="title" required disabled={timeOnly} maxLength={SESSION_TITLE_MAX} value={sessionTitle} onChange={(event) => setSessionTitle(event.target.value.slice(0, SESSION_TITLE_MAX))} /><span className={styles.counter}>{sessionTitleCount(sessionTitle)}</span></span></label>
                <label className={styles.field}><span>{copy.relatedLesson}</span><select name="lesson" disabled={timeOnly} value={sessionLesson} onChange={(event) => setSessionLesson(event.target.value)}><option value="">{copy.selectLesson}</option>{(selected?.lessons || []).map((lesson) => <option key={lesson.id} value={lesson.id}>{lesson.title}</option>)}</select></label>
                <div className={styles.pair}>
                  <label className={styles.field}><span>{copy.date} <span className={styles.req}>*</span></span><input name="date" type="date" required min={todayDate()} value={sessionDate} onChange={(event) => setSessionDate(event.target.value)} /></label>
                  <label className={styles.field}><span>{copy.startTime} <span className={styles.req}>*</span></span><input name="time" type="time" required min={earliestTime(sessionDate) || undefined} value={sessionTime} onChange={(event) => setSessionTime(event.target.value)} /></label>
                  <label className={styles.field}><span>{copy.duration} <span className={styles.req}>*</span></span><select name="durationMinutes" required disabled={timeOnly} value={sessionDuration} onChange={(event) => setSessionDuration(event.target.value)}><option value="">{copy.selectDuration}</option>{DURATION_MINUTE_CHOICES.map((minutes) => <option key={minutes} value={minutes}>{fill(copy.plannedDuration, { count: minutes })}</option>)}</select></label>
                  <label className={styles.field}><span>{copy.maxParticipants} <span className={styles.req}>*</span> <span className={styles.hint}>{copy.maximumSix}</span></span><select name="maxParticipants" required disabled={timeOnly} value={sessionMax} onChange={(event) => setSessionMax(event.target.value)}><option value="">{copy.selectMaximum}</option>{[2, 3, 4, 5, 6].map((count) => <option key={count} value={count}>{count}</option>)}</select></label>
                </div>
                <label className={styles.field}>{copy.focus}<span className={`${styles.fieldBox} ${styles.focusBox}`}><textarea name="focus" disabled={timeOnly} maxLength={50} placeholder={copy.enterDescription} value={sessionFocus} onChange={(event) => setSessionFocus(event.target.value.slice(0, 50))} /><span className={styles.counter}>{sessionFocus.length}/50</span></span></label>
                <label className={styles.switch}><span>{copy.aiTutorLabel}</span><span className={styles.switchText}>{copy.enableAiTutor}</span><input name="aiTutor" type="checkbox" disabled={timeOnly} checked={sessionTutor} onChange={(event) => setSessionTutor(event.target.checked)} /></label>
              </>
            ) : null}
            {errorPlace === "dialog" ? <p className={styles.alert} role="alert">{errorText}</p> : null}
            {dialog !== "waiting" ? (
              <div className={styles.dialogActions}>
                <button className={styles.ghost} type="button" onClick={closeDialog} disabled={submitting}>{copy.cancel}</button>
                {dialog === "edit" || dialog === "edit-session" || dialog === "schedule" ? <button className={styles.primary} type="submit" disabled={submitting}>{dialog === "schedule" ? copy.scheduleAction : copy.save}</button> : null}
              </div>
            ) : (
              <div className={styles.dialogActions}>
                <button className={styles.ghost} type="button" onClick={closeWaiting}>{copy.close}</button>
              </div>
            )}
          </form>
        </PortalDialog>
      ) : null}
      {dialog === "cancel-group" ? (
        <PortalDialog className={styles.modal} labelledBy="study-group-dialog-title" onClose={closeDialog} busy={cancelling}>
          <form method="dialog" onSubmit={(event) => { event.preventDefault(); void submitCancelGroup(); }}>
            <h2 id="study-group-dialog-title">{copy.cancelGroupConfirmTitle}</h2>
            <p className={styles.confirmBody}>{copy.confirmCancelGroup}</p>
            <div className={styles.dialogActions}>
              <button className={styles.ghost} type="button" onClick={closeDialog} disabled={cancelling}>{copy.confirmBack}</button><button className={styles.danger} type="submit" disabled={cancelling}>{copy.confirmCancelGroupAction}</button>
            </div>
          </form>
        </PortalDialog>
      ) : null}
      {dialog === "cancel-session" || dialog === "leave-group" ? (
        <PortalDialog className={styles.modal} labelledBy="study-group-dialog-title" onClose={closeDialog} busy={mutating !== null}>
          <form method="dialog" onSubmit={(event) => { event.preventDefault(); if (dialog === "leave-group") void runLeaveGroup(); else if (confirmSession) void runSessionMutation("cancel-session", confirmSession); }}>
            <h2 id="study-group-dialog-title">{dialog === "leave-group" ? copy.leaveGroupConfirmTitle : copy.cancelSessionConfirmTitle}</h2>
            <p className={styles.confirmBody}>{dialog === "leave-group" ? copy.confirmLeaveGroup : copy.confirmCancelSession}</p>
            {errorPlace === "dialog" ? <p className={styles.alert} role="alert">{errorText}</p> : null}
            <div className={styles.dialogActions}>
              <button className={styles.ghost} type="button" onClick={closeDialog} disabled={mutating !== null}>{copy.confirmBack}</button><button className={styles.danger} type="submit" disabled={mutating !== null}>{dialog === "leave-group" ? copy.confirmLeaveGroupAction : copy.confirmCancelSessionAction}</button>
            </div>
          </form>
        </PortalDialog>
      ) : null}
    </div>
  );
}
