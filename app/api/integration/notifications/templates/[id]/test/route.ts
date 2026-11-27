import type { NotificationCopy, NotificationLanguage } from "@/services/notifications/types";
import { requireNotificationsService } from "@/services/notifications/token";
import { sendTemplateTest } from "@/services/notifications/service";
import { missingOperatorResponse, notificationJson, operatorFrom, readNotificationJson } from "../../../http";

export const dynamic = "force-dynamic";

const COPY_FIELDS: Array<keyof NotificationCopy> = ["title", "message", "buttonText", "subject", "emailBody", "emailButtonText"];

function pickCopy(value: unknown): NotificationCopy | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const copy: NotificationCopy = {};
  for (const field of COPY_FIELDS) {
    const fieldValue = (value as Record<string, unknown>)[field];
    if (typeof fieldValue === "string") copy[field] = fieldValue;
  }
  return copy;
}

/**
 * POST /api/integration/notifications/templates/:id/test
 * { channel, language, operatorEmail, operator, copy?, params? }
 * Sends the open channel/language content, saved or not (NTF-BO-019).
 */
export async function POST(request: Request, context: { params: Promise<Record<string, string>> }) {
  const denied = requireNotificationsService(request);
  if (denied) return denied;
  const parsed = await readNotificationJson(request);
  if (!parsed.ok) return parsed.response;
  const body = parsed.body;
  const id = (await context.params).id || "";
  const operator = operatorFrom(request, body);
  if (!operator) return missingOperatorResponse();

  const channel = body.channel === "email" ? "email" : body.channel === "in_app" ? "in_app" : null;
  if (!channel) return notificationJson({ ok: false, code: "invalid_request", error: "channel must be in_app or email." }, 400);
  const language: NotificationLanguage | null = body.language === "zh" ? "zh" : body.language === "en" ? "en" : null;
  if (!language) return notificationJson({ ok: false, code: "invalid_request", error: "language must be en or zh." }, 400);
  const operatorEmail = typeof body.operatorEmail === "string" ? body.operatorEmail.trim()
    : typeof body.email === "string" ? body.email.trim() : "";
  if (!operatorEmail.includes("@")) return notificationJson({ ok: false, code: "invalid_request", error: "operatorEmail must be an email address." }, 400);
  if (body.params !== undefined && (body.params === null || typeof body.params !== "object" || Array.isArray(body.params))) {
    return notificationJson({ ok: false, code: "invalid_request", error: "params must be an object." }, 400);
  }

  const nestedCopy = body.copy && typeof body.copy === "object" && !Array.isArray(body.copy) ? body.copy as Record<string, unknown> : undefined;
  const en = pickCopy(nestedCopy?.en ?? body.en);
  const zh = pickCopy(nestedCopy?.zh ?? body.zh);
  const result = await sendTemplateTest({
    templateId: id,
    channel,
    language,
    operatorEmail,
    operator,
    ...(en || zh ? { copy: { ...(en ? { en } : {}), ...(zh ? { zh } : {}) } } : {}),
    params: (body.params as Record<string, unknown> | null | undefined) ?? null,
  });

  if (result.ok) return notificationJson(result);
  const status = result.code === "not_found" || result.code === "no_learner" ? 404
    : result.code === "email_not_configured" ? 503
      : result.code === "email_failed" ? 502
        : 400;
  return notificationJson({ ok: false, code: result.code, error: result.message, ...(result.logId ? { logId: result.logId } : {}) }, status);
}
