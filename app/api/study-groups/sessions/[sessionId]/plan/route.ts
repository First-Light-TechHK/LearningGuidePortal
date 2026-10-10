import { signedInUser, studyGroupData, studyGroupFailure, unauthenticated } from "@/modules/group-study/http";
import { studyGroupService } from "@/modules/group-study/runtime";

export async function POST(request: Request, context: { params: Promise<{ sessionId: string }> }) {
  const user = await signedInUser(request);
  if (!user) return unauthenticated();
  const { sessionId } = await context.params;
  try {
    await studyGroupService().planToAttend({ actorUserId: user.id, sessionId });
    return studyGroupData({ planned: true });
  } catch (error) {
    return studyGroupFailure(error);
  }
}
