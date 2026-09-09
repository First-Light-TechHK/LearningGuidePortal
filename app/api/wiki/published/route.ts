import { NextRequest } from "next/server";
import { rejectIfUnauthenticated } from "@/services/productAuth";
import { readPublishedWiki } from "../../../lib/wiki-store";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const denied = await rejectIfUnauthenticated(request);
  if (denied) return denied;
  const topic = request.nextUrl.searchParams.get("topic") || "Epicureanism";
  return Response.json(await readPublishedWiki(topic));
}
