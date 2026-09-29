import { NextResponse } from "next/server";
import { currentOperatorRequest } from "./productAuth";
import { requestOriginMatches } from "./adminHost";

export function portalCmsResponse(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "private, no-store", Vary: "Cookie" } });
}

export async function portalCmsAccess(request: Request, mutation = false) {
  if (!await currentOperatorRequest(request) || (mutation && !requestOriginMatches(request))) {
    return portalCmsResponse({ error: "Operator access required." }, 403);
  }
  return null;
}

export class PortalCmsBodyTooLarge extends Error {
  constructor() { super("Request body is too large."); }
}

// Bound actual streamed bytes before JSON or multipart parsing, including chunked uploads.
export async function readPortalCmsBody(request: Request, limit: number): Promise<Uint8Array> {
  const length = request.headers.get("content-length");
  if (length && /^\d+$/.test(length) && Number(length) > limit) throw new PortalCmsBodyTooLarge();
  if (!request.body) throw new Error("Request body is required.");
  const reader = request.body.getReader(), chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) {
        await reader.cancel().catch(() => undefined);
        throw new PortalCmsBodyTooLarge();
      }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return bytes;
}

export async function portalCmsBody<T>(request: Request): Promise<T> {
  const bytes = await readPortalCmsBody(request, 2_000_000);
  const body = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error("A JSON object is required.");
  return body as T;
}

export function portalCmsFailure(error: unknown, fallback: string) {
  const message = error instanceof Error ? error.message : fallback;
  return portalCmsResponse({ error: message }, error instanceof PortalCmsBodyTooLarge ? 413 : message.includes("not configured") ? 503 : 400);
}
