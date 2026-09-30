import assert from "node:assert/strict";
import { test } from "node:test";
import { build } from "esbuild";
import { chromium } from "playwright";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

test("streamed content retains the server DOM when a Flight child resolves during hydration replay", async () => {
  // Reproduce react/react#37584 with the renderer actually shipped by Next,
  // not the unrelated top-level react-dom package. No network timing or sleeps.
  const bundle = await build({
    stdin: { contents: `
      import React from 'react';
      import { hydrateRoot } from 'next/dist/compiled/react-dom/client';
      import { StreamedContent } from './components/portal/StreamedContent';
      window.probe = (protectedHost, siblings) => {
        const errors = [];
        const original = document.querySelector('#target');
        const child = React.lazy(() => {
          const callbacks = [];
          const chunk = { status: 'pending', value: null, then: callback => {
            if (chunk.status === 'fulfilled') callback(chunk.value);
            else callbacks.push(callback);
          }};
          queueMicrotask(() => {
            chunk.value = { default: React.createElement('section', { id: 'child' }, 'Lesson') };
            chunk.status = 'fulfilled';
            callbacks.forEach(callback => callback(chunk.value));
          });
          return chunk;
        });
        function App() {
          React.useEffect(() => { window.hydrationDone = true; }, []);
          const children = siblings
            ? [React.createElement('header', {key:'header'}, 'Course'), child]
            : child;
          return React.createElement('main', { id: 'target' },
            protectedHost ? StreamedContent({children}) : children);
        }
        window.hydrationResult = () => ({ errors, preserved: original === document.querySelector('#target'),
          html: document.querySelector('#target').innerHTML });
        React.startTransition(() => hydrateRoot(document.querySelector('#root'), React.createElement(App), {
          onRecoverableError: error => errors.push(error.message)
        }));
      };
    `, resolveDir: process.cwd(), loader: "tsx" },
    bundle: true, write: false, platform: "browser", jsx: "automatic",
    alias: { react: resolve("node_modules/next/dist/compiled/react") },
    define: { "process.env.NODE_ENV": '"production"' },
  });
  const browser = await chromium.launch({ headless: true });
  try {
    for (const siblings of [false, true]) {
      for (const protectedHost of [false, true]) {
        const html = `${siblings ? '<header>Course</header>' : ''}<section id="child">Lesson</section>`;
        for (let run = 0; run < 10; run++) {
          const page = await browser.newPage();
          const pageErrors: string[] = [];
          page.on("pageerror", error => pageErrors.push(error.message));
          await page.setContent(`<div id="root"><main id="target">${html}</main></div>`);
          await page.addScriptTag({ content: bundle.outputFiles[0].text });
          await page.evaluate(({ protectedHost, siblings }) => {
            (window as unknown as { probe: (a: boolean, b: boolean) => void }).probe(protectedHost, siblings);
          }, { protectedHost, siblings });
          await page.waitForFunction(() => (window as unknown as { hydrationDone: boolean }).hydrationDone);
          const result = await page.evaluate(() => (window as unknown as {
            hydrationResult: () => { errors: string[]; preserved: boolean; html: string };
          }).hydrationResult());
          assert.deepEqual(pageErrors, []);
          assert.equal(result.html, html);
          if (protectedHost) {
            assert.deepEqual(result.errors, []);
            assert.equal(result.preserved, true);
          } else {
            // Deliberate red control: revisiting this assertion is required when
            // upgrading Next to a renderer containing the upstream repair.
            assert.ok(result.errors.some(error => error.includes('#418')));
            assert.equal(result.preserved, false);
          }
          await page.close();
        }
      }
    }
  } finally { await browser.close(); }
});

test("course page and layout host elements keep the streamed-content boundary", async () => {
  for (const file of ["app/layout.tsx", "app/[locale]/layout.tsx",
    "app/[locale]/portal/courses/page.tsx", "app/[locale]/portal/courses/[slug]/page.tsx"]) {
    const source = await readFile(resolve(file), "utf8");
    assert.match(source, /<StreamedContent>/, file);
    assert.match(source, /<\/StreamedContent>/, file);
  }
});
