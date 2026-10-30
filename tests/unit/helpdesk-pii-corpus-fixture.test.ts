// Helpdesk v5 Part G2/G5: the shared PII scrubber corpus. Admin keeps a copy of
// this scrubber for enquiries staff turn into FAQ candidates, so both
// repositories run the same corpus file (byte-identical copies, pinned by hash
// here and in learningguideadmin's helpdesk-pii-corpus.spec.ts). CI runs it with
// no model ("the scrubber corpus test").
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { scrubPii, type ScrubContext } from "../../modules/helpdesk/piiScrubber";

const FILE = join(__dirname, "..", "fixtures", "helpdesk-pii-corpus.json");
const raw = readFileSync(FILE);
const corpus = JSON.parse(raw.toString("utf8")) as { cases: { group: string; input: string; expected: string; context?: ScrubContext }[] };

/** Change both copies together, then update this pin and Admin's. */
const PINNED_SHA256 = "1beb8cfe0c215511f02849f0a27ccc1911e96b286f343c90b056bc3ef72be261";

test("the shared corpus is the pinned version (the same bytes as Admin's copy)", () => {
  assert.equal(createHash("sha256").update(raw).digest("hex"), PINNED_SHA256);
});

test("covers zh-CN, zh-TW, en and mixed text", () => {
  assert.deepEqual(new Set(corpus.cases.map((c) => c.group)), new Set(["zh-CN", "zh-TW", "en", "mixed"]));
  assert.ok(corpus.cases.length >= 80);
});

for (const [index, item] of corpus.cases.entries()) {
  test(`corpus #${index} (${item.group})`, () => {
    const once = scrubPii(item.input, item.context ?? {});
    assert.equal(once, item.expected);
    assert.equal(scrubPii(once, item.context ?? {}), once);
  });
}
