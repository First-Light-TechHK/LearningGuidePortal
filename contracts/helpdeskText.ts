// Helpdesk text rules shared by the contract (server) and the learner pages
// (client bundle): pure functions, no imports, so both sides count and
// refuse exactly the same text.

/** C0 controls other than tab, line feed and carriage return, DEL, and the C1 controls. PostgreSQL TEXT cannot even store U+0000. */
const CONTROL_CHARACTERS = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/;
/** Whitespace and the zero-width characters that render as nothing. */
const INVISIBLE = /[\s​-‍⁠﻿]/g;

export function hasControlCharacters(value: string): boolean {
  return CONTROL_CHARACTERS.test(value);
}

/** Length in Unicode code points (what PostgreSQL char_length counts), not UTF-16 code units. */
export function textLength(value: string): number {
  let count = 0;
  for (const _ of value) count += 1;
  return count;
}

/** Nothing visible: only whitespace and zero-width characters. */
export function isBlankText(value: string): boolean {
  return value.replace(INVISIBLE, "") === "";
}
