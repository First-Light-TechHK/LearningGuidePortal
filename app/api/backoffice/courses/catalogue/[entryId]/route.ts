import { saveCatalogueEntry } from "@/services/productStore";
import { authoringActor, authoringBody, authoringFailure, authoringSuccess } from "@/services/courseAuthoringHttp";
import type { CatalogueInput } from "@/contracts/course-authoring";

export async function PATCH(request: Request, { params }: { params: Promise<{ entryId: string }> }) {
  try {
    const user = await authoringActor(request, true);
    const input = await authoringBody<CatalogueInput>(request);
    return authoringSuccess({ entry: await saveCatalogueEntry(user.id, (await params).entryId, input) });
  } catch (error) { return authoringFailure(error); }
}
