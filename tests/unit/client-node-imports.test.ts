import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { builtinModules } from "node:module";
import { dirname, join, relative, resolve } from "node:path";
import test from "node:test";

// 2026-11-02: a Help Centre value import (HELP_POPULAR_SHOWN from
// modules/helpdesk/helpCentre.ts) pulled contracts/helpdesk.ts -> lib/uuidv7.ts
// -> node:crypto into the browser bundle and the page failed to build. Unit
// tests and tsc cannot see that, so this walks every client component's value
// imports (type-only imports are erased) and fails on any Node built-in.

const ROOT = resolve(__dirname, "../..");
const SCOPES = ["components/helpdesk", "components/portal"];
const NODE = new Set([...builtinModules, ...builtinModules.map((name) => `node:${name}`)]);

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? files(path) : /\.(tsx?|mts)$/.test(name) ? [path] : [];
  });
}

function resolveImport(from: string, specifier: string): string | null {
  const base = specifier.startsWith("@/") ? join(ROOT, specifier.slice(2)) : specifier.startsWith(".") ? resolve(dirname(from), specifier) : null;
  if (!base) return null;
  for (const candidate of [base, `${base}.ts`, `${base}.tsx`, join(base, "index.ts"), join(base, "index.tsx")]) {
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
  }
  return null;
}

/** Specifiers a file imports or re-exports as values (not `import type` / `export type`, not all-`type` braces). */
function valueImports(source: string): string[] {
  const out: string[] = [];
  const statement = /(?:^|\n)\s*(import|export)\s+(type\s+)?([^;]*?)\s*from\s*["']([^"']+)["']|(?:^|\n)\s*import\s*["']([^"']+)["']/g;
  for (const match of source.matchAll(statement)) {
    if (match[5]) { out.push(match[5]); continue; }
    if (match[2]) continue;
    const clause = match[3].trim();
    const braces = clause.match(/^\{([\s\S]*)\}$/);
    if (braces && braces[1].split(",").map((part) => part.trim()).filter(Boolean).every((part) => part.startsWith("type "))) continue;
    out.push(match[4]);
  }
  return out;
}

function nodeChain(entry: string): string[] | null {
  const seen = new Set<string>();
  const walk = (file: string, chain: string[]): string[] | null => {
    if (seen.has(file)) return null;
    seen.add(file);
    for (const specifier of valueImports(readFileSync(file, "utf8"))) {
      if (NODE.has(specifier)) return [...chain, specifier];
      const next = resolveImport(file, specifier);
      if (!next || /\.(css|json)$/.test(next)) continue;
      const found = walk(next, [...chain, relative(ROOT, next)]);
      if (found) return found;
    }
    return null;
  };
  return walk(entry, [relative(ROOT, entry)]);
}

test("client components never reach a Node built-in through their value imports", () => {
  const clients = SCOPES.flatMap((scope) => files(join(ROOT, scope))).filter((file) => /^\s*["']use client["']/.test(readFileSync(file, "utf8")));
  assert.ok(clients.length > 5, "found the client components");
  const broken = clients.map((file) => nodeChain(file)).filter((chain): chain is string[] => chain !== null);
  assert.deepEqual(broken, []);
});

test("the walker sees through value imports and skips type-only ones", () => {
  assert.deepEqual(valueImports('import type { A } from "@/x";\nimport { type B } from "@/y";\nimport { C, type D } from "@/z";\nexport { E } from "./e";\nimport "./side";'), ["@/z", "./e", "./side"]);
  assert.ok(nodeChain(join(ROOT, "modules/helpdesk/helpCentre.ts"))?.includes("node:crypto"), "helpCentre.ts itself is server-only");
});
