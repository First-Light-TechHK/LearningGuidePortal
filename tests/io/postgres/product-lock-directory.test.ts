import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, rm, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

// Run only against an explicitly supplied disposable database.
test('PostgreSQL product writes do not require a local lock directory', {skip: !process.env.NOTIFICATION_QA_DATABASE_URL}, async () => {
  const original = process.cwd();
  const directory = await mkdtemp(path.join(tmpdir(), 'lg-pg-lock-test-'));
  process.chdir(directory);
  process.env.DATABASE_URL = process.env.NOTIFICATION_QA_DATABASE_URL;
  process.env.DATA_S3_BUCKET = 'local-test-only';
  process.env.STORAGE_BACKEND = 'postgres';
  try {
    const { editProductData } = await import('../../../services/productStore');
    await editProductData(data => data.users.length);
    await assert.rejects(access(path.join(directory, 'data/knowledge_system/learning_guide/product.json.lock')));
  } finally {
    const { getPool } = await import('../../../services/persistence/db');
    await getPool().end();
    process.chdir(original);
    await rm(directory,{recursive:true,force:true});
  }
});
