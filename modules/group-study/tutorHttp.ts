import { randomUUID } from "node:crypto";
import { signedInUser, studyGroupData, studyGroupFailure, unauthenticated } from "./http";
import { studyGroupService } from "./runtime";

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
    await studyGroupService().deliverTutorAnswer({ sessionId }).catch(() => undefined);
    return studyGroupData(queued);
  } catch (error) {
    return studyGroupFailure(error);
  }
}
