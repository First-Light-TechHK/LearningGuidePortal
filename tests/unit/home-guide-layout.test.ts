import assert from "node:assert/strict";
import { test } from "node:test";
import { build } from "esbuild";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { renderToStaticMarkup } from "react-dom/server";
import path from "node:path";
import { chromium } from "playwright";

test("homepage title and underline stay centred after removing the Why Us label", async () => {
  const output = path.resolve("test-results/home-guide-layout");
  await mkdir(output, { recursive: true });
  const bundle = await build({
    entryPoints: ["app/[locale]/portal/page.tsx"], bundle: true, write: false,
    outfile: path.join(output, "page.cjs"), platform: "node", format: "cjs", jsx: "automatic",
    external: ["react", "react/jsx-runtime", "/portal/*"], loader: { ".css": "local-css" },
    plugins: [{ name: "homepage-fixtures", setup(b) {
      b.onResolve({ filter: /^(next\/|@\/services\/|@\/components\/portal\/(CatalogueCourseCard|PortalFooter|PortalHeader|BannerCarousel)$)/ }, args => ({ path: args.path, namespace: "fixture" }));
      b.onLoad({ filter: /.*/, namespace: "fixture" }, args => ({ loader: "tsx", contents:
        args.path.endsWith("productStore") ? "export const listPublishedCourses=async()=>[];export const getPortalContent=async()=>({categories:[]});"
        : args.path.endsWith("productAuth") ? "export const currentProductUser=async()=>null;"
        : args.path.endsWith("/s3") ? "export const signCourseMediaUrl=async src=>src;"
        : args.path === "next/image" ? "import React from 'react';export default function Image(props){return <img {...props}/>;}"
        : args.path === "next/link" ? "import React from 'react';export default function Link({prefetch,...props}){return <a {...props}/>;}"
        : `export const ${args.path.split("/").pop()}=()=>null;` }));
    } }],
  });
  const compiled = bundle.outputFiles.find(file => file.path.endsWith(".cjs"))!;
  await writeFile(compiled.path, compiled.text);
  const render = createRequire(import.meta.url)(compiled.path).default;
  const css = bundle.outputFiles.find(file => file.path.endsWith(".css"))!.text;
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.route("http://home.test/**", async route => {
      const pathname = new URL(route.request().url()).pathname;
      await route.fulfill({ body: await readFile(path.join("public", pathname)), contentType: pathname.endsWith("svg") ? "image/svg+xml" : "image/png" });
    });
    for (const locale of ["en-GB", "zh-CN"]) {
      await page.setContent(`<base href="http://home.test/">${renderToStaticMarkup(await render({ params: Promise.resolve({ locale }) }))}`);
      await page.addStyleTag({ content: await readFile("app/styles.css", "utf8") });
      await page.addStyleTag({ content: await readFile("app/portal-design.css", "utf8") });
      await page.addStyleTag({ content: css });
      await page.evaluate(() => document.fonts.ready);
      if (locale === "en-GB") assert.equal(await page.getByRole("heading", { name: "Short Guide", exact: true }).count(), 1);
      assert.equal(await page.locator("#why-us > p").count(), 0);
      for (const width of [1440, 1300, 768, 390]) {
        await page.setViewportSize({ width, height: 1000 });
        const geometry = await page.locator("#why-us").evaluate(section => {
          const box = section.getBoundingClientRect(), title = section.querySelector("h2")!.getBoundingClientRect(), line = section.querySelector("img")!.getBoundingClientRect();
          return { gap: line.top - title.bottom, visible: line.width > 0 && line.height > 0,
            centreOffset: Math.abs((title.top + line.bottom) / 2 - (box.top + box.bottom) / 2),
            inside: line.left >= box.left && line.right <= box.right && line.bottom <= box.bottom };
        });
        assert.ok(geometry.visible && geometry.inside, `${locale}/${width}: underline stays visible inside section`);
        assert.ok(Math.abs(geometry.gap - 12) <= 1, `${locale}/${width}: underline follows the final line`);
        assert.ok(geometry.centreOffset <= 1, `${locale}/${width}: title and underline are vertically centred`);
        await page.locator("#why-us").screenshot({ path: path.join(output, `${locale}-${width}.png`) });
      }
    }
  } finally { await browser.close(); }
});
