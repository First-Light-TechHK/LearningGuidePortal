import assert from "node:assert/strict";
import { test } from "node:test";
import { formatHomeCourseDuration } from "../../lib/courseDuration";
import en from "../../messages/en-GB.json";

test("a 45-minute course must not display 0h 45m", () => {
  const formatted = formatHomeCourseDuration(45, en.homeDesign.hourShort, en.homeDesign.minuteShort);
  assert.equal(formatted, "45m", `a 45-minute course displayed "${formatted}"`);
});
