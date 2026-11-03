import { getMessages } from "@/lib/i18n/messages";

export type TutorErrorKey = "unavailable" | "offline" | "signIn" | "noAccess" | "notFound" | "tooLong" | "busy" | "rateLimited" | "generic";

/**
 * REQ-0140: what the learner reads when an AI Tutor request fails. The API
 * answers with `{ ok:false, code, error }` JSON (or plain text from the KS
 * proxy); that body is for logs, never for the learner, so the chat only ever
 * shows one of these fixed, localised lines. `status` is null when no HTTP
 * answer arrived (network error, or the stream broke after it started).
 */
export function tutorErrorKey(status: number | null, body: string): TutorErrorKey {
  let code = "";
  try {
    const parsed = JSON.parse(body) as { code?: unknown };
    if (parsed && typeof parsed.code === "string") code = parsed.code;
  } catch {
    // Not JSON: decide by status alone.
  }
  if (code === "AI_TUTOR_OFFLINE") return "offline";
  if (code === "AI_TUTOR_UNAVAILABLE" || code === "KS_TUTOR_NOT_CONFIGURED") return "unavailable";
  switch (status) {
    case 400: return "tooLong";
    case 401: return "signIn";
    case 403: return "noAccess";
    case 404: return "notFound";
    case 409: return "busy";
    case 429: return "rateLimited";
    case 503: return "unavailable";
    default: return "generic";
  }
}

export function tutorErrorMessage(locale: "en-GB" | "zh-CN", status: number | null, body: string): string {
  return getMessages(locale).learning.tutorErrors[tutorErrorKey(status, body)];
}

/** Thrown inside TutorChat for a non-OK answer, so the catch knows the status and body. */
export class TutorRequestError extends Error {
  constructor(readonly status: number | null, readonly body: string) {
    super("AI Tutor request failed.");
    this.name = "TutorRequestError";
  }
}
