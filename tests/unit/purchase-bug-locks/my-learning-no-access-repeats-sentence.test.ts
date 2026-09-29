import assert from "node:assert/strict";
import React from "react";
import { after, before, test } from "node:test";
import { isolateProductStore, mockModule, verifiedUser } from "./helpers";

// Outside tests/unit/*.test.ts so test:ci / Verify does not run this lock.

(globalThis as { React?: typeof React }).React = React;

let sessionToken = "";
mockModule("next/headers", {
  namedExports: {
    cookies: async () => ({ get: (name: string) => name === "learning_guide_session" ? { value: sessionToken } : undefined }),
    headers: async () => new Headers({ host: "localhost" }),
  },
});
mockModule("next/navigation", {
  namedExports: {
    redirect: (url: string) => { throw new Error(`redirect ${url}`); },
    useRouter: () => ({ replace() {}, push() {}, refresh() {} }),
    usePathname: () => "/en-GB/account/my-learning",
    useSearchParams: () => new URLSearchParams(),
  },
});
mockModule("next/link", {
  defaultExport: (props: { href: string; children?: React.ReactNode; className?: string }) => React.createElement("a", { href: String(props.href), className: props.className }, props.children),
});
mockModule("next/image", {
  defaultExport: () => null,
});

let isolated: Awaited<ReturnType<typeof isolateProductStore>>;

before(async () => {
  isolated = await isolateProductStore();
});

after(async () => {
  await isolated.restore();
});

function paragraph(html: string, className: string) {
  const match = html.match(new RegExp(`class="${className}"[^>]*>([\\s\\S]*?)</p>`));
  assert.ok(match, `missing .${className}`);
  return match[1].replace(/<!-- -->/g, "").replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
}

test("BUG: My Learning no_access_history repeats the same sentence as the state label and the description", async () => {
  const { store } = isolated;
  const user = await verifiedUser(store, "no-access-card@example.test");
  sessionToken = (await store.createSession(user.id)).token;
  const pending = await store.createPendingDemoTrialOrder(user.id, "epicureanism-pc-6");
  await store.completeDemoTrialOrder(user.id, pending.order.id);
  await store.recordStudyEvent({
    userId: user.id,
    courseId: "epicureanism",
    lessonId: "pleasure-and-the-good-life",
    event: "open",
    seconds: 0,
    clientEventId: "no-access-card-open",
  }, "paid");
  const trial = (await store.ensureProductData()).subscriptions.find((item) => item.userId === user.id && item.source === "trial");
  assert.ok(trial);
  await store.cancelSubscription(user.id, trial.id);
  const overview = await store.getLearningOverview(user.id);
  assert.equal(overview.courses.find((course) => course.courseId === "epicureanism")?.cardState, "no_access_history");

  const page = (await import("../../../app/[locale]/account/my-learning/page")).default;
  const element = await page({ params: Promise.resolve({ locale: "en-GB" }) });
  const { renderToReadableStream } = await import("react-dom/server");
  const stream = await renderToReadableStream(element);
  await stream.allReady;
  const html = await new Response(stream).text();
  const meta = paragraph(html, "overview-course-meta");
  const description = paragraph(html, "overview-course-description");
  const stateLabel = meta.split(" · ").at(-1)?.trim();
  assert.notEqual(stateLabel, description, "no_access_history must not use outsideAccess for both the state label and the description");
});
