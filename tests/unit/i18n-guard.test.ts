// Language guard: "a page shows one language" as a rule the build checks, for the
// modules we own (Study Groups, the AI Tutor, Helpdesk). The browser version of
// the same rule is tests/e2e/locale-purity.ts.
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import ts from "typescript";
import enGB from "../../messages/en-GB.json";
import zhCN from "../../messages/zh-CN.json";

const HAN = /\p{Script=Han}/u;
const root = process.cwd();
const ZH_TERMS = new Set(["AI", "Tutor", "TUTOR", "My", "Learning", "Guide", "FAQ", "Google", "Stripe", "Cookie", "PC", "Everything", "PDF", "MB", "JPG", "PNG", "CSV", "WebP", "GIF", "TXT", "DOCX", "XLSX", "Esc", "Enter", "ID", "Email"]);

function flat(value: unknown, prefix = ""): Array<[string, string]> {
  if (typeof value === "string") return [[prefix, value]];
  if (Array.isArray(value)) return value.flatMap((item, index) => flat(item, `${prefix}.${index}`));
  if (value && typeof value === "object") return Object.entries(value).flatMap(([key, item]) => flat(item, prefix ? `${prefix}.${key}` : key));
  return [];
}

function latin(text: string) {
  return text.replace(/\{[^}]*\}/g, " ").match(/[A-Za-z]{2,}/g) ?? [];
}

const en = flat(enGB);
const zh = flat(zhCN);
const OWNED = /^(studyGroupsPage|helpdesk|helpCentre|helpPage|learning\.(lecture|socratic|tutor|tutorErrors))\b/;

test("the two catalogs have the same keys", () => {
  assert.deepEqual(en.map(([key]) => key).sort(), zh.map(([key]) => key).sort());
});

test("our English copy has no Chinese", () => {
  assert.deepEqual(en.filter(([key, value]) => OWNED.test(key) && HAN.test(value)), []);
});

test("our Chinese copy has no untranslated English words", () => {
  const bad = zh.filter(([key, value]) => OWNED.test(key) && !/\.(icon|href|url|email)/i.test(key) && latin(value).some((word) => !ZH_TERMS.has(word)));
  assert.deepEqual(bad, []);
});

function files(path: string): string[] {
  if (statSync(path).isFile()) return [path];
  return readdirSync(path).flatMap((name) => files(join(path, name)));
}

const SCREENS = [
  "components/portal/StudyGroupsApp.tsx", "components/portal/StudySessionEntry.tsx", "components/portal/StudySessionRoom.tsx", "components/portal/CreateStudyGroupForm.tsx", "components/portal/ScheduleStudySessionForm.tsx",
  "components/portal/TutorChat.tsx", "components/portal/TutorDrawer.tsx", "components/portal/TutorAnswer.tsx", "components/portal/PortalHeader.tsx", "components/portal/CookieConsent.tsx",
].concat(files(join(root, "app/[locale]/account/my-learning/support")).map((path) => path.slice(root.length + 1)), files(join(root, "app/[locale]/help")).map((path) => path.slice(root.length + 1)));

test("our screens have no hard-coded text, and format dates in the page's language", () => {
  const bad: string[] = [];
  const LABELS = new Set(["placeholder", "title", "alt", "aria-label", "label"]);
  for (const path of SCREENS) {
    const file = ts.createSourceFile(path, readFileSync(join(root, path), "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const at = (node: ts.Node) => `${path}:${file.getLineAndCharacterOfPosition(node.getStart()).line + 1}`;
    const visit = (node: ts.Node) => {
      if (ts.isJsxText(node) && /[A-Za-z]{3,}|\p{Script=Han}/u.test(node.getText())) bad.push(`${at(node)} ${node.getText().trim().slice(0, 50)}`);
      if (ts.isJsxAttribute(node) && LABELS.has(node.name.getText()) && node.initializer && ts.isStringLiteral(node.initializer) && /[A-Za-z]{3,}|\p{Script=Han}/u.test(node.initializer.text)) bad.push(`${at(node)} ${node.getText().slice(0, 50)}`);
      if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && /^toLocale(Date|Time)?String$/.test(node.expression.name.text) && !node.arguments.length) bad.push(`${at(node)} ${node.getText().slice(0, 50)}`);
      ts.forEachChild(node, visit);
    };
    visit(file);
  }
  assert.deepEqual(bad, []);
});

test("the reminder strip asks for the page's language, and both languages are stored", () => {
  const app = readFileSync(join(root, "components/portal/StudyGroupsApp.tsx"), "utf8");
  assert.match(app, /view=reminders&locale=\$\{locale\}/);
  const service = readFileSync(join(root, "modules/group-study/service.ts"), "utf8");
  assert.match(service, /copies: reminderCopies\(/);
});
