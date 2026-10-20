import { randomUUID } from "node:crypto";
import { signedInUser, studyGroupData, studyGroupFailure, unauthenticated } from "./http";
import { studyGroupService } from "./runtime";

const backgroundDeliveries = new Set<Promise<unknown>>();

/** Resolves once every answer delivery started by a POST has finished (tests and shutdown). */
export async function tutorDeliveriesSettled() {
  while (backgroundDeliveries.size) await Promise.all([...backgroundDeliveries]);
}

export async function acceptTutorPost(request: Request, sessionId: string) {
  const user = await signedInUser(request);
  if (!user) return unauthenticated();
  try {
    const body = await request.json() as { message?: string; text?: string; clientEventId?: string };
    const queued = await studyGroupService().enqueueTutor({
      actorUserId: user.id,
      sessionId,
      text: body.text || body.message || "",
      clientEventId: body.clientEventId || randomUUID()
    });
    // Answering runs after the response (QA 2026-10-19 M21): the asker gets
    // the queued question back at once and shows "answering" until the answer
    // arrives in the room. The durable claim/outbox flow owns delivery, and
    // the recovery timer picks up anything a crash leaves behind.
    // A failed background delivery leaves one redacted line (no session,
    // user, question or error detail); the recovery timer retries the work.
    const delivery = studyGroupService().deliverTutorAnswer({ sessionId })
      .catch(() => { console.info(JSON.stringify({ type: "study_group.tutor_delivery_failed" })); })
      .finally(() => backgroundDeliveries.delete(delivery));
    backgroundDeliveries.add(delivery);
    return studyGroupData(queued);
  } catch (error) {
    return studyGroupFailure(error);
  }
}
