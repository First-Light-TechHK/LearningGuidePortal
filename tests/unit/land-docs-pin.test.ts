import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";

// docs/phase1/overlay-forge-issues.md OF-05: the lander must be re-runnable.
// It blindly `git am`ed every patch onto AIOps main, so once the patches
// landed the documented one-liner exited 2. Every run here uses a local bare
// repo as "AIOps"; nothing touches GitHub.

const ROOT = join(__dirname, "..", "..");
const SCRIPT = join(ROOT, "docs", "phase1", "aiops-release", "land-docs-pin.sh");
const PATCH_DIR = join(ROOT, "docs", "phase1", "aiops-release");
const GIT_ENV = {
  ...process.env,
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_AUTHOR_NAME: "t",
  GIT_AUTHOR_EMAIL: "t@example.test",
  GIT_COMMITTER_NAME: "t",
  GIT_COMMITTER_EMAIL: "t@example.test",
};

const tmpRoots: string[] = [];
after(() => {
  for (const dir of tmpRoots) rmSync(dir, { recursive: true, force: true });
});

function git(cwd: string, ...args: string[]): string {
  const result = spawnSync("git", ["-c", "commit.gpgsign=false", ...args], { cwd, env: GIT_ENV, encoding: "utf8" });
  assert.equal(result.status, 0, `git ${args.join(" ")}\n${result.stderr}`);
  return result.stdout.trim();
}

function patchSubject(patchPath: string): string {
  const result = spawnSync("git", ["mailinfo", "/dev/null", "/dev/null"], {
    input: require("node:fs").readFileSync(patchPath),
    env: GIT_ENV,
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr);
  const subject = result.stdout.match(/^Subject: (.+)$/m)?.[1];
  assert.ok(subject, `${patchPath}: no Subject`);
  return subject.trim();
}

function makeFixture(subjects: string[]): { bare: string; work: string } {
  const base = mkdtempSync(join(tmpdir(), "lander-"));
  tmpRoots.push(base);
  const bare = join(base, "aiops.git");
  mkdirSync(bare);
  git(bare, "init", "--bare", "-q", "-b", "main");
  const work = join(base, "seed");
  mkdirSync(work);
  git(work, "init", "-q", "-b", "main");
  writeFileSync(join(work, "README.md"), "# fixture\n");
  git(work, "add", "-A");
  git(work, "commit", "-q", "-m", "init");
  for (const subject of subjects) git(work, "commit", "-q", "--allow-empty", "-m", subject);
  git(work, "remote", "add", "origin", bare);
  git(work, "push", "-q", "origin", "main");
  return { bare, work };
}

function runLander(remote: string, dest: string, extraEnv: Record<string, string> = {}) {
  return spawnSync("bash", [SCRIPT, "--dir", dest], {
    cwd: ROOT,
    env: { ...GIT_ENV, AIOPS_REMOTE: remote, ...extraEnv },
    encoding: "utf8",
  });
}

test("every patch already on main: exit 0 and nothing applied", () => {
  const patches = readdirSync(PATCH_DIR).filter((f) => /^000\d.*\.patch$/.test(f)).sort();
  assert.ok(patches.length >= 8, `expected the 0001-0008 series, got ${patches.length}`);
  const subjects = patches.map((f) => patchSubject(join(PATCH_DIR, f)));
  const { bare } = makeFixture(subjects);
  const dest = join(bare, "..", "dest");
  const result = runLander(bare, dest);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /nothing to apply/);
  assert.match(result.stdout, new RegExp(`skipped ${patches.length} already on origin/main`));
  assert.equal(git(dest, "rev-parse", "HEAD"), git(dest, "rev-parse", "origin/main"));
});

test("a patch missing from main is applied on the landing branch", () => {
  const { bare, work } = makeFixture([]);
  // Author the missing patch from the fixture itself so it applies cleanly.
  git(work, "checkout", "-q", "-b", "author");
  writeFileSync(join(work, "README.md"), "# fixture\n\nmore\n");
  git(work, "commit", "-q", "-am", "docs(docs/agent): fixture patch not yet on main");
  const patchDir = join(work, "..", "patches");
  mkdirSync(patchDir);
  git(work, "format-patch", "-q", "-1", "-o", patchDir, "HEAD");
  const dest = join(bare, "..", "dest");
  const result = runLander(bare, dest, { LG_PATCH_DIR: patchDir });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /applied 1 patch/);
  assert.equal(git(dest, "log", "-1", "--format=%s"), "docs(docs/agent): fixture patch not yet on main");
  assert.equal(git(dest, "rev-parse", "HEAD~1"), git(dest, "rev-parse", "origin/main"));
});
