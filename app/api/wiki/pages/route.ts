import { NextResponse } from "next/server";
import { rejectIfUnauthenticated } from "@/services/productAuth";
import { getPagesManifest, id, savePagesManifest, saveWikiPage } from "@/lib/ks-data";

export async function GET(request: Request) {
  const denied = await rejectIfUnauthenticated(request);
  if (denied) return denied;
  return NextResponse.json(await getPagesManifest());
}

export async function POST(request: Request) {
  const denied = await rejectIfUnauthenticated(request);
  if (denied) return denied;
  const body = (await request.json()) as { title?: string };
  const title = body.title?.trim() || "Untitled";
  const pageId = title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || id("page");
  const manifest = await getPagesManifest();
  manifest.pages.push({ id: pageId, title });
  await savePagesManifest(manifest);
  await saveWikiPage({ id: pageId, title, status: "Draft", sections: {}, updatedAt: new Date().toISOString() });
  return NextResponse.json({ id: pageId, title });
}
