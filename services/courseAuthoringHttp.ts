import { NextResponse } from "next/server";
import { currentProductUserFromRequest } from "./productAuth";
import { canAuthorCourses } from "./backofficeAccess";
import { AuthoringError } from "./courseAuthoring";

export const AUTHORING_BODY_MAX_BYTES = 2_000_000;
const privateHeaders = { "Cache-Control": "private, no-store", Vary: "Cookie" };
class OversizedAuthoringBody extends AuthoringError {
  constructor() { super("invalid"); }
}

export async function authoringActor(request: Request, mutation = false) {
  const user = await currentProductUserFromRequest(request);
  if (!user || !canAuthorCourses(user)) throw new AuthoringError("restricted");
  if (mutation) {
    try {
      const origin = request.headers.get("origin"), parsed = new URL(origin || "");
      if (!["http:", "https:"].includes(parsed.protocol) || parsed.origin !== origin || parsed.host !== (request.headers.get("host") || new URL(request.url).host)) throw new Error();
    } catch { throw new AuthoringError("restricted"); }
  }
  return user;
}

export async function authoringBody<T>(request: Request): Promise<T> {
  const length = request.headers.get("content-length");
  if (length && /^\d+$/.test(length) && Number(length) > AUTHORING_BODY_MAX_BYTES) throw new OversizedAuthoringBody();
  if (!request.body) throw new AuthoringError("invalid");
  const reader = request.body.getReader(), chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > AUTHORING_BODY_MAX_BYTES) {
        await reader.cancel().catch(() => undefined);
        throw new OversizedAuthoringBody();
      }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const buffer = new Uint8Array(bytes);
  let offset = 0;
  for (const chunk of chunks) { buffer.set(chunk, offset); offset += chunk.byteLength; }
  const raw = new TextDecoder("utf-8", { fatal: true }).decode(buffer);
  const value = JSON.parse(raw);
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new AuthoringError("invalid");
  return value as T;
}

export function authoringFailure(error: unknown) {
  const code = error instanceof AuthoringError ? error.code : error instanceof SyntaxError || error instanceof TypeError ? "invalid" : "failed";
  const status = error instanceof OversizedAuthoringBody ? 413 : code === "restricted" ? 403 : code === "notFound" ? 404 : code === "conflict" || code === "inUse" ? 409 : code === "failed" ? 500 : 400;
  return NextResponse.json({ ok: false, code, requestId: crypto.randomUUID() }, { status, headers: privateHeaders });
}

export function authoringSuccess(data: Record<string, unknown>, status = 200) {
  return NextResponse.json({ ok: true, ...data, requestId: crypto.randomUUID() }, { status, headers: privateHeaders });
}
