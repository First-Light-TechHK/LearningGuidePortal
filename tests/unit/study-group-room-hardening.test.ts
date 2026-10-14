// Hardening tests for the Live Session room (independent bug hunt
// 2026-10-14): M1 a failed entry request must leave the Loading state and
// offer a retry, M2 room data-channel messages are source-checked before they
// are rendered, M5 chat length caps and publish-failure marking, L6 chat
// timestamps follow the app locale. The component cannot be rendered in this
// harness (no DOM), so its behaviour contracts are pinned against the source,
// the way the other room tests already do.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

function roomSource() {
  return readFileSync(new URL("../../components/portal/StudySessionRoom.tsx", import.meta.url), "utf8");
}

test("hunt M1: a failed entry request leaves Loading and offers a retry", () => {
  const room = roomSource();
  // The entry POST chain must catch a fetch rejection (network drop, a
  // gateway's non-JSON error page): without the catch the promise rejects,
  // entryDone stays false and the page shows Loading forever.
  assert.match(
    room,
    /sessions\/\$\{sessionId\}\/enter`, \{ method: "POST", body: "{}" \}\)\.then\(\(result\) => \{[\s\S]{0,700}?\}\)\.catch\(\(\) => \{[\s\S]{0,600}?setErrorCode\("connect_failed"\);\s*\n\s*setEntryDone\(true\);/
  );
  // The failure is recoverable in place: the Retry control re-runs the entry
  // request through an attempt counter the effect depends on.
  assert.match(room, /setEntryDone\(false\)/);
  assert.match(room, /setEntryAttempt\(\(attempt\) => attempt \+ 1\)/);
  assert.match(room, /\[session\?\.state, sessionId, left, entryAttempt\]/);
});
