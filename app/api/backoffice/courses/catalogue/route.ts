import { getCourseCatalogue, saveCatalogueEntry } from "@/services/productStore";
import { authoringActor, authoringBody, authoringFailure, authoringSuccess } from "@/services/courseAuthoringHttp";
import type { CatalogueInput } from "@/contracts/course-authoring";

export async function GET(request: Request) {
  try {
    const user = await authoringActor(request);
    return authoringSuccess({ entries: await getCourseCatalogue(user.id) });
  } catch (error) { return authoringFailure(error); }
}

export async function POST(request: Request) {
  try {
    const user = await authoringActor(request, true);
    return authoringSuccess({ entry: await saveCatalogueEntry(user.id, null, await authoringBody<CatalogueInput>(request)) }, 201);
  } catch (error) { return authoringFailure(error); }
}
