"use client";

import { useEffect, useRef, useState } from "react";
import type { Locale } from "@/lib/i18n/config";
import { getMessages } from "@/lib/i18n/messages";
import { liveKitDisconnectReasonName, liveKitDisconnectStep, transitionLiveKitClient, whileCurrentRoom } from "@/modules/group-study/liveKitClientRecovery";
import type { LiveKitIncident } from "@/modules/group-study/liveKitIncident";
import { chatLabel, parseRoomDataMessage, ROOM_CHAT_MAX_LENGTH, roomDataPacket, roomDataSenderName } from "@/modules/group-study/roomData";
import { createSeatIntents, deadlineSignal } from "@/modules/group-study/seatIntents";
import { participantStatus, raisedHands, roomPageRestoreAction, seatRefusalOffer, sessionControls } from "@/modules/group-study/uiState";
import styles from "./study-groups.module.css";
import { PortalDialog } from "./PortalDialog";
import { FINAL_ENTRY_CODES, fill, tutorOfflineReason, tutorPendingState, plannedMinutes, reconnectDelayMs, roomGateAction, roomSignInHref, screenShareCancelled, screenShareSupported, SEAT_HEARTBEAT_MS, seatReentryAction, sessionNotStarted, sessionScheduleLabel, studyGroupRequest, tutorAskAgain, tutorChatLines, tutorClientEventId, tutorQueueBody, tutorRefusalReason, tutorStillWaiting, type StudyGroupDetail, type StudySession } from "./studyGroupClient";

function tileStatus(copy: { muted: string; speaking: string; micOn: string }, tile: { mic: boolean; speaking: boolean }) {
  const status = participantStatus(tile);
  if (status === "muted") return copy.muted;
  if (status === "speaking") return copy.speaking;
  return copy.micOn;
}

function ControlIcon({ kind }: { kind: "mic" | "camera" | "share" | "people" | "hand" | "leave" }) {
  const props = { viewBox: "0 0 24 24", width: 16, height: 16, "aria-hidden": true as const, fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
  if (kind === "mic") return <svg {...props}><rect x="9" y="3" width="6" height="11" rx="3" /><path d="M6 11a6 6 0 0 0 12 0M12 17v3" /></svg>;
  if (kind === "camera") return <svg {...props}><path d="M3 8h11v9H3zM14 11l6-3v9l-6-3" /></svg>;
  if (kind === "share") return <svg {...props}><rect x="4" y="5" width="16" height="12" rx="2" /><path d="M10 11h4M12 9v4" /></svg>;
  if (kind === "people") return <svg {...props}><circle cx="9" cy="8" r="2.5" /><circle cx="16" cy="9" r="2" /><path d="M4 18c.6-2.4 2.4-3.5 5-3.5s4.4 1.1 5 3.5M14 14.5c1.6 0 3 .7 3.8 2.5" /></svg>;
  if (kind === "hand") return <svg {...props}><path d="M8 11V6.5a1.5 1.5 0 0 1 3 0V11M11 8V5.5a1.5 1.5 0 0 1 3 0V12M14 9V7.5a1.5 1.5 0 0 1 3 0V14c0 3-2 5-5 5h-1c-2 0-3-.8-4-2l-2.5-3.5a1.5 1.5 0 0 1 2.2-2L8 13" /></svg>;
  return <svg {...props}><path d="M14 4h4v4M18 4l-7 7M10 6H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2v-4" /></svg>;
}

function CrumbChevron() {
  return <svg className={styles.crumbChevron} viewBox="0 0 12 12" aria-hidden="true"><path d="M4.5 2.5 8 6l-3.5 3.5" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" /></svg>;
}

function TileMic({ status, label }: { status: "muted" | "speaking" | "mic-on"; label: string }) {
  const props = { viewBox: "0 0 24 24", width: 14, height: 14, "aria-hidden": true as const, fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
  return <span className={styles.tileMic} data-status={status} aria-label={label}>{status === "muted" ? <svg {...props}><path d="M9 10v2a3 3 0 0 0 5 2M15 11V6a3 3 0 0 0-5.5-1.5M5 5l14 14M12 17v3M8 11a4 4 0 0 0 .5 2" /></svg> : <svg {...props}><rect x="9" y="3" width="6" height="11" rx="3" /><path d="M6 11a6 6 0 0 0 12 0M12 17v3" /></svg>}</span>;
}

function PersonGlyph() {
  return <svg viewBox="0 0 64 64" width="64" height="64" aria-hidden="true" fill="currentColor"><circle cx="32" cy="20" r="13" /><path d="M6 64c0-14.4 11.6-24 26-24s26 9.6 26 24H6Z" /></svg>;
}

// The Permissions API is not available everywhere; anything but an explicit
// "prompt" or "denied" is treated as unknown so the normal call still runs.
async function mediaPermission(kind: "mic" | "camera"): Promise<{ state: PermissionState | "unknown"; status: PermissionStatus | null }> {
  try {
    if (typeof navigator === "undefined" || !navigator.permissions) return { state: "unknown", status: null };
    const status = await navigator.permissions.query({ name: kind === "mic" ? "microphone" : "camera" });
    return { state: status.state, status };
  } catch {
    return { state: "unknown", status: null };
  }
}

function isPermissionMediaError(error: unknown) {
  const name = error instanceof Error ? error.name : "";
  return name === "NotAllowedError" || name === "PermissionDeniedError";
}

function isDeviceMediaError(error: unknown) {
  const name = error instanceof Error ? error.name : "";
  return name === "NotFoundError" || name === "NotReadableError";
}

function elapsedClock(startedAt: string | null) {
  if (!startedAt) return "00:00";
  const seconds = Math.max(0, Math.floor((Date.now() - Date.parse(startedAt)) / 1000));
  return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}

type ChatLine = {
  id: string; from: string; text: string; at: string; host?: boolean; tutor?: boolean; mode?: "course" | "general" | "unavailable"; failed?: boolean;
  // AI Tutor lines: `pending` is the asker's own "answering" placeholder until
  // the answer with the same id replaces it; `replyTo` names the question an
  // answer belongs to.
  pending?: boolean; replyTo?: { name: string; question: string };
  // The queue position the server gave when it took the question, shown
  // until the next session poll lists it.
  queuedPosition?: number | null;
  // The asker's own question line: what to resend, and why the last ask failed.
  tutorAsk?: { question: string; clientEventId: string }; tutorError?: string;
  // The id of the answer line this question's latest ask is waiting on.
  tutorAnswerId?: string;
  // A question line its asker withdrew before the Tutor started on it.
  tutorWithdrawn?: boolean;
};

// How long the asker waits on "answering" before the line says the AI Tutor is unavailable.
const TUTOR_ANSWER_TIMEOUT_MS = 120_000;
// The answer timer waits again while the server lists the question, at most
// this many times, so a page whose polling stopped still settles the line.
const TUTOR_ANSWER_WAITS = 10;
// A token request that hangs gives up, so the next connect attempt is not
// held behind it.
const TOKEN_REQUEST_TIMEOUT_MS = 15_000;

function endedParts(body: string) {
  const splitAt = body.search(/[.。]\s+\S/);
  if (splitAt < 0) return [body];
  return [body.slice(0, splitAt + 1), body.slice(splitAt + 1).trim()];
}

function chatStamp() {
  return new Date().toISOString();
}

type Tile = { identity: string; name: string; host: boolean; mic: boolean; speaking: boolean };
type MentionRow = { key: string; name: string; tutor?: boolean };
type AttachableTrack = { attach: (element: HTMLMediaElement) => HTMLMediaElement; detach: (element: HTMLMediaElement) => HTMLMediaElement[] };
type CallRoom = { startAudio: () => Promise<void>; disconnect: () => Promise<void>; canPlaybackAudio: boolean; state: string };
type LocalMedia = { setMicrophoneEnabled: (on: boolean) => Promise<unknown>; setCameraEnabled: (on: boolean) => Promise<unknown>; setScreenShareEnabled: (on: boolean) => Promise<unknown>; publishData: (data: Uint8Array, options: { reliable: boolean; destinationIdentities?: string[] }) => Promise<unknown>; identity?: string; isMicrophoneEnabled: boolean; isCameraEnabled: boolean };

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
  // The latest session for timers that outlive a render.
  const sessionRef = useRef<StudySession | null>(null);
  useEffect(() => {
    sessionRef.current = session;
  }, [session]);
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
  const handsRef = useRef<string[]>([]);
  handsRef.current = hands;
  const [roomApi, setRoomApi] = useState<{ localParticipant: LocalMedia } | null>(null);
  const [micOn, setMicOn] = useState(false);
  const [cameraOn, setCameraOn] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [shareTrack, setShareTrack] = useState<AttachableTrack | null>(null);
  const [cameraTracks, setCameraTracks] = useState<Record<string, AttachableTrack>>({});
  const [addressTutor, setAddressTutor] = useState(false);
  const [mention, setMention] = useState<{ start: number; query: string; index: number } | null>(null);
  const [mediaNotice, setMediaNotice] = useState<{ kind: "mic" | "camera"; device: boolean } | null>(null);
  const [entryAttempt, setEntryAttempt] = useState(0);
  const chatInputRef = useRef<HTMLInputElement>(null);
  const chatLogRef = useRef<HTMLDivElement>(null);
  const chatPinnedRef = useRef(true);
  const caretRef = useRef<number | null>(null);
  const chatSequence = useRef(0);
  const permissionWatchRef = useRef<PermissionStatus | null>(null);
  const [clock, setClock] = useState("00:00");
  const shareVideo = useRef<HTMLVideoElement>(null);
  const audioRoot = useRef<HTMLDivElement>(null);
  const groupRef = useRef<StudyGroupDetail | null>(null);
  const repaintRef = useRef<(() => void) | null>(null);
  const roomRef = useRef<CallRoom | null>(null);
  // The room this page is connecting or holding: its handlers act only while
  // it is the current one, so a released room's teardown events never paint
  // the next state (QA3 room review F2, F6).
  const activeRoomRef = useRef<CallRoom | null>(null);
  const connectGeneration = useRef(0);
  // One connect at a time: a new attempt waits for the one before it to
  // settle, so two Rooms with this account's identity never race each other
  // into a "joined elsewhere" (QA3 room review F8).
  const connectRunRef = useRef<Promise<void>>(Promise.resolve());
  const connectingRef = useRef<object | null>(null);
  // Set the moment this page leaves (Leave Session, a breadcrumb, the page
  // hidden for good) and cleared only by a failed leave or Rejoin: a
  // re-render while the leave request is in flight must not undo it, or a
  // heartbeat could seat the page again.
  const leftRef = useRef(false);
  const sessionIdRef = useRef(sessionId);
  sessionIdRef.current = sessionId;
  // Enter, renew and leave go to the server one at a time and never enter or
  // renew after a leave (modules/group-study/seatIntents.ts).
  const [seatIntent] = useState(() => createSeatIntents({
    send: (intent, signal) => studyGroupRequest(`/api/study-groups/sessions/${sessionIdRef.current}/${intent}`, { method: "POST", body: "{}", signal }),
    hasLeft: () => leftRef.current
  }));
  const [connectAttempt, setConnectAttempt] = useState(0);
  const [recoveryRequired, setRecoveryRequired] = useState(false);
  const recoveryUsedRef = useRef(false);
  const incidentReportsRef = useRef(new Map<string, number>());
  const [sideTab, setSideTab] = useState<"participants" | "chat">("participants");
  const sideTabRef = useRef<"participants" | "chat">("participants");
  const [unread, setUnread] = useState(0);
  // The session poll's own failure, kept apart from the connection's error so
  // a failed poll never shows a "reconnect" that would drop a working call
  // (QA 2026-10-19 N4); the next successful poll clears it.
  const [pollError, setPollError] = useState("");
  // Signed out, or no longer a member: the page may not keep (or start) a call.
  const accessLost = pollError === "forbidden" || pollError === "unauthenticated";
  // The SDK is recovering the media connection on its own: the room stays up.
  const [reconnecting, setReconnecting] = useState(false);
  // A disconnect no automatic retry may undo (another tab took over this
  // account's place, removed, room ended): only the user reconnects (QA N2).
  const [blocked, setBlocked] = useState(false);
  const blockedRef = useRef(false);
  blockedRef.current = blocked;
  const failuresRef = useRef(0);
  const [audioBlocked, setAudioBlocked] = useState(false);
  // The Host's Start in the waiting view: in flight, and why it failed. Kept
  // apart from the connection's error so it never follows the page into the
  // live room (QA 2026-10-19 M13).
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState("");
  // Leave Session asks first; a leave the server did not take keeps the call
  // and offers the leave again (QA 2026-10-19 M15).
  const [leaveAsked, setLeaveAsked] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [leaveError, setLeaveError] = useState("");
  const [shareFailed, setShareFailed] = useState(false);
  const [canShare, setCanShare] = useState(false);
  const heartbeatBusy = useRef(false);
  const leftShownRef = useRef(false);
  leftShownRef.current = left;
  groupRef.current = group;

  async function load() {
    try {
      const current = await studyGroupRequest<StudySession>(`/api/study-groups/sessions/${sessionId}`);
      if (!current.ok) {
        setPollError(current.code);
        if (current.code === "not_found") {
          setSession(null);
          await releaseRoom();
        }
        if (current.code === "forbidden" || current.code === "unauthenticated") {
          // No longer a member (left the Study Group in another tab) or signed
          // out: this page may not keep the call open. The page says so with
          // a way back (QA 2026-10-19 M17); a later poll that succeeds again
          // lets the room reconnect.
          await releaseRoom();
        }
        return;
      }
      setPollError("");
      const detail = await studyGroupRequest<StudyGroupDetail>(`/api/study-groups/${current.data.groupId}`);
      setSession(current.data);
      if (detail.ok) setGroup(detail.data);
    } catch {
      // A fetch rejection (network drop, a gateway's non-JSON error page) must
      // not surface as an unhandled rejection (audit F-7): the panel keeps its
      // current Loading/error state and the 3 s poll retries until it heals —
      // no separate error face for a failure the poll already owns.
    }
  }

  async function connect(generation: number, recovery: boolean) {
    const issued = await studyGroupRequest<{ token: string; liveKitUrl: string }>(`/api/study-groups/sessions/${sessionId}/token`, { method: "POST", body: JSON.stringify(recovery ? { recovery: true } : {}), signal: deadlineSignal(TOKEN_REQUEST_TIMEOUT_MS) });
    if (!issued.ok || !issued.data.liveKitUrl) throw new Error(issued.ok ? "unavailable" : issued.code);
    const { DisconnectReason, EngineEvent, Room, RoomEvent } = await import("livekit-client");
    if (connectGeneration.current !== generation || leftRef.current) return;
    // The SDK's own reconnect policy (several attempts with backoff) rides out
    // a short network drop without tearing the room down (QA 2026-10-19 N1).
    const room = new Room();
    activeRoomRef.current = room;
    const current = () => activeRoomRef.current === room;
    const live = <A extends unknown[]>(handler: (...args: A) => void) => whileCurrentRoom(current, handler);
    const showShare = () => {
      // Only someone else's share fills the main view: the sharer's own screen
      // shown back to them nests itself into a hall of mirrors (QA M18).
      const remote = Array.from(room.remoteParticipants.values()).flatMap((person) => [...person.trackPublications.values()]);
      const shared = remote.find((item) => item.source === "screen_share" && item.track && item.track.mediaStreamTrack?.readyState !== "ended" && item.isMuted !== true);
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
    // The room's trust boundary (hunt M2, QA3 F9): the packet's own sender
    // stamp says who spoke (empty only for the server), the parser lets only
    // the server speak as the AI Tutor, and malformed payloads are dropped
    // instead of thrown. The stamp is on the packet the room's engine
    // receives; a failed first attempt (another region) replaces the engine,
    // so each signal connection watches the engine it brought up.
    let watchedEngine: unknown = null;
    const watchData = () => {
      if (room.engine === watchedEngine) return;
      watchedEngine = room.engine;
      room.engine.on(EngineEvent.DataPacketReceived, live(receiveData));
    };
    room.on(RoomEvent.SignalConnected, watchData);
    const receiveData = (packet: Parameters<typeof roomDataPacket>[0]) => {
      const data = roomDataPacket(packet);
      if (!data) return;
      const message = parseRoomDataMessage(data.payload, data.fromServer);
      if (!message) return;
      const participant = data.senderIdentity ? room.remoteParticipants.get(data.senderIdentity) : undefined;
      const from = roomDataSenderName({ participantName: participant?.name, identity: data.senderIdentity, members: groupRef.current?.members || [], fallback: roomCopy.participant });
      const hostIds = new Set((groupRef.current?.members || []).filter((member) => member.role === "host").map((member) => member.userId));
      if (message.type === "tutor") {
        // The server republishes a crashed tutor answer with the same message
        // id; keying the line by that id drops the repeat instead of
        // double-rendering it.
        setChat((items) => tutorChatLines(items, {
          id: message.id ? `tutor-${message.id}` : `tutor-${items.length}`,
          from: roomCopy.tutorName,
          text: message.text,
          at: chatStamp(),
          tutor: true,
          mode: message.mode,
          ...(message.replyTo ? { replyTo: message.replyTo } : {})
        }));
        setSideTab("chat");
        return;
      }
      if (message.type === "chat") {
        setChat((items) => [...items, { id: `${from}-${items.length}`, from, text: message.text, at: chatStamp(), host: hostIds.has(data.senderIdentity) }]);
        if (sideTabRef.current !== "chat") setUnread((count) => count + 1);
      }
      if (message.type === "raise-hand") setHands((items) => raisedHands(items, data.senderIdentity, message.raised));
      if (message.type === "hands-query") sendRaisedHand(data.senderIdentity);
    };
    const paint = () => {
      if (!current()) return;
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
    // Raised hands live in the room, not on the server: a newcomer hears every
    // raised hand from its owner, and a hand goes down with the person who
    // leaves or drops (QA 2026-10-19 M19). The owner pushes on
    // ParticipantConnected and answers the newcomer's own hands-query, which
    // it sends once its connection is up (the push alone can be lost).
    const sendRaisedHand = (identity: string) => {
      if (!handsRef.current.includes(room.localParticipant.identity)) return;
      void room.localParticipant.publishData(new TextEncoder().encode(JSON.stringify({ type: "raise-hand", raised: true })), { reliable: true, destinationIdentities: [identity] }).catch(() => undefined);
    };
    room.on(RoomEvent.ParticipantConnected, live((participant) => {
      paint();
      window.setTimeout(() => void load(), 400);
      sendRaisedHand(participant.identity);
    }));
    room.on(RoomEvent.ParticipantDisconnected, live((participant) => {
      setHands((items) => raisedHands(items, participant.identity, false));
      paint();
      window.setTimeout(() => void load(), 400);
    }));
    room.on(RoomEvent.ActiveSpeakersChanged, live(paint));
    room.on(RoomEvent.TrackMuted, live(() => { paint(); showShare(); }));
    room.on(RoomEvent.TrackUnmuted, live(() => { paint(); showShare(); }));
    const attachRemoteAudio = (track: { kind: string; attach: () => HTMLMediaElement }) => {
      if (track.kind !== "audio") return;
      const element = track.attach();
      element.autoplay = true;
      if (audioRoot.current && element.parentElement !== audioRoot.current) audioRoot.current.appendChild(element);
      void room.startAudio().catch(() => undefined).finally(live(() => setAudioBlocked(!room.canPlaybackAudio)));
    };
    // Autoplay policy (Safari, iOS): remote audio stays silent until a user
    // gesture; the page offers a button instead of failing silently (QA N13).
    room.on(RoomEvent.AudioPlaybackStatusChanged, live(() => setAudioBlocked(!room.canPlaybackAudio)));
    room.on(RoomEvent.TrackSubscribed, live((track) => { attachRemoteAudio(track); paint(); showShare(); }));
    room.on(RoomEvent.TrackUnpublished, live(() => { paint(); showShare(); }));
    room.on(RoomEvent.TrackUnsubscribed, (track) => {
      // The audio element goes whether or not the room is still current.
      if (track.kind === "audio") track.detach().forEach((element) => element.remove());
      if (!current()) return;
      paint();
      showShare();
    });
    room.on(RoomEvent.LocalTrackPublished, live(() => { paint(); showShare(); }));
    room.on(RoomEvent.LocalTrackUnpublished, live(() => { paint(); showShare(); }));
    // While the SDK recovers the connection the room stays up and connected:
    // tearing it down here used to cancel the SDK's own recovery (QA N1).
    room.on(RoomEvent.Reconnecting, live(() => {
      setReconnecting(true);
      const transition = transitionLiveKitClient({ type: "connection_quality", quality: "Lost" });
      if (transition.incident) reportIncident(transition.incident.code);
    }));
    room.on(RoomEvent.Reconnected, live(() => {
      if (transitionLiveKitClient({ type: "reconnected" }).type === "connected") {
        setReconnecting(false);
        setErrorCode("");
        paint();
        showShare();
      }
    }));
    room.on(RoomEvent.ConnectionQualityChanged, live((quality, participant) => {
      if (participant?.identity !== room.localParticipant.identity) return;
      const transition = transitionLiveKitClient({ type: "connection_quality", quality: String(quality) });
      if (transition.type === "sdk_reconnecting" && transition.incident) reportIncident(transition.incident.code);
    }));
    room.on(RoomEvent.Disconnected, (reason) => {
      if (roomRef.current !== room) return;
      // The call's state goes with the call even while a leave is in flight:
      // a leave the server then refuses must find a disconnected page that
      // reconnects, not a dead room marked connected (QA3 F4).
      roomRef.current = null;
      resetCall();
      const reasonName = liveKitDisconnectReasonName(reason, DisconnectReason as unknown as Record<number, string>);
      const transition = transitionLiveKitClient({ type: "disconnect", reason: reasonName, recoveryUsed: recoveryUsedRef.current });
      const step = liveKitDisconnectStep(transition, leftRef.current);
      if (step === "recover") {
        recoveryUsedRef.current = true;
        if (transition.incident) reportIncident(transition.incident.code);
        setRecoveryRequired(true);
        setConnectAttempt((attempt) => attempt + 1);
        return;
      }
      if (step === "report") {
        if (transition.incident) reportIncident(transition.incident.code);
        return;
      }
      // A terminal reason (another tab of this account joined, removed, room
      // ended) must not be fought with an automatic reconnect: two tabs used
      // to kick each other out forever (QA N2).
      if (step === "blocked") setBlocked(true);
      if (transition.incident) showIncident(transition.incident);
    });
    try {
      await room.connect(issued.data.liveKitUrl, issued.data.token);
    } catch (error) {
      if (current()) activeRoomRef.current = null;
      await room.disconnect().catch(() => undefined);
      throw error;
    }
    // Released (left, superseded, page gone) while it was connecting.
    if (connectGeneration.current !== generation || leftRef.current || !current()) {
      if (current()) activeRoomRef.current = null;
      await room.disconnect().catch(() => undefined);
      return;
    }
    watchData();
    roomRef.current = room;
    setRoomApi(room);
    setConnected(true);
    setReconnecting(false);
    void room.localParticipant.publishData(new TextEncoder().encode(JSON.stringify({ type: "hands-query" })), { reliable: true }).catch(() => undefined);
    failuresRef.current = 0;
    recoveryUsedRef.current = false;
    setRecoveryRequired(false);
    setErrorCode("");
    paint();
    void room.startAudio().catch(() => undefined).finally(live(() => setAudioBlocked(!room.canPlaybackAudio)));
  }

  useEffect(() => {
    // Unload (refresh, tab close, navigating away) only drops this page's own
    // media connection. The seat is the server's business: it stops being
    // renewed and lapses one lease later, so a reload re-enters the same live
    // session and a closed tab frees its seat (modules/group-study/presence.ts).
    // A hidden page sends no seat intent again (it has left): if the
    // back/forward cache brings it back, a page that was in the session
    // reloads instead of passing off a dead call as connected, and its seat
    // is entered again only by a live page (QA3 room review F1).
    const release = () => {
      const rooms = new Set([roomRef.current, activeRoomRef.current]);
      roomRef.current = null;
      activeRoomRef.current = null;
      rooms.forEach((room) => void room?.disconnect().catch(() => undefined));
    };
    const hide = () => {
      leftRef.current = true;
      release();
    };
    const show = (event: PageTransitionEvent) => {
      if (roomPageRestoreAction({ persisted: event.persisted, left: leftShownRef.current }) === "reload") window.location.reload();
    };
    window.addEventListener("pagehide", hide);
    window.addEventListener("pageshow", show);
    return () => {
      window.removeEventListener("pagehide", hide);
      window.removeEventListener("pageshow", show);
      release();
    };
  }, [sessionId]);

  // The seat holder's heartbeat: keeps this page's seat while the page is
  // open. A seat the server no longer holds (the device slept, the network
  // was gone longer than the lease) is entered again through the normal
  // admission rules.
  // A page stopped for good (another tab took this account's place, removed,
  // signed out) holds no seat: it stops renewing, so the tab that took over,
  // or nobody, decides (QA 2026-10-19 final review B1).
  // A background tab's timers are throttled to about once a minute, so the
  // lease could lapse while the page sleeps; coming back to the tab or back
  // online renews at once (QA 2026-10-19 final review r2-B4).
  useEffect(() => {
    if (!seated || left || blocked || accessLost || (session?.state !== "live" && session?.state !== "starting_soon")) return;
    // Each intent is bounded by the seat intents' own timeout, so a request
    // stalled by a sleeping device frees the next renewal (QA3 F3), and a page
    // that has left sends neither a renewal nor an entry (QA3 F1, F5).
    const beat = async () => {
      if (heartbeatBusy.current || leftRef.current) return;
      heartbeatBusy.current = true;
      try {
        const result = await seatIntent<{ seated: boolean }>("heartbeat");
        if (!result.ok || result.data.seated || leftRef.current || blockedRef.current) return;
        const entered = await seatIntent("enter");
        if (entered.ok || leftRef.current) return;
        if (seatReentryAction(entered.code, roomRef.current?.state === "connected") === "keep") return;
        setSeated(false);
        setErrorCode(entered.code);
        await releaseRoom();
      } finally {
        heartbeatBusy.current = false;
      }
    };
    const timer = window.setInterval(() => void beat(), SEAT_HEARTBEAT_MS);
    const beatWhenVisible = () => { if (document.visibilityState === "visible") void beat(); };
    const beatNow = () => void beat();
    document.addEventListener("visibilitychange", beatWhenVisible);
    window.addEventListener("online", beatNow);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", beatWhenVisible);
      window.removeEventListener("online", beatNow);
    };
  }, [seated, left, blocked, accessLost, session?.state, sessionId]);

  // Coming back online retries a dropped connection at once instead of
  // waiting for the next backoff step. A connect in flight or a held call
  // is left alone: restarting it would only race a second Room against the
  // first (QA3 F8).
  useEffect(() => {
    const retry = () => {
      if (connectingRef.current || roomRef.current) return;
      setConnectAttempt((attempt) => attempt + 1);
    };
    window.addEventListener("online", retry);
    return () => window.removeEventListener("online", retry);
  }, []);

  useEffect(() => {
    sideTabRef.current = sideTab;
    if (sideTab === "chat") { setUnread(0); chatPinnedRef.current = true; }
  }, [sideTab]);

  // BUG-0198: the chat scrolls inside the fixed-height panel (599:1276) instead
  // of stretching the page, and follows the newest line while the reader is at
  // the bottom; someone reading back up is not pulled down.
  useEffect(() => {
    const log = chatLogRef.current;
    if (log && chatPinnedRef.current) log.scrollTop = log.scrollHeight;
  }, [chat, sideTab]);

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load(), 3000);
    return () => window.clearInterval(timer);
  }, [sessionId]);

  useEffect(() => {
    if (session?.state === "completed") void releaseRoom();
    if (session?.state === "live") setStartError("");
  }, [session?.state]);

  useEffect(() => {
    setCanShare(screenShareSupported(navigator.mediaDevices));
  }, []);

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
    void seatIntent("enter").then((result) => {
      if (cancelled || leftRef.current) return;
      if (result.ok) setSeated(true);
      else if (result.code !== "session_not_open") setErrorCode(result.code);
      setEntryDone(true);
    }).catch(() => {
      if (cancelled) return;
      // A network drop or a gateway error page rejects the entry request
      // (hunt M1): without this branch entryDone stayed false and the page sat
      // on Loading with no error and no way forward. Surface the connect
      // failure instead — the retry below re-runs the whole entry request.
      setErrorCode("connect_failed");
      setEntryDone(true);
    });
    return () => { cancelled = true; };
  }, [session?.state, sessionId, left, entryAttempt]);

  useEffect(() => {
    // leftRef: a Leave or a navigation away already dropped this page's seat.
    if (session?.state !== "live" || connected || left || leftRef.current || !seated || blocked || accessLost) return;
    const generation = connectGeneration.current + 1;
    connectGeneration.current = generation;
    let timer = 0;
    const recovery = recoveryRequired;
    // Releasing first also aborts a Room still connecting for an earlier
    // attempt; that attempt then settles before this one starts (QA3 F8).
    const previous = connectRunRef.current;
    const token = {};
    connectingRef.current = token;
    const run = (async () => {
      await releaseRoom();
      await previous;
      if (connectGeneration.current !== generation || leftRef.current) return;
      const entered = await seatIntent("enter");
      if (connectGeneration.current !== generation || leftRef.current) return;
      if (!entered.ok) throw new Error(entered.code);
      await connect(generation, recovery);
    })().catch((error: unknown) => {
      if (connectGeneration.current !== generation) return;
      const code = error instanceof Error ? error.message : "";
      if (FINAL_ENTRY_CODES.has(code)) {
        setErrorCode(code);
        setBlocked(true);
        return;
      }
      // One verified-token recovery, then keep trying with backoff for as
      // long as the page is open: a connection that failed a few times in a
      // row used to stop for good (QA 2026-10-19 N1).
      if (!recovery && !recoveryUsedRef.current) {
        recoveryUsedRef.current = true;
        setRecoveryRequired(true);
        setConnectAttempt((attempt) => attempt + 1);
        return;
      }
      setErrorCode(code in copy.errors ? code : "connect_failed");
      timer = window.setTimeout(() => setConnectAttempt((attempt) => attempt + 1), reconnectDelayMs(failuresRef.current));
      failuresRef.current += 1;
    }).finally(() => {
      if (connectingRef.current === token) connectingRef.current = null;
    });
    connectRunRef.current = run;
    return () => {
      connectGeneration.current += 1;
      window.clearTimeout(timer);
    };
  }, [session?.state, connected, left, seated, connectAttempt, recoveryRequired, blocked, accessLost]);

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

  useEffect(() => {
    if (caretRef.current === null) return;
    const input = chatInputRef.current;
    if (!input) return;
    input.focus();
    input.setSelectionRange(caretRef.current, caretRef.current);
    caretRef.current = null;
  });

  useEffect(() => () => {
    if (permissionWatchRef.current) permissionWatchRef.current.onchange = null;
  }, []);

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

  function watchMediaPermission(status: PermissionStatus | null) {
    if (permissionWatchRef.current) permissionWatchRef.current.onchange = null;
    permissionWatchRef.current = status;
    if (!status) return;
    status.onchange = () => {
      if (status.state === "granted") setMediaNotice(null);
    };
  }

  async function toggleMedia(kind: "mic" | "camera", enabled: boolean) {
    const permission = await mediaPermission(kind);
    // A denied permission never prompts again, so skip the doomed call and
    // point at the browser controls instead. "prompt" keeps the normal call —
    // that is what raises the browser's own permission dialog.
    if (permission.state === "denied") {
      watchMediaPermission(permission.status);
      setMediaNotice({ kind, device: false });
      return;
    }
    try {
      await setMedia(kind, enabled);
    } catch (error) {
      if (kind === "mic") setMicOn(false);
      if (kind === "camera") setCameraOn(false);
      // Permission errors get the address-bar guidance; missing/busy devices
      // (NotFoundError / NotReadableError) get the device guidance instead.
      if (isPermissionMediaError(error) || isDeviceMediaError(error)) {
        watchMediaPermission(permission.status);
        setMediaNotice({ kind, device: isDeviceMediaError(error) });
      }
    }
  }

  // Leave Session after the confirmation. The server decides: until it has
  // taken the leave, the seat and the call stay and the dialog offers the
  // leave again instead of claiming "You left" (QA 2026-10-19 M15). An ended
  // session has nobody left to leave.
  // The leave goes out after any entry or renewal already on its way, and no
  // entry or renewal follows it, so the server never seats the page again
  // after taking its leave (QA3 F5).
  async function leaveSession() {
    leftRef.current = true;
    setLeaving(true);
    setLeaveError("");
    const result = await seatIntent("leave");
    setLeaving(false);
    if (!result.ok && result.code !== "session_unavailable") {
      leftRef.current = false;
      setLeaveError(result.code);
      // The call may have dropped while the leave was in flight (QA3 F4):
      // the page reconnects by the normal rules.
      setConnectAttempt((attempt) => attempt + 1);
      return;
    }
    // Left first: dropping the call flips `connected`, and the connect effect
    // must not see a seated, not-left page and enter again (QA M15).
    setLeaveAsked(false);
    setLeft(true);
    await releaseRoom();
    await load();
  }

  // Back into a session that is still live after leaving it: the normal
  // entry runs again, with every admission rule.
  function rejoin() {
    leftRef.current = false;
    setErrorCode("");
    setBlocked(false);
    setSeated(false);
    setEntryDone(false);
    failuresRef.current = 0;
    setLeft(false);
  }

  async function startSession() {
    setStarting(true);
    setStartError("");
    const started = await studyGroupRequest(`/api/study-groups/sessions/${sessionId}/start`, { method: "POST", body: "{}" });
    if (!started.ok) setStartError(started.code);
    else await load();
    setStarting(false);
  }

  function retryLoad() {
    setPollError("");
    setErrorCode("");
    void load();
  }

  // Runs the entry request again in place, with every admission rule.
  function retryEntry() {
    setErrorCode("");
    setBlocked(false);
    setEntryDone(false);
    setEntryAttempt((attempt) => attempt + 1);
  }

  // Everything the page shows about a call goes with the call: a stale "turn
  // sound on" button after a disconnect did nothing when clicked (QA r4-N13-a),
  // and a hand raised in the old room is not raised in the next one.
  // The released room's own handlers stop with it (QA3 F2, F6): a group poll
  // or a teardown event must not repaint its tiles after the reset.
  function resetCall() {
    activeRoomRef.current = null;
    repaintRef.current = null;
    setRoomApi(null);
    setConnected(false);
    setReconnecting(false);
    setMicOn(false);
    setCameraOn(false);
    setSharing(false);
    setShareTrack(null);
    setAudioBlocked(false);
    setTiles([]);
    setCameraTracks({});
    setHands([]);
  }

  // Also drops a Room still connecting, so no connect outlives its release.
  async function releaseRoom() {
    const rooms = new Set([roomRef.current, activeRoomRef.current]);
    roomRef.current = null;
    resetCall();
    await Promise.all([...rooms].map((room) => room?.disconnect().catch(() => undefined)));
  }

  async function exitTo(href: string) {
    // Navigating away is not Leave Session: the media connection closes and
    // the seat lapses on the server like any closed page, so a last person
    // following a breadcrumb no longer ends the session on the spot.
    leftRef.current = true;
    await releaseRoom();
    window.location.assign(href);
  }

  function path() {
    if (!session) return null;
    return (
      <nav className={styles.crumb} aria-label={roomCopy.crumbGroups}>
        <button type="button" onClick={() => void exitTo(`/${locale}/portal`)}>{roomCopy.crumbHome}</button>
        <CrumbChevron />
        <button type="button" onClick={() => void exitTo(`/${locale}/portal/study-groups`)}>{roomCopy.crumbGroups}</button>
        <CrumbChevron />
        {group ? <button type="button" onClick={() => void exitTo(`/${locale}/portal/study-groups?group=${group.id}`)}>{roomCopy.crumbGroupInfo}</button> : <span>{roomCopy.crumbGroupInfo}</span>}
        <CrumbChevron />
        <span aria-current="page">{roomCopy.crumbSession}</span>
      </nav>
    );
  }

  // A page that cannot show the session says why and offers the way on:
  // sign in, back to Study Groups, or try again (QA 2026-10-19 M17, M20).
  function gate(code: string) {
    const action = roomGateAction(code);
    const message = code === "forbidden" ? roomCopy.noAccess : copy.errors[code as keyof typeof copy.errors] || copy.errors.error;
    return (
      <section className={styles.empty} role="alert">
        <h1>{message}</h1>
        {action === "sign-in"
          ? <a className={styles.primary} href={roomSignInHref(locale, sessionId)}>{copy.signIn}</a>
          : action === "groups"
          ? <a className={styles.primary} href={`/${locale}/portal/study-groups`}>{roomCopy.backToGroups}</a>
          : <button className={styles.primary} type="button" onClick={retryLoad}>{copy.retry}</button>}
      </section>
    );
  }

  const loadError = pollError || errorCode;
  if (!session) return loadError ? <>{path()}{gate(loadError)}</> : <p className={styles.panel} role="status">{copy.loading}</p>;
  if (accessLost) return <>{path()}{gate(pollError)}</>;
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
          <p className={styles.meta}>{group?.courseTitle ? <>{group.courseTitle}<span className={styles.divider} aria-hidden="true" />{fill(roomCopy.groupStudy, { count: plannedMinutes(session) })}</> : fill(roomCopy.groupStudy, { count: plannedMinutes(session) })}</p>
          {ended ? endedParts(roomCopy.endedBody).map((line) => <p className={styles.endBody} key={line}>{line}</p>) : null}
          <div className={styles.endActions}>{!ended && session.state === "live" ? <button className={styles.primary} type="button" onClick={rejoin}>{roomCopy.rejoin}</button> : null}<a className={styles.primary} href={group ? `/${locale}/portal/courses/${group.courseSlug}` : `/${locale}/portal/study-groups`}>{roomCopy.returnToCourse}</a></div>
        </div>
      </section>
      </>
    );
  }
  // A full session can free a seat at any moment, also for a member whose
  // own seat lapsed and was taken: the page offers to enter again (QA3 F7).
  const refusalOffer = seated ? null : seatRefusalOffer(errorCode);
  if (refusalOffer) {
    return <>{path()}<section className={styles.empty} role="alert"><h1>{refusalOffer === "retry" ? copy.sessionFull : copy.errors.course_access_required}</h1><p>{session.title}</p>{refusalOffer === "course-access" && group ? <a className={styles.primary} href={`/${locale}/portal/courses/${group.courseSlug}`}>{copy.getCourseAccess}</a> : null}{refusalOffer === "retry" ? <button className={styles.primary} type="button" onClick={retryEntry}>{copy.retry}</button> : null}</section></>;
  }
  if ((session.state === "starting_soon" || session.state === "live") && !seated && !entryDone) {
    return <p className={styles.panel} role="status">{copy.loading}</p>;
  }
  if ((session.state === "starting_soon" || session.state === "live") && !seated && errorCode) {
    // Entry finished without a seat: the request failed on its way out or was
    // refused (hunt M1). Show the failure with a retry that re-runs the entry
    // request in place instead of leaving the viewer stuck on Loading. A
    // refusal no retry fixes (signed out, not a member) points the way on.
    if (roomGateAction(errorCode) !== "retry") return <>{path()}{gate(errorCode)}</>;
    return <>{path()}<section className={styles.empty} role="alert"><h1>{copy.errors[errorCode as keyof typeof copy.errors] || copy.errors.error}</h1><p>{session.title}</p><button className={styles.primary} type="button" onClick={retryEntry}>{roomCopy.reconnect}</button></section></>;
  }
  if (session.state === "scheduled") {
    return <>{path()}<section className={styles.empty} role="status"><h1>{copy.errors.session_not_open}</h1><p>{session.title}</p>{session.focus ? <><h2>{copy.focus}</h2><p>{session.focus}</p></> : null}<p>{sessionScheduleLabel(locale, session)}</p><p>{fill(copy.plannedDuration, { count: plannedMinutes(session) })}</p><p>{copy.enterWindow}</p></section></>;
  }
  if (sessionNotStarted(session)) {
    return <>{path()}<section className={styles.empty} role="status"><h1>{copy.notStarted}</h1><p>{copy.notStartedBody}</p><p>{session.title}</p><p>{sessionScheduleLabel(locale, session)}</p></section></>;
  }
  if (session.state !== "live") {
    return <>{path()}<section className={styles.empty} role="status"><h1>{group?.role === "host" ? copy.hostWaiting : copy.waiting}</h1><p>{session.title}</p>{session.focus ? <><h2>{copy.focus}</h2><p>{session.focus}</p></> : null}<p>{sessionScheduleLabel(locale, session)}</p><p>{fill(copy.plannedDuration, { count: plannedMinutes(session) })}</p><p>{fill(copy.currentlyInSession, { count: session.occupancy, max: session.maxParticipants })}</p><p>{fill(copy.upToParticipants, { count: session.maxParticipants })}</p>{group?.role === "host" ? <button className={styles.primary} type="button" disabled={starting} aria-busy={starting} onClick={() => void startSession()}>{starting ? roomCopy.starting : copy.start}</button> : null}{startError ? <p className={styles.alert} role="alert">{copy.errors[startError as keyof typeof copy.errors] || copy.errors.error}</p> : null}</section></>;
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
  // A failed poll never shows here: one that means this page may not stay
  // (signed out, no longer a member) has its own page above, and a passing
  // network blip heals on the next poll.
  const errorText = errorCode ? copy.errors[errorCode as keyof typeof copy.errors] || copy.errors.error : "";

  // Why the room does not offer the AI Tutor right now (the server says), or null.
  const tutorOffline = tutorOfflineReason(session);
  const mentionRows: MentionRow[] = [];
  if (mention) {
    const fragment = mention.query.toLowerCase();
    const candidates: MentionRow[] = session.aiTutorEnabled && !tutorOffline ? [{ key: "tutor", name: roomCopy.tutorName, tutor: true }] : [];
    const seenNames = new Set<string>();
    for (const person of roster) {
      if (person.key === roomApi?.localParticipant.identity || seenNames.has(person.name)) continue;
      seenNames.add(person.name);
      candidates.push({ key: person.key, name: person.name });
    }
    for (const row of candidates) {
      if (mentionRows.length === 6) break;
      if (row.name.toLowerCase().startsWith(fragment)) mentionRows.push(row);
    }
  }
  const mentionIndex = mention ? Math.min(mention.index, mentionRows.length - 1) : 0;

  async function publish(message: { type: string; text?: string; raised?: boolean }) {
    if (!roomApi) return;
    await roomApi.localParticipant.publishData(new TextEncoder().encode(JSON.stringify(message)), { reliable: true });
  }

  function markChatLine(id: string, failed: boolean) {
    setChat((items) => items.map((item) => item.id === id ? { ...item, failed } : item));
  }

  // Queues a question for the AI Tutor. Success adds the asker's "answering"
  // line, which the answer replaces; a refusal (busy, too many, not enabled,
  // signed out) stays on the question's own line, marked as not sent to the
  // AI Tutor with the reason and a retry, never on the room banner — an AI
  // Tutor failure has nothing to do with the call (QA N4, X-5). Every ask
  // carries its client event id, so a retry of a request the server did take
  // is answered once (QA M21).
  async function askTutor(lineId: string, ask: { question: string; clientEventId: string }) {
    setChat((items) => items.map((item) => item.id === lineId ? { ...item, tutorAsk: ask, tutorError: undefined, tutorAnswerId: undefined } : item));
    const queued = await studyGroupRequest<{ id: string; position?: number | null }>(`/api/study-groups/sessions/${sessionId}/ai-tutor`, { method: "POST", body: JSON.stringify(tutorQueueBody(ask.question, ask.clientEventId)) });
    if (!queued.ok) {
      setChat((items) => items.map((item) => item.id === lineId ? { ...item, tutorError: queued.code } : item));
      return;
    }
    const answerId = `tutor-${queued.data.id}`;
    setChat((items) => tutorChatLines(items.map((item) => item.id === lineId ? { ...item, tutorAnswerId: answerId } : item), { id: answerId, from: roomCopy.tutorName, text: "", at: chatStamp(), tutor: true, pending: true, queuedPosition: queued.data.position ?? null }));
    // A question the server still lists as waiting keeps waiting; only one it
    // no longer lists, with no answer here, is called unavailable.
    let waits = 0;
    const expire = () => {
      if (tutorStillWaiting(sessionRef.current, answerId) && waits < TUTOR_ANSWER_WAITS) {
        waits += 1;
        window.setTimeout(expire, TUTOR_ANSWER_TIMEOUT_MS);
        return;
      }
      setChat((items) => items.map((item) => item.id === answerId && item.pending ? { ...item, mode: "unavailable" } : item));
    };
    window.setTimeout(expire, TUTOR_ANSWER_TIMEOUT_MS);
  }

  // Takes back a question the AI Tutor has not started on: its waiting line
  // goes, and the question line says it was withdrawn. A question the Tutor
  // has meanwhile started keeps waiting for its answer.
  async function withdrawTutor(answerId: string) {
    const requestId = answerId.replace(/^tutor-/, "");
    const withdrawn = await studyGroupRequest<{ id: string; withdrawn: boolean }>(`/api/study-groups/sessions/${sessionId}/ai-tutor`, { method: "DELETE", body: JSON.stringify({ requestId }) });
    if (!withdrawn.ok || !withdrawn.data.withdrawn) return;
    setChat((items) => items.filter((item) => item.id !== answerId).map((item) => item.tutorAnswerId === answerId ? { ...item, tutorWithdrawn: true, tutorAnswerId: undefined } : item));
  }

  // The optimistic echo must not claim success the room never saw (hunt M5):
  // publishData rejects (for example "Message too large") instead of sending,
  // so the line is marked failed and can be resent from the marker.
  function sendChatLine(line: ChatLine) {
    markChatLine(line.id, false);
    return publish({ type: "chat", text: line.text }).catch(() => markChatLine(line.id, true));
  }

  function updateMention(value: string, caret: number) {
    const upToCaret = value.slice(0, caret);
    const at = upToCaret.lastIndexOf("@");
    if (at < 0 || (at > 0 && upToCaret[at - 1] !== " ")) {
      setMention(null);
      return;
    }
    setMention({ start: at, query: upToCaret.slice(at + 1), index: 0 });
  }

  function chooseMention(row: MentionRow) {
    if (!mention) return;
    const next = `${draft.slice(0, mention.start)}@${row.name} ${draft.slice(mention.start + 1 + mention.query.length)}`;
    caretRef.current = mention.start + row.name.length + 2;
    setDraft(next);
    setMention(null);
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
        {reconnecting ? <p className={styles.alert} role="status">{copy.errors.network_lost}</p> : null}
        {!reconnecting && errorText ? <p className={styles.alert} role="alert">{errorText} <button className={styles.textButton} type="button" onClick={() => { setErrorCode(""); setBlocked(false); failuresRef.current = 0; setRecoveryRequired(true); setConnected(false); setConnectAttempt((attempt) => attempt + 1); }}>{roomCopy.reconnect}</button></p> : null}
        {audioBlocked ? <p className={styles.alert} role="alert"><button className={styles.textButton} type="button" onClick={() => { const room = roomRef.current; void room?.startAudio().catch(() => undefined).finally(() => { if (roomRef.current === room) setAudioBlocked(Boolean(room && !room.canPlaybackAudio)); }); }}>{roomCopy.enableAudio}</button></p> : null}
        <div ref={audioRoot} hidden />
        {shareTrack ? <video ref={shareVideo} className={styles.shareMain} autoPlay playsInline muted /> : null}
        {sharing ? <p className={styles.meta} role="status">{roomCopy.sharingNotice}</p> : null}
        <div className={`${styles.videos}${tiles.length <= 1 ? ` ${styles.videosSingle}` : ""}`}>
          {tiles.length === 0 ? <div className={styles.tile}><span>{connected ? copy.loading : blocked || errorCode ? roomCopy.notConnected : roomCopy.connecting}</span></div> : tiles.map((tile) => {
            const camera = cameraTracks[tile.identity] ?? null;
            return (
              <div className={styles.tile} data-video={camera ? "on" : "off"} key={tile.identity}>
                <ParticipantCamera track={camera} />
                {camera ? null : <span className={styles.tilePlaceholder} aria-hidden="true"><i><PersonGlyph /></i></span>}
                {tile.speaking ? <span className={styles.speakingPill}>{roomCopy.speaking}</span> : null}
                {hands.includes(tile.identity) ? <span className={styles.tileHand} role="img" aria-label={roomCopy.raiseHand}>✋</span> : null}
                <span className={styles.tileCaption}><span>{tile.name}{tile.host ? <span className={styles.tileHost}> · {roomCopy.host}</span> : ""}{tile.speaking ? <i className={styles.speakingDot} aria-hidden="true" /> : null}</span><TileMic status={participantStatus(tile)} label={tileStatus(roomCopy, tile)} /></span>
              </div>
            );
          })}
        </div>
        {mediaNotice ? <p className={styles.alert} role="alert">{mediaNotice.device ? roomCopy.mediaDeviceBlocked : mediaNotice.kind === "camera" ? roomCopy.mediaBlockedCamera : roomCopy.mediaBlockedMic} <button className={styles.textButton} type="button" onClick={() => setMediaNotice(null)}>{copy.close}</button></p> : null}
        {shareFailed ? <p className={styles.alert} role="alert">{roomCopy.shareFailed} <button className={styles.textButton} type="button" onClick={() => setShareFailed(false)}>{copy.close}</button></p> : null}
        {/* BUG-0196: the focus carries the same "Session Focus" label and 12px body as the waiting dialog (599:755), so it never reads as a second title. */}
        {session.focus ? <section className={styles.roomFocus} aria-labelledby="study-session-focus"><h2 id="study-session-focus" className={styles.waitingFocus}>{copy.focus}</h2><p>{session.focus}</p></section> : null}
        <div className={styles.controls}>
          {controls.includes("mic") ? <button type="button" aria-pressed={micOn} disabled={!connected} onClick={() => void toggleMedia("mic", !micOn)}><ControlIcon kind="mic" />{roomCopy.mic}</button> : null}
          {controls.includes("camera") ? <button type="button" aria-pressed={cameraOn} disabled={!connected} onClick={() => void toggleMedia("camera", !cameraOn)}><ControlIcon kind="camera" />{roomCopy.camera}</button> : null}
          {controls.includes("share") && canShare ? <button className={styles.shareControl} type="button" aria-pressed={sharing} disabled={!connected} onClick={() => {
            const start = !sharing;
            setShareFailed(false);
            void setMedia("share", start).catch((error: unknown) => {
              setSharing(false);
              if (start && !screenShareCancelled(error)) setShareFailed(true);
            });
          }}><ControlIcon kind="share" />{roomCopy.share}</button> : null}
          {controls.includes("participants") ? <button type="button" className={styles.participantCount} data-participants={present} aria-pressed={sideTab === "participants"} onClick={() => setSideTab("participants")}><span className={styles.controlGlyph}><ControlIcon kind="people" /><span className={styles.participantBadge}>{present}</span></span>{roomCopy.participants}</button> : null}
          {controls.includes("raise-hand") ? <button type="button" aria-pressed={Boolean(roomApi?.localParticipant.identity && hands.includes(roomApi.localParticipant.identity))} disabled={!connected} onClick={() => {
            const identity = roomApi?.localParticipant.identity || "";
            if (!identity) return;
            const raised = !hands.includes(identity);
            setHands((items) => raisedHands(items, identity, raised));
            // The optimistic toggle is reconciled with the publish result (hunt
            // M5 pattern, audit F-3): a rejected broadcast reverts the local
            // hand — but only while the failed intent is still the current
            // state, so a newer click is never undone. No resend button and no
            // error strip: a transient hand is retried by clicking again.
            void publish({ type: "raise-hand", raised }).catch(() => setHands((items) => (items.includes(identity) === raised ? raisedHands(items, identity, !raised) : items)));
          }}><ControlIcon kind="hand" />{roomCopy.raiseHand}</button> : null}
          {controls.includes("leave") ? <button className={styles.leaveControl} type="button" onClick={() => { setLeaveError(""); setLeaveAsked(true); }}><ControlIcon kind="leave" />{roomCopy.leave}</button> : null}
        </div>
        {leaveAsked ? (
          <PortalDialog className={styles.modal} labelledBy="study-session-leave-title" onClose={() => setLeaveAsked(false)} busy={leaving}>
            <form method="dialog" onSubmit={(event) => { event.preventDefault(); void leaveSession(); }}>
              <h2 id="study-session-leave-title">{roomCopy.leaveConfirmTitle}</h2>
              {/* The server's seat count says whether anyone stays behind. */}
              <p className={styles.confirmBody}>{session.occupancy <= 1 ? roomCopy.leaveConfirmLast : roomCopy.leaveConfirmBody}</p>
              {leaveError ? <p className={styles.alert} role="alert">{roomCopy.leaveFailed} {copy.errors[leaveError as keyof typeof copy.errors] || copy.errors.error}</p> : null}
              <div className={styles.dialogActions}>
                <button className={styles.ghost} type="button" onClick={() => setLeaveAsked(false)} disabled={leaving}>{copy.confirmBack}</button><button className={styles.danger} type="submit" disabled={leaving}>{leaveError ? copy.retry : roomCopy.confirmLeave}</button>
              </div>
            </form>
          </PortalDialog>
        ) : null}
      </div>
      <aside className={styles.side} aria-label={sideTab === "participants" ? roomCopy.participants : roomCopy.chat}>
        <div className={styles.sideTabs} role="tablist">
          <button type="button" role="tab" aria-selected={sideTab === "participants"} onClick={() => setSideTab("participants")}>{roomCopy.participants} <span className={styles.tabCount}>{present}/{session.maxParticipants}</span></button>
          <button type="button" role="tab" aria-selected={sideTab === "chat"} onClick={() => setSideTab("chat")}>{roomCopy.chat}{unread > 0 ? <span className={styles.tabCount} aria-label={fill(roomCopy.unread, { count: unread })}>{unread}</span> : null}</button>
        </div>
        {sideTab === "participants" ? (
          <div className={styles.sidePanel} role="tabpanel">
            <ul className={styles.roster}>
              {roster.map((person) => <li key={person.key}><span className={styles.rosterInitial}>{person.name.slice(0, 1)}</span><strong>{person.name}</strong>{person.host ? <span className={styles.chatHost}>{roomCopy.host}</span> : null}{person.hand ? <span>{roomCopy.raiseHand}</span> : null}{person.status ? <span className={styles.rosterStatus} data-status={person.status}>{person.status === "muted" ? roomCopy.muted : person.status === "speaking" ? roomCopy.speaking : roomCopy.micOn}</span> : null}</li>)}
            </ul>
          </div>
        ) : (
          <>
            <div ref={chatLogRef} className={styles.chatLog} role="tabpanel" aria-live="polite" onScroll={(event) => {
              const log = event.currentTarget;
              chatPinnedRef.current = log.scrollHeight - log.scrollTop - log.clientHeight < 24;
            }}>
              {chat.map((line) => <article className={styles.chatLine} key={line.id}><div className={styles.chatHead}>{line.tutor ? <span className={styles.tutorAvatar} aria-hidden="true">✦</span> : <span className={styles.rosterInitial}>{line.from.slice(0, 1)}</span>}<strong className={line.tutor ? styles.tutorName : undefined}>{line.from}</strong>{line.host ? <span className={styles.chatHost}>{roomCopy.host}</span> : null}{line.tutor ? null : <time dateTime={line.at}>{chatLabel(locale, line.at)}</time>}</div>{line.tutor ? (
                <p className={`${styles.chatBody} ${styles.tutorBody}`}>
                  {line.replyTo ? <span className={styles.tutorDisclosure}>{fill(roomCopy.tutorReplyTo, { name: line.replyTo.name || roomCopy.participant, question: line.replyTo.question })}</span> : null}
                  {line.mode === "unavailable"
                    ? roomCopy.tutorUnavailable
                    : line.pending
                    ? (() => {
                        const pending = tutorPendingState(session, line.id, line.queuedPosition);
                        return <span className={styles.tutorRow} role="status">{pending.state === "queued" ? (pending.ahead > 0 ? fill(roomCopy.tutorQueued, { count: String(pending.ahead) }) : roomCopy.tutorNext) : roomCopy.tutorAnswering}{pending.withdrawable ? <> <button className={styles.textButton} type="button" onClick={() => void withdrawTutor(line.id)}>{roomCopy.tutorWithdraw}</button></> : null}</span>;
                      })()
                    : <>
                        {line.text.split("\n").filter((row) => row.trim()).map((row, index) => index === 0
                          ? <span key="lead" className={styles.tutorLead}>{row}</span>
                          : <span key={index} className={styles.tutorRow}>{row}</span>)}
                      </>}
                </p>
              ) : <><p className={styles.chatBody}>{line.text.startsWith(`${roomCopy.aiTutor} `) ? <><span className={styles.tutorMention}>{roomCopy.aiTutor}</span>{line.text.slice(roomCopy.aiTutor.length)}</> : line.text}</p>{line.failed ? <p className={styles.alert} role="alert">{copy.errors.error} <button className={styles.textButton} type="button" onClick={() => void sendChatLine(line)}>{roomCopy.send}</button></p> : null}{line.tutorError && line.tutorAsk ? <p className={styles.alert} role="alert">{fill(roomCopy.tutorNotSent, { reason: tutorRefusalReason(line.tutorError, { errors: copy.errors, notLive: roomCopy.tutorNotLive }) })} <button className={styles.textButton} type="button" onClick={() => void askTutor(line.id, line.tutorAsk!)}>{roomCopy.tutorRetry}</button></p> : null}{line.tutorWithdrawn ? <p className={styles.chatBody} role="status">{roomCopy.tutorWithdrawn}</p> : null}{!line.tutorError && line.tutorAsk && tutorAskAgain(chat, line.tutorAnswerId) ? <p className={styles.chatBody}><button className={styles.textButton} type="button" onClick={() => void askTutor(line.id, { question: line.tutorAsk!.question, clientEventId: tutorClientEventId() })}>{roomCopy.tutorRetry}</button></p> : null}</>}</article>)}
              {!connected ? <p>{roomCopy.chatUnavailable}</p> : null}
            </div>
            <form className={styles.chatForm} onSubmit={(event) => {
              event.preventDefault();
              const text = draft.trim();
              if (!text || !connected) return;
              // The room has no AI Tutor toggle: typing "@AI Tutor " (or picking
              // it from the mention list) is the only way to address the Tutor.
              const prefix = `${roomCopy.aiTutor} `;
              const hasPrefix = text.startsWith(prefix);
              const mentionsTutor = (addressTutor || hasPrefix) && session.aiTutorEnabled && !tutorOffline;
              const chatText = mentionsTutor && !hasPrefix ? `${roomCopy.aiTutor} ${text}` : text;
              const line: ChatLine = { id: `local-${chatSequence.current++}`, from: roomCopy.you, text: chatText, at: chatStamp(), host: group?.role === "host" };
              chatPinnedRef.current = true;
              setChat((items) => [...items, line]);
              void sendChatLine(line);
              if (mentionsTutor) void askTutor(line.id, { question: (hasPrefix ? text.slice(prefix.length) : text).trim(), clientEventId: tutorClientEventId() });
              setMention(null);
              setDraft("");
              setAddressTutor(false);
            }}>

              {mentionRows.length > 0 ? (
                <div className={styles.mentionMenu} role="listbox" aria-label={roomCopy.mentionList}>
                  {mentionRows.map((row, index) => (
                    <button type="button" role="option" aria-selected={index === mentionIndex} key={row.key} onMouseDown={(event) => { event.preventDefault(); chooseMention(row); }}>
                      <span className={row.tutor ? styles.tutorAvatar : styles.rosterInitial} aria-hidden="true">{row.tutor ? "✦" : row.name.slice(0, 1)}</span>
                      {row.name}
                    </button>
                  ))}
                </div>
              ) : null}
              <input ref={chatInputRef} maxLength={ROOM_CHAT_MAX_LENGTH} aria-label={roomCopy.chat} value={draft} onChange={(event) => { setDraft(event.target.value); updateMention(event.target.value, event.target.selectionStart ?? event.target.value.length); }} onKeyDown={(event) => {
                // IME composition (Chinese/Japanese input): Enter picks the candidate and
                // Escape/arrows drive the IME — the mention popup must not steal those.
                if (event.nativeEvent.isComposing || event.keyCode === 229) return;
                if (!mention || mentionRows.length === 0) return;
                if (event.key === "ArrowDown") { event.preventDefault(); setMention({ ...mention, index: (mentionIndex + 1) % mentionRows.length }); }
                else if (event.key === "ArrowUp") { event.preventDefault(); setMention({ ...mention, index: (mentionIndex - 1 + mentionRows.length) % mentionRows.length }); }
                else if (event.key === "Escape") { event.preventDefault(); setMention(null); }
                else if (event.key === "Enter") { event.preventDefault(); chooseMention(mentionRows[mentionIndex]); }
              }} placeholder={roomCopy.chatPlaceholder} disabled={!connected} />
              {/* 599:1392: the box holds only the placeholder and the send control; the @AI Tutor entry sits on the box's bottom-left edge instead of a label above the text (BUG-0197). */}
              {tutorOffline ? <p className={`${styles.chatBody} ${styles.tutorOffline}`} role="status" data-testid="tutor-offline">{roomCopy[`tutorOff_${tutorOffline}`]}</p> : null}
              {session.aiTutorEnabled ? <button className={styles.tutorEntry} type="button" aria-pressed={addressTutor} disabled={Boolean(tutorOffline)} title={tutorOffline ? roomCopy[`tutorOff_${tutorOffline}`] : undefined} onClick={() => setAddressTutor((on) => !on)}>{roomCopy.aiTutor}</button> : null}
              <button className={styles.sendButton} type="submit" disabled={!connected} aria-label={roomCopy.send}><svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><path d="M2 8.5 14 2 9 14l-1.5-4.5L2 8.5Z" fill="currentColor" /></svg></button>
            </form>
          </>
        )}
      </aside>
    </section>
    </>
  );
}
