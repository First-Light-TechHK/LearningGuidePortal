import { readJsonObject, signedInUser, studyGroupData, studyGroupFailure, unauthenticated } from "@/modules/group-study/http";
import { parseScheduleSessionBody } from "@/modules/group-study/parsers";
import { studyGroupService } from "@/modules/group-study/runtime";

export async function POST(request: Request, context: { params: Promise<{ groupId: string }> }) {
  const user = await signedInUser(request);
  if (!user) return unauthenticated();
  const { groupId } = await context.params;
  try {
    const body = parseScheduleSessionBody(await readJsonObject(request));
    return studyGroupData(await studyGroupService().scheduleSession({ actorUserId: user.id, groupId, ...body }));
  } catch (error) {
    return studyGroupFailure(error);
  }
}
