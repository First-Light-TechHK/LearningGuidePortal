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
import { hasTraditionalOnly } from "./traditionalChinese";

/** Portal's caps in code points: Admin's English limits (its Chinese ones are lower and already applied). */
export const TURN_TEXT_MAX: Record<GuardedField, number> = { opening: 80, closing: 80, reply: 200, explanation: 350 };
/** Part H: an answer this short is shown whole (no excerpt, no "show the full answer"). */
export const EXCERPT_RULES = { maxBlocks: 3, shortBlocks: 3, shortChars: 200 } as const;
/** Graph design §1: at most 4 follow-up chips under an answer; a choice node has 2-4 options. */
export const NEXT_STEPS_MAX = 4;
const LABEL_MAX = 200;

/** The language of Portal's fixed copy: the page's two locales, and Traditional Chinese for a learner who writes it (as Admin's templates). */
export type TemplateVariant = HelpdeskLocale | "zh-TW";

/**
 * Portal's fixed copy: the click frame (Part H; clicks never ask the model) and the fallbacks for a string Portal refuses.
 * The zh-TW lines are Admin's own (workflow/guard.ts TEMPLATES), word for word.
 */
export const TURN_TEMPLATES: Record<TemplateVariant, { opening: string; closing: string; greeting: string; farewell: string; offTopic: string }> = {
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
  },
  "zh-TW": {
    opening: "好的，這個問題可以這樣處理：",
    closing: "還有不清楚的，接著問我就好。",
    greeting: "你好！遇到什麼問題了？可以直接告訴我，或者看看下面這些常見情況。",
    farewell: "不客氣！之後有問題隨時來問我。",
    offTopic: "這個我幫不上忙。關於 Learning Guide 的使用、課程或訂閱，隨時問我。"
  }
};

const HAN_SCRIPT = /\p{Script=Han}/u;
const LATIN_SCRIPT = /\p{Script=Latin}/u;

/**
 * The template language for what the learner wrote, decided as Admin's guard decides it (learnerOf): Chinese
 * characters -> zh-TW when one of them is Traditional-only, else zh-CN; only Latin letters -> English; neither
 * (emoji, punctuation) -> the page's language.
 */
export function templateVariant(text: string, locale: HelpdeskLocale): TemplateVariant {
  if (HAN_SCRIPT.test(text)) return hasTraditionalOnly(text) ? "zh-TW" : "zh-CN";
  if (LATIN_SCRIPT.test(text)) return "en-GB";
  return locale;
}

/**
 * The frame of a click (no text of its own): in the zh-CN chat, the script of the learner's newest Chinese words
 * in the session (oldest first in learnerTexts); the English chat's cards are English, so its frame is too.
 */
export function frameVariant(locale: HelpdeskLocale, learnerTexts: readonly string[]): TemplateVariant {
  if (locale !== "zh-CN") return locale;
  for (const text of [...learnerTexts].reverse()) if (HAN_SCRIPT.test(text)) return hasTraditionalOnly(text) ? "zh-TW" : "zh-CN";
  return locale;
}

export function replyTemplate(locale: TemplateVariant, intent: SuggestIntent | null): string {
  const copy = TURN_TEMPLATES[locale];
  if (intent === "farewell") return copy.farewell;
  if (intent === "off_topic") return copy.offTopic;
  return copy.greeting;
}

/** C0 / C1 controls: become a space. */
const CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/g;
/** Invisible format characters (zero-width spaces and joiners, soft hyphen, direction controls, BOM): dropped, so "fr­ee" reads "free". */
const INVISIBLE = /\p{Cf}/gu;
/** Links: with a scheme or www., or any dotted host ending in two or more letters (no list of top-level domains: .xyz and .online count). */
const URL_PATTERN = /(?:https?:\/\/|www\.)[^\s<>"'，。！？、()（）]+|\b[a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,}\b(?:\/[^\s<>"'，。！？、()（）]*)?/giu;
const EMAIL_PATTERN = /[^\s@<>"'，。()（）[\]]+@[^\s@<>"'，。()（）[\]]+\.[a-z]{2,}/giu;
const DIGITS = /\p{Nd}+/gu;
/**
 * Numbers written as words count as digits (a duration or an amount the card may not say): Chinese numerals (with 两, 半,
 * 几; simplified or traditional) before a unit of time or money, not after 第 (an ordinal); English number words (and
 * "a few", "a couple of", "half an") before a unit. Mirrors Admin's guard (workflow/guard.ts).
 */
const ZH_NUMBER = /(?<!第)[零〇一二两兩三四五六七八九十百千万萬半几幾]+(?:\s*(?:到|至|或|-|–|~)\s*[零〇一二两兩三四五六七八九十百千万萬半几幾]+)?\s*(?:多|来|來)?\s*[个個]?\s*(?:半\s*)?(?:工作日|天|日|周|週|星期|礼拜|禮拜|月|年|分钟|分鐘|小时|小時|钟头|鐘頭|钟|鐘|秒|刻钟|刻鐘|元|块钱|塊錢|英镑|英鎊|镑|鎊|美元|欧元|歐元|港币|港幣|毛钱|毛錢)/gu;
const EN_NUMBER_WORD = "(?:zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|thousand|dozen|half an?|half|a few|few|a couple of|couple of|several)";
const EN_NUMBER = new RegExp(`\\b${EN_NUMBER_WORD}(?:[\\s-]+(?:to|or|and|-)?[\\s-]*${EN_NUMBER_WORD})*[\\s-]+(?:more\\s+)?(?:(?:working|business|calendar)\\s+)?(?:seconds?|minutes?|mins?|hours?|hrs?|days?|weeks?|fortnights?|months?|years?|pounds?|quid|dollars?|euros?|pence|cents?)\\b`, "giu");
/** Markdown, HTML and code in a short line: emphasis, headings, links, lists, code, tables, tags (and no line breaks). */
const MARKUP = /[*_`#|<>[\]{}\\]|^\s*(?:[-+]|\d+[.)])\s/mu;
/** An explanation may be steps on separate lines ("1. " / "- "), and "A > B" is a breadcrumb; a quote line, a tag or other Markdown is not. */
const EXPLANATION_MARKUP = /[*_`#|[\]{}\\<]|~~|^\s*>/mu;
const TRAILING = /[.,;:!?。，；：！？、)）\]'"]+$/u;
/** At most this many lines in an explanation. */
const EXPLANATION_LINES_MAX = 8;

const fold = (text: string) => text.normalize("NFKC").toLowerCase();
const digitRuns = (text: string) => (text.normalize("NFKC").match(DIGITS) ?? []);
const numberWords = (text: string) => [...(fold(text).match(ZH_NUMBER) ?? []), ...(fold(text).match(EN_NUMBER) ?? [])];
const compact = (text: string) => text.replace(/\s+/g, "");
const linkKey = (link: string) => fold(link).replace(TRAILING, "").replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/+$/, "");
const emailKey = (email: string) => fold(email).replace(TRAILING, "").replace(/^mailto:/, "");

/** The text Portal would show: invisible characters dropped, controls and runs of spaces collapsed; only an explanation keeps line breaks. */
function tidy(field: GuardedField, raw: string): string {
  const text = raw.replace(INVISIBLE, "").replace(/\r\n?/g, "\n").replace(CONTROL, " ");
  if (field !== "explanation") return text.replace(/\s+/g, " ").trim();
  return text.split("\n").map((line) => line.replace(/\s+/g, " ").trim()).join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

export type ScreenedText = { text: string | null; reason: GuardReason | null };

/**
 * Portal's own check of one short string from Admin. text null = refused (reason says why); missing = there was none.
 * For an explanation, groundedIn is the card it explains: its links, emails, digit runs and numbers in words may be
 * repeated (each as a whole token), nothing else.
 */
export function screenTurnText(field: GuardedField, raw: string | null | undefined, groundedIn: string | null = null): ScreenedText {
  if (typeof raw !== "string") return { text: null, reason: "missing" };
  const text = tidy(field, raw);
  if (!text) return { text: null, reason: "missing" };
  if (textLength(text) > TURN_TEXT_MAX[field]) return { text: null, reason: "too_long" };
  if (field === "explanation" && text.split("\n").length > EXPLANATION_LINES_MAX) return { text: null, reason: "markup" };
  const ground = field === "explanation" && groundedIn ? groundedIn : null;
  const groundEmails = new Set(ground === null ? [] : (ground.match(EMAIL_PATTERN) ?? []).map(emailKey));
  const groundLinks = new Set<string>();
  for (const link of ground === null ? [] : ground.match(URL_PATTERN) ?? []) {
    const key = linkKey(link);
    groundLinks.add(key);
    groundLinks.add(key.split("/")[0]); // the bare host of a link the card has
  }
  const emails = text.match(EMAIL_PATTERN) ?? [];
  if (emails.some((email) => !groundEmails.has(emailKey(email)))) return { text: null, reason: "email" };
  const withoutEmails = emails.reduce((value, part) => value.split(part).join(" "), text);
  const links = withoutEmails.match(URL_PATTERN) ?? [];
  if (links.some((link) => !groundLinks.has(linkKey(link)))) return { text: null, reason: "link" };
  // Links and emails the card has are fine in an explanation; their characters are not markup or loose digits.
  const rest = links.reduce((value, part) => value.split(part).join(" "), withoutEmails);
  if ((field === "explanation" ? EXPLANATION_MARKUP : MARKUP).test(rest)) return { text: null, reason: "markup" };
  const groundDigits = ground === null ? null : new Set(digitRuns(ground));
  const groundCompact = ground === null ? null : compact(fold(ground));
  const loose = digitRuns(rest).some((run) => groundDigits === null || !groundDigits.has(run))
    || numberWords(rest).some((words) => groundCompact === null || !groundCompact.includes(compact(words)));
  if (loose) return { text: null, reason: field === "explanation" ? "ungrounded" : "digit" };
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
