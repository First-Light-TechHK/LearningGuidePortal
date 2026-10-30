// Helpdesk v5 Part G2 (helpdesk-v5-context-chips-and-smalltalk.md): the
// code-only PII scrubber. Learner text leaves Portal only through it (the
// insights feed for the flywheel), and the 180-day retention job replaces the
// raw text of old assist log rows with its output. No model is involved.
//
// What it replaces, each with a fixed placeholder:
// - links with a query string, a fragment, user info, a token-like path
//   segment or a code after /reset, /verify, /invite and the like (<url>; a
//   plain page link is kept, it says where the learner was);
// - emails, also written with spaces or a line break around "@" or the dots,
//   "。" / 点 for the dot, 艾特 for "@" or "name at qq dot com" (<email>), and
//   the learner's own account email and its local part;
// - JWTs, API keys and other long random strings (<token>); UUIDs (<id>);
// - Portal and Stripe order / payment ids and numbers after 订单号 / 訂單編號 /
//   order no. (<order>); Helpdesk ticket numbers (<ticket>);
// - Portal user ids and numbers after 学号 / 學號 / student id (<student_id>);
// - WeChat (also wx / vx / V信) / QQ / LINE / Telegram / Instagram / WhatsApp
//   ids after their label (<handle>); IPv4 addresses (<ip>);
// - government ids: mainland ID numbers ending in X, Taiwan ID numbers, Hong
//   Kong ID numbers with their check digit, and any id or passport number after
//   身份证 / 身分證 / 护照 / HKID / passport / my id (<id>);
// - phones: mainland China mobiles and landlines with or without +86 / 0086,
//   Hong Kong (+852, eight digits), Taiwan (09xx, +886), UK (07..., +44) and
//   anything written with + / 00 / a bracketed area code, also split by
//   repeated spaces, line breaks, other dashes or spaces, "," "/" or "_", and
//   right after letters such as tel13800138000 (<phone>);
// - card-like runs of 13-19 digits and the last four digits after 尾号 /
//   ending in (<card>);
// - verification codes and any other run of six or more digits, and phone
//   numbers spelled with Chinese numerals (<number>);
// - the learner's own name from their account (the full name, and for a
//   Chinese name the given name; for a Latin name each part of three or more
//   letters) and names introduced as 我叫 / 我的名字是： / 孩子叫 (two or three
//   Han characters, four after a two-character surname such as 欧阳, or a
//   Latin name), my name is / I am Zhang Wei (<name>).
// Full-width and other non-ASCII digits and letters are folded to ASCII first
// and invisible format characters (zero-width spaces, joiners) are dropped,
// so "１３８\u200b００１３８０００" is a phone too. Dates, times, prices, version
// numbers and short numbers (lesson 3, 199 元) are kept.
// Pure and deterministic; idempotent (scrubbing scrubbed text changes
// nothing, placeholders are never touched).

export const PII_KINDS = ["url", "email", "token", "id", "order", "ticket", "student_id", "handle", "ip", "phone", "card", "number", "name"] as const;
export type PiiKind = (typeof PII_KINDS)[number];
export const PII_PLACEHOLDERS: readonly string[] = PII_KINDS.map((kind) => `<${kind}>`);

/** The learner's own account details (and their enquiries' contact details) that must not survive. */
export type ScrubContext = { names?: readonly string[]; emails?: readonly string[] };
export type ScrubReport = { text: string; found: Partial<Record<PiiKind, number>> };

const placeholder = (kind: PiiKind) => `<${kind}>`;
const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** The value of a decimal digit of any script (Unicode keeps each script's 0-9 contiguous). */
function digitValue(ch: string): string {
  const folded = ch.normalize("NFKC");
  if (/^[0-9]$/.test(folded)) return folded;
  const cp = ch.codePointAt(0) as number;
  let start = cp;
  while (start > 0 && cp - start < 64 && /\p{Nd}/u.test(String.fromCodePoint(start - 1))) start -= 1;
  return String((cp - start) % 10);
}

/** Full-width ASCII letters, digits and the symbols of addresses and numbers, and digits of any script, become ASCII; invisible format characters go. */
function fold(text: string): string {
  let out = "";
  for (const ch of text) {
    if (/[\p{Cf}\p{Co}]/u.test(ch)) continue;
    const cp = ch.codePointAt(0) as number;
    if (cp >= 0xff01 && cp <= 0xff5e) {
      const ascii = String.fromCharCode(cp - 0xfee0);
      if (/[0-9A-Za-z@+\-._/]/.test(ascii)) { out += ascii; continue; }
    }
    if (/\p{Nd}/u.test(ch) && !/[0-9]/.test(ch)) { out += digitValue(ch); continue; }
    out += ch;
  }
  return out;
}

type Rule = { pattern: RegExp; replace: (match: string, ...groups: string[]) => { kind: PiiKind; keep?: string; tail?: string } | null };

const URL_CHARS = "[^\\s<>\"'，。！？、；（）()\\[\\]{}「」]";
const TRAILING = /[.,;:!?'")\]]+$/;
const TOKEN_SEGMENT = /^(?=[A-Za-z0-9_-]*\d)(?=[A-Za-z0-9_-]*[A-Za-z])[A-Za-z0-9_-]{16,}$|^[0-9a-f]{12,}$/i;
/** A path segment that says the next one is a one-time code (reset-password/Xy7aQ9pLm2, verify/ab12cd). */
const CODE_BEFORE = /^(?:reset|reset[-_]?password|password[-_]?reset|forgot[-_]?password|verify|verification|confirm|confirmation|activate|activation|invite|invitation|magic|magic[-_]?link|token|auth|unsubscribe|share)$/i;
const SHORT_CODE = /^(?=[A-Za-z0-9_-]*\d)[A-Za-z0-9_-]{6,}$|^[A-Za-z0-9_-]{12,}$/;

/** A link is kept only when it is a plain page address: no query, fragment, user info or token-like path segment. */
function urlRule(pattern: RegExp): Rule {
  return {
    pattern,
    replace(match) {
      const tail = TRAILING.exec(match)?.[0] ?? "";
      const url = tail ? match.slice(0, -tail.length) : match;
      const rest = url.replace(/^[a-z][a-z0-9+.-]*:\/\//i, "");
      const segments = rest.split("/").slice(1);
      const sensitive = /[?#@=]/.test(rest)
        || segments.some((segment, index) => TOKEN_SEGMENT.test(segment) || (index > 0 && CODE_BEFORE.test(segments[index - 1]) && SHORT_CODE.test(segment)));
      return sensitive ? { kind: "url", tail } : null;
    }
  };
}

/** A label, the optional ":" / "是" / "is" after it, and the value: the label stays, the value goes. */
function labelled(kind: PiiKind, labels: string, value: string, flags = "giu"): Rule {
  return {
    pattern: new RegExp(`(${labels})(\\s*(?:[:：#]|是|為|为|係|is)?\\s*)(${value})`, flags),
    replace: (_match, label, separator) => ({ kind, keep: `${label}${separator}` })
  };
}

/** Dates (2026-10-29, 29-10-2026) are kept, a run with only dots is a version or a price unless every group is long. */
function digitRunKind(run: string): PiiKind | null {
  const digits = run.replace(/\D/g, "");
  const n = digits.length;
  if (n < 6) return null;
  const plain = run.trim();
  if (/^\d{4}[-./]\d{1,2}[-./]\d{1,2}$/.test(plain) || /^\d{1,2}[-./]\d{1,2}[-./]\d{4}$/.test(plain)) return null;
  if (/^[\d.]+$/.test(plain) && plain.includes(".") && plain.split(".").some((group) => group.length < 3)) return null;
  if (/^(?:\+|00)/.test(plain) || /[(（]/.test(plain)) return "phone";
  const national = n === 13 && digits.startsWith("86") ? digits.slice(2) : n === 11 && digits.startsWith("852") ? digits.slice(3) : n === 12 && digits.startsWith("886") ? `0${digits.slice(3)}` : digits;
  if (/^1[3-9]\d{9}$/.test(national)) return "phone";
  if (/^[2-9]\d{7}$/.test(national)) return "phone";
  if (/^09\d{8}$/.test(national)) return "phone";
  if (/^0[1-9]\d{8,10}$/.test(national)) return "phone";
  if (n >= 13 && n <= 19) return "card";
  return "number";
}

/** Separators a single phone number can be typed with between digit groups (single, in the tight rule). */
const TIGHT_SEPARATOR = /^[ \t\u00a0\u3000\-.]$/;

/**
 * A run of digit groups split by wider separators (" - ", two spaces, a line break, other dashes and
 * spaces, ",", "/", "_"): only a phone is taken out, never a list of numbers ("lesson 3, 4, 5"), a
 * price (1,299,000) or a date (2026 - 10 - 29). The groups between wide separators are tried as one
 * number, longest first, so "lesson 3, 138 - 0013 - 8000" keeps "lesson 3, ".
 */
function loosePhone(match: string): { kind: PiiKind; keep?: string; tail?: string } | null {
  const parts = match.split(/(\d+)/); // [prefix, digits, separator, digits, ..., digits, ""]
  const chunks: { start: number; end: number }[] = [];
  let offset = parts[0].length;
  let current: { start: number; end: number } | null = { start: 0, end: offset };
  let wide = false;
  for (let i = 1; i < parts.length; i += 2) {
    const separator = parts[i + 1] ?? "";
    current = current ?? { start: offset, end: offset };
    offset += parts[i].length;
    current.end = offset;
    if (i + 2 < parts.length && !TIGHT_SEPARATOR.test(separator)) {
      wide = true;
      chunks.push(current);
      current = null;
    }
    offset += separator.length;
  }
  if (current) chunks.push(current);
  if (!wide) return null; // the tight rule after this one decides
  for (let size = chunks.length; size >= 1; size -= 1) {
    for (let first = 0; first + size <= chunks.length; first += 1) {
      const start = chunks[first].start;
      const end = chunks[first + size - 1].end;
      const run = match.slice(start, end);
      const groups = run.split(/\D+/).filter(Boolean).map((group) => group.length);
      const dateLike = groups.length === 3 && ((groups[0] === 4 && groups[1] <= 2 && groups[2] <= 2) || (groups[0] <= 2 && groups[1] <= 2 && groups[2] === 4));
      if (dateLike || digitRunKind(run) !== "phone") continue;
      // A comma between groups reads as a list or a price unless the number is a whole mainland mobile.
      if (/[,，]/.test(run) && !/^(?:86)?1[3-9]\d{9}$/.test(run.replace(/\D/g, ""))) continue;
      return { kind: "phone", keep: match.slice(0, start), tail: match.slice(end) };
    }
  }
  return null;
}

const EMAIL_TLDS = "com|net|org|edu|gov|cn|hk|tw|mo|sg|uk|io|me|co|info|biz|jp|kr|us|ca|au|de|fr|top|xyz|cc";
const EMAIL_DOT = "(?:\\.|。|点|點|\\(dot\\)|\\[dot\\]|\\s+dot\\s+)";
const EMAIL_STOPWORDS = "is|my|our|his|her|email|e-mail|mail|address|to|the|me|was|are|and|or|at|from|it|its|use|send|write|contact";

const RULES: Rule[] = [
  urlRule(new RegExp(`(?:\\b[a-z][a-z0-9+.-]*:\\/\\/|\\bwww\\.)${URL_CHARS}+`, "giu")),
  urlRule(new RegExp(`\\b(?:[a-z0-9-]+\\.)+[a-z]{2,}\\/${URL_CHARS}*`, "giu")),
  { pattern: /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g, replace: () => ({ kind: "token" }) },
  { pattern: /(?:mailto:)?[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g, replace: () => ({ kind: "email" }) },
  // "john smith at gmail dot com": up to two more words before " at " are the address too.
  {
    pattern: new RegExp(`(?:\\b(?!(?:${EMAIL_STOPWORDS})\\b)[A-Za-z0-9._%+-]+\\s+){0,2}[A-Za-z0-9._%+-]+\\s+at\\s+[A-Za-z0-9-]+(?:\\s*${EMAIL_DOT}\\s*[A-Za-z0-9-]+)*?\\s*${EMAIL_DOT}\\s*(?:${EMAIL_TLDS})(?![A-Za-z0-9])`, "gi"),
    replace: () => ({ kind: "email" })
  },
  // Spaces or a line break around "@" or the dots, "。" / 点 for the dot, 艾特 / (at) for "@": only before a known top-level domain.
  {
    pattern: new RegExp(`[A-Za-z0-9._%+-]+\\s*(?:@|\\(at\\)|\\[at\\]|艾特)\\s*[A-Za-z0-9-]+(?:\\s*${EMAIL_DOT}\\s*[A-Za-z0-9-]+)*?\\s*${EMAIL_DOT}\\s*(?:${EMAIL_TLDS})(?![A-Za-z0-9])`, "gi"),
    replace: () => ({ kind: "email" })
  }
];

const COMPOUND_SURNAMES = "欧阳|歐陽|司马|司馬|上官|诸葛|諸葛|东方|東方|皇甫|尉迟|尉遲|公孙|公孫|慕容|令狐|长孙|長孫|宇文|司徒|夏侯|端木|南宫|南宮|独孤|獨孤|西门|西門";
const NAME_LABELS_ZH = "我叫|我的名字是|我的名字叫|名字叫|本人叫|本人姓名|姓名|孩子叫|小孩叫|女儿叫|儿子叫|女兒叫|兒子叫";
/** Words after "I am" / "this is" that start a sentence, not a name. */
const NOT_A_NAME = "Not|Still|Unable|Trying|Using|Having|Learning|Getting|Very|So|The|A|An|In|On|From|At|With|Also|Just|Really|Chinese|English|New|Now|Here|There|Sorry|Back|Done|Logged|Signed";

const ID_RULES: Rule[] = [
  { pattern: /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, replace: () => ({ kind: "id" }) },
  { pattern: /\border_\d{10,}_[0-9a-f]{4,}\b/gi, replace: () => ({ kind: "order" }) },
  { pattern: /\b(?:user|usr)_\d{10,}_[0-9a-f]{4,}\b/gi, replace: () => ({ kind: "student_id" }) },
  { pattern: /\b(?:pi|ch|cs|in|sub|py|re|txn|pm|seti|si|po|tr|ii|il)_(?:test_|live_)?[A-Za-z0-9]{8,}\b/g, replace: () => ({ kind: "order" }) },
  { pattern: /\bcus_[A-Za-z0-9]{8,}\b/g, replace: () => ({ kind: "id" }) },
  { pattern: /\bLG-\d{6}-\d{4,}\b/gi, replace: () => ({ kind: "ticket" }) },
  { pattern: /(?<![A-Za-z0-9_-])(?=[A-Za-z0-9_-]*\d)(?=[A-Za-z0-9_-]*[A-Za-z])[A-Za-z0-9_-]{24,}(?![A-Za-z0-9_-])/g, replace: () => ({ kind: "token" }) },
  {
    pattern: /(?<![\d.])(?:\d{1,3}\.){3}\d{1,3}(?![\d.])/g,
    replace: (match) => (match.split(".").every((part) => Number(part) <= 255) ? { kind: "ip" } : null)
  },
  // Labelled values (the label is kept so the question still reads).
  labelled("student_id", "学号|學號|学生号|學生號|学籍号|學籍號|学生证号|學生證號|student\\s*(?:id|no\\.?|number|#)", "[A-Za-z]{0,3}\\d[A-Za-z0-9-]{2,30}(?![A-Za-z0-9_-])"),
  labelled("order", "订单编号|訂單編號|订单号|訂單號|订单|訂單|交易单号|交易號|交易号|流水号|流水號|单号|單號|order\\s*(?:id|no\\.?|number|#)?|transaction\\s*(?:id|no\\.?|number)?|receipt\\s*(?:no\\.?|number|#)?|invoice\\s*(?:no\\.?|number|#)?",
    "[A-Za-z0-9_-]*\\d[A-Za-z0-9_-]{3,63}(?![A-Za-z0-9_-])"),
  labelled("handle", "微信号|微信號|微信\\s*ID|微信|wechat\\s*(?:id)?|wxid|weixin|V信|威信|\\bwx\\b|\\bvx\\b|QQ号|QQ號|QQ|telegram|\\btg\\b|instagram|\\big\\b|\\bins\\b|whatsapp|skype|discord",
    "@?(?:[A-Za-z](?=[A-Za-z0-9_-]*[\\d_])[A-Za-z0-9_-]{4,29}|\\d{5,12})(?![A-Za-z0-9_-])"),
  labelled("handle", "LINE\\s*ID|Line\\s*ID|line\\s*id|LINE", "@?(?:[A-Za-z](?=[A-Za-z0-9_.-]*[\\d_])[A-Za-z0-9_.-]{3,29}|\\d{5,12})(?![A-Za-z0-9_-])", "gu"),
  // Government ids and passports: any value after their label, and the shapes below without one.
  labelled("id", "身份证号码|身份证号|身份证|身份證號碼|身份證號|身份證|身分證字號|身分證號碼|身分證號|身分證|居留证号|居留證號|证件号码|证件号|證件號碼|證件號|护照号码|护照号|护照|護照號碼|護照號|護照|通行证号|通行證號|HKID(?:\\s*(?:no\\.?|number))?|identity\\s*card(?:\\s*(?:no\\.?|number))?|ID\\s*card(?:\\s*(?:no\\.?|number))?|passport(?:\\s*(?:no\\.?|number|#))?|\\bmy\\s+id(?:\\s*(?:no\\.?|number))?",
    "[A-Za-z]{0,2}\\d{6,17}[\\dXx]?(?:\\s*[(（][0-9A][)）])?(?![A-Za-z0-9])"),
  { pattern: /(?<![A-Za-z0-9])\d{17}[Xx](?![A-Za-z0-9])/g, replace: () => ({ kind: "id" }) },
  { pattern: /(?<![A-Za-z0-9])[A-Z][12]\d{8}(?![A-Za-z0-9])/g, replace: () => ({ kind: "id" }) },
  { pattern: /(?<![A-Za-z0-9])[A-Z]{1,2}\d{6}\s*[(（][0-9A][)）]/g, replace: () => ({ kind: "id" }) },
  labelled("card", "尾号|尾號|末四位|后四位|後四位|ending in|ends in|last (?:4|four) digits(?: are| is)?", "\\d{4}(?!\\d)"),
  labelled("number", "验证码|驗證碼|校验码|校驗碼|动态码|動態碼|verification code|security code|otp|code", "\\d{4,8}(?!\\d)"),
  // Names the learner introduces (their account name is handled before these).
  {
    pattern: new RegExp(`(${NAME_LABELS_ZH})(\\s*[:：]?\\s*)((?:${COMPOUND_SURNAMES})\\p{Script=Han}{1,2}|\\p{Script=Han}{2,3}|[A-Za-z][A-Za-z'-]+(?:\\s+[A-Z][a-z'-]+){0,2})`, "gu"),
    replace: (_match, label, space) => ({ kind: "name", keep: `${label}${space}` })
  },
  {
    pattern: new RegExp(`\\b(I am|I'm|[Tt]his is)(\\s+)((?!(?:${NOT_A_NAME})\\b)[A-Z][a-z'-]+(?:\\s+[A-Z][a-z'-]+){1,2})`, "g"),
    replace: (_match, label, space) => ({ kind: "name", keep: `${label}${space}` })
  },
  {
    pattern: /\b([Mm]y [Nn]ame is|[Mm]y [Nn]ame's|I am called|I'm called|[Nn]ame\s*:|[Mm]y (?:son|daughter|child)(?:'s name)? is)(\s+)([A-Z][a-z'-]+(?:\s+[A-Z][a-z'-]+){0,2})/g,
    replace: (_match, label, space) => ({ kind: "name", keep: `${label}${space}` })
  },
  // Phones, cards and other long numbers (after the labelled ones, which say what a number is).
  {
    pattern: /(?<![\dA-Za-z_])(?:(?:\+|00)[ \t\u00a0\u3000]?)?\d{1,11}(?:[\s\-.\u2010-\u2015\u2212\ufe58\ufe63/_,，]{1,3}\d{1,11})+(?!\d)/g,
    replace: (match) => loosePhone(match)
  },
  // A mainland mobile number right after letters (tel13800138000).
  { pattern: /(?<=[A-Za-z_])(?:(?:\+|00)?86)?1[3-9]\d{9}(?!\d)/g, replace: () => ({ kind: "phone" }) },
  {
    pattern: /(?<![\dA-Za-z_])(?:(?:\+|00)[ \t\u00a0\u3000]?)?(?:[(（][ \t]*\d{1,4}[ \t]*[)）][ \t\u3000-]?)?\d(?:[ \t\u00a0\u3000\-.]?\d)+(?!\d)/g,
    replace: (match) => {
      const kind = digitRunKind(match);
      return kind ? { kind } : null;
    }
  },
  { pattern: /[零〇一二三四五六七八九幺两兩]{7,}/gu, replace: () => ({ kind: "number" }) }
];

const HAN = /\p{Script=Han}/u;
const LETTER_EDGE_BEFORE = "(?<![<\\p{L}\\p{N}_])";
const LETTER_EDGE_AFTER = "(?![>\\p{L}\\p{N}_])";

/** The account's names: the full name, a Chinese name's given name, a Latin name's parts of three or more letters (longest first). */
function nameRules(names: readonly string[]): Rule[] {
  const patterns = new Set<string>();
  for (const raw of names) {
    const name = fold(raw).replace(/\s+/g, " ").trim();
    if ([...name].length < 2) continue;
    const parts = name.split(" ");
    if (HAN.test(name)) {
      const han = name.replace(/\s+/g, "");
      patterns.add(escapeRegExp(han));
      if (/^\p{Script=Han}{3,4}$/u.test(han)) patterns.add(escapeRegExp(han.slice(1)));
      for (const part of parts) if (!HAN.test(part) && part.length >= 3) patterns.add(`${LETTER_EDGE_BEFORE}${escapeRegExp(part)}${LETTER_EDGE_AFTER}`);
      continue;
    }
    patterns.add(`${LETTER_EDGE_BEFORE}${parts.map(escapeRegExp).join("\\s*")}${LETTER_EDGE_AFTER}`);
    for (const part of parts) if ([...part].length >= 3) patterns.add(`${LETTER_EDGE_BEFORE}${escapeRegExp(part)}${LETTER_EDGE_AFTER}`);
  }
  return [...patterns].sort((a, b) => b.length - a.length).map((source) => ({ pattern: new RegExp(source, "giu"), replace: () => ({ kind: "name" as const }) }));
}

/** The account's emails and their local parts of four or more characters. */
function emailRules(emails: readonly string[]): Rule[] {
  const rules: Rule[] = [];
  for (const raw of emails) {
    const email = fold(raw).trim();
    if (!email.includes("@")) continue;
    rules.push({ pattern: new RegExp(escapeRegExp(email), "gi"), replace: () => ({ kind: "email" }) });
    const local = email.split("@")[0];
    if ([...local].length >= 4) rules.push({ pattern: new RegExp(`(?<![<\\p{L}\\p{N}_.@-])${escapeRegExp(local)}(?![>\\p{L}\\p{N}_@-])`, "giu"), replace: () => ({ kind: "email" }) });
  }
  return rules;
}

const PLACEHOLDER_SPLIT = new RegExp(`(${PII_PLACEHOLDERS.map(escapeRegExp).join("|")})`);

function apply(text: string, rule: Rule, found: Partial<Record<PiiKind, number>>): string {
  // Placeholders already in the text are never part of a match: only the pieces between them are scrubbed.
  return text.split(PLACEHOLDER_SPLIT).map((piece, index) => {
    if (index % 2 === 1) return piece;
    return piece.replace(rule.pattern, (match: string, ...rest: unknown[]) => {
      const groups = rest.slice(0, -2).map((group) => (typeof group === "string" ? group : ""));
      const decision = rule.replace(match, ...groups);
      if (!decision) return match;
      found[decision.kind] = (found[decision.kind] ?? 0) + 1;
      return `${decision.keep ?? ""}${placeholder(decision.kind)}${decision.tail ?? ""}`;
    });
  }).join("");
}

/** Dates and times are kept as typed: set aside (as private-use markers, which fold drops from any input) while the number rules run. */
const DATE_OR_TIME = /(?<!\d)(?:\d{4}[-/.]\d{1,2}[-/.]\d{1,2}|\d{1,2}[-/.]\d{1,2}[-/.]\d{4}|\d{1,2}[:：]\d{2}(?:[:：]\d{2})?)(?!\d)/g;

/** The scrubbed text and how many of each placeholder were put in (never the text that was removed). */
export function scrubPiiReport(text: string, context: ScrubContext = {}): ScrubReport {
  const found: Partial<Record<PiiKind, number>> = {};
  let out = fold(text);
  for (const rule of RULES) out = apply(out, rule, found);
  for (const rule of nameRules(context.names ?? [])) out = apply(out, rule, found);
  for (const rule of emailRules(context.emails ?? [])) out = apply(out, rule, found);
  const kept: string[] = [];
  out = out.replace(DATE_OR_TIME, (match) => `\ue000${String.fromCharCode(0xe100 + kept.push(match) - 1)}\ue001`);
  for (const rule of ID_RULES) out = apply(out, rule, found);
  out = out.replace(/\ue000([\ue100-\uf8ff])\ue001/g, (_match, index: string) => kept[index.charCodeAt(0) - 0xe100] ?? "");
  return { text: out, found };
}

/** Learner text with every personal detail replaced by its placeholder (see the list at the top). */
export function scrubPii(text: string, context: ScrubContext = {}): string {
  return scrubPiiReport(text, context).text;
}
