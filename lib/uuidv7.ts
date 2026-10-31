import { randomBytes } from "node:crypto";

// UUID version 7 (RFC 9562 §5.7): 48-bit Unix millisecond timestamp, version
// nibble 7, 12-bit rand_a used as a monotonic counter within one millisecond
// (RFC 9562 §6.2 method 1), RFC variant bits, 62 random bits. Generated ids
// therefore sort in creation order within this process.
let lastMs = -1;
let lastCounter = 0;

function hex(value: number, width: number) {
  return value.toString(16).padStart(width, "0");
}

export function uuidv7(nowMs: number = Date.now()): string {
  let ms = Math.max(0, Math.floor(nowMs));
  let counter: number;
  if (ms <= lastMs) {
    ms = lastMs;
    counter = lastCounter + 1;
    if (counter > 0xfff) { ms += 1; counter = randomBytes(2).readUInt16BE(0) & 0x7ff; }
  } else {
    counter = randomBytes(2).readUInt16BE(0) & 0x7ff;
  }
  lastMs = ms;
  lastCounter = counter;
  const tail = randomBytes(8);
  tail[0] = (tail[0] & 0x3f) | 0x80;
  const time = hex(ms, 12);
  const randB = tail.toString("hex");
  return `${time.slice(0, 8)}-${time.slice(8, 12)}-7${hex(counter, 3)}-${randB.slice(0, 4)}-${randB.slice(4, 16)}`;
}

export function uuidv7Timestamp(id: string): number {
  return parseInt(id.replace(/-/g, "").slice(0, 12), 16);
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID.test(value);
}
