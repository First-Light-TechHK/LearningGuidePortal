import path from "node:path";
import { PRODUCT_DOCS, PRODUCT_TABLES, type Identified, type MigrationOrm } from "./migrationOrm";

export type OrmOp =
  | { kind: "table"; action: "insert" | "update" | "upsert"; table: string; id: string; row: Identified }
  | { kind: "doc"; action: "set" | "patch"; name: string; value: unknown }
  | { kind: "file"; action: "write"; path: string; text: string; contentType: string };

export type CompiledSql = { text: string; values: unknown[] };

export type CompiledObject = {
  relativePath: string;
  key: string;
  body: Buffer;
  contentType: string;
};

export type OrmPlan = {
  sql: CompiledSql[];
  objects: CompiledObject[];
  productTouched: boolean;
};

export type SqlClient = {
  query: (text: string, values?: unknown[]) => Promise<{ rows: Array<Record<string, unknown>> }>;
};

export type ObjectPut = (relativePath: string, body: Buffer, contentType: string) => Promise<string>;

const FILE_ROOT = "learning_guide/orm";
const BINARY_EXT = new Set([".pdf", ".doc", ".docx", ".png", ".jpg", ".jpeg", ".gif", ".zip", ".bin"]);
const TEXT_DB_MAX_BYTES = 512 * 1024;

export const ORM_RUNTIME_DDL = `
CREATE TABLE IF NOT EXISTS data_migrations (
  id TEXT PRIMARY KEY,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS orm_rows (
  table_name TEXT NOT NULL,
  id TEXT NOT NULL,
  payload JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (table_name, id)
);
`;

function guessContentType(filePath: string) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".json") return "application/json";
  if (ext === ".md") return "text/markdown";
  if (ext === ".txt") return "text/plain";
  if (ext === ".html") return "text/html";
  if (ext === ".pdf") return "application/pdf";
  if (ext === ".png") return "image/png";
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  return "text/plain; charset=utf-8";
}

function shouldUseS3(relativePath: string, bytes: Buffer) {
  const ext = path.extname(relativePath).toLowerCase();
  return BINARY_EXT.has(ext) || bytes.byteLength > TEXT_DB_MAX_BYTES;
}

function appFilePath(ormPath: string) {
  return `${FILE_ROOT}/${ormPath.replace(/^\/+/, "")}`;
}

export function recordOrm(base: MigrationOrm): { orm: MigrationOrm; ops: OrmOp[] } {
  const ops: OrmOp[] = [];
  const tables = new Map<string, unknown>();
  const docs = new Map<string, unknown>();
  const orm: MigrationOrm = {
    table<T extends Identified>(name: string) {
      const cached = tables.get(name);
      if (cached) return cached as ReturnType<typeof base.table<T>>;
      const inner = base.table<T>(name);
      const wrapped = {
        all: () => inner.all(),
        findById: (id: string) => inner.findById(id),
        find: (predicate: (row: T) => boolean) => inner.find(predicate),
        insert(row: T) {
          const result = inner.insert(row);
          ops.push({ kind: "table", action: "insert", table: name, id: row.id, row: result });
          return result;
        },
        update(id: string, patch: Partial<T>) {
          const result = inner.update(id, patch);
          ops.push({ kind: "table", action: "update", table: name, id, row: result });
          return result;
        },
        upsert(row: T) {
          const action = inner.upsert(row);
          ops.push({ kind: "table", action: "upsert", table: name, id: row.id, row: inner.findById(row.id) || row });
          return action;
        },
      };
      tables.set(name, wrapped as never);
      return wrapped;
    },
    doc<T>(name: string) {
      const cached = docs.get(name);
      if (cached) return cached as ReturnType<typeof base.doc<T>>;
      const inner = base.doc<T>(name);
      const wrapped = {
        get: () => inner.get(),
        set(value: T) {
          inner.set(value);
          ops.push({ kind: "doc", action: "set", name, value });
        },
        patch(partial: Partial<T>) {
          const next = inner.patch(partial);
          ops.push({ kind: "doc", action: "patch", name, value: next });
          return next;
        },
      };
      docs.set(name, wrapped as never);
      return wrapped;
    },
    files: {
      readText: (filePath) => base.files.readText(filePath),
      readJson: (filePath) => base.files.readJson(filePath),
      writeText(filePath, text) {
        base.files.writeText(filePath, text);
        ops.push({ kind: "file", action: "write", path: filePath, text, contentType: guessContentType(filePath) });
      },
      writeJson(filePath, value) {
        const text = JSON.stringify(value);
        base.files.writeJson(filePath, value);
        ops.push({ kind: "file", action: "write", path: filePath, text, contentType: "application/json" });
      },
      exists: (filePath) => base.files.exists(filePath),
      changed: () => base.files.changed(),
      list: () => base.files.list(),
    },
    extraTables: () => base.extraTables(),
    snapshot: (name) => base.snapshot(name),
  };
  return { orm, ops };
}

export function compileOrmOps(ops: OrmOp[], options: { s3Prefix?: string } = {}): OrmPlan {
  const prefix = (options.s3Prefix || "learning-guide/dev").replace(/^\/+|\/+$/g, "");
  const sql: CompiledSql[] = [];
  const objects: CompiledObject[] = [];
  let productTouched = false;

  for (const op of ops) {
    if (op.kind === "table") {
      if (op.table === "_data_migrations") {
        sql.push({
          text: "INSERT INTO data_migrations (id) VALUES ($1) ON CONFLICT (id) DO NOTHING",
          values: [op.id],
        });
        continue;
      }
      if ((PRODUCT_TABLES as readonly string[]).includes(op.table)) {
        productTouched = true;
        sql.push({
          text: "INSERT INTO orm_rows (table_name, id, payload, updated_at) VALUES ($1, $2, $3::jsonb, NOW()) ON CONFLICT (table_name, id) DO UPDATE SET payload = EXCLUDED.payload, updated_at = NOW()",
          values: [op.table, op.id, JSON.stringify(op.row)],
        });
        continue;
      }
      sql.push({
        text: "INSERT INTO orm_rows (table_name, id, payload, updated_at) VALUES ($1, $2, $3::jsonb, NOW()) ON CONFLICT (table_name, id) DO UPDATE SET payload = EXCLUDED.payload, updated_at = NOW()",
        values: [op.table, op.id, JSON.stringify(op.row)],
      });
      continue;
    }
    if (op.kind === "doc") {
      if ((PRODUCT_DOCS as readonly string[]).includes(op.name)) {
        productTouched = true;
        sql.push({
          text: "INSERT INTO orm_rows (table_name, id, payload, updated_at) VALUES ($1, $2, $3::jsonb, NOW()) ON CONFLICT (table_name, id) DO UPDATE SET payload = EXCLUDED.payload, updated_at = NOW()",
          values: [`doc:${op.name}`, op.name, JSON.stringify(op.value)],
        });
        continue;
      }
      sql.push({
        text: "INSERT INTO orm_rows (table_name, id, payload, updated_at) VALUES ($1, $2, $3::jsonb, NOW()) ON CONFLICT (table_name, id) DO UPDATE SET payload = EXCLUDED.payload, updated_at = NOW()",
        values: [`doc:${op.name}`, op.name, JSON.stringify(op.value)],
      });
      continue;
    }
    const relativePath = appFilePath(op.path);
    const body = Buffer.from(op.text, "utf8");
    if (shouldUseS3(relativePath, body)) {
      const key = `${prefix}/${relativePath}`;
      objects.push({ relativePath, key, body, contentType: op.contentType });
      sql.push({
        text: "INSERT INTO app_files (path, storage, content, s3_key, byte_size, content_type, updated_at) VALUES ($1, 's3', NULL, $2, $3, $4, NOW()) ON CONFLICT (path) DO UPDATE SET storage = 's3', content = NULL, s3_key = EXCLUDED.s3_key, byte_size = EXCLUDED.byte_size, content_type = EXCLUDED.content_type, updated_at = NOW()",
        values: [relativePath, key, body.byteLength, op.contentType],
      });
    } else {
      sql.push({
        text: "INSERT INTO app_files (path, storage, content, s3_key, byte_size, content_type, updated_at) VALUES ($1, 'db', $2, NULL, $3, $4, NOW()) ON CONFLICT (path) DO UPDATE SET storage = 'db', content = EXCLUDED.content, s3_key = NULL, byte_size = EXCLUDED.byte_size, content_type = EXCLUDED.content_type, updated_at = NOW()",
        values: [relativePath, op.text, body.byteLength, op.contentType],
      });
    }
  }

  return { sql, objects, productTouched };
}

export async function ensureOrmRuntime(db: SqlClient) {
  await db.query(ORM_RUNTIME_DDL);
}

export async function hydrateOrmFromSql(data: Record<string, unknown>, db: SqlClient) {
  const extras = (data.ormExtras as { tables?: Record<string, Identified[]>; files?: Record<string, string> }) || { tables: {}, files: {} };
  extras.tables ||= {};
  extras.files ||= {};
  data.ormExtras = extras;

  const ledger = await db.query("SELECT id FROM data_migrations");
  const ids = [...((data.dataMigrations as string[]) || []), ...ledger.rows.map((row) => String(row.id))];
  data.dataMigrations = [...new Set(ids)];
  data.catalogueMigrations = [...new Set([...((data.catalogueMigrations as string[]) || []), ...ids])];

  const rows = await db.query("SELECT table_name, id, payload FROM orm_rows");
  for (const row of rows.rows) {
    const tableName = String(row.table_name);
    const payload = (typeof row.payload === "string" ? JSON.parse(row.payload) : row.payload) as Identified;
    if (tableName.startsWith("doc:")) {
      data[tableName.slice(4)] = payload;
      continue;
    }
    if ((PRODUCT_TABLES as readonly string[]).includes(tableName)) {
      const list = Array.isArray(data[tableName]) ? [...(data[tableName] as Identified[])] : [];
      const index = list.findIndex((item) => item.id === payload.id);
      if (index < 0) list.push(payload);
      else list[index] = payload;
      data[tableName] = list;
      continue;
    }
    const list: Identified[] = extras.tables[tableName] || [];
    const index = list.findIndex((item: Identified) => item.id === payload.id);
    if (index < 0) list.push(payload);
    else list[index] = payload;
    extras.tables[tableName] = list;
  }

  const files = await db.query("SELECT path, storage, content FROM app_files WHERE path LIKE $1 AND storage = 'db'", [`${FILE_ROOT}/%`]);
  for (const file of files.rows) {
    const relative = String(file.path).slice(FILE_ROOT.length + 1);
    extras.files[relative] = String(file.content || "");
  }
}

export async function persistProductSnapshot(data: Record<string, unknown>, db: SqlClient) {
  for (const table of PRODUCT_TABLES) {
    const rows = Array.isArray(data[table]) ? (data[table] as Identified[]) : [];
    const ids = rows.map((row) => row.id);
    if (!ids.length) {
      await db.query("DELETE FROM orm_rows WHERE table_name = $1", [table]);
    } else {
      await db.query("DELETE FROM orm_rows WHERE table_name = $1 AND NOT (id = ANY($2::text[]))", [table, ids]);
      for (const row of rows) {
        await db.query(
          "INSERT INTO orm_rows (table_name, id, payload, updated_at) VALUES ($1, $2, $3::jsonb, NOW()) ON CONFLICT (table_name, id) DO UPDATE SET payload = EXCLUDED.payload, updated_at = NOW()",
          [table, row.id, JSON.stringify(row)],
        );
      }
    }
  }
  for (const name of PRODUCT_DOCS) {
    if (!(name in data) || data[name] == null) continue;
    await db.query(
      "INSERT INTO orm_rows (table_name, id, payload, updated_at) VALUES ($1, $2, $3::jsonb, NOW()) ON CONFLICT (table_name, id) DO UPDATE SET payload = EXCLUDED.payload, updated_at = NOW()",
      [`doc:${name}`, name, JSON.stringify(data[name])],
    );
  }
}

export async function executeOrmPlan(plan: OrmPlan, db: SqlClient, putObject?: ObjectPut) {
  for (const statement of plan.sql) {
    await db.query(statement.text, statement.values);
  }
  if (!plan.objects.length) return;
  if (!putObject) throw new Error("ORM file writes need an S3 putObject on AWS persist.");
  for (const object of plan.objects) {
    await putObject(object.relativePath, object.body, object.contentType);
  }
}
