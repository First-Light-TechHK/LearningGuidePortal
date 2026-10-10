"use client";

import { useEffect, useRef, useState } from "react";
import type { Locale } from "@/lib/i18n/config";
import { getMessages } from "@/lib/i18n/messages";
import { transitionLiveKitClient } from "@/modules/group-study/liveKitClientRecovery";
import type { LiveKitIncident } from "@/modules/group-study/liveKitIncident";
import { participantStatus, raisedHands, sessionControls } from "@/modules/group-study/uiState";
import styles from "./study-groups.module.css";
import { fill, plannedMinutes, sessionNotStarted, sessionScheduleLabel, studyGroupRequest, tutorQueueBody, type StudyGroupDetail, type StudySession } from "./studyGroupClient";

function tileStatus(copy: { muted: string; speaking: string; micOn: string }, tile: { mic: boolean; speaking: boolean }) {
  const status = participantStatus(tile);
  if (status === "muted") return copy.muted;
  if (status === "speaking") return copy.speaking;
  return copy.micOn;
}

function ControlIcon({ kind }: { kind: "mic" | "camera" | "share" | "people" | "hand" | "leave" }) {
  const props = { viewBox: "0 0 24 24", width: 18, height: 18, "aria-hidden": true as const, fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
  if (kind === "mic") return <svg {...props}><rect x="9" y="3" width="6" height="11" rx="3" /><path d="M6 11a6 6 0 0 0 12 0M12 17v3" /></svg>;
  if (kind === "camera") return <svg {...props}><path d="M3 8h11v9H3zM14 11l6-3v9l-6-3" /></svg>;
  if (kind === "share") return <svg {...props}><rect x="4" y="5" width="16" height="12" rx="2" /><path d="M10 11h4M12 9v4" /></svg>;
  if (kind === "people") return <svg {...props}><circle cx="9" cy="8" r="2.5" /><circle cx="16" cy="9" r="2" /><path d="M4 18c.6-2.4 2.4-3.5 5-3.5s4.4 1.1 5 3.5M14 14.5c1.6 0 3 .7 3.8 2.5" /></svg>;
  if (kind === "hand") return <svg {...props}><path d="M8 11V6.5a1.5 1.5 0 0 1 3 0V11M11 8V5.5a1.5 1.5 0 0 1 3 0V12M14 9V7.5a1.5 1.5 0 0 1 3 0V14c0 3-2 5-5 5h-1c-2 0-3-.8-4-2l-2.5-3.5a1.5 1.5 0 0 1 2.2-2L8 13" /></svg>;
  return <svg {...props}><path d="M14 4h4v4M18 4l-7 7M10 6H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2v-4" /></svg>;
}

function TileMic({ status, label }: { status: "muted" | "speaking" | "mic-on"; label: string }) {
  const props = { viewBox: "0 0 24 24", width: 14, height: 14, "aria-hidden": true as const, fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
  return <span className={styles.tileMic} data-status={status} aria-label={label}>{status === "muted" ? <svg {...props}><path d="M9 10v2a3 3 0 0 0 5 2M15 11V6a3 3 0 0 0-5.5-1.5M5 5l14 14M12 17v3M8 11a4 4 0 0 0 .5 2" /></svg> : <svg {...props}><rect x="9" y="3" width="6" height="11" rx="3" /><path d="M6 11a6 6 0 0 0 12 0M12 17v3" /></svg>}</span>;
}

function elapsedClock(startedAt: string | null) {
  if (!startedAt) return "00:00";
  const seconds = Math.max(0, Math.floor((Date.now() - Date.parse(startedAt)) / 1000));
  return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}

type ChatLine = { id: string; from: string; text: string; at: string; host?: boolean; tutor?: boolean };

function endedParts(body: string) {
  const splitAt = body.search(/[.。]\s+\S/);
  if (splitAt < 0) return [body];
  return [body.slice(0, splitAt + 1), body.slice(splitAt + 1).trim()];
}

function chatStamp() {
  return new Date().toISOString();
}

function chatLabel(at: string) {
  const date = new Date(at);
  if (Number.isNaN(date.getTime())) return at;
  return new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit" }).format(date);
}
type Tile = { identity: string; name: string; host: boolean; mic: boolean; speaking: boolean };
type AttachableTrack = { attach: (element: HTMLMediaElement) => HTMLMediaElement; detach: (element: HTMLMediaElement) => HTMLMediaElement[] };
type LocalMedia = { setMicrophoneEnabled: (on: boolean) => Promise<unknown>; setCameraEnabled: (on: boolean) => Promise<unknown>; setScreenShareEnabled: (on: boolean) => Promise<unknown>; publishData: (data: Uint8Array, options: { reliable: boolean }) => Promise<unknown>; identity?: string; isMicrophoneEnabled: boolean; isCameraEnabled: boolean };

function ParticipantCamera({ track }: { track: AttachableTrack | null }) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const element = ref.current;
    if (!track || !element) return;
    track.attach(element);
    return () => { track.detach(element); };
  }, [track]);
  if (!track) return null;
  return <video ref={ref} autoPlay playsInline muted />;
}

export function StudySessionRoom({ locale, sessionId }: { locale: Locale; sessionId: string }) {
  const copy = getMessages(locale).studyGroupsPage;
  const roomCopy = copy.room;
  const [session, setSession] = useState<StudySession | null>(null);
  const [group, setGroup] = useState<StudyGroupDetail | null>(null);
  const [errorCode, setErrorCode] = useState("");
  const [connected, setConnected] = useState(false);
  const [seated, setSeated] = useState(false);
  const [entryDone, setEntryDone] = useState(false);
  const [left, setLeft] = useState(false);
  const [tiles, setTiles] = useState<Tile[]>([]);
  const [chat, setChat] = useState<ChatLine[]>([]);
  const [draft, setDraft] = useState("");
  const [hands, setHands] = useState<string[]>([]);
  const [roomApi, setRoomApi] = useState<{ localParticipant: LocalMedia } | null>(null);
  const [micOn, setMicOn] = useState(false);
  const [cameraOn, setCameraOn] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [shareTrack, setShareTrack] = useState<AttachableTrack | null>(null);
  const [cameraTracks, setCameraTracks] = useState<Record<string, AttachableTrack>>({});
  const [addressTutor, setAddressTutor] = useState(false);
  const [clock, setClock] = useState("00:00");
  const shareVideo = useRef<HTMLVideoElement>(null);
  const audioRoot = useRef<HTMLDivElement>(null);
  const groupRef = useRef<StudyGroupDetail | null>(null);
  const repaintRef = useRef<(() => void) | null>(null);
  const roomRef = useRef<{ startAudio: () => Promise<void>; disconnect: () => Promise<void> } | null>(null);
  const connectGeneration = useRef(0);
  const seatedRef = useRef(false);
  const leftRef = useRef(false);
  const releasedRef = useRef(false);
  const sessionStateRef = useRef("");
  seatedRef.current = seated;
  leftRef.current = left;
  sessionStateRef.current = session?.state || "";
  const [connectAttempt, setConnectAttempt] = useState(0);
  const [recoveryRequired, setRecoveryRequired] = useState(false);
  const recoveryUsedRef = useRef(false);
  const incidentReportsRef = useRef(new Map<string, number>());
  const [sideTab, setSideTab] = useState<"participants" | "chat">("participants");
  groupRef.current = group;

  async function load() {
    const current = await studyGroupRequest<StudySession>(`/api/study-groups/sessions/${sessionId}`);
    if (!current.ok) {
      setErrorCode(current.code);
      if (current.code === "not_found") {
        setSession(null);
        await releaseRoom();
      }
      return;
    }
    const detail = await studyGroupRequest<StudyGroupDetail>(`/api/study-groups/${current.data.groupId}`);
    setSession(current.data);
    if (detail.ok) setGroup(detail.data);
  }

  async function connect(generation: number, recovery: boolean) {
    const issued = await studyGroupRequest<{ token: string; liveKitUrl: string }>(`/api/study-groups/sessions/${sessionId}/token`, { method: "POST", body: JSON.stringify(recovery ? { recovery: true } : {}) });
    if (!issued.ok || !issued.data.liveKitUrl) throw new Error(issued.ok ? "unavailable" : issued.code);
    const { Room, RoomEvent } = await import("livekit-client");
    const room = new Room({
      reconnectPolicy: {
        nextRetryDelayInMs({ retryCount }) {
          return retryCount < 1 ? 300 : null;
        }
      }
    });
    const showShare = () => {
      const publications = [
        ...room.localParticipant.trackPublications.values(),
        ...Array.from(room.remoteParticipants.values()).flatMap((person) => [...person.trackPublications.values()])
      ];
      const shared = publications.find((item) => item.source === "screen_share" && item.track && item.track.mediaStreamTrack?.readyState !== "ended" && item.isMuted !== true);
      setShareTrack(shared?.track ?? null);
      setSharing([...room.localParticipant.trackPublications.values()].some((item) => item.source === "screen_share" && item.track));
      setMicOn(room.localParticipant.isMicrophoneEnabled);
      setCameraOn(room.localParticipant.isCameraEnabled);
    };
    const reportIncident = (code: string) => {
      const timestamp = Date.now();
      const last = incidentReportsRef.current.get(code) || 0;
      if (timestamp - last < 30_000) return;
      incidentReportsRef.current.set(code, timestamp);
      void fetch(`/api/study-groups/sessions/${sessionId}/livekit-incident`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ code }), keepalive: true }).catch(() => undefined);
    };
    const showIncident = (incident: LiveKitIncident) => {
      reportIncident(incident.code);
      if (incident.action === "sdk_reconnect") {
        setErrorCode("network_lost");
        return;
      }
      if (incident.action === "end_session") {
        setErrorCode("room_ended");
        void load();
        return;
      }
      if (incident.action === "show_duplicate_identity") {
        setErrorCode("duplicate_identity");
        return;
      }
      if (incident.action === "show_removed") {
        setErrorCode("participant_removed");
        return;
      }
      setErrorCode("connect_failed");
    };
    room.on(RoomEvent.DataReceived, (payload, participant) => {
      const message = JSON.parse(new TextDecoder().decode(payload)) as { type: string; text?: string; raised?: boolean };
      const from = participant?.name || participant?.identity || "participant";
      const hostIds = new Set((groupRef.current?.members || []).filter((member) => member.role === "host").map((member) => member.userId));
      if (message.type === "tutor" && message.text) {
        setChat((items) => [...items, { id: `tutor-${items.length}`, from: roomCopy.tutorName, text: message.text || "", at: chatStamp(), tutor: true }]);
        setSideTab("chat");
        return;
      }
      if (message.type === "chat" && message.text) setChat((items) => [...items, { id: `${from}-${items.length}`, from, text: message.text || "", at: chatStamp(), host: hostIds.has(participant?.identity || "") }]);
      if (message.type === "raise-hand") {
        const identity = participant?.identity || "";
        setHands((items) => raisedHands(items, identity, message.raised !== false));
      }
    });
    const paint = () => {
      const hostIds = new Set((groupRef.current?.members || []).filter((member) => member.role === "host").map((member) => member.userId));
      const people = [room.localParticipant, ...Array.from(room.remoteParticipants.values())];
      const nextCameras: Record<string, AttachableTrack> = {};
      for (const person of people) {
        const publication = [...person.trackPublications.values()].find((item) => item.source === "camera" && item.track && item.isMuted === false);
        if (publication?.track) nextCameras[person.identity] = publication.track;
      }
      setCameraTracks(nextCameras);
      setTiles(people.map((person) => ({
        identity: person.identity,
        name: person.name || person.identity,
        host: hostIds.has(person.identity),
        mic: person.isMicrophoneEnabled,
        speaking: person.isSpeaking
      })));
    };
    repaintRef.current = paint;
    room.on(RoomEvent.ParticipantConnected, () => { paint(); window.setTimeout(() => void load(), 400); });
    room.on(RoomEvent.ParticipantDisconnected, () => { paint(); window.setTimeout(() => void load(), 400); });
    room.on(RoomEvent.ActiveSpeakersChanged, paint);
    room.on(RoomEvent.TrackMuted, () => { paint(); showShare(); });
    room.on(RoomEvent.TrackUnmuted, () => { paint(); showShare(); });
    const attachRemoteAudio = (track: { kind: string; attach: () => HTMLMediaElement }) => {
      if (track.kind !== "audio") return;
      const element = track.attach();
      element.autoplay = true;
      if (audioRoot.current && element.parentElement !== audioRoot.current) audioRoot.current.appendChild(element);
      void room.startAudio().catch(() => undefined);
    };
    room.on(RoomEvent.TrackSubscribed, (track) => { attachRemoteAudio(track); paint(); showShare(); });
    room.on(RoomEvent.TrackUnpublished, () => { paint(); showShare(); });
    room.on(RoomEvent.TrackUnsubscribed, (track) => {
      if (track.kind === "audio") track.detach().forEach((element) => element.remove());
      paint();
      showShare();
    });
    room.on(RoomEvent.LocalTrackPublished, () => { paint(); showShare(); });
    room.on(RoomEvent.LocalTrackUnpublished, () => { paint(); showShare(); });
    room.on(RoomEvent.Reconnecting, () => {
      setConnected(false);
      const transition = transitionLiveKitClient({ type: "connection_quality", quality: "Lost" });
      if (transition.incident) showIncident(transition.incident);
    });
    room.on(RoomEvent.Reconnected, () => {
      if (transitionLiveKitClient({ type: "reconnected" }).type === "connected") {
        setConnected(true);
        setErrorCode("");
        paint();
        showShare();
      }
    });
    room.on(RoomEvent.ConnectionQualityChanged, (quality, participant) => {
      if (participant?.identity !== room.localParticipant.identity) return;
      const transition = transitionLiveKitClient({ type: "connection_quality", quality: String(quality) });
      if (transition.type === "sdk_reconnecting" && transition.incident) showIncident(transition.incident);
    });
    room.on(RoomEvent.Disconnected, (reason) => {
      if (roomRef.current !== room || leftRef.current || releasedRef.current) return;
      roomRef.current = null;
      setRoomApi(null);
      setConnected(false);
      setMicOn(false);
      setCameraOn(false);
      setSharing(false);
      setShareTrack(null);
      const transition = transitionLiveKitClient({ type: "disconnect", reason: String(reason), recoveryUsed: recoveryUsedRef.current });
      if (transition.type === "recover_token") {
        recoveryUsedRef.current = true;
        if (transition.incident) reportIncident(transition.incident.code);
        setRecoveryRequired(true);
        setConnectAttempt((attempt) => attempt + 1);
      } else if (transition.incident) showIncident(transition.incident);
    });
    try {
      await room.connect(issued.data.liveKitUrl, issued.data.token);
    } catch (error) {
      await room.disconnect().catch(() => undefined);
      throw error;
    }
    if (connectGeneration.current !== generation) {
      await room.disconnect().catch(() => undefined);
      return;
    }
    roomRef.current = room;
    setRoomApi(room);
    setConnected(true);
    recoveryUsedRef.current = false;
    setRecoveryRequired(false);
    setErrorCode("");
    paint();
    void room.startAudio().catch(() => undefined);
  }

  useEffect(() => {
    const release = () => {
      const room = roomRef.current;
      roomRef.current = null;
      void room?.disconnect().catch(() => undefined);
      if (releasedRef.current || !seatedRef.current || leftRef.current) return;
      if (sessionStateRef.current !== "live" && sessionStateRef.current !== "starting_soon") return;
      releasedRef.current = true;
      void fetch(`/api/study-groups/sessions/${sessionId}/leave`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}", keepalive: true });
    };
    window.addEventListener("pagehide", release);
    return () => {
      window.removeEventListener("pagehide", release);
      release();
    };
  }, [sessionId]);

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load(), 3000);
    return () => window.clearInterval(timer);
  }, [sessionId]);

  useEffect(() => {
    if (session?.state === "completed") void releaseRoom();
  }, [session?.state]);

  useEffect(() => {
    if (!session || left) return;
    if (session.state !== "starting_soon" && session.state !== "live") {
      setEntryDone(true);
      return;
    }
    if (sessionNotStarted(session)) {
      setEntryDone(true);
      return;
    }
    let cancelled = false;
    setEntryDone(false);
    void studyGroupRequest(`/api/study-groups/sessions/${sessionId}/enter`, { method: "POST", body: "{}" }).then((result) => {
      if (cancelled) return;
      if (result.ok) setSeated(true);
      else if (result.code !== "session_not_open") setErrorCode(result.code);
      setEntryDone(true);
    });
    return () => { cancelled = true; };
  }, [session?.state, sessionId, left]);

  useEffect(() => {
    if (session?.state !== "live" || connected || left || !seated) return;
    const generation = connectGeneration.current + 1;
    connectGeneration.current = generation;
    let timer = 0;
    const recovery = recoveryRequired;
    const run = (triesLeft: number) => {
      void (async () => {
        await releaseRoom();
        if (connectGeneration.current !== generation) return;
        const entered = await studyGroupRequest(`/api/study-groups/sessions/${sessionId}/enter`, { method: "POST", body: "{}" });
        if (connectGeneration.current !== generation) return;
        if (!entered.ok) throw new Error(entered.code);
        await connect(generation, recovery);
      })().catch((error: unknown) => {
        if (connectGeneration.current !== generation) return;
        if (triesLeft > 0) {
          timer = window.setTimeout(() => run(triesLeft - 1), 600);
          return;
        }
        if (!recovery && !recoveryUsedRef.current) {
          recoveryUsedRef.current = true;
          setRecoveryRequired(true);
          setConnectAttempt((attempt) => attempt + 1);
          return;
        }
        const code = error instanceof Error ? error.message : "";
        setErrorCode(code in copy.errors ? code : "connect_failed");
      });
    };
    run(recovery ? 0 : 1);
    return () => {
      connectGeneration.current += 1;
      window.clearTimeout(timer);
    };
  }, [session?.state, connected, left, seated, connectAttempt, recoveryRequired]);

  useEffect(() => {
    if (session?.state !== "live") return;
    const tick = () => setClock(elapsedClock(session.startedAt));
    tick();
    const timer = window.setInterval(tick, 1000);
    return () => window.clearInterval(timer);
  }, [session?.state, session?.startedAt]);

  useEffect(() => {
    repaintRef.current?.();
  }, [group]);

  useEffect(() => {
    const element = shareVideo.current;
    if (!shareTrack || !element) return;
    shareTrack.attach(element);
    return () => { shareTrack.detach(element); };
  }, [shareTrack]);

  async function setMedia(kind: "mic" | "camera" | "share", enabled: boolean) {
    const local = roomApi?.localParticipant;
    if (!local) return;
    await roomRef.current?.startAudio().catch(() => undefined);
    if (kind === "mic") await local.setMicrophoneEnabled(enabled);
    if (kind === "camera") await local.setCameraEnabled(enabled);
    if (kind === "share") await local.setScreenShareEnabled(enabled);
    if (kind === "mic") setMicOn(enabled);
    if (kind === "camera") setCameraOn(enabled);
    if (kind === "share") setSharing(enabled);
  }

  async function releaseRoom() {
    const room = roomRef.current;
    roomRef.current = null;
    await room?.disconnect().catch(() => undefined);
  }

  async function exitTo(href: string) {
    if (session && (session.state === "live" || session.state === "starting_soon") && !left && !sessionNotStarted(session)) {
      releasedRef.current = true;
      leftRef.current = true;
      await releaseRoom();
      await studyGroupRequest(`/api/study-groups/sessions/${sessionId}/leave`, { method: "POST", body: "{}" });
    }
    window.location.assign(href);
  }

  function path() {
    if (!session) return null;
    return (
      <nav className={styles.crumb} aria-label={roomCopy.crumbGroups}>
        <button type="button" onClick={() => void exitTo(`/${locale}/portal`)}>{roomCopy.crumbHome}</button>
        <span aria-hidden="true">/</span>
        <button type="button" onClick={() => void exitTo(`/${locale}/portal/study-groups`)}>{roomCopy.crumbGroups}</button>
        {group ? <><span aria-hidden="true">/</span><button type="button" onClick={() => void exitTo(`/${locale}/portal/study-groups?group=${group.id}`)}>{group.title}</button></> : null}
        <span aria-hidden="true">/</span>
        <span aria-current="page">{session.title}</span>
      </nav>
    );
  }

  if (!session) return <p className={styles.panel} role="status">{errorCode ? copy.errors[errorCode as keyof typeof copy.errors] || copy.errors.error : copy.loading}</p>;
  if (session.state === "completed" || left) {
    const ended = session.state === "completed";
    return (
      <>
      {path()}
      <section className={styles.empty}>
        <div className={styles.endCard}>
          {ended ? <span className={styles.endMark} aria-hidden="true">✓</span> : null}
          <h1>{ended ? roomCopy.endedTitle : roomCopy.youLeft}</h1>
          <p className={styles.endTitle}>{group?.title || session.title}</p>
          {session.focus ? <p>{session.focus}</p> : null}
          <p className={styles.meta}>{[group?.courseTitle, fill(roomCopy.groupStudy, { count: plannedMinutes(session) })].filter(Boolean).join(" · ")}</p>
          {ended ? endedParts(roomCopy.endedBody).map((line) => <p key={line}>{line}</p>) : null}
          <a className={styles.primary} href={group ? `/${locale}/portal/courses/${group.courseSlug}` : `/${locale}/portal/study-groups`}>{roomCopy.returnToCourse}</a>
        </div>
      </section>
      </>
    );
  }
  if (!seated && (errorCode === "session_full" || errorCode === "course_access_required")) {
    return <>{path()}<section className={styles.empty} role="alert"><h1>{errorCode === "session_full" ? copy.sessionFull : copy.errors.course_access_required}</h1><p>{session.title}</p>{errorCode === "course_access_required" && group ? <a className={styles.primary} href={`/${locale}/portal/courses/${group.courseSlug}`}>{copy.getCourseAccess}</a> : null}</section></>;
  }
  if ((session.state === "starting_soon" || session.state === "live") && !seated && !entryDone) {
    return <p className={styles.panel} role="status">{copy.loading}</p>;
  }
  if (session.state === "scheduled") {
    return <>{path()}<section className={styles.empty} role="status"><h1>{copy.errors.session_not_open}</h1><p>{session.title}</p>{session.focus ? <><h2>{copy.focus}</h2><p>{session.focus}</p></> : null}<p>{sessionScheduleLabel(locale, session)}</p><p>{fill(copy.plannedDuration, { count: plannedMinutes(session) })}</p><p>{copy.enterWindow}</p></section></>;
  }
  if (sessionNotStarted(session)) {
    return <>{path()}<section className={styles.empty} role="status"><h1>{copy.notStarted}</h1><p>{copy.notStartedBody}</p><p>{session.title}</p><p>{sessionScheduleLabel(locale, session)}</p></section></>;
  }
  if (session.state !== "live") {
    return <>{path()}<section className={styles.empty} role="status"><h1>{copy.waiting}</h1><p>{session.title}</p>{session.focus ? <><h2>{copy.focus}</h2><p>{session.focus}</p></> : null}<p>{sessionScheduleLabel(locale, session)}</p><p>{fill(copy.plannedDuration, { count: plannedMinutes(session) })}</p><p>{fill(copy.currentlyInSession, { count: session.occupancy, max: session.maxParticipants })}</p><p>{fill(copy.upToParticipants, { count: session.maxParticipants })}</p>{group?.role === "host" ? <button className={styles.primary} type="button" onClick={() => { void studyGroupRequest(`/api/study-groups/sessions/${sessionId}/start`, { method: "POST", body: "{}" }).then((started) => { if (!started.ok) { setErrorCode(started.code); return; } return load(); }); }}>{copy.start}</button> : null}</section></>;
  }

  const controls = sessionControls({ role: group?.role || "member", state: "live", occupancy: session.occupancy, maxParticipants: session.maxParticipants });
  const present = connected && tiles.length > 0 ? tiles.length : session.occupancy;
  const roster = tiles.length
    ? tiles.map((tile) => ({
        key: tile.identity,
        name: tile.name,
        host: tile.host,
        hand: hands.includes(tile.identity),
        status: participantStatus(tile)
      }))
    : session.attendees.map((person) => ({
        key: person.userId,
        name: person.displayName,
        host: Boolean(group?.members?.some((member) => member.userId === person.userId && member.role === "host")),
        hand: false,
        status: "" as const
      }));
  const errorText = errorCode ? copy.errors[errorCode as keyof typeof copy.errors] || copy.errors.error : "";

  async function publish(message: { type: string; text?: string; raised?: boolean }) {
    if (!roomApi) return;
    await roomApi.localParticipant.publishData(new TextEncoder().encode(JSON.stringify(message)), { reliable: true });
  }

  return (
    <>
    {path()}
    <section className={styles.room}>
      <div className={styles.stage}>
        <div className={styles.stageHead}>
          <h1>{session.title}</h1>
          {group?.courseTitle ? <span className={styles.coursePill}>{group.courseTitle}</span> : null}
          <p className={styles.liveClock}><span className={styles.liveDot} aria-hidden="true">●</span> {fill(roomCopy.liveClock, { time: clock }).replace(/^●\s*/, "")}</p>
        </div>
        {session.focus ? <p>{session.focus}</p> : null}
        {errorText ? <p className={styles.alert} role="alert">{errorText} <button className={styles.textButton} type="button" onClick={() => { setErrorCode(""); setRecoveryRequired(true); setConnected(false); setConnectAttempt((attempt) => attempt + 1); }}>{roomCopy.reconnect}</button></p> : null}
        <div ref={audioRoot} hidden />
        {shareTrack ? <video ref={shareVideo} className={styles.shareMain} autoPlay playsInline muted /> : null}
        <div className={styles.videos}>
          {tiles.length === 0 ? <div className={styles.tile}><span>{connected ? copy.loading : roomCopy.notConnected}</span></div> : tiles.map((tile) => (
            <div className={styles.tile} key={tile.identity}>
              <ParticipantCamera track={cameraTracks[tile.identity] ?? null} />
              {tile.speaking ? <span className={styles.speakingPill}>{roomCopy.speaking}</span> : null}
              <span className={styles.tileCaption}><span>{tile.name}{tile.host ? ` · ${roomCopy.host}` : ""}{hands.includes(tile.identity) ? " · " + roomCopy.raiseHand : ""}</span><TileMic status={participantStatus(tile)} label={tileStatus(roomCopy, tile)} /></span>
            </div>
          ))}
        </div>
        <div className={styles.controls}>
          {controls.includes("mic") ? <button type="button" aria-pressed={micOn} disabled={!connected} onClick={() => void setMedia("mic", !micOn).catch(() => setMicOn(false))}><ControlIcon kind="mic" />{roomCopy.mic}</button> : null}
          {controls.includes("camera") ? <button type="button" aria-pressed={cameraOn} disabled={!connected} onClick={() => void setMedia("camera", !cameraOn).catch(() => setCameraOn(false))}><ControlIcon kind="camera" />{roomCopy.camera}</button> : null}
          {controls.includes("share") ? <button type="button" aria-pressed={sharing} disabled={!connected} onClick={() => void setMedia("share", !sharing).catch(() => setSharing(false))}><ControlIcon kind="share" />{roomCopy.share}</button> : null}
          {controls.includes("participants") ? <button type="button" className={styles.participantCount} data-participants={present} aria-pressed={sideTab === "participants"} onClick={() => setSideTab("participants")}><ControlIcon kind="people" /><strong>{present}</strong> {roomCopy.participants}</button> : null}
          {controls.includes("raise-hand") ? <button type="button" aria-pressed={Boolean(roomApi?.localParticipant.identity && hands.includes(roomApi.localParticipant.identity))} disabled={!connected} onClick={() => { const identity = roomApi?.localParticipant.identity || ""; if (!identity) return; const raised = !hands.includes(identity); setHands((items) => raisedHands(items, identity, raised)); void publish({ type: "raise-hand", raised }); }}><ControlIcon kind="hand" />{roomCopy.raiseHand}</button> : null}
          {controls.includes("leave") ? <button className={styles.leaveControl} type="button" onClick={async () => { await releaseRoom(); await studyGroupRequest(`/api/study-groups/sessions/${sessionId}/leave`, { method: "POST", body: "{}" }); setLeft(true); await load(); }}><ControlIcon kind="leave" />{roomCopy.leave}</button> : null}
        </div>
      </div>
      <aside className={styles.side} aria-label={sideTab === "participants" ? roomCopy.participants : roomCopy.chat}>
        <div className={styles.sideTabs} role="tablist">
          <button type="button" role="tab" aria-selected={sideTab === "participants"} onClick={() => setSideTab("participants")}>{roomCopy.participants} <span className={styles.tabCount}>{present}/{session.maxParticipants}</span></button>
          <button type="button" role="tab" aria-selected={sideTab === "chat"} onClick={() => setSideTab("chat")}>{roomCopy.chat}</button>
        </div>
        {sideTab === "participants" ? (
          <div className={styles.sidePanel} role="tabpanel">
            <ul className={styles.roster}>
              {roster.map((person) => <li key={person.key}><span className={styles.rosterInitial}>{person.name.slice(0, 1)}</span><strong>{person.name}</strong>{person.host ? <span className={styles.chatHost}>{roomCopy.host}</span> : null}{person.hand ? <span>{roomCopy.raiseHand}</span> : null}{person.status ? <span className={styles.rosterStatus} data-status={person.status}>{person.status === "muted" ? roomCopy.muted : person.status === "speaking" ? roomCopy.speaking : roomCopy.micOn}</span> : null}</li>)}
            </ul>
          </div>
        ) : (
          <>
            <div className={styles.chatLog} role="tabpanel" aria-live="polite">
              {chat.map((line) => <article className={styles.chatLine} key={line.id}><div className={styles.chatHead}>{line.tutor ? <span className={styles.tutorAvatar} aria-hidden="true">✦</span> : <span className={styles.rosterInitial}>{line.from.slice(0, 1)}</span>}<strong className={line.tutor ? styles.tutorName : undefined}>{line.from}</strong>{line.host ? <span className={styles.chatHost}>{roomCopy.host}</span> : null}<time dateTime={line.at}>{chatLabel(line.at)}</time></div><p className={styles.chatBody}>{line.text.startsWith(`${roomCopy.aiTutor} `) ? <><span className={styles.tutorMention}>{roomCopy.aiTutor}</span>{line.text.slice(roomCopy.aiTutor.length)}</> : line.text}</p></article>)}
              {!connected ? <p>{roomCopy.chatUnavailable}</p> : null}
            </div>
            <form className={styles.chatForm} onSubmit={(event) => {
              event.preventDefault();
              const text = draft.trim();
              if (!text || !connected) return;
              const mention = addressTutor && session.aiTutorEnabled;
              const chatText = mention ? `${roomCopy.aiTutor} ${text}` : text;
              void publish({ type: "chat", text: chatText });
              setChat((items) => [...items, { id: `local-${items.length}`, from: roomCopy.you, text: chatText, at: chatStamp(), host: group?.role === "host" }]);
              if (mention) {
                void studyGroupRequest(`/api/study-groups/sessions/${sessionId}/ai-tutor`, { method: "POST", body: JSON.stringify(tutorQueueBody(text)) }).then((queued) => {
                  if (!queued.ok) setErrorCode(queued.code);
                });
              }
              setDraft("");
              setAddressTutor(false);
            }}>
              {session.aiTutorEnabled ? <button className={styles.tutorEntry} type="button" aria-pressed={addressTutor} onClick={() => setAddressTutor((on) => !on)}>{roomCopy.aiTutor}</button> : null}
              <input aria-label={roomCopy.chat} value={draft} onChange={(event) => setDraft(event.target.value)} placeholder={roomCopy.chatPlaceholder} disabled={!connected} />
              <button className={styles.sendButton} type="submit" disabled={!connected} aria-label={roomCopy.send}><svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><path d="M2 8.5 14 2 9 14l-1.5-4.5L2 8.5Z" fill="currentColor" /></svg></button>
            </form>
          </>
        )}
      </aside>
    </section>
    </>
  );
}
