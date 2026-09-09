import { NextRequest } from "next/server";
import { rejectIfUnauthenticated } from "@/services/productAuth";
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import mammoth from "mammoth";
import { ensureTopicDirs, slugify, topicDir } from "../../../lib/wiki-store";

export const runtime = "nodejs";

const SUPPORTED = [".pdf", ".txt", ".doc", ".docx"];
const execFileAsync = promisify(execFile);
const PDF_PARSE_BIN = path.join(process.cwd(), "node_modules", ".bin", "pdf-parse");

async function extractText(fileName: string, buffer: Buffer, absolutePath?: string) {
  const lower = fileName.toLowerCase();
  if (lower.endsWith(".txt")) return buffer.toString("utf8");
  if (lower.endsWith(".docx") || lower.endsWith(".doc")) {
    const result = await mammoth.extractRawText({ buffer });
    return result.value;
  }
  if (lower.endsWith(".pdf")) {
    if (!absolutePath) return "";
    const { stdout } = await execFileAsync(PDF_PARSE_BIN, ["text", absolutePath], {
      cwd: process.cwd(),
      maxBuffer: 10 * 1024 * 1024
    });
    return stdout;
  }
  return "";
}

async function saveFiles(form: FormData, field: string, topic: string, kind: "file" | "qa") {
  const values = form.getAll(field);
  const saved = [];
  const textBlocks = [];
  const root = topicDir(topic);

  for (const value of values) {
    if (!(value instanceof File)) continue;
    const ext = path.extname(value.name).toLowerCase();
    if (!SUPPORTED.includes(ext)) {
      saved.push({ name: value.name, error: `Unsupported file type: ${ext || "unknown"}` });
      continue;
    }

    const buffer = Buffer.from(await value.arrayBuffer());
    const safeName = `${Date.now()}-${slugify(path.basename(value.name, ext))}${ext}`;
    const relativePath = path.join("source-materials", kind, safeName);
    const absolutePath = path.join(root, relativePath);
    await fs.writeFile(absolutePath, buffer);

    const text = (await extractText(value.name, buffer, absolutePath)).trim();
    saved.push({ name: value.name, storedAs: relativePath, chars: text.length });
    textBlocks.push(`SOURCE ${kind.toUpperCase()}: ${value.name}\n${text}`);
  }

  return { saved, text: textBlocks.join("\n\n") };
}

export async function POST(request: NextRequest) {
  const denied = await rejectIfUnauthenticated(request);
  if (denied) return denied;
  try {
    const form = await request.formData();
    const topic = String(form.get("topic") || "Epicureanism").trim();
    const videoLinks = form.getAll("videoLinks").map(String).map((item) => item.trim()).filter(Boolean);

    if (!topic) {
      return Response.json({ error: "Topic is required." }, { status: 400 });
    }

    await ensureTopicDirs(topic);
    const root = topicDir(topic);

    if (videoLinks.length) {
      await fs.writeFile(
        path.join(root, "source-materials", "video", "links.json"),
        JSON.stringify(videoLinks, null, 2),
        "utf8"
      );
    }

    const fileResult = await saveFiles(form, "files", topic, "file");
    const qaResult = await saveFiles(form, "qaFiles", topic, "qa");
    const videoText = videoLinks.map((link, index) => `VIDEO LINK ${index + 1}: ${link}`).join("\n");
    const materialText = [videoText, fileResult.text, qaResult.text].filter(Boolean).join("\n\n");

    return Response.json({
      topic,
      sources: {
        video: videoLinks.map((link) => ({ link })),
        file: fileResult.saved,
        qa: qaResult.saved
      },
      materialText
    });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Source material save failed." },
      { status: 500 }
    );
  }
}
