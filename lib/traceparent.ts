// W3C Trace Context Level 1 (§3.2) traceparent for Portal -> Admin calls.
// A valid incoming header is continued (same trace id and flags, a new
// span id of ours); a missing or invalid one starts a new trace (§4.3).
// We always send version 00. Only random ids, never anything about the learner.
import { randomBytes } from "node:crypto";

export type TraceParent = { traceId: string; parentId: string; flags: string };

const isHex = (value: string | undefined, length: number) => value !== undefined && value.length === length && /^[0-9a-f]+$/.test(value);
const allZero = (value: string) => /^0+$/.test(value);

export function parseTraceparent(raw: unknown): TraceParent | null {
  if (typeof raw !== "string") return null;
  const value = raw.trim();
  if (value.length < 55) return null;
  const [version, traceId, parentId, flags] = value.slice(0, 55).split("-");
  if (!isHex(version, 2) || version === "ff") return null;
  if (version === "00" ? value.length !== 55 : value.length > 55 && value[55] !== "-") return null;
  if (!isHex(traceId, 32) || allZero(traceId)) return null;
  if (!isHex(parentId, 16) || allZero(parentId)) return null;
  if (!isHex(flags, 2)) return null;
  return { traceId, parentId, flags };
}

function randomHex(bytes: number): string {
  for (;;) {
    const value = randomBytes(bytes).toString("hex");
    if (!allZero(value)) return value;
  }
}

/** The traceparent for one outgoing call: a child of the incoming one, or a new trace. */
export function outgoingTraceparent(incoming?: string | null): string {
  const parent = parseTraceparent(incoming);
  return `00-${parent?.traceId ?? randomHex(16)}-${randomHex(8)}-${parent?.flags ?? "00"}`;
}
