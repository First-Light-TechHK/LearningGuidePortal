import { execFileSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { release } from 'node:os';
import type { Page } from 'playwright';

export async function browserAssertionEvidence(page: Page, directory: string, name: string, testFile: string, details: object) {
  let commit = process.env.GITHUB_SHA || 'unavailable';
  try { commit = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8', timeout: 1000, stdio: ['ignore', 'pipe', 'ignore'] }).trim(); }
  catch { /* A source archive can omit Git metadata. */ }
  const base = directory + '/' + name;
  const record = {
    commit, browser: page.context().browser()?.version(), os: process.platform,
    osRelease: release(), arch: process.arch, node: process.version,
    viewport: page.viewportSize(), rerun: 'node --import tsx --test ' + testFile,
    ...details,
  };
  try {
    await mkdir(directory, { recursive: true });
    await writeFile(base + '.json', JSON.stringify(record, null, 2) + '\n');
    await page.screenshot({ path: base + '.png', timeout: 3000 });
    return base + '.json';
  } catch (error) {
    return 'evidence capture incomplete: ' + String(error);
  }
}
