import sanitizeHtml from "sanitize-html";
import type { LessonContent } from "@/contracts/lesson-content";
import type { TextLessonPreview } from "@/contracts/text-lesson-preview";
import { textLessonPreviewPolicy } from "@/lib/textLessonPreview";
import { sanitiseLessonContents, sanitiseRichHtml } from "./lessonContent";
import type { LessonPreviewConfiguration } from "@/contracts/lesson-resources";

// Keep complete HTML entities and Unicode code points, rather than cutting markup
// or an escaped entity in half. sanitize-html balances every retained element.
function characters(text: string) { return text.match(/&(?:#x[\da-f]+|#\d+|[a-z]+);|[\s\S]/giu) || []; }

export function firstHalfTextHtml(html: string): string {
  let length = 0;
  sanitizeHtml(html, { allowedTags: [], transformTags: { img: (tagName, attribs) => { length++; return { tagName, attribs }; } }, textFilter: text => { length += characters(text).length; return text; } });
  let remaining = Math.ceil(length / 2);
  return sanitizeHtml(html, {
    allowedTags: false, allowedAttributes: false, allowVulnerableTags: true,
    transformTags: { "*": (tagName, attribs) => { if (remaining <= 0) return { tagName: "span", attribs: {} }; if (tagName === "img") remaining--; return { tagName, attribs }; } },
    textFilter: text => { const chars = characters(text), result = chars.slice(0, remaining).join(""); remaining = Math.max(0, remaining - chars.length); return result; },
    exclusiveFilter: frame => frame.tag === "span" && !frame.text && !Object.keys(frame.attribs).length,
  });
}

export function buildTextLessonPreview(lesson: { contents?: LessonContent[]; body: string; preview?: LessonPreviewConfiguration }, courseId: string, entitled: boolean): { contents: LessonContent[]; body: string; textPreview?: TextLessonPreview } {
  const contents = sanitiseLessonContents(lesson.contents || [], courseId);
  if (entitled) return { contents, body: lesson.body };
  const textPreview = textLessonPreviewPolicy(contents, lesson.preview);
  return {
    textPreview,
    // Legacy bodies are not an alternative route to an authored Lesson's text.
    body: contents.length || lesson.preview ? "" : Array.from(lesson.body).slice(0, Math.ceil(Array.from(lesson.body).length / 2)).join(""),
    contents: contents.map(content => {
      const status = textPreview.points[content.id];
      if (!status || status === "full") return content;
      if (status === "locked") return { id: content.id, title: content.title, type: content.type, mode: content.mode, nodes: [] };
      const html = firstHalfTextHtml(content.html || "");
      const visibleNodes = content.nodes.filter(node => new RegExp(`data-node-id=["']${node.id}["']`).test(html));
      return { ...content, html: sanitiseRichHtml(html, courseId, visibleNodes.map(node => node.id)), nodes: visibleNodes };
    }),
  };
}
