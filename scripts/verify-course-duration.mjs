import assert from "node:assert/strict";
import { totalVideoMinutes } from "../lib/courseDuration.ts";

assert.equal(totalVideoMinutes([]), null);
assert.equal(totalVideoMinutes([{ durationMinutes: 45 }]), null);
assert.equal(totalVideoMinutes([{ videoDurationSeconds: 120 }, {}]), null);
assert.equal(totalVideoMinutes([{ videoDurationSeconds: NaN }]), null);
assert.equal(totalVideoMinutes([{ videoDurationSeconds: -1 }]), null);
assert.equal(totalVideoMinutes([{ videoDurationSeconds: 0 }]), 0);
assert.equal(totalVideoMinutes([{ videoDurationSeconds: 61 }, { videoDurationSeconds: 59 }]), 2);
assert.equal(totalVideoMinutes([{ videoDurationSeconds: 1 }]), 1);
console.log("PASS: measured video totals, text-only, rounding, missing metadata, invalid durations; study estimates are not used as video time.");
