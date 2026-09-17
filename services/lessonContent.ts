import sanitizeHtml from "sanitize-html";
import { LESSON_CONTENT_LIMITS as LIMITS, type CourseMediaAsset, type LessonContent, type LessonNode } from "@/contracts/lesson-content";

export type { LessonContent, LessonNode } from "@/contracts/lesson-content";

export class LessonContentError extends Error {
  readonly code = "invalid";
  constructor(message = "Invalid lesson content.") { super(message); }
}

export function isContentId(value: unknown): value is string {
  return typeof value === "string" && /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/.test(value);
}

export function courseMediaAssetId(value: unknown, courseId: string): string | null {
  if (!isContentId(courseId) || typeof value !== "string") return null;
  const prefix = `/api/course-media/${courseId}/`;
  if (!value.startsWith(prefix)) return null;
  const id = value.slice(prefix.length);
  return /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(id) ? id : null;
}

function safeHref(value: string, courseId: string): boolean {
  if (courseMediaAssetId(value, courseId)) return true;
  // Navigation links are not media embeds. Do not allow alternate asset paths,
  // encoded API URLs or credentials disguised as external links.
  try {
    const url = new URL(value);
    return /^https?:$/.test(url.protocol) && !url.username && !url.password &&
      !/\/api\/course-media(?:\/|$)/i.test(decodeURIComponent(url.pathname));
  } catch { return false; }
}

function safeExternalMediaUrl(value: unknown): value is string {
  if (typeof value !== "string" || /[\u0000-\u0020\\]/.test(value)) return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password &&
      !/\/api\/course-media(?:\/|$)/i.test(decodeURIComponent(url.pathname));
  } catch { return false; }
}

function exhibitSrcFromInstanceContent(raw: string, courseId: string, allowExternalMedia: boolean): string | undefined {
  const candidates = [raw.trim(), ...(raw.match(/https:\/\/[^\s"'<>]+/g) || []), ...(raw.match(/\/api\/course-media\/[A-Za-z0-9_-]+\/[0-9a-f-]+/g) || [])];
  for (const candidate of candidates) {
    if (courseMediaAssetId(candidate, courseId)) return candidate;
    if (allowExternalMedia && safeExternalMediaUrl(candidate)) return candidate;
  }
  return undefined;
}

/** Apply again on the server before rendering historical or imported HTML. */
export function sanitiseRichHtml(value: unknown, courseId: string, nodeIds: Iterable<string> = [], options: { allowExternalMedia?: boolean } = {}): string {
  if (typeof value !== "string" || value.length > LIMITS.htmlCharacters || !isContentId(courseId)) return "";
  const nodes = new Set(nodeIds);
  const allowExternalMedia = options.allowExternalMedia === true;
  return sanitizeHtml(value, {
    allowedTags: ["p", "br", "hr", "h1", "h2", "h3", "h4", "h5", "h6", "strong", "b", "em", "i", "u", "s", "del", "mark", "sub", "sup", "blockquote", "pre", "code", "ul", "ol", "li", "span", "a", "img", "table", "thead", "tbody", "tfoot", "tr", "th", "td", "label", "input", "div"],
    allowedAttributes: {
      a: ["href", "title", "rel", "data-node-id"],
      span: ["data-node-id", "style", "data-image-align", "data-image-inline", "data-caption", "class", "data-instance-type", "data-instance-answer-type", "data-instance-answer-result", "data-instance-src", "data-trial-stop"],
      img: ["src", "alt", "title", "width", "height", "data-align", "data-inline", "data-image-align", "data-image-inline", "data-caption"],
      ul: ["data-type"], li: ["data-type", "data-checked"], input: ["type", "checked", "disabled"],
      p: ["style"], h1: ["style"], h2: ["style"], h3: ["style"], h4: ["style"], h5: ["style"], h6: ["style"], mark: ["style"],
      th: ["colspan", "rowspan"], td: ["colspan", "rowspan"], ol: ["start"],
    },
    allowedStyles: { "*": { "text-align": [/^(left|right|center|justify)$/], color: [/^#[0-9a-f]{3,8}$/i], "background-color": [/^#[0-9a-f]{3,8}$/i] } },
    allowedSchemes: ["https", "http"],
    allowProtocolRelative: false,
    disallowedTagsMode: "discard",
    enforceHtmlBoundary: true,
    transformTags: {
      "*": (tagName, attributes) => {
        const attribs = { ...attributes };
        if (tagName === "input") {
          if (attribs.type !== "checkbox") return { tagName: "span", attribs: {} };
          attribs.disabled = "";
        }
        if (attribs["data-type"] !== (tagName === "ul" ? "taskList" : tagName === "li" ? "taskItem" : "")) delete attribs["data-type"];
        for (const key of ["data-checked", "data-inline", "data-image-inline"]) {
          if (key in attribs && !["true", "false"].includes(attribs[key])) delete attribs[key];
        }
        for (const key of ["data-align", "data-image-align"]) {
          if (key in attribs && !["left", "center", "right"].includes(attribs[key])) delete attribs[key];
        }
        if (attribs["data-caption"] && attribs["data-caption"].length > 2000) delete attribs["data-caption"];
        if (tagName === "span" && attribs["class"] !== "instance-node") delete attribs["class"];
        if (tagName === "span" && "data-instance-type" in attribs) {
          if (!/^[1-6]$/.test(attribs["data-instance-type"])) delete attribs["data-instance-type"];
          if (attribs["data-instance-answer-type"] && !["input", "single", "multiple"].includes(attribs["data-instance-answer-type"])) delete attribs["data-instance-answer-type"];
          if (attribs["data-instance-answer-result"] && attribs["data-instance-answer-result"].length > 10000) delete attribs["data-instance-answer-result"];
          const extracted = exhibitSrcFromInstanceContent(attribs["data-instance-content"] || attribs["data-instance-src"] || "", courseId, allowExternalMedia);
          if (extracted) attribs["data-instance-src"] = extracted;
          else delete attribs["data-instance-src"];
          if (attribs["data-trial-stop"] !== "true") delete attribs["data-trial-stop"];
        } else {
          delete attribs["data-instance-type"];
          delete attribs["data-instance-answer-type"];
          delete attribs["data-instance-answer-result"];
          delete attribs["data-instance-src"];
          delete attribs["data-trial-stop"];
        }
        delete attribs["data-instance-content"];
        const nodeId = attribs["data-node-id"];
        if (!nodes.has(nodeId)) delete attribs["data-node-id"];
        if (tagName === "a") {
          if (nodes.has(nodeId)) attribs.href = `#node-${nodeId}`;
          else if (!safeHref(attribs.href || "", courseId)) delete attribs.href;
          attribs.rel = "noopener noreferrer";
        }
        if (tagName === "img" && !courseMediaAssetId(attribs.src, courseId)) delete attribs.src;
        for (const name of ["width", "height", "colspan", "rowspan", "start"]) {
          if (name in attribs && !/^[1-9][0-9]{0,3}$/.test(attribs[name])) delete attribs[name];
        }
        return { tagName, attribs };
      },
    },
    exclusiveFilter: frame => frame.tag === "img" && !frame.attribs.src,
  });
}

export const sanitizeRichHtml = sanitiseRichHtml;

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new LessonContentError();
  return value as Record<string, unknown>;
}

function text(value: unknown, max: number, required = true): string {
  if (typeof value !== "string" || value.length > max || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value) || (required && !value.trim())) throw new LessonContentError();
  return value.trim();
}

export function validateLessonContents(value: unknown, courseId: string, options: { allowExternalMedia?: boolean } = {}): LessonContent[] {
  if (!isContentId(courseId) || !Array.isArray(value) || value.length > LIMITS.contents) throw new LessonContentError();
  try {
    if (Buffer.byteLength(JSON.stringify(value), "utf8") > LIMITS.lessonBytes) throw new LessonContentError("Lesson content is too large.");
  } catch { throw new LessonContentError("Lesson content is too large or invalid."); }
  const ids = new Set<string>();
  let nodeCount = 0;
  const identity = (id: unknown) => {
    if (!isContentId(id) || ids.has(id)) throw new LessonContentError("Content and node IDs must be unique.");
    ids.add(id);
    return id;
  };
  const url = (value: unknown) => {
    if (!courseMediaAssetId(value, courseId) && !(options.allowExternalMedia && safeExternalMediaUrl(value))) throw new LessonContentError("Media must belong to this course.");
    return value as string;
  };
  const html = (value: unknown, nodes: string[]) => sanitiseRichHtml(text(value, LIMITS.htmlCharacters, false), courseId, nodes, options);
  const active = (value: unknown) => {
    if (value !== undefined && typeof value !== "boolean") throw new LessonContentError("Active must be a boolean.");
    return value !== false;
  };
  return value.map(item => {
    const input = record(item);
    if (!["text", "video", "pdf"].includes(input.type as string) || !["lecture", "interactive"].includes(input.mode as string) || !Array.isArray(input.nodes) || input.nodes.length > LIMITS.nodesPerContent) throw new LessonContentError();
    const id = identity(input.id);
    const nodes: LessonNode[] = input.nodes.map(item => {
      const node = record(item);
      if (++nodeCount > LIMITS.nodesPerLesson || !["text", "video", "image", "audio", "model3d", "exercise"].includes(node.type as string) || typeof node.triggerTime !== "number" || !Number.isFinite(node.triggerTime) || node.triggerTime < 0 || node.triggerTime > LIMITS.triggerSeconds) throw new LessonContentError();
      const result: LessonNode = { id: identity(node.id), title: text(node.title, LIMITS.titleCharacters), type: node.type as LessonNode["type"], active: active(node.active), triggerTime: node.triggerTime };
      if (["video", "image", "audio", "model3d"].includes(result.type)) result.url = url(node.url);
      else if (node.url) throw new LessonContentError();
      if (result.type === "exercise") {
        result.question = text(node.question, 10_000);
        if (node.options !== undefined) {
          if (!Array.isArray(node.options) || node.options.length < 2 || node.options.length > LIMITS.options) throw new LessonContentError();
          result.options = node.options.map(option => text(option, 2000));
          if (new Set(result.options.map(option => option.toLowerCase())).size !== result.options.length) throw new LessonContentError("Quiz options must be distinct.");
          if (!Array.isArray(node.correctOptions) || !node.correctOptions.length || node.correctOptions.length > result.options.length || new Set(node.correctOptions).size !== node.correctOptions.length || node.correctOptions.some(index => !Number.isInteger(index) || index < 0 || index >= result.options!.length)) throw new LessonContentError("Quiz answer indexes must identify valid options.");
          result.correctOptions = [...node.correctOptions].sort((a, b) => a - b);
          if (node.answer !== undefined) result.answer = text(node.answer, 10_000, false);
        } else {
          if (node.correctOptions !== undefined) throw new LessonContentError();
          result.answer = text(node.answer, 10_000);
        }
      } else if (node.question !== undefined || node.answer !== undefined || node.options !== undefined || node.correctOptions !== undefined) throw new LessonContentError();
      return result;
    });
    const nodeIds = nodes.map(node => node.id);
    nodes.forEach((node, index) => {
      const raw = input.nodes as Record<string, unknown>[];
      if (raw[index].html !== undefined) node.html = html(raw[index].html, nodeIds);
    });
    const result: LessonContent = { id, title: text(input.title, LIMITS.titleCharacters), type: input.type as LessonContent["type"], mode: input.mode as LessonContent["mode"], active: active(input.active), nodes };
    if (result.type !== "text") result.url = url(input.url);
    else if (input.url) throw new LessonContentError();
    if (input.html !== undefined) result.html = html(input.html, nodeIds);
    return result;
  });
}

/** Read defence: malformed stored content is withheld, never returned unsanitised. */
export function sanitiseLessonContents(value: unknown, courseId: string): LessonContent[] {
  try {
    return validateLessonContents(value, courseId, { allowExternalMedia: true }).filter(content => content.active !== false).map(content => {
      const nodes = content.nodes.filter(node => node.active !== false);
      const ids = nodes.map(node => node.id);
      return { ...content, ...(content.html !== undefined ? { html: sanitiseRichHtml(content.html, courseId, ids, { allowExternalMedia: true }) } : {}), nodes: nodes.map(node => ({ ...node, ...(node.html !== undefined ? { html: sanitiseRichHtml(node.html, courseId, ids, { allowExternalMedia: true }) } : {}) })) };
    });
  } catch { return []; }
}

export const sanitizeLessonContents = sanitiseLessonContents;

export function lessonContentsText(contents: LessonContent[]): string {
  const plain = (html: string) => sanitizeHtml(html, {
    allowedTags: [], allowedAttributes: {},
    transformTags: { br: () => ({ tagName: "br", text: "\n", attribs: {} }) },
  }).replace(/&#(x[\da-f]+|\d+);|&(amp|lt|gt|quot|apos|nbsp);/gi, (match, code: string | undefined, name: string | undefined) => {
    if (code) {
      const point = code[0].toLowerCase() === "x" ? parseInt(code.slice(1), 16) : Number(code);
      return point > 0 && point <= 0x10ffff ? String.fromCodePoint(point) : "";
    }
    return ({ amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " } as Record<string, string>)[name!.toLowerCase()] || match;
  }).trim();
  return contents.filter(content => content.active !== false).flatMap(content => [content.title, plain(content.html || ""), ...content.nodes.filter(node => node.active !== false).flatMap(node => [node.title, plain(node.html || ""), node.question || "", ...(node.options || [])])]).filter(Boolean).join("\n");
}

/** Extract only renderable references, not raw string matches inside scripts or comments. */
export function lessonContentAssetReferences(value: unknown, courseId: string, includeInactive = false): Array<{ assetId: string; fileType?: CourseMediaAsset["fileType"] }> {
  const references: Array<{ assetId: string; fileType?: CourseMediaAsset["fileType"] }> = [];
  const add = (url: unknown, fileType?: CourseMediaAsset["fileType"]) => { const assetId = courseMediaAssetId(url, courseId); if (assetId) references.push({ assetId, fileType }); };
  const contents = includeInactive
    ? validateLessonContents(value, courseId, { allowExternalMedia: true })
    : sanitiseLessonContents(value, courseId);
  for (const content of contents) {
    for (const item of [content, ...content.nodes]) {
      if (item.type !== "text" && item.type !== "exercise") add(item.url, item.type);
      if (item.html) sanitizeHtml(item.html, {
        allowedTags: ["img", "a"], allowedAttributes: { img: ["src"], a: ["href"] },
        transformTags: { "*": (tagName, attribs) => { if (tagName === "img") add(attribs.src, "image"); if (tagName === "a") add(attribs.href); return { tagName, attribs }; } },
      });
    }
  }
  return references;
}

export function lessonContentAssetIds(value: unknown, courseId: string): Set<string> {
  return new Set(lessonContentAssetReferences(value, courseId).map(reference => reference.assetId));
}
