// Pure helpers for the Live Session room's data channel, kept out of the
// component so the message contract is unit-testable (bug hunt 2026-10-14).

// The room chat input cap (hunt M5). LiveKit's reliable data channel rejects
// oversized messages (SCTP maxMessageSize, ~256KB in Chrome) by throwing
// inside publishData, which the optimistic echo used to swallow; 2000 keeps a
// comfortable margin under that and matches what a chat message needs.
export const ROOM_CHAT_MAX_LENGTH = 2000;

export type RoomTutorMessage = { type: "tutor"; id?: string; text: string; mode: "course" | "general" | "unavailable"; replyTo?: { name: string; question: string } };
export type RoomChatMessage = { type: "chat"; text: string };
export type RoomRaiseHandMessage = { type: "raise-hand"; raised: boolean };
// A newcomer, once its own connection is up, asks who has a hand raised; each
// raiser answers to it alone (QA M19: a push sent on ParticipantConnected can
// reach the newcomer before its data channel is open and be lost).
export type RoomHandsQueryMessage = { type: "hands-query" };
export type RoomDataMessage = RoomTutorMessage | RoomChatMessage | RoomRaiseHandMessage | RoomHandsQueryMessage;

// The chat line's HH:mm stamp in the APPLICATION locale (hunt L6). The room
// used to format with the browser locale, so a zh-CN user on an en-US
// browser saw "02:15 PM" in chat while the session cards on the same page
// showed "14:15". An unparseable stamp echoes back unchanged.
export function chatLabel(locale: string, at: string) {
  const date = new Date(at);
  if (Number.isNaN(date.getTime())) return at;
  return new Intl.DateTimeFormat(locale, { hour: "2-digit", minute: "2-digit" }).format(date);
}

// Parses one data-channel payload into a renderable message, or null when it
// must be dropped. The parser is where the room's trust boundary lives
// (hunt M2): the publisher is passed in as `fromServer` because LiveKit
// distinguishes them at the protocol level — a member publish always carries
// its identity, while the server's own RoomService.SendData (the AI Tutor
// answer republished from the outbox) arrives with none (roomDataPacket).
// Only the server may render as the AI Tutor; only members may chat or raise
// hands. Malformed payloads are dropped instead of throwing: one bad message
// must not interrupt the event handler for every later room event.
function tutorReplyTo(value: unknown) {
  if (!value || typeof value !== "object") return null;
  const { name, question } = value as Record<string, unknown>;
  if (typeof name !== "string" || typeof question !== "string" || !question) return null;
  return { name, question };
}

export function parseRoomDataMessage(raw: Uint8Array, fromServer: boolean): RoomDataMessage | null {
  let value: unknown;
  try {
    value = JSON.parse(new TextDecoder().decode(raw));
  } catch {
    return null;
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const message = value as Record<string, unknown>;
  if (message.type === "tutor") {
    if (!fromServer) return null;
    if (typeof message.text !== "string") return null;
    // An "unavailable" tutor message carries an empty text by contract, so the
    // empty-text guard lets exactly that case through.
    if (!message.text && message.mode !== "unavailable") return null;
    return {
      type: "tutor",
      ...(typeof message.id === "string" ? { id: message.id } : {}),
      text: message.text,
      mode: message.mode === "general" || message.mode === "unavailable" ? message.mode : "course",
      ...(tutorReplyTo(message.replyTo) ? { replyTo: tutorReplyTo(message.replyTo)! } : {})
    };
  }
  if (message.type === "chat") {
    if (fromServer) return null;
    if (typeof message.text !== "string" || !message.text) return null;
    return { type: "chat", text: message.text };
  }
  if (message.type === "raise-hand") {
    if (fromServer) return null;
    if (message.raised !== undefined && typeof message.raised !== "boolean") return null;
    return { type: "raise-hand", raised: message.raised !== false };
  }
  if (message.type === "hands-query") return fromServer ? null : { type: "hands-query" };
  return null;
}

// The sender of one data packet, as the LiveKit server stamped it (QA3 room
// review F9). The SFU writes the publishing member's identity into every
// packet it forwards, and leaves it empty only for its own RoomService
// SendData (the AI Tutor answer). The SDK's DataReceived event hides that
// stamp: it hands over the matching remote participant, which is also
// missing for a member this browser has not heard of yet (a newcomer's first
// message), and a missing participant used to read as "the server". The room
// therefore reads the packet itself; `fromServer` is an empty stamp, never an
// unknown member. Anything but a user payload is not a room message.
export function roomDataPacket(packet: { participantIdentity?: string; value?: { case?: string; value?: unknown } }): { payload: Uint8Array; senderIdentity: string; fromServer: boolean } | null {
  if (packet.value?.case !== "user") return null;
  const payload = (packet.value.value as { payload?: unknown } | undefined)?.payload;
  if (!(payload instanceof Uint8Array)) return null;
  const senderIdentity = typeof packet.participantIdentity === "string" ? packet.participantIdentity : "";
  return { payload, senderIdentity, fromServer: senderIdentity === "" };
}

// The name a member's chat line shows: the call's own name for them, else
// their Study Group name (a member the call has not announced yet), else the
// page's localised word for an unnamed participant (QA3 room review F9, F10).
export function roomDataSenderName(input: { participantName?: string; identity: string; members: Array<{ userId: string; displayName: string }>; fallback: string }) {
  if (input.participantName) return input.participantName;
  const member = input.identity ? input.members.find((item) => item.userId === input.identity) : undefined;
  return member?.displayName || input.fallback;
}
