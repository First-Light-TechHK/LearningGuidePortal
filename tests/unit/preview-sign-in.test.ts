import assert from "node:assert/strict";
import { test } from "node:test";
import { build } from "esbuild";
import { createRequire } from "node:module";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { getMessages } from "../../lib/i18n/messages";

test("Preview login returns an authenticated visitor to the lesson entry without another form", async () => {
  const state = { user: null as null | { email: string | null; emailVerifiedAt: string | null } };
  (globalThis as any).previewSignInState = state;
  const bundle = await build({
    entryPoints: ["app/[locale]/portal/sign-in/page.tsx"], bundle: true, write: false,
    platform: "node", format: "cjs", jsx: "automatic", external: ["react/jsx-runtime"],
    plugins: [{ name: "page", setup(b) {
      b.onResolve({ filter: /^(next\/|@\/components\/|@\/services\/(productAuth|oauthService))/ }, args => ({ path: args.path, namespace: "mock" }));
      b.onLoad({ filter: /.*/, namespace: "mock" }, args => ({ contents:
        args.path.endsWith("productAuth") ? "export async function currentEmailBindingUser(){return globalThis.previewSignInState.user}"
        : args.path.endsWith("oauthService") ? "export const googleEnabled=()=>false;export const wechatEnabled=()=>false"
        : args.path === "next/navigation" ? "export function redirect(url){throw new Error('redirect:'+url)}"
        : args.path.startsWith("next/") ? "export default 'mock-ui'"
        : `export const ${args.path.split("/").pop()}='mock-ui'`
      }));
    } }],
  });
  await mkdir("test-results/preview-sign-in", { recursive: true });
  const filename = path.resolve("test-results/preview-sign-in/page.cjs");
  await writeFile(filename, bundle.outputFiles[0].text);
  const page = createRequire(import.meta.url)(filename).default;
  try {
    for (const locale of ["en-GB", "zh-CN"] as const) {
      const returnTo = `/${locale}/portal/courses/course?lessonEntry=lesson`;
      const render = (target = returnTo, step?: string) => page({ params: Promise.resolve({ locale }), searchParams: Promise.resolve({ returnTo: target, step }) });
      state.user = null;
      assert.ok(await render(), "guests still see the email step");
      assert.ok(await render(returnTo, "password"), "guests can enter their password");
      state.user = { email: "learner@example.test", emailVerifiedAt: "2026-01-01" };
      for (const step of [undefined, "password"]) await assert.rejects(() => render(returnTo, step), { message: `redirect:${returnTo}` });
      await assert.rejects(() => render("https://external.test/"), { message: `redirect:/${locale}/account/my-learning` });
      state.user = { email: null, emailVerifiedAt: null };
      await assert.rejects(() => render(), { message: `redirect:/${locale}/portal/bind-email?returnTo=${encodeURIComponent(returnTo)}` });
      assert.equal(getMessages(locale).portal.navigation.pricing, locale === "en-GB" ? "Subscription" : "订阅");
    }
  } finally { delete (globalThis as any).previewSignInState; }
});
