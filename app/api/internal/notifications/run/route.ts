import { NextResponse } from "next/server";
import { requireNotificationsService } from "@/services/notifications/token";
import {
  runNotificationJobsOnce,
  runNotificationRetentionJob,
  runRenewalReminderJob,
} from "@/services/notifications/scheduler";
import { dispatchPendingNotificationEmails } from "@/services/notifications/email";

export const dynamic = "force-dynamic";

/**
 * POST /api/internal/notifications/run
 *
 * Operations entry point for the Notification P0 schedulers (design §7). The
 * in-process timer (started from instrumentation.ts) runs them on its own; this route is the manual/observability
 * path (the same service token as the Admin integration API).
 *
 * Body (all optional): { job?: "all" | "renewal-reminder" | "email-dispatch"
 * | "retention", now?: ISO instant, force?: boolean }
 *
 * `now` is for verification in non-production environments and replaying a
 * missed window; `force` bypasses the once-per-HKT-day marker. The renewal
 * reminder stays idempotent per billing period either way.
 */
export async function POST(request: Request) {
  const denied = requireNotificationsService(request);
  if (denied) return denied;

  let body: Record<string, unknown> = {};
  const text = await request.text();
  if (text.trim()) {
    try {
      const parsed: unknown = JSON.parse(text);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) body = parsed as Record<string, unknown>;
      else return NextResponse.json({ ok: false, error: "Send a JSON object." }, { status: 400 });
    } catch {
      return NextResponse.json({ ok: false, error: "Send a JSON body." }, { status: 400 });
    }
  }

  const job = typeof body.job === "string" ? body.job : "all";
  if (!["all", "renewal-reminder", "email-dispatch", "retention"].includes(job)) {
    return NextResponse.json({ ok: false, error: "Unknown job." }, { status: 400 });
  }
  if (body.now !== undefined && (typeof body.now !== "string" || Number.isNaN(Date.parse(body.now)))) {
    return NextResponse.json({ ok: false, error: "now must be an ISO instant." }, { status: 400 });
  }
  if (body.force !== undefined && typeof body.force !== "boolean") {
    return NextResponse.json({ ok: false, error: "force must be a boolean." }, { status: 400 });
  }

  const now = typeof body.now === "string" ? body.now : undefined;
  const force = body.force === true;

  if (job === "renewal-reminder") {
    return NextResponse.json({ ok: true, job, result: await runRenewalReminderJob({ now, force }) }, { headers: { "Cache-Control": "private, no-store" } });
  }
  if (job === "email-dispatch") {
    return NextResponse.json({ ok: true, job, result: await dispatchPendingNotificationEmails({ now }) }, { headers: { "Cache-Control": "private, no-store" } });
  }
  if (job === "retention") {
    return NextResponse.json({ ok: true, job, result: await runNotificationRetentionJob({ now, force }) }, { headers: { "Cache-Control": "private, no-store" } });
  }
  return NextResponse.json({ ok: true, job, result: await runNotificationJobsOnce({ now, force }) }, { headers: { "Cache-Control": "private, no-store" } });
}
