import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { isolateProductStore, mockModule, verifiedUser } from "./helpers";

// Outside tests/unit/*.test.ts so test:ci / Verify does not run this lock.

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
    usePathname: () => "/",
    useSearchParams: () => new URLSearchParams(),
  },
});

let isolated: Awaited<ReturnType<typeof isolateProductStore>>;

before(async () => {
  isolated = await isolateProductStore();
});

after(async () => {
  await isolated.restore();
});

test("BUG: fulfilling an Everything purchase leaves the epicureanism trial subscription active", async () => {
  const { store } = isolated;
  const user = await verifiedUser(store, "everything-hides-trial@example.test");
  sessionToken = (await store.createSession(user.id)).token;
  const trialOrder = await store.createPendingDemoTrialOrder(user.id, "epicureanism-pc-6");
  await store.completeDemoTrialOrder(user.id, trialOrder.order.id);
  const duringTrial = await store.checkEntitlement(user.id, "epicureanism");
  assert.equal(duringTrial.allowed, true);
  assert.equal(duringTrial.source, "trial");

  const quote = await store.createQuote(user.id, "everything-pc-6");
  const purchase = await store.createPendingDemoOrder(user.id, quote.quote.id);
  await store.completeDemoOrder(user.id, purchase.order.id);

  const data = await store.ensureProductData();
  const liveTrialEntitlement = data.entitlements.find((item) => item.userId === user.id && item.source === "trial" && item.state === "active");
  assert.equal(liveTrialEntitlement, undefined, "the broader purchase already removed the trial entitlement");

  const route = await import("../../../app/api/subscription/route");
  const response = await route.GET();
  assert.equal(response.status, 200);
  const body = await response.json() as {
    ok: boolean;
    subscriptions: Array<{ source: string; state: string; validTo: string; planId?: string; plan?: { id?: string; name?: string } | null }>;
  };
  assert.equal(body.ok, true);
  const activeCourseTrial = body.subscriptions.find((item) => item.source === "trial" && (item.plan?.id === "epicureanism-pc-6" || item.planId === "epicureanism-pc-6") && item.state === "active" && new Date(item.validTo) > new Date());
  assert.equal(activeCourseTrial, undefined, `GET /api/subscription still presents the epicureanism trial as Trial / valid (${JSON.stringify(activeCourseTrial)})`);
});
