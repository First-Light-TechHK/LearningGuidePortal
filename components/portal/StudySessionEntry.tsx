"use client";

import { AlertCircle, Ban, BookOpen, Calendar, CircleCheck, Clock, ExternalLink, Lock, RefreshCw, Timer, UserPlus, Users } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import type { Locale } from "@/lib/i18n/config";
import { getMessages } from "@/lib/i18n/messages";
import styles from "./study-groups.module.css";
import { StudySessionRoom } from "./StudySessionRoom";
import { courseAccessHref, fill, plannedMinutes, roomSignInHref, sessionDateLabel, sessionEntryAccessGained, sessionEntryRecheckMs, sessionTimeLabel, studyGroupListHref, studyGroupRequest, type SessionEntry } from "./studyGroupClient";

type Tone = "red" | "amber" | "blue" | "gray";

// A link to one Live Session (reminder mail, in-site reminder, a shared
// address). The server answers where the viewer goes (GET /entry,
// modules/group-study/entry.ts); this page only shows that answer: the live
// room, the list's waiting dialog or Start, or one page that says why the
// viewer stops and offers the one way on (Figma Deep Link 01-03; the states
// it has no frame for follow the deep-link PDF, 2026-10-30).
export function StudySessionEntry({ locale, sessionId }: { locale: Locale; sessionId: string }) {
  const copy = getMessages(locale).studyGroupsPage;
  const dl = copy.deepLink;
  const router = useRouter();
  const [entry, setEntry] = useState<SessionEntry | null>(null);
  const [loadError, setLoadError] = useState("");
  const [actionError, setActionError] = useState("");
  const [busy, setBusy] = useState(false);
  const [accessGained, setAccessGained] = useState(false);
  const lastNext = useRef<SessionEntry["next"] | null>(null);
  // Only the newest answer is shown: a timer's check and an action's check
  // may overlap.
  const checkSeq = useRef(0);

  const check = useCallback(async () => {
    const seq = ++checkSeq.current;
    const result = await studyGroupRequest<SessionEntry>(`/api/study-groups/sessions/${encodeURIComponent(sessionId)}/entry`);
    if (seq !== checkSeq.current) return;
    if (!result.ok) {
      setLoadError(result.code);
      return;
    }
    setLoadError("");
    if (sessionEntryAccessGained(lastNext.current, result.data.next)) setAccessGained(true);
    lastNext.current = result.data.next;
    setEntry(result.data);
  }, [sessionId]);

  useEffect(() => {
    void check();
  }, [check]);

  // Nobody enters before the Host starts: a member waits in the list's
  // waiting dialog (it takes the seat), the Host starts from the list.
  useEffect(() => {
    if (!entry?.group) return;
    if (entry.next === "wait") router.replace(studyGroupListHref(locale, entry.group.id, sessionId));
    else if (entry.next === "host_start") router.replace(studyGroupListHref(locale, entry.group.id));
  }, [entry, locale, router, sessionId]);

  useEffect(() => {
    if (!entry) return;
    const delay = sessionEntryRecheckMs(entry, Date.now());
    if (delay === null) return;
    const timer = window.setTimeout(() => { void check(); }, delay);
    return () => window.clearTimeout(timer);
  }, [entry, check]);

  // Back from the purchase tab (or any other): ask again, so new access or a
  // session that opened meanwhile carries on without a reload.
  const stopped = entry !== null && entry.next !== "enter" && entry.next !== "wait" && entry.next !== "host_start";
  useEffect(() => {
    if (!stopped) return;
    const wake = () => { if (document.visibilityState === "visible") void check(); };
    document.addEventListener("visibilitychange", wake);
    window.addEventListener("focus", wake);
    return () => {
      document.removeEventListener("visibilitychange", wake);
      window.removeEventListener("focus", wake);
    };
  }, [stopped, check]);

  async function act(run: () => Promise<{ ok: boolean; code: string }>) {
    setBusy(true);
    setActionError("");
    try {
      const result = await run();
      if (!result.ok) {
        setActionError(result.code);
        return;
      }
      await check();
    } finally {
      setBusy(false);
    }
  }

  if (entry?.next === "enter") return <StudySessionRoom locale={locale} sessionId={sessionId} onNotLive={() => void check()} />;
  if (!entry && !loadError) return <p className={styles.panel} role="status">{copy.loading}</p>;
  if (entry && (entry.next === "wait" || entry.next === "host_start")) return <p className={styles.panel} role="status">{copy.loading}</p>;

  const listHref = `/${locale}/portal/study-groups`;
  const groupHref = entry?.group ? studyGroupListHref(locale, entry.group.id) : listHref;
  const errorText = (code: string) => copy.errors[code as keyof typeof copy.errors] || copy.errors.error;

  function gate(tone: Tone, icon: ReactNode, title: string, body: string | null, actions: ReactNode, note?: string | null) {
    return (
      <section className={styles.dlGate} data-tone={tone} aria-labelledby="study-session-entry-title">
        <span className={styles.dlIcon} aria-hidden="true">{icon}</span>
        <h2 id="study-session-entry-title">{title}</h2>
        {body ? <p>{body}</p> : null}
        <div className={styles.dlActions}>{actions}</div>
        {note ? <small>{note}</small> : null}
        {actionError ? <p className={styles.alert} role="alert">{errorText(actionError)}</p> : null}
      </section>
    );
  }

  function card() {
    const session = entry?.session;
    if (!session) {
      return (
        <section className={styles.dlCard}>
          <div>
            <div className={styles.dlChips}><span className={styles.dlChip} data-tone="gray">{dl.liveSession}</span></div>
            <h1>{entry?.next === "unavailable" ? dl.unavailableTitle : dl.genericTitle}</h1>
          </div>
        </section>
      );
    }
    const stateChip = session.state === "live"
      ? <span className={styles.dlChip} data-tone="redStrong">{dl.stateLive}</span>
      : session.state === "starting_soon"
      ? <span className={styles.dlChip} data-tone="amber">{dl.stateStartingSoon}</span>
      : session.state === "scheduled"
      ? <span className={styles.dlChip} data-tone="green">{dl.stateUpcoming}</span>
      : <span className={styles.dlChip} data-tone="gray">{dl.stateCompleted}</span>;
    const sessionTone = session.state === "completed" ? "gray" : session.state === "scheduled" ? "green" : "red";
    const people = session.occupancy !== null && session.state !== "scheduled" && session.state !== "completed"
      ? fill(copy.currentlyInSession, { count: session.occupancy, max: session.maxParticipants })
      : fill(copy.upToParticipants, { count: session.maxParticipants });
    return (
      <section className={styles.dlCard}>
        <div>
          <div className={styles.dlChips}><span className={styles.dlChip} data-tone={sessionTone}>{dl.liveSession}</span>{stateChip}</div>
          <h1>{session.title}</h1>
          {session.focus ? <p className={styles.dlFocus}>{session.focus}</p> : null}
          {entry?.course ? <a className={styles.dlCourse} href={`/${locale}/portal/courses/${entry.course.slug}`}><BookOpen size={18} aria-hidden="true" />{entry.course.title}</a> : null}
        </div>
        <ul className={styles.dlFacts}>
          <li><Calendar size={18} aria-hidden="true" />{sessionDateLabel(locale, session.startsAt)}</li>
          <li><Clock size={18} aria-hidden="true" />{sessionTimeLabel(locale, session)}</li>
          <li><Timer size={18} aria-hidden="true" />{fill(copy.plannedDuration, { count: plannedMinutes(session) })}</li>
          <li><Users size={18} aria-hidden="true" />{people}</li>
        </ul>
      </section>
    );
  }

  function next() {
    if (!entry) {
      return gate("red", <AlertCircle size={24} />, errorText(loadError), null, <button className={styles.dlPrimary} type="button" onClick={() => { setLoadError(""); void check(); }}>{copy.retry}</button>);
    }
    const session = entry.session;
    const group = entry.group;
    const course = entry.course;
    switch (entry.next) {
      case "sign_in":
        return gate("blue", <Lock size={24} />, dl.signInTitle, dl.signInBody, <a className={styles.dlPrimary} href={roomSignInHref(locale, sessionId)}>{copy.signIn}</a>, dl.signInNote);
      case "unavailable":
        return gate("gray", <Ban size={24} />, dl.unavailableHeading, dl.unavailableBody, <a className={styles.dlPrimary} href={listHref}>{dl.backToGroups}</a>);
      case "ended":
        return gate("gray", <CircleCheck size={24} />, dl.endedTitle, dl.endedBody, <><a className={styles.dlPrimary} href={groupHref}>{dl.openGroup}</a>{course ? <a className={styles.dlSecondary} href={`/${locale}/portal/courses/${course.slug}`}>{dl.returnToCourse}</a> : null}</>);
      case "course_unavailable":
        return gate("gray", <Ban size={24} />, dl.courseGoneTitle, dl.courseGoneBody, <a className={styles.dlSecondary} href={listHref}>{dl.backToGroups}</a>);
      case "course_access":
        // A new tab keeps this page: coming back to it asks again (above).
        return gate("red", <Lock size={24} />, dl.accessTitle, fill(dl.accessBody, { course: course?.title ?? "" }), course ? <a className={styles.dlPrimary} href={courseAccessHref(locale, course.id)} target="_blank" rel="noopener noreferrer"><ExternalLink size={18} aria-hidden="true" />{dl.accessAction}</a> : null);
      case "join_group":
        return gate("amber", <Users size={24} />, dl.joinTitle, dl.joinBody, group ? <button className={styles.dlPrimary} type="button" disabled={busy} aria-busy={busy} onClick={() => void act(() => studyGroupRequest(`/api/study-groups/${encodeURIComponent(group.id)}/join`, { method: "POST", body: "{}" }))}><UserPlus size={18} aria-hidden="true" />{dl.joinAction}</button> : null);
      case "not_open": {
        const time = entry.opensAt ? new Intl.DateTimeFormat(locale, { hour: "2-digit", minute: "2-digit" }).format(new Date(entry.opensAt)) : "";
        if (entry.viewer?.host) return gate("blue", <Clock size={24} />, fill(dl.notOpenTitle, { time }), fill(dl.hostNotOpenBody, { time }), <a className={styles.dlPrimary} href={groupHref}>{dl.openGroup}</a>);
        if (entry.viewer?.planned) return gate("blue", <Clock size={24} />, fill(dl.notOpenTitle, { time }), dl.notOpenBody, <a className={styles.dlSecondary} href={groupHref}>{dl.openGroup}</a>, dl.plannedNote);
        return gate("blue", <Clock size={24} />, fill(dl.notOpenTitle, { time }), dl.notOpenBody, <button className={styles.dlPrimary} type="button" disabled={busy} aria-busy={busy} onClick={() => void act(() => studyGroupRequest(`/api/study-groups/sessions/${encodeURIComponent(sessionId)}/plan`, { method: "POST", body: "{}" }))}>{copy.plan}</button>, dl.planNote);
      }
      case "full":
        return gate("amber", <Users size={24} />, dl.fullTitle, fill(dl.fullBody, { count: session?.occupancy ?? session?.maxParticipants ?? 0, max: session?.maxParticipants ?? 0 }), <><button className={styles.dlPrimary} type="button" disabled={busy} aria-busy={busy} onClick={() => void act(async () => ({ ok: true, code: "" }))}><RefreshCw size={18} aria-hidden="true" />{copy.retry}</button><a className={styles.dlSecondary} href={groupHref}>{dl.backToGroup}</a></>);
      default:
        return null;
    }
  }

  return (
    <div className={styles.deepLink}>
      {card()}
      {accessGained && entry?.course ? <p className={styles.dlNotice} role="status"><CircleCheck size={18} aria-hidden="true" />{fill(dl.accessGained, { course: entry.course.title })}</p> : null}
      {next()}
    </div>
  );
}
