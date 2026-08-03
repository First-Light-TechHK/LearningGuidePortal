import fs from "node:fs/promises";
import path from "node:path";

export type WikiSection = {
  title: string;
  body?: string;
  bullets?: string[];
};

export type WikiDraft = {
  topic: string;
  title: string;
  status?: string;
  summary?: string;
  sections: WikiSection[];
  sourceReferences?: string[];
  learningObjectives?: string[];
  misunderstandingMaps?: unknown[];
  teachingSequences?: string[];
  socraticPromptPatterns?: string[];
  editorialStandards?: string[];
  answerRubric?: string[];
  materialDigest?: string;
};

const ROOT = process.cwd();
export const WIKI_STORE_ROOT = path.join(ROOT, ".wiki-store");

export function slugify(value: string) {
  return (value || "untitled")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "untitled";
}

export function topicDir(topic: string) {
  return path.join(WIKI_STORE_ROOT, "topics", slugify(topic));
}

export async function ensureTopicDirs(topic: string) {
  const root = topicDir(topic);
  await fs.mkdir(path.join(root, "source-materials", "video"), { recursive: true });
  await fs.mkdir(path.join(root, "source-materials", "file"), { recursive: true });
  await fs.mkdir(path.join(root, "source-materials", "qa"), { recursive: true });
  await fs.mkdir(path.join(root, "drafts"), { recursive: true });
  await fs.mkdir(path.join(root, "published"), { recursive: true });
  return root;
}

export function draftToMarkdown(draft: WikiDraft) {
  const lines = [
    `# ${draft.title || draft.topic}`,
    "",
    `Topic: ${draft.topic}`,
    `Status: ${draft.status || "Published"}`,
    ""
  ];

  if (draft.summary) {
    lines.push("## Summary", "", draft.summary, "");
  }

  for (const [index, section] of (draft.sections || []).entries()) {
    lines.push(`## ${index + 1}. ${section.title}`, "");
    if (section.body) lines.push(section.body, "");
    for (const bullet of section.bullets || []) {
      lines.push(`- ${bullet}`);
    }
    if (section.bullets?.length) lines.push("");
  }

  if (draft.sourceReferences?.length) {
    lines.push("## Source References", "");
    for (const item of draft.sourceReferences) lines.push(`- ${item}`);
    lines.push("");
  }

  return lines.join("\n").trim() + "\n";
}

export async function saveDraft(topic: string, draft: WikiDraft) {
  const root = await ensureTopicDirs(topic);
  const file = path.join(root, "drafts", `${slugify(draft.title || topic)}.json`);
  await fs.writeFile(file, JSON.stringify(draft, null, 2), "utf8");
  return file;
}

export async function publishDraft(topic: string, draft: WikiDraft) {
  const root = await ensureTopicDirs(topic);
  const markdown = draftToMarkdown({ ...draft, topic, status: "Published" });
  const fileName = `${slugify(draft.title || topic)}.md`;
  const file = path.join(root, "published", fileName);
  await fs.writeFile(file, markdown, "utf8");
  await fs.writeFile(
    path.join(root, "manifest.json"),
    JSON.stringify(
      {
        topic,
        topicSlug: slugify(topic),
        publishedAt: new Date().toISOString(),
        title: draft.title || topic,
        file: path.relative(root, file)
      },
      null,
      2
    ),
    "utf8"
  );
  return { file, markdown };
}

export async function readPublishedWiki(topic: string) {
  const root = topicDir(topic);
  const published = path.join(root, "published");
  try {
    const files = (await fs.readdir(published)).filter((file) => file.endsWith(".md")).sort();
    const parts = await Promise.all(
      files.map(async (file) => {
        const content = await fs.readFile(path.join(published, file), "utf8");
        return `<!-- ${file} -->\n${content}`;
      })
    );
    return {
      topic,
      files,
      markdown: parts.join("\n\n")
    };
  } catch {
    return { topic, files: [], markdown: "" };
  }
}
