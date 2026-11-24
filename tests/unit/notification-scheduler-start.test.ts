import assert from "node:assert/strict";
import { mock, test } from "node:test";
import { readFile } from "node:fs/promises";
import { startNotificationScheduler, stopNotificationScheduler } from "../../services/notifications/scheduler";

// N1: the notification scheduler starts from instrumentation.ts, once per process.
// It used to start as an import side effect of service.ts, which a route bundle
// can evaluate more than once, and from the operations route.

test("the scheduler is started by instrumentation.ts and nowhere else", async () => {
  const instrumentation = await readFile("instrumentation.ts", "utf8");
  const guarded = instrumentation.slice(instrumentation.indexOf('NEXT_RUNTIME === "nodejs"'));
  assert.match(guarded, /import\("\.\/services\/notifications\/scheduler"\)/);
  assert.match(guarded, /startNotificationScheduler\(\)/);
  assert.ok(!(await readFile("services/notifications/service.ts", "utf8")).includes("startNotificationScheduler"));
  assert.ok(!(await readFile("app/api/internal/notifications/run/route.ts", "utf8")).includes("startNotificationScheduler"));
});

test("starting the scheduler twice creates one timer", () => {
  const setIntervalMock = mock.method(globalThis, "setInterval", () => ({ unref() { /* no-op */ } }) as unknown as ReturnType<typeof setInterval>);
  const clearIntervalMock = mock.method(globalThis, "clearInterval", () => undefined);
  try {
    stopNotificationScheduler();
    startNotificationScheduler();
    startNotificationScheduler();
    assert.equal(setIntervalMock.mock.callCount(), 1);
  } finally {
    stopNotificationScheduler();
    setIntervalMock.mock.restore();
    clearIntervalMock.mock.restore();
  }
});
