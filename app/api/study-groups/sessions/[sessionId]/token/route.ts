import { StudyGroupError } from "@/modules/group-study/domain";
import { signedInUser, studyGroupData, studyGroupFailure, unauthenticated } from "@/modules/group-study/http";
import { studyGroupService } from "@/modules/group-study/runtime";

export async function POST(request: Request, context: { params: Promise<{ sessionId: string }> }) {
  const user = await signedInUser(request);
  if (!user) return unauthenticated();
  const { sessionId } = await context.params;
  try {
    const body = await request.json() as unknown;
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new StudyGroupError("validation", "Token request body is invalid.");
    const { recovery } = body as { recovery?: unknown };
    if (recovery !== undefined && recovery !== true) throw new StudyGroupError("validation", "Recovery flag is invalid.");
    return studyGroupData(await studyGroupService().issueToken({ actorUserId: user.id, sessionId, recovery: recovery === true }));
  } catch (error) {
    return studyGroupFailure(error);
  }
}
