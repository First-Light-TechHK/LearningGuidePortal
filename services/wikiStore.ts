import path from "path";
import crypto from "crypto";
import { atomicWriteJson, ensureDir, now, readJson, readText, writeText } from "./fileStore";
import { getKnowledge, knowledgeDir } from "./knowledgeStore";
import { readGeneratedOutput, readIncrementalOutput } from "./draftStore";
import { IncrementalWikiUpdate, parseIncrementalWikiUpdate } from "@/lib/incrementalWikiParser";

export type WikiEntry = {
  id: string;
  title: string;
  content: string;
  order: number;
  createdAt: string;
  updatedAt: string;
};

export type WikiPageDocument = {
  courseId: string;
  knowledgeId: string;
  title: string;
  status: "Draft" | "Published";
  entries: WikiEntry[];
  updatedAt: string;
};

export type WikiComment = {
  id: string;
  entryId: string;
  text: string;
  author: string;
  createdAt: string;
};

export type WikiCommentsDocument = { comments: WikiComment[] };

export type SourceReference = {
  entryId: string;
  entryTitle: string;
  linkText: string;
  url: string;
};

export type ImportedSourceContent = {
  originalName: string;
  content: string;
};

type ImportedSourceEntryDraft = {
  title: string;
  content: string;
};

function wikiDir(courseId: string, knowledgeId: string) {
  return path.join(knowledgeDir(courseId, knowledgeId), "wiki");
}

function pageJsonPath(courseId: string, knowledgeId: string) {
  return path.join(wikiDir(courseId, knowledgeId), "page.json");
}

function pageMarkdownPath(courseId: string, knowledgeId: string) {
  return path.join(wikiDir(courseId, knowledgeId), "page.md");
}

function commentsPath(courseId: string, knowledgeId: string) {
  return path.join(wikiDir(courseId, knowledgeId), "comments.json");
}

function entryId() {
  return `entry_${crypto.randomBytes(6).toString("hex")}`;
}

function commentId() {
  return `comment_${crypto.randomBytes(8).toString("hex")}`;
}

function stripHeadingPrefix(line: string, level: "#" | "##" | "###") {
  return line.replace(new RegExp(`^${level}\\s+`), "").trim();
}

export function parseDraftOutputToEntries(markdown: string): WikiEntry[] {
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  const entries: WikiEntry[] = [];
  let current: { title: string; contentLines: string[] } | null = null;

  for (const line of lines) {
    if (/^##\s+/.test(line) && !/^###\s+/.test(line)) {
      if (current) {
        entries.push(makeEntry(current.title, current.contentLines.join("\n").trim(), entries.length + 1));
      }
      current = { title: stripHeadingPrefix(line, "##"), contentLines: [] };
      continue;
    }
    if (/^#\s+/.test(line)) continue;
    if (current) current.contentLines.push(line);
  }

  if (current) {
    entries.push(makeEntry(current.title, current.contentLines.join("\n").trim(), entries.length + 1));
  }

  if (!entries.length && markdown.trim()) {
    entries.push(makeEntry("Generated Wiki Entry", markdown.trim(), 1));
  }

  return entries;
}

function sourceBaseName(originalName: string) {
  const parsed = path.parse(originalName || "");
  return (parsed.name || originalName || "Imported Source").trim();
}

function uniqueImportedTitle(title: string, sourceName: string, usedTitles: Set<string>) {
  const baseTitle = (title || "Imported Source").trim();
  if (!usedTitles.has(baseTitle)) {
    usedTitles.add(baseTitle);
    return baseTitle;
  }

  const sourceTitle = sourceBaseName(sourceName);
  const fallback = `${baseTitle} - ${sourceTitle}`;
  if (!usedTitles.has(fallback)) {
    usedTitles.add(fallback);
    return fallback;
  }

  let index = 2;
  while (usedTitles.has(`${fallback} ${index}`)) index += 1;
  const uniqueTitle = `${fallback} ${index}`;
  usedTitles.add(uniqueTitle);
  return uniqueTitle;
}

function stripNumberedTitle(line: string) {
  return line.replace(/^\d{1,3}\.\s+/, "").trim();
}

function cleanImportedTitle(title: string) {
  return title
    .replace(/^\d{1,3}\.\s+/, "")
    .trim();
}

function parseNumberedQaEntries(markdown: string): ImportedSourceEntryDraft[] {
  const lines = markdown.split("\n");
  const entries: ImportedSourceEntryDraft[] = [];
  let current: { title: string; contentLines: string[] } | null = null;

  for (const line of lines) {
    if (/^\d{1,3}\.\s+.+/.test(line)) {
      if (current) {
        entries.push({ title: current.title, content: current.contentLines.join("\n").trim() });
      }
      current = { title: stripNumberedTitle(line), contentLines: [] };
      continue;
    }
    if (current) current.contentLines.push(line);
  }

  if (current) entries.push({ title: current.title, content: current.contentLines.join("\n").trim() });
  return entries.filter((entry) => entry.title && entry.content);
}

function parseHeadingEntries(markdown: string, level: "#" | "##"): ImportedSourceEntryDraft[] {
  const lines = markdown.split("\n");
  const entries: ImportedSourceEntryDraft[] = [];
  let current: { title: string; contentLines: string[] } | null = null;
  const headingPattern = level === "##" ? /^##\s+(.+)/ : /^#\s+(.+)/;
  const deeperHeadingPattern = level === "##" ? /^###\s+/ : /^##\s+/;

  for (const line of lines) {
    if (headingPattern.test(line) && !deeperHeadingPattern.test(line)) {
      if (current) {
        entries.push({ title: current.title, content: current.contentLines.join("\n").trim() });
      }
      current = { title: stripHeadingPrefix(line, level), contentLines: [] };
      continue;
    }
    if (current) current.contentLines.push(line);
  }

  if (current) entries.push({ title: current.title, content: current.contentLines.join("\n").trim() });
  return entries.filter((entry) => entry.title && entry.content);
}

function parseImportedSourceDrafts(source: ImportedSourceContent): ImportedSourceEntryDraft[] {
  const markdown = source.content.replace(/\r\n/g, "\n");
  const numberedEntries = parseNumberedQaEntries(markdown);
  if (numberedEntries.length) return numberedEntries;

  const h2Entries = parseHeadingEntries(markdown, "##");
  if (h2Entries.length) return h2Entries;

  const h1Entries = parseHeadingEntries(markdown, "#");
  if (h1Entries.length) return h1Entries;

  return markdown.trim()
    ? [{ title: sourceBaseName(source.originalName) || "Imported Source", content: markdown.trim() }]
    : [];
}

export function parseImportedSourceToEntries(source: ImportedSourceContent, startOrder: number, usedTitles: Set<string>): WikiEntry[] {
  const entries: WikiEntry[] = [];
  for (const draft of parseImportedSourceDrafts(source)) {
    entries.push(makeEntry(
      uniqueImportedTitle(cleanImportedTitle(draft.title), source.originalName, usedTitles),
      draft.content.trim(),
      startOrder + entries.length
    ));
  }
  return entries;
}

export function importedSourceEntriesToMarkdown(entries: WikiEntry[]) {
  return entries
    .map((entry) => `## ${entry.title}\n\n${entry.content}`.trim())
    .join("\n\n")
    .trim();
}

function makeEntry(title: string, content: string, order: number): WikiEntry {
  const time = now();
  return {
    id: entryId(),
    title: title || "Untitled Wiki Entry",
    content,
    order,
    createdAt: time,
    updatedAt: time
  };
}

export async function getWikiPage(courseId: string, knowledgeId: string): Promise<WikiPageDocument | null> {
  const page = await readJson<WikiPageDocument | null>(pageJsonPath(courseId, knowledgeId), null);
  if (!page) return null;
  return { ...page, entries: [...(page.entries || [])].sort((a, b) => a.order - b.order) };
}

export async function readExistingWikiMarkdown(courseId: string, knowledgeId: string) {
  const page = await getWikiPage(courseId, knowledgeId);
  if (page?.entries?.length) {
    return [`# ${page.title}`, ...page.entries.map((entry) => `## ${entry.title}\n\n${entry.content}`)].join("\n\n").trim();
  }
  try {
    return (await readText(pageMarkdownPath(courseId, knowledgeId))).trim();
  } catch {
    return "";
  }
}

export async function hasExistingWikiContent(courseId: string, knowledgeId: string) {
  return Boolean((await readExistingWikiMarkdown(courseId, knowledgeId)).trim());
}

async function writeWikiPage(page: WikiPageDocument) {
  page.entries = page.entries.map((entry, index) => ({ ...entry, order: index + 1 }));
  page.updatedAt = now();
  await ensureDir(wikiDir(page.courseId, page.knowledgeId));
  await atomicWriteJson(pageJsonPath(page.courseId, page.knowledgeId), page);
  await syncWikiMarkdown(page.courseId, page.knowledgeId, page);
}

export async function createWikiFromDraftOutput(courseId: string, knowledgeId: string) {
  const draft = await readGeneratedOutput(courseId, knowledgeId);
  if (!draft.trim()) throw new Error("Please generate a draft first.");
  const knowledge = await getKnowledge(courseId, knowledgeId);
  const time = now();
  const page: WikiPageDocument = {
    courseId,
    knowledgeId,
    title: knowledge?.title || knowledgeId,
    status: "Draft",
    entries: parseDraftOutputToEntries(draft),
    updatedAt: time
  };
  await writeWikiPage(page);
  return page;
}

export async function createWikiFromImportedSources(courseId: string, knowledgeId: string, sources: ImportedSourceContent[]) {
  const readableSources = sources
    .map((source) => ({ ...source, content: source.content.trim() }))
    .filter((source) => source.content);
  if (!readableSources.length) throw new Error("No readable source text was extracted from the selected files.");

  const usedTitles = new Set<string>();
  const entries: WikiEntry[] = [];
  for (const source of readableSources) {
    entries.push(...parseImportedSourceToEntries(source, entries.length + 1, usedTitles));
  }
  if (!entries.length) throw new Error("No wiki entries could be imported from the selected files.");

  const knowledge = await getKnowledge(courseId, knowledgeId);
  const time = now();
  const page: WikiPageDocument = {
    courseId,
    knowledgeId,
    title: knowledge?.title || knowledgeId,
    status: "Draft",
    entries,
    updatedAt: time
  };
  await writeWikiPage(page);
  return { page, importedEntryCount: entries.length, importedSourceCount: readableSources.length };
}

export function buildImportSourceOutputMarkdown(sources: ImportedSourceContent[]) {
  const usedTitles = new Set<string>();
  const entries: WikiEntry[] = [];
  for (const source of sources) {
    entries.push(...parseImportedSourceToEntries(source, entries.length + 1, usedTitles));
  }
  return { entries, markdown: importedSourceEntriesToMarkdown(entries) };
}

export async function createWikiFromImportSourceOutput(courseId: string, knowledgeId: string, markdown: string) {
  if (!markdown.trim()) throw new Error("Import Source Output is empty.");
  const entries = parseDraftOutputToEntries(markdown);
  if (!entries.length) throw new Error("No wiki entries were found in Import Source Output.");
  const knowledge = await getKnowledge(courseId, knowledgeId);
  const time = now();
  const page: WikiPageDocument = {
    courseId,
    knowledgeId,
    title: knowledge?.title || knowledgeId,
    status: "Draft",
    entries,
    updatedAt: time
  };
  await writeWikiPage(page);
  return { page, importedEntryCount: entries.length, entryTitles: entries.map((entry) => entry.title) };
}

function incrementalAppend(existingContent: string, nextContent: string) {
  const update = nextContent.trim() || "No additional content supplied.";
  return `${existingContent.trim()}\n\n## Incremental Update\n\n${update}`.trim();
}

export async function applyIncrementalWikiUpdate(courseId: string, knowledgeId: string, incrementalMarkdown?: string) {
  const incrementalDraft = incrementalMarkdown ?? await readIncrementalOutput(courseId, knowledgeId);
  if (!incrementalDraft.trim()) throw new Error("Please generate or save an incremental draft first.");

  const parsed = parseIncrementalWikiUpdate(incrementalDraft);
  if (!parsed.suggestedUpdates.length && !parsed.newEntries.length) {
    throw new Error("No applicable incremental wiki entries were found.");
  }

  const knowledge = await getKnowledge(courseId, knowledgeId);
  const existingPage = await getWikiPage(courseId, knowledgeId);
  const time = now();
  const page: WikiPageDocument = existingPage || {
    courseId,
    knowledgeId,
    title: knowledge?.title || knowledgeId,
    status: "Draft",
    entries: [],
    updatedAt: time
  };

  let updatedCount = 0;
  let addedCount = 0;
  const findEntryIndex = (title: string) => page.entries.findIndex((entry) => entry.title === title);

  for (const update of parsed.suggestedUpdates) {
    const index = findEntryIndex(update.existingTitle);
    if (index >= 0) {
      page.entries[index] = {
        ...page.entries[index],
        content: incrementalAppend(page.entries[index].content, update.content),
        updatedAt: now()
      };
      updatedCount += 1;
    } else {
      page.entries.push(makeEntry(`${update.existingTitle} - Suggested Update`, update.content, page.entries.length + 1));
      addedCount += 1;
    }
  }

  for (const entry of parsed.newEntries) {
    const index = findEntryIndex(entry.title);
    if (index >= 0) {
      page.entries[index] = {
        ...page.entries[index],
        content: incrementalAppend(page.entries[index].content, entry.content),
        updatedAt: now()
      };
      updatedCount += 1;
    } else {
      page.entries.push(makeEntry(entry.title, entry.content, page.entries.length + 1));
      addedCount += 1;
    }
  }

  await writeWikiPage(page);
  return { page, parsed, updatedCount, addedCount };
}

export async function addWikiEntry(courseId: string, knowledgeId: string, patch?: Partial<WikiEntry>) {
  const page = await requireWikiPage(courseId, knowledgeId);
  const time = now();
  const entry: WikiEntry = {
    id: entryId(),
    title: patch?.title || "New Wiki Entry",
    content: patch?.content || "",
    order: page.entries.length + 1,
    createdAt: time,
    updatedAt: time
  };
  page.entries.push(entry);
  await writeWikiPage(page);
  return { page, entry };
}

export async function updateWikiEntry(courseId: string, knowledgeId: string, entryIdValue: string, patch: Partial<Pick<WikiEntry, "title" | "content">>) {
  const page = await requireWikiPage(courseId, knowledgeId);
  const index = page.entries.findIndex((entry) => entry.id === entryIdValue);
  if (index === -1) throw new Error("Wiki entry not found");
  page.entries[index] = {
    ...page.entries[index],
    ...patch,
    updatedAt: now()
  };
  await writeWikiPage(page);
  return { page, entry: page.entries[index] };
}

export async function deleteWikiEntry(courseId: string, knowledgeId: string, entryIdValue: string) {
  const page = await requireWikiPage(courseId, knowledgeId);
  page.entries = page.entries.filter((entry) => entry.id !== entryIdValue);
  await writeWikiPage(page);
  return page;
}

export async function requireWikiPage(courseId: string, knowledgeId: string) {
  const page = await getWikiPage(courseId, knowledgeId);
  if (!page) throw new Error("No wiki draft has been created yet.");
  return page;
}

export async function syncWikiMarkdown(courseId: string, knowledgeId: string, suppliedPage?: WikiPageDocument) {
  const page = suppliedPage || (await requireWikiPage(courseId, knowledgeId));
  const markdown = [`# ${page.title}`, ...page.entries.map((entry) => `## ${entry.title}\n\n${entry.content}`)].join("\n\n").trim() + "\n";
  await writeText(pageMarkdownPath(courseId, knowledgeId), markdown);
}

export async function getComments(courseId: string, knowledgeId: string, entryIdValue?: string) {
  const doc = await readJson<WikiCommentsDocument | WikiComment[]>(commentsPath(courseId, knowledgeId), { comments: [] });
  const comments = Array.isArray(doc) ? doc : doc.comments || [];
  return entryIdValue ? comments.filter((comment) => comment.entryId === entryIdValue) : comments;
}

export async function addComment(courseId: string, knowledgeId: string, entryIdValue: string, text: string) {
  const comments = await getComments(courseId, knowledgeId);
  const comment: WikiComment = {
    id: commentId(),
    entryId: entryIdValue,
    text: text.trim(),
    author: "Prof. Gordon",
    createdAt: now()
  };
  comments.push(comment);
  await ensureDir(wikiDir(courseId, knowledgeId));
  await atomicWriteJson(commentsPath(courseId, knowledgeId), { comments });
  return comments;
}

export async function deleteComment(courseId: string, knowledgeId: string, commentIdValue: string) {
  const comments = await getComments(courseId, knowledgeId);
  const nextComments = comments.filter((comment) => comment.id !== commentIdValue);
  await ensureDir(wikiDir(courseId, knowledgeId));
  await atomicWriteJson(commentsPath(courseId, knowledgeId), { comments: nextComments });
  return nextComments;
}

export async function extractSourceReferences(courseId: string, knowledgeId: string): Promise<SourceReference[]> {
  const page = await getWikiPage(courseId, knowledgeId);
  if (!page) return [];
  const references: SourceReference[] = [];
  const linkPattern = /\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g;
  for (const entry of page.entries) {
    const searchable = `${entry.title}\n${entry.content}`;
    for (const match of searchable.matchAll(linkPattern)) {
      references.push({
        entryId: entry.id,
        entryTitle: entry.title,
        linkText: match[1],
        url: match[2]
      });
    }
  }
  return references;
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export async function removeSourceReference(courseId: string, knowledgeId: string, entryIdValue: string, linkText: string, url: string) {
  const page = await requireWikiPage(courseId, knowledgeId);
  const index = page.entries.findIndex((entry) => entry.id === entryIdValue);
  if (index === -1) throw new Error("Wiki entry not found");

  const linkPattern = new RegExp(`\\[${escapeRegExp(linkText)}\\]\\(${escapeRegExp(url)}\\)`);
  const entry = page.entries[index];
  const updatedContent = entry.content.replace(linkPattern, linkText);
  const updatedTitle = updatedContent === entry.content ? entry.title.replace(linkPattern, linkText) : entry.title;

  if (updatedContent === entry.content && updatedTitle === entry.title) {
    throw new Error("Source reference not found");
  }

  page.entries[index] = {
    ...entry,
    title: updatedTitle,
    content: updatedContent,
    updatedAt: now()
  };
  await writeWikiPage(page);
  return { page, entry: page.entries[index] };
}
