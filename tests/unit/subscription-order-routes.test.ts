import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { test } from "node:test";
import { build } from "esbuild";
import { renderToStaticMarkup } from "react-dom/server";

type Route = typeof import("../../app/[locale]/account/my-learning/subscription/page").default;

test("My Subscription hides pending payments while owned order links keep recovery available in both locales", async () => {
  const bundle = await build({
    stdin: { resolveDir: process.cwd(), contents: `
      export { default as subscription } from './app/[locale]/account/my-learning/subscription/page';
      export { default as orders } from './app/[locale]/account/my-learning/subscription/orders/page';
    ` }, bundle: true, write: false, platform: "node", format: "cjs", jsx: "automatic", external: ["react/jsx-runtime"],
    plugins: [{ name: "route-fixtures", setup(build) {
      build.onResolve({ filter: /^next\/navigation$|services\/(productStore|productAuth|orderPaymentService|subscriptionPresentationService)$|components\/portal\/(AccountNav|PortalHeader|PortalFooter|PendingOrders|SubscriptionManager)$/ }, args => ({ path: args.path.split("/").at(-1)!, namespace: "fixture" }));
      build.onLoad({ filter: /.*/, namespace: "fixture" }, ({ path }) => {
        const state = "globalThis.subscriptionOrderRoutes";
        const contents: Record<string, string> = {
          navigation: "export function redirect(url) { throw new Error(url) }",
          productAuth: `export async function currentProductUser() { return ${state}.user }`,
          productStore: `export async function getLearningOverview(id) { return { subscriptions: [], orders: ${state}.orders.filter(order => order.userId === id) } }`,
          orderPaymentService: `export async function listManagedOrders(id) { ${state}.listRequests.push(id); return ${state}.orders.filter(order => order.userId === id) }`,
          subscriptionPresentationService: "export async function presentSubscriptionOrders(orders) { return orders }",
          PendingOrders: "export const PendingOrders = ({ initialOrders, returnOrderId }) => <section data-orders={initialOrders.map(order => order.id).join(',')} data-selected={returnOrderId} />",
          SubscriptionManager: "export const SubscriptionManager = ({ initialOrders }) => <section data-payment-history={initialOrders.map(order => order.id).join(',')} />"
        };
        return { loader: "tsx", resolveDir: process.cwd(), contents: contents[path] ?? `export const ${path} = () => null` };
      });
    } }]
  });
  const routeModule = { exports: {} as { subscription: Route; orders: Route } };
  new Function("require", "module", "exports", bundle.outputFiles[0].text)(createRequire(import.meta.url), routeModule, routeModule.exports);
  const { subscription, orders } = routeModule.exports;
  const state = {
    user: { id: "learner", nickname: "Learner" } as { id: string; nickname: string } | null,
    orders: [
      { id: "pending order", userId: "learner", status: "pending" }, { id: "paid", userId: "learner", status: "paid" },
      { id: "closed", userId: "learner", status: "canceled" }, { id: "foreign", userId: "other", status: "pending" }
    ],
    listRequests: [] as string[]
  };
  const fixture = globalThis as typeof globalThis & { subscriptionOrderRoutes?: typeof state };
  fixture.subscriptionOrderRoutes = state;
  try {
    for (const locale of ["en-GB", "zh-CN"]) {
      const invoke = (route: Route, orderId?: string) => route({ params: Promise.resolve({ locale }), searchParams: Promise.resolve({ orderId }) });
      const base = `/${locale}/account/my-learning/subscription`;
      const target = `${base}/orders?orderId=pending%20order`;
      for (const selection of [undefined, "paid", "foreign"]) {
        const html = renderToStaticMarkup(await invoke(subscription, selection));
        assert.match(html, /data-payment-history="paid,closed"/);
        assert.doesNotMatch(html, /data-orders|pending order|foreign/);
      }
      assert.equal(state.listRequests.length, 0);
      await assert.rejects(invoke(subscription, "pending order"), { message: target });
      await assert.rejects(invoke(subscription, "closed"), { message: `${base}/orders?orderId=closed` });
      const html = renderToStaticMarkup(await invoke(orders, "pending order"));
      assert.match(html, /data-selected="pending order"/);
      assert.doesNotMatch(html, /foreign/);
      assert.doesNotMatch(renderToStaticMarkup(await invoke(orders, "foreign")), /data-selected|foreign/);
      await assert.rejects(invoke(orders, "paid"), { message: base });
      state.listRequests.length = 0;

      const signedIn = state.user;
      state.user = null;
      await assert.rejects(invoke(orders, "pending order"), { message: `/${locale}/portal/sign-in?returnTo=${encodeURIComponent(target)}` });
      assert.equal(state.listRequests.length, 0);
      state.user = signedIn;
    }
  } finally {
    delete fixture.subscriptionOrderRoutes;
  }
});
