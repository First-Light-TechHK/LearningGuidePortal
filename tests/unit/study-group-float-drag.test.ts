import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { clampMove } from "../../components/portal/useFloatDrag";

// Owner 2026-10-30: the people card and the full-screen chat can be dragged,
// never out of the screen they float on.
const frame = { left: 0, top: 0, right: 1000, bottom: 600 };
const box = { left: 760, top: 16, right: 976, bottom: 200 };

test("a float moves freely inside its frame", () => {
  assert.deepEqual(clampMove(box, frame, -300, 200), { x: -300, y: 200 });
});

test("a float stops 8px from every edge of its frame", () => {
  assert.deepEqual(clampMove(box, frame, 500, 0), { x: 1000 - 8 - 976, y: 0 });
  assert.deepEqual(clampMove(box, frame, -5000, -5000), { x: 8 - 760, y: 8 - 16 });
  assert.deepEqual(clampMove(box, frame, 0, 900), { x: 0, y: 600 - 8 - 200 });
});

test("with no move, a float that sticks out (after a resize) is nudged back inside", () => {
  assert.deepEqual(clampMove({ left: 900, top: 500, right: 1116, bottom: 684 }, frame, 0, 0), { x: 1000 - 8 - 1116, y: 600 - 8 - 684 });
  assert.deepEqual(clampMove(box, frame, 0, 0), { x: 0, y: 0 });
});

test("the room wires both floats to the drag hook, with the headers as handles", () => {
  const room = readFileSync(new URL("../../components/portal/StudySessionRoom.tsx", import.meta.url), "utf8");
  const css = readFileSync(new URL("../../components/portal/study-groups.module.css", import.meta.url), "utf8");
  const hook = readFileSync(new URL("../../components/portal/useFloatDrag.ts", import.meta.url), "utf8");
  assert.match(room, /const peopleDrag = useFloatDrag<HTMLDivElement>\(focus\);/);
  assert.match(room, /const chatDrag = useFloatDrag<HTMLElement>\(focus\);/);
  assert.match(room, /className=\{styles\.avatarToggle\} aria-expanded=\{peopleOpen\} onClick=\{togglePeople\} \{\.\.\.peopleDrag\.handle\}/);
  assert.match(room, /<div className=\{styles\.floatHead\} \{\.\.\.chatDrag\.handle\}>/);
  assert.match(css, /\.avatarToggle, \.floatHead \{ cursor: grab; touch-action: none; user-select: none; \}/);
  // A drag that ends on the header is not also a click that folds the card.
  assert.match(hook, /window\.addEventListener\("click", swallow, \{ capture: true, once: true \}\);/);
});
