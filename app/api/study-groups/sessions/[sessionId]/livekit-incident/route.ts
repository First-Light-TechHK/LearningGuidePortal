import { StudyGroupError } from "@/modules/group-study/domain";
import { isClientReportableLiveKitIncidentCode } from "@/modules/group-study/liveKitIncident";
import { signedInUser, studyGroupData, studyGroupFailure, unauthenticated } from "@/modules/group-study/http";
import { studyGroupService } from "@/modules/group-study/runtime";

export async function POST(request: Request, context: { params: Promise<{ sessionId: string }> }) {
  const user = await signedInUser(request);
  if (!user) return unauthenticated();
  const { sessionId } = await context.params;
  try {
    const body = await request.json() as unknown;
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new StudyGroupError("validation", "Incident request body is invalid.");
    const code = (body as { code?: unknown }).code;
    if (!isClientReportableLiveKitIncidentCode(code)) throw new StudyGroupError("validation", "LiveKit incident code is invalid.");
    await studyGroupService().reportLiveKitIncident({ actorUserId: user.id, sessionId, code });
    return studyGroupData({ accepted: true }, 202);
  } catch (error) {
    return studyGroupFailure(error);
  }
}
