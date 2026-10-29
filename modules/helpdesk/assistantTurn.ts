// Helpdesk v5 (Parts B, D, H; graph design §4): how Portal turns Admin's
// suggest turn, or a click, into what the chat shows. Locked vs flexible:
// - the FAQ card is always the approved text verbatim (the whole answer, or
//   the blocks Admin picked, re-checked here and taken from the cached
//   release, never from model text);
// - the short strings (opening, closing, small-talk reply, clarify
//   explanation) come from Admin already guarded, and Portal checks them once
//   more (defence in depth): plain text only, within the length cap, no link,
//   email, digit or markup (an explanation may repeat the digits and links of
//   the card it explains, nothing else). A string that fails is replaced by
//   Portal's fixed template (an explanation that fails becomes "not covered":
//   the fixed copy and the handover card). Nothing here is ever rendered as
//   Markdown or HTML by the chat.
// Pure: no I/O.
import { type AssistantNextStep, type AssistantTurn, type FaqBlock, type FaqNode, type GuardReason, type GuardedField, type HelpdeskLocale, type SuggestIntent } from "@/contracts/helpdesk";
import { textLength } from "@/contracts/helpdeskText";
import type { ReleaseGraph } from "./faqReleaseCache";

/** Portal's caps in code points: Admin's English limits (its Chinese ones are lower and already applied). */
export const TURN_TEXT_MAX: Record<GuardedField, number> = { opening: 80, closing: 80, reply: 200, explanation: 350 };
/** Part H: an answer this short is shown whole (no excerpt, no "show the full answer"). */
export const EXCERPT_RULES = { maxBlocks: 3, shortBlocks: 3, shortChars: 200 } as const;
/** Graph design §1: at most 4 follow-up chips under an answer; a choice node has 2-4 options. */
export const NEXT_STEPS_MAX = 4;
const LABEL_MAX = 200;

/** Portal's fixed copy: the click frame (Part H; clicks never ask the model) and the fallbacks for a string Portal refuses. */
export const TURN_TEMPLATES: Record<HelpdeskLocale, { opening: string; closing: string; greeting: string; farewell: string; offTopic: string }> = {
  "en-GB": {
    opening: "Here's how to sort this out:",
    closing: "If anything's unclear, just ask.",
    greeting: "Hi! What can I help you with? Tell me here, or pick one of the common topics below.",
    farewell: "You're welcome! Ask me any time you need help.",
    offTopic: "I can't help with that one. Ask me any time about using Learning Guide, your courses or your subscription."
  },
  "zh-CN": {
    opening: "好的，这个问题可以这样处理：",
    closing: "还有不清楚的，接着问我就好。",
    greeting: "你好！遇到什么问题了？可以直接告诉我，或者看看下面这些常见情况。",
    farewell: "不客气！之后有问题随时来问我。",
    offTopic: "这个我帮不上忙。关于 Learning Guide 的使用、课程或订阅，随时问我。"
  }
};

export function replyTemplate(locale: HelpdeskLocale, intent: SuggestIntent | null): string {
  const copy = TURN_TEMPLATES[locale];
  if (intent === "farewell") return copy.farewell;
  if (intent === "off_topic") return copy.offTopic;
  return copy.greeting;
}

const CONTROL = /[\u0000-\u001f\u007f-\u009f​-‏‪-‮⁦-⁩]/g;
const URL_PATTERN = /\b(?:https?:\/\/|www\.)[^\s<>"'，。！？、]+/giu;
const EMAIL_PATTERN = /[^\s@<>"'，。]+@[^\s@<>"'，。]+\.[a-z]{2,}/giu;
const DIGITS = /\p{Nd}+/gu;
/** Markdown, HTML and code: emphasis, headings, links, lists, code, tables, tags. */
const MARKUP = /[*_`#|<>[\]{}\\]|^\s*(?:[-+]|\d+[.)])\s/mu;

const digitRuns = (text: string) => (text.normalize("NFKC").match(DIGITS) ?? []);

export type ScreenedText = { text: string | null; reason: GuardReason | null };

/**
 * Portal's own check of one short string from Admin. text null = refused (reason says why); missing = there was none.
 * For an explanation, groundedIn is the card it explains: its links, emails and digit runs may be repeated, nothing else.
 */
export function screenTurnText(field: GuardedField, raw: string | null | undefined, groundedIn: string | null = null): ScreenedText {
  if (typeof raw !== "string") return { text: null, reason: "missing" };
  const text = raw.replace(CONTROL, " ").replace(/\s+/g, " ").trim();
  if (!text) return { text: null, reason: "missing" };
  if (textLength(text) > TURN_TEXT_MAX[field]) return { text: null, reason: "too_long" };
  const ground = field === "explanation" && groundedIn ? groundedIn.normalize("NFKC").toLowerCase() : null;
  const inGround = (value: string) => ground !== null && ground.includes(value.normalize("NFKC").toLowerCase());
  const links = text.match(URL_PATTERN) ?? [];
  if (links.some((link) => !inGround(link.replace(/[.,;:!?)\]]+$/, "")))) return { text: null, reason: "link" };
  const emails = text.match(EMAIL_PATTERN) ?? [];
  if (emails.some((email) => !inGround(email))) return { text: null, reason: "email" };
  // Links and emails the card has are fine in an explanation; their characters are not markup or loose digits.
  const rest = [...links, ...emails].reduce((value, part) => value.split(part).join(" "), text);
  if (MARKUP.test(rest)) return { text: null, reason: "markup" };
  const groundDigits = ground === null ? null : new Set(digitRuns(ground));
  if (digitRuns(rest).some((run) => groundDigits === null || !groundDigits.has(run))) return { text: null, reason: field === "explanation" ? "ungrounded" : "digit" };
  return { text, reason: null };
}

/**
 * Part H: the blocks to show, verbatim from the node, or null for the whole answer. Null when the pick is not
 * 1-3 contiguous block ids of this answer node, or the answer is short (at most 3 blocks, or at most 200 characters).
 */
export function excerptOf(node: FaqNode | null, blockIds: readonly string[]): FaqBlock[] | null {
  if (!node || node.type !== "answer" || !blockIds.length || blockIds.length > EXCERPT_RULES.maxBlocks) return null;
  if (node.blocks.length <= EXCERPT_RULES.shortBlocks || textLength(node.answer) <= EXCERPT_RULES.shortChars) return null;
  const indexes = blockIds.map((id) => node.blocks.findIndex((block) => block.id === id));
  if (indexes.some((index) => index < 0)) return null;
  const sorted = [...indexes].sort((a, b) => a - b);
  if (new Set(sorted).size !== sorted.length || sorted.some((index, at) => at > 0 && index !== sorted[at - 1] + 1)) return null;
  return sorted.map((index) => ({ id: node.blocks[index].id, text: node.blocks[index].text }));
}

/** The next steps under a node: follow-up chips under an answer (at most 4), the options of a choice node; null when none. */
export function nextOf(graph: ReleaseGraph | null, node: FaqNode | null): AssistantTurn["next"] {
  if (!graph || !node) return null;
  const kind = node.type === "choice" ? "option" : "follow_up";
  const steps: AssistantNextStep[] = [];
  for (const edge of graph.children(node.id)) {
    if (edge.kind !== kind || steps.length >= NEXT_STEPS_MAX || !graph.node(edge.childId)) continue;
    steps.push({ nodeId: edge.childId, label: [...edge.label].slice(0, LABEL_MAX).join("") });
  }
  return steps.length ? { kind, steps } : null;
}
