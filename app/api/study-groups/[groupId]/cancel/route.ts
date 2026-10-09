import { signedInUser, studyGroupData, studyGroupFailure, unauthenticated } from "@/modules/group-study/http";
import { studyGroupService } from "@/modules/group-study/runtime";

export async function POST(request: Request, context: { params: Promise<{ groupId: string }> }) {
  const user = await signedInUser(request);
  if (!user) return unauthenticated();
  const { groupId } = await context.params;
  try {
    await studyGroupService().cancelGroup({ actorUserId: user.id, groupId });
    return studyGroupData({ cancelled: true });
  } catch (error) {
    return studyGroupFailure(error);
  }
}
