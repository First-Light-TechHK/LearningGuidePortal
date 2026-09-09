import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

// Break: BACKOFFICE_OPERATOR_EMAIL match on register/Google, or a live
// email compare in isOperator, grants Operator (AUTH-04 / API-AUTH-003).

const COLLISION_EMAIL = "auth-04-collision@example.test";

const originalCwd = process.cwd();
const originalStorageBackend = process.env.STORAGE_BACKEND;
const originalOperatorEmail = process.env.BACKOFFICE_OPERATOR_EMAIL;
let isolatedCwd: string;
let store: typeof import("../../services/productStore");

before(async () => {
  isolatedCwd = await mkdtemp(path.join(tmpdir(), "lg-auth-04-"));
  process.chdir(isolatedCwd);
  process.env.STORAGE_BACKEND = "local";
  process.env.BACKOFFICE_OPERATOR_EMAIL = COLLISION_EMAIL;
  store = await import("../../services/productStore");
});

after(async () => {
  process.chdir(originalCwd);
  if (originalStorageBackend === undefined) delete process.env.STORAGE_BACKEND;
  else process.env.STORAGE_BACKEND = originalStorageBackend;
  if (originalOperatorEmail === undefined) delete process.env.BACKOFFICE_OPERATOR_EMAIL;
  else process.env.BACKOFFICE_OPERATOR_EMAIL = originalOperatorEmail;
  if (isolatedCwd && path.dirname(isolatedCwd) === tmpdir()) {
    await rm(isolatedCwd, { recursive: true, force: true });
  }
});

test("AUTH-04: registering the operator email stays a student", async () => {
  const user = await store.registerUser({
    email: COLLISION_EMAIL,
    password: "password1",
    nickname: "Auth Four",
  });
  assert.equal(user.role, "student");
  assert.equal(store.isOperator(user), false);
});

test("AUTH-04: Google signup with the operator email stays a student", async () => {
  const googleEmail = "auth-04-google-ops@example.test";
  process.env.BACKOFFICE_OPERATOR_EMAIL = googleEmail;
  const user = await store.getOrCreateSocialUser({
    provider: "google",
    email: googleEmail,
    providerSubject: "auth-04-google-sub",
    nickname: "Auth Four",
    locale: "en-GB",
  });
  assert.equal(user.role, "student");
  assert.equal(store.isOperator(user), false);
});

test("AUTH-04: isOperator does not promote a student when env email matches", async () => {
  const user = await store.registerUser({
    email: "auth-04-live@example.test",
    password: "password1",
    nickname: "Auth Four",
  });
  process.env.BACKOFFICE_OPERATOR_EMAIL = user.email || "";
  assert.equal(user.role, "student");
  assert.equal(store.isOperator(user), false);
});
