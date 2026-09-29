import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { postgresSsl } from "../../services/persistence/db";

const originalDisable = process.env.DATABASE_SSL;
const originalCa = process.env.DATABASE_CA_FILE;

afterEach(() => {
  if (originalDisable === undefined) delete process.env.DATABASE_SSL;
  else process.env.DATABASE_SSL = originalDisable;
  if (originalCa === undefined) delete process.env.DATABASE_CA_FILE;
  else process.env.DATABASE_CA_FILE = originalCa;
});

test("App Runner RDS SSL does not require Node to trust Amazon's CA", () => {
  delete process.env.DATABASE_SSL;
  delete process.env.DATABASE_CA_FILE;
  assert.deepEqual(postgresSsl("postgresql://example.test/learning_guide"), { rejectUnauthorized: false });
});

test("DATABASE_SSL=0 disables TLS", () => {
  process.env.DATABASE_SSL = "0";
  delete process.env.DATABASE_CA_FILE;
  assert.equal(postgresSsl("postgresql://example.test/learning_guide"), undefined);
});
