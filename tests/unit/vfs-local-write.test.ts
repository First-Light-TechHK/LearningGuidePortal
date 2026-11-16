import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { vfsWriteText } from "../../services/persistence/vfs";

test("local atomic writes retry transient Windows replacement locks and preserve the old file on failure", async (t) => {
  const directory = await fs.mkdtemp(path.join(tmpdir(), "portal-vfs-"));
  const file = path.join(directory, "value.json");
  const previous = { ...process.env };
  const rename = fs.rename;
  process.env.STORAGE_BACKEND = "local";
  process.env.APP_ENV = "DEV";
  delete process.env.DATABASE_URL;
  try {
    await fs.writeFile(file, "old\n");
    let calls = 0;
    const replacement = t.mock.method(fs, "rename", async (from: string, to: string) => {
      calls++;
      if (calls === 1 && process.platform === "win32") throw Object.assign(new Error("locked"), { code: "EPERM" });
      return rename(from, to);
    });
    await vfsWriteText(directory, file, "new");
    assert.equal(await fs.readFile(file, "utf8"), "new\n");
    assert.equal(calls, process.platform === "win32" ? 2 : 1);
    replacement.mock.mockImplementation(async () => { throw Object.assign(new Error("denied"), { code: "EACCES" }); });
    await assert.rejects(vfsWriteText(directory, file, "lost"), { code: "EACCES" });
    assert.equal(await fs.readFile(file, "utf8"), "new\n");
    assert.deepEqual(await fs.readdir(directory), ["value.json"]);
    replacement.mock.restore();
  } finally {
    t.mock.restoreAll();
    for (const key of Object.keys(process.env)) if (!(key in previous)) delete process.env[key];
    Object.assign(process.env, previous);
    await fs.rm(directory, { recursive: true, force: true });
  }
});
