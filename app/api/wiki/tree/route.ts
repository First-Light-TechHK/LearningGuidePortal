import { NextRequest } from "next/server";
import fs from "node:fs/promises";
import path from "node:path";
import { WIKI_STORE_ROOT } from "../../../lib/wiki-store";

export const runtime = "nodejs";

const TREE_FILE = path.join(WIKI_STORE_ROOT, "course-tree.json");

const DEFAULT_TREE = [
  {
    id: "course-epicureanism",
    title: "Epicureanism",
    type: "course",
    children: [
      { id: "knowledge-overview", title: "Overview", type: "knowledge" },
      { id: "knowledge-pleasure", title: "Pleasure", type: "knowledge" },
      { id: "knowledge-desire", title: "Desire", type: "knowledge" }
    ]
  }
];

export async function GET() {
  try {
    const text = await fs.readFile(TREE_FILE, "utf8");
    return Response.json({ tree: JSON.parse(text) });
  } catch {
    return Response.json({ tree: DEFAULT_TREE });
  }
}

export async function POST(request: NextRequest) {
  const body = await request.json();
  await fs.mkdir(WIKI_STORE_ROOT, { recursive: true });
  await fs.writeFile(TREE_FILE, JSON.stringify(body.tree || DEFAULT_TREE, null, 2), "utf8");
  return Response.json({ status: "saved", file: TREE_FILE });
}
