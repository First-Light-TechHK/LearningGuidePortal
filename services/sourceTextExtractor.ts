import path from "path";
import mammoth from "mammoth";
import pdfParse from "pdf-parse";
import { ensureInside, readBinary } from "./fileStore";
import { knowledgeDir } from "./knowledgeStore";

export async function extractSourceFileText(courseId: string, knowledgeId: string, relativePath: string, originalName: string) {
  const root = knowledgeDir(courseId, knowledgeId);
  const full = ensureInside(root, path.join(root, relativePath));
  const ext = path.extname(originalName).toLowerCase();
  const buffer = await readBinary(full);
  if (ext === ".txt" || ext === ".md") return buffer.toString("utf8");
  if (ext === ".docx" || ext === ".doc") {
    try {
      const result = await mammoth.extractRawText({ buffer });
      return result.value;
    } catch {
      return buffer.toString("utf8").replace(/[^\x20-\x7E\n]+/g, " ");
    }
  }
  if (ext === ".pdf") {
    try {
      const result = await pdfParse(buffer);
      return result.text;
    } catch {
      return buffer.toString("latin1").replace(/[^\x20-\x7E\n]+/g, " ");
    }
  }
  return "";
}
