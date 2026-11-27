import { BroadcastError, type BroadcastUpdateInput } from "@/services/notifications/core";
import { broadcastDetail, deleteBroadcast, sendBroadcast, updateBroadcast, withdrawBroadcast } from "@/services/notifications/service";
import { missingOperatorResponse, notificationJson, operatorFrom } from "../http";

function patchFrom(body: Record<string, unknown>): BroadcastUpdateInput {
  const patch: BroadcastUpdateInput = {};
  if (typeof body.titleEn === "string") patch.titleEn = body.titleEn;
  if (typeof body.bodyEn === "string") patch.bodyEn = body.bodyEn;
  for (const field of ["titleZh", "bodyZh", "buttonText", "buttonLink"] as const) {
    if (!(field in body)) continue;
    const value = body[field];
    if (typeof value === "string" || value === null) patch[field] = value;
  }
  if (typeof body.audience === "string") patch.audience = body.audience as BroadcastUpdateInput["audience"];
  return patch;
}

function broadcastErrorResponse(error: BroadcastError) {
  const status = error.code === "not_found" ? 404 : error.code === "invalid" ? 400 : 409;
  return notificationJson({ ok: false, code: error.code, error: error.message }, status);
}

/**
 * PATCH /api/integration/notifications/broadcasts[/:id]
 * { id, operator, action: "update" | "send" | "withdraw", ...fields }
 * Status flow Draft → Sent → Withdrawn; withdrawal is irreversible.
 */
export async function patchBroadcastResponse(request: Request, id: string, body: Record<string, unknown>) {
  const operator = operatorFrom(request, body);
  if (!operator) return missingOperatorResponse();
  const rawAction = typeof body.action === "string" ? body.action : "";
  // Accept the status-style naming too, so an Admin build can PATCH {status}.
  const action = rawAction === "send_now" ? "send"
    : rawAction || (body.status === "sent" ? "send" : body.status === "withdrawn" ? "withdraw" : body.status === "draft" ? "update" : "");
  try {
    if (action === "update") {
      const broadcast = await updateBroadcast(id, patchFrom(body), operator);
      return notificationJson({ ok: true, broadcast });
    }
    if (action === "send") {
      const sent = await sendBroadcast(id, operator);
      const detail = await broadcastDetail(id);
      return notificationJson({ ok: true, broadcast: detail?.broadcast ?? null, recipients: sent.recipients });
    }
    if (action === "withdraw") {
      const withdrawn = await withdrawBroadcast(id, operator);
      const detail = await broadcastDetail(id);
      return notificationJson({ ok: true, broadcast: detail?.broadcast ?? null, withdrawn: withdrawn.withdrawn });
    }
    if (action === "delete") {
      const deleted = await deleteBroadcast(id, operator);
      return notificationJson({ ok: true, ...deleted });
    }
    return notificationJson({ ok: false, code: "invalid_request", error: "action must be update, send, withdraw or delete." }, 400);
  } catch (error) {
    if (error instanceof BroadcastError) return broadcastErrorResponse(error);
    throw error;
  }
}
