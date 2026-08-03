import { NextRequest } from "next/server";
import { readPublishedWiki } from "../../../lib/wiki-store";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const topic = request.nextUrl.searchParams.get("topic") || "Epicureanism";
  return Response.json(await readPublishedWiki(topic));
}
