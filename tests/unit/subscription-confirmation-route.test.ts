import assert from "node:assert/strict";
import { test } from "node:test";
import { createRequire } from "node:module";
import { build } from "esbuild";
import { getMessages } from "../../lib/i18n/messages";
import { defaultPortalContent } from "../../lib/portalContent";

test("confirmation route authenticates before resolving the caller's quote and passes server presentation data", async () => {
  const state = { user: null as { id: string } | null, result: null as any, calls: [] as string[] };
  (globalThis as any).confirmationRoute = { state, categories: defaultPortalContent.categories };
  try {
    const bundle = await build({ entryPoints: ["app/[locale]/portal/subscription/confirmation/page.tsx"], bundle: true, write: false, platform: "node", format: "cjs", jsx: "automatic", external: ["react/jsx-runtime"], plugins: [{ name: "route", setup(b) {
      b.onResolve({ filter: /next\/navigation|services\/(productAuth|productStore)$|components\/portal\/SubscriptionConfirmation$|app\/\[locale\]\/subscription\/page$/ }, args => ({ path: args.path, namespace: "mock" }));
      b.onLoad({ filter: /.*/, namespace: "mock" }, args => ({ contents:
        args.path === "next/navigation" ? "export function redirect(url){throw new Error('redirect:'+url)}"
          : args.path.endsWith("productAuth") ? "export async function currentProductUser(){return globalThis.confirmationRoute.state.user}"
          : args.path.endsWith("productStore") ? "export async function getQuoteForUser(user,id){globalThis.confirmationRoute.state.calls.push(user+':'+id);return globalThis.confirmationRoute.state.result};export async function getPortalContent(){return {categories:globalThis.confirmationRoute.categories}}"
          : args.path.endsWith("SubscriptionConfirmation") ? "export const SubscriptionConfirmation=()=>null"
          : "export default ()=>null" }));
    } }] });
    const routeModule = { exports: {} as { default: (props: any) => Promise<any> } };
    new Function("require", "module", "exports", bundle.outputFiles[0].text)(createRequire(import.meta.url), routeModule, routeModule.exports);
    const invoke = (locale = "en-GB") => routeModule.exports.default({ params: Promise.resolve({ locale }), searchParams: Promise.resolve({ quoteId: "owned-quote", userId: "forged" }) });
    await assert.rejects(invoke(), /redirect:.*sign-in\?returnTo=/); assert.deepEqual(state.calls, []);
    state.user = { id: "owner" };
    await assert.rejects(invoke(), /redirect:\/en-GB\/subscription$/); assert.deepEqual(state.calls, ["owner:owned-quote"]);
    for (const locale of ["en-GB", "zh-CN"] as const) for (const kind of ["category", "everything", "upgrade"]) {
      state.result = { quote: { id: "owned-quote", createdAt: "2026-10-13T00:00:00Z", kind: kind === "upgrade" ? "upgrade" : "purchase", upgradeProration: kind === "upgrade" ? { periodEnd: Date.parse("2027-02-01T00:00:00Z") / 1000, prorationDate: Date.parse("2026-10-14T00:00:00Z") / 1000 } : undefined }, plan: { id: "plan", scope: kind === "category" ? "category" : "everything", scopeId: "Science", termMonths: 6, aiPoints: 1500 }, sourceSubscription: kind === "upgrade" ? { validTo: "2027-02-03T00:00:00Z" } : undefined, sourcePlan: kind === "upgrade" ? { scopeId: "Science", aiPoints: 500 } : undefined };
      const page = await invoke(locale), props = page.props.children[1].props;
      assert.equal(state.calls.at(-1), "owner:owned-quote");
      assert.equal(props.display.categoryCount, 3);
      assert.equal(props.display.planKind, kind === "category" ? "category" : "everything");
      assert.equal(props.planHeading, kind === "category" ? getMessages(locale).pricingDesign.category : getMessages(locale).pricingDesign.everything);
      if (kind === "category") assert.equal(props.planSubtitle, locale === "en-GB" ? "Science" : "科学");
      if (kind === "upgrade") {
        assert.equal(props.display.upgrade.sourceCategory, locale === "en-GB" ? "Science" : "科学");
        assert.equal(props.display.upgrade.renewsAt, "2027-02-01T00:00:00.000Z");
        assert.equal(props.display.upgrade.remainingDays, 110);
      }
    }
  } finally { delete (globalThis as any).confirmationRoute; }
});
