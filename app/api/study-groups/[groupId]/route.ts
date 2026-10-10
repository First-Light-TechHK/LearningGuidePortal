import { signedInUser, studyGroupData, studyGroupFailure, unauthenticated } from "@/modules/group-study/http";
import { studyGroupService } from "@/modules/group-study/runtime";

export async function GET(request: Request, context: { params: Promise<{ groupId: string }> }) {
  const user = await signedInUser(request);
  const { groupId } = await context.params;
  try {
    const service = studyGroupService();
    if (user) await service.dispatchDueReminders();
    return studyGroupData(await service.getGroup({ actorUserId: user?.id || null, groupId }));
  } catch (error) {
    return studyGroupFailure(error);
  }
}

export async function PATCH(request: Request, context: { params: Promise<{ groupId: string }> }) {
  const user = await signedInUser(request);
  if (!user) return unauthenticated();
  const { groupId } = await context.params;
  try {
    const body = await request.json() as { title?: string; about?: string; courseId?: string };
    return studyGroupData(await studyGroupService().editGroup({
      actorUserId: user.id,
      groupId,
      title: body.title || "",
      about: body.about || "",
      courseId: body.courseId
    }));
  } catch (error) {
    return studyGroupFailure(error);
  }
}
