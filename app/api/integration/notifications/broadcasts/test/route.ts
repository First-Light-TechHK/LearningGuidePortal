import { BroadcastError } from "@/services/notifications/core";
import { requireNotificationsService } from "@/services/notifications/token";
import { sendBroadcastTest } from "@/services/notifications/service";
import { missingOperatorResponse, notificationJson, operatorFrom, readNotificationJson } from "../../http";

export const dynamic = "force-dynamic";

function text(value: unknown) {
  return typeof value === "string" ? value : null;
}

/**
 * POST /api/integration/notifications/broadcasts/test
 * { operator, operatorEmail, titleEn, bodyEn, titleZh?, bodyZh?, buttonText?, buttonLink?, language? }
 * Sends the content on screen, saved or not, to the operator's learner account (NTF-BC-014).
 */
export async function POST(request: Request) {
  const denied = requireNotificationsService(request);
  if (denied) return denied;
  const parsed = await readNotificationJson(request);
  if (!parsed.ok) return parsed.response;
  const body = parsed.body;
  const operator = operatorFrom(request, body);
  if (!operator) return missingOperatorResponse();
  const operatorEmail = text(body.operatorEmail)?.trim() || "";
  if (!operatorEmail.includes("@")) return notificationJson({ ok: false, code: "invalid_request", error: "operatorEmail must be an email address." }, 400);
  try {
    const result = await sendBroadcastTest({
      titleEn: text(body.titleEn) ?? "",
      bodyEn: text(body.bodyEn) ?? "",
      titleZh: text(body.titleZh),
      bodyZh: text(body.bodyZh),
      buttonText: text(body.buttonText),
      buttonLink: text(body.buttonLink),
      operatorEmail,
      operator,
      language: body.language === "zh" ? "zh" : body.language === "en" ? "en" : undefined,
    });
    if (!result.ok) return notificationJson({ ok: false, code: result.code, error: "No learner account uses that email address." }, 404);
    return notificationJson(result);
  } catch (error) {
    if (error instanceof BroadcastError) return notificationJson({ ok: false, code: error.code, error: error.message }, 400);
    throw error;
  }
}
