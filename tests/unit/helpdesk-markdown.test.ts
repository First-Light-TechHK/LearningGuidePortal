// The one Markdown-subset renderer for FAQ answers (tickets-v2-figma-addendum
// §1): **bold**, "1. " and "- " lists, [text](https|mailto) links, bare
// http(s) URLs and paragraphs. Nothing else is interpreted: raw HTML stays
// text and any other link scheme (javascript:, data:, relative) is dropped to
// its label. The same parse feeds the chat panel, the submit-time modal and
// the Help Centre (components/helpdesk/Markdown.tsx renders it to React).
import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { parseMarkdown, safeHref, summaryLine } from "../../modules/helpdesk/markdown";
import { Markdown } from "../../components/helpdesk/Markdown";

const html = (text: string) => renderToStaticMarkup(createElement(Markdown, { text }));

test("paragraphs split on blank lines; single line breaks stay line breaks", () => {
  assert.deepEqual(parseMarkdown("First line\nsecond line\n\n\nNext paragraph"), [
    { kind: "paragraph", lines: [[{ kind: "text", text: "First line" }], [{ kind: "text", text: "second line" }]] },
    { kind: "paragraph", lines: [[{ kind: "text", text: "Next paragraph" }]] }
  ]);
  assert.equal(html("First line\nsecond line\n\nNext"), "<p>First line<br/>second line</p><p>Next</p>");
  assert.deepEqual(parseMarkdown(" \n\r\n  "), [], "blank input is nothing");
  assert.equal(html("a\r\nb"), "<p>a<br/>b</p>", "CRLF is a line break");
});

test("bold, ordered and bullet lists, with lazy continuation lines and loose lists", () => {
  assert.equal(html("Use **Settings** then **Save**."), "<p>Use <strong>Settings</strong> then <strong>Save</strong>.</p>");
  assert.equal(html("1. Open **Account**\nThen sign in again.\n2. Check spam"), "<ol><li>Open <strong>Account</strong><br/>Then sign in again.</li><li>Check spam</li></ol>");
  assert.equal(html("3. Third\n\n4. Fourth\n\nAfter"), '<ol start="3"><li>Third</li><li>Fourth</li></ol><p>After</p>', "a blank line between items keeps one list");
  assert.equal(html("- one\n* two\n\n   indented more\nText"), "<ul><li>one</li><li>two<br/>indented more<br/>Text</li></ul>");
  assert.equal(html("Intro\n- a\n- b"), "<p>Intro</p><ul><li>a</li><li>b</li></ul>", "a list may follow a paragraph line directly");
  assert.equal(html("1. a\n- b"), "<ol><li>a</li></ol><ul><li>b</li></ul>", "switching list kind starts a new list");
  assert.equal(html("**not closed and 2 * 3"), "<p>**not closed and 2 * 3</p>");
  assert.equal(html("1.5 million learners"), "<p>1.5 million learners</p>", "a number without a space after the dot is text");
});

test("links: only http(s) and mailto; external links open safely; bare URLs link without trailing punctuation", () => {
  assert.equal(html("See [the help centre](https://example.com/help?a=1&b=2)."), '<p>See <a href="https://example.com/help?a=1&amp;b=2" target="_blank" rel="noopener noreferrer">the help centre</a>.</p>');
  assert.equal(html("[Email us](mailto:support@example.com)"), '<p><a href="mailto:support@example.com" rel="noopener noreferrer">Email us</a></p>');
  assert.equal(html("Open https://example.com/reset. Then **retry**"), '<p>Open <a href="https://example.com/reset" target="_blank" rel="noopener noreferrer">https://example.com/reset</a>. Then <strong>retry</strong></p>');
  assert.equal(html("[**Bold** link](http://example.com)"), '<p><a href="http://example.com/" target="_blank" rel="noopener noreferrer"><strong>Bold</strong> link</a></p>');
  for (const bad of ["javascript:alert(1)", "JavaScript:alert(1)", " javascript:alert(1)", "java\tscript:alert(1)", "data:text/html,<script>alert(1)</script>", "vbscript:x", "/relative", "//evil.example", "file:///etc/passwd", "https://", "mailto:"]) {
    const out = html(`[click](${bad})`);
    assert.ok(!out.includes("<a"), `${bad} is not a link: ${out}`);
    assert.ok(out.includes("click"), "the label stays as text");
    assert.equal(safeHref(bad), null, bad);
  }
  assert.equal(safeHref("https://example.com/a b"), null, "whitespace in a URL is not a link");
  assert.equal(safeHref("HTTPS://Example.com/x"), "https://example.com/x");
  assert.equal(html("javascript:alert(1)"), "<p>javascript:alert(1)</p>", "a bare javascript: is plain text");
});

test("raw HTML is never interpreted: tags and entities are shown as text", () => {
  const out = html('<script>alert(1)</script><img src=x onerror="alert(2)"> &amp; <b>bold</b>');
  assert.ok(!out.includes("<script"), out);
  assert.ok(!out.includes("<img"), out);
  assert.ok(!out.includes("<b>"), out);
  assert.equal(out, "<p>&lt;script&gt;alert(1)&lt;/script&gt;&lt;img src=x onerror=&quot;alert(2)&quot;&gt; &amp;amp; &lt;b&gt;bold&lt;/b&gt;</p>");
  assert.ok(!html("[x](https://example.com/\"onmouseover=\"alert(1))").includes("<a"), "a quote in a link target is not a link");
});

test("summary line: the first plain-text line with Markdown stripped, truncated with an ellipsis", () => {
  assert.equal(summaryLine("\n\n1. Open **Account** and [reset](https://example.com) it\nSecond line"), "Open Account and reset it");
  assert.equal(summaryLine("- **Bold** item"), "Bold item");
  assert.equal(summaryLine("Visit https://example.com/x now"), "Visit https://example.com/x now");
  assert.equal(summaryLine("<b>hi</b>"), "<b>hi</b>", "text stays text (React escapes it)");
  assert.equal(summaryLine("   "), "");
  const long = "word ".repeat(60).trim();
  const cut = summaryLine(long, 40);
  assert.equal([...cut].length, 40);
  assert.ok(cut.endsWith("…"));
  assert.equal(summaryLine("短答案", 40), "短答案");
  assert.equal([...summaryLine("😀".repeat(50), 10)].length, 10, "counts code points, never splits a surrogate pair");
});
