import { missingOperatorResponse, notificationJson, operatorFrom } from "../http";
import { updateTemplate } from "@/services/notifications/service";

/** Shared PUT handling for both /templates and /templates/:id. */
export async function putTemplateResponse(request: Request, id: string, body: Record<string, unknown>) {
  const operator = operatorFrom(request, body);
  if (!operator) return missingOperatorResponse();
  const result = await updateTemplate({
    id,
    operator,
    ...(typeof body.enabled === "boolean" ? { enabled: body.enabled } : {}),
    ...(body.en && typeof body.en === "object" ? { en: body.en as Record<string, string> } : {}),
    ...(body.zh && typeof body.zh === "object" ? { zh: body.zh as Record<string, string> } : {}),
    ...("expectedUpdatedAt" in body ? { expectedUpdatedAt: typeof body.expectedUpdatedAt === "string" ? body.expectedUpdatedAt : null } : {}),
  });
  if (result.ok) return notificationJson({ ok: true, template: result.template });
  if (result.code === "not_found") return notificationJson({ ok: false, code: result.code, error: result.message }, 404);
  if (result.code === "conflict") return notificationJson({ ok: false, code: result.code, error: result.message, current: result.current }, 409);
  if (result.code === "locked") return notificationJson({ ok: false, code: result.code, error: result.message }, 400);
  return notificationJson({ ok: false, code: result.code, error: result.message, issues: result.issues }, 400);
}
