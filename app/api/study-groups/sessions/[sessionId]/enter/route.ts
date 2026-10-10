import { signedInUser, studyGroupData, studyGroupFailure, unauthenticated } from "@/modules/group-study/http";
import { studyGroupService } from "@/modules/group-study/runtime";

let receipt = 0;

export function POST(request: Request, context: { params: Promise<{ sessionId: string }> }) {
  const requestedAt = `${new Date().toISOString()}#${String(++receipt).padStart(8, "0")}`;
  return studyGroupService().orderEntry(requestedAt, async () => {
    const user = await signedInUser(request);
    if (!user) return unauthenticated();
    const { sessionId } = await context.params;
    try {
      return studyGroupData(await studyGroupService().grantSeat({
        actorUserId: user.id,
        sessionId,
        requestedAt
      }));
    } catch (error) {
      return studyGroupFailure(error);
    }
  });
}
