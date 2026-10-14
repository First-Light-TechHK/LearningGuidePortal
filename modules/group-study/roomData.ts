// Pure helpers for the Live Session room's data channel, kept out of the
// component so the message contract is unit-testable (bug hunt 2026-10-14).

export type RoomTutorMessage = { type: "tutor"; id?: string; text: string; mode: "course" | "general" | "unavailable" };
export type RoomChatMessage = { type: "chat"; text: string };
export type RoomRaiseHandMessage = { type: "raise-hand"; raised: boolean };
export type RoomDataMessage = RoomTutorMessage | RoomChatMessage | RoomRaiseHandMessage;

// Parses one data-channel payload into a renderable message, or null when it
// must be dropped. The parser is where the room's trust boundary lives
// (hunt M2): the publisher is passed in as `fromServer` because LiveKit
// distinguishes them at the protocol level — a member publish always carries
// its participant, while the server's own RoomService.SendData (the AI Tutor
// answer republished from the outbox) arrives with no participant at all.
// Only the server may render as the AI Tutor; only members may chat or raise
// hands. Malformed payloads are dropped instead of throwing: one bad message
// must not interrupt the event handler for every later room event.
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
      mode: message.mode === "general" || message.mode === "unavailable" ? message.mode : "course"
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
  return null;
}
