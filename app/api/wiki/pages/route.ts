import { NextResponse } from "next/server";
import { getPagesManifest, id, savePagesManifest, saveWikiPage } from "@/lib/ks-data";

export async function GET() {
  return NextResponse.json(await getPagesManifest());
}

export async function POST(request: Request) {
  const body = (await request.json()) as { title?: string };
  const title = body.title?.trim() || "Untitled";
  const pageId = title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || id("page");
  const manifest = await getPagesManifest();
  manifest.pages.push({ id: pageId, title });
  await savePagesManifest(manifest);
  await saveWikiPage({ id: pageId, title, status: "Draft", sections: {}, updatedAt: new Date().toISOString() });
  return NextResponse.json({ id: pageId, title });
}
