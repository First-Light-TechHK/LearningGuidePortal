export type Identified = { id: string };

export type MigrationTable<T extends Identified> = {
  all(): T[];
  findById(id: string): T | undefined;
  find(predicate: (row: T) => boolean): T[];
  insert(row: T): T;
  update(id: string, patch: Partial<T>): T;
  upsert(row: T): "add" | "update";
};

export type MigrationDoc<T> = {
  get(): T | undefined;
  set(value: T): void;
  patch(partial: Partial<T>): T;
};

export type MigrationFiles = {
  readText(path: string): string | undefined;
  readJson<T>(path: string): T | undefined;
  writeText(path: string, text: string): void;
  writeJson(path: string, value: unknown): void;
  exists(path: string): boolean;
  changed(): boolean;
  list(): Record<string, string>;
};

export type OrmExtras = {
  tables: Record<string, Identified[]>;
  files: Record<string, string>;
};

export const ORM_EXTRAS_KEY = "ormExtras";

export type MigrationOrm = {
  table<T extends Identified>(name: string): MigrationTable<T>;
  doc<T>(name: string): MigrationDoc<T>;
  files: MigrationFiles;
  extraTables(): string[];
  snapshot(name: string): string;
};

export const PRODUCT_TABLES = [
  "courses",
  "plans",
  "users",
  "sessions",
  "accounts",
  "orders",
  "quotes",
  "subscriptions",
  "entitlements",
  "studyRecords",
  "studyEvents",
  "conversations",
  "notifications",
  "verificationTokens",
  "passwordResetTokens",
  "emailBindingTokens",
  "stripeEvents",
  "orderActivities",
] as const;

export const PRODUCT_DOCS = ["portalContent", "paymentSettings"] as const;

export const PROTECTED_TABLES = ["users", "sessions", "accounts", "orders", "quotes", "subscriptions", "entitlements", "studyRecords", "studyEvents", "conversations", "notifications", "verificationTokens", "passwordResetTokens", "emailBindingTokens", "stripeEvents"] as const;

function asRows<T extends Identified>(value: unknown): T[] {
  return Array.isArray(value) ? value as T[] : [];
}

function tableApi<T extends Identified>(rows: T[]): MigrationTable<T> {
  return {
    all: () => rows,
    findById: (id) => rows.find((row) => row.id === id),
    find: (predicate) => rows.filter(predicate),
    insert(row) {
      if (rows.some((item) => item.id === row.id)) throw new Error(`Duplicate id ${row.id}`);
      rows.push(row);
      return row;
    },
    update(id, patch) {
      const index = rows.findIndex((row) => row.id === id);
      if (index < 0) throw new Error(`Missing id ${id}`);
      rows[index] = { ...rows[index], ...patch, id };
      return rows[index];
    },
    upsert(row) {
      const index = rows.findIndex((item) => item.id === row.id);
      if (index < 0) {
        rows.push(row);
        return "add";
      }
      rows[index] = { ...rows[index], ...row, id: row.id };
      return "update";
    },
  };
}

export function createMemoryOrm(seed: {
  tables?: Record<string, Identified[]>;
  docs?: Record<string, unknown>;
  files?: Record<string, string>;
} = {}): MigrationOrm {
  const tables = new Map<string, Identified[]>();
  const docs = new Map<string, unknown>();
  const files = new Map<string, string>();
  const fileOrigin = new Set<string>();
  for (const [name, rows] of Object.entries(seed.tables || {})) tables.set(name, rows.map((row) => ({ ...row })));
  for (const [name, value] of Object.entries(seed.docs || {})) docs.set(name, structuredClone(value));
  for (const [name, value] of Object.entries(seed.files || {})) {
    files.set(name, value);
    fileOrigin.add(`${name}:${value}`);
  }

  return {
    table<T extends Identified>(name: string) {
      if (!tables.has(name)) tables.set(name, []);
      return tableApi(tables.get(name) as T[]);
    },
    doc<T>(name: string) {
      return {
        get: () => docs.get(name) as T | undefined,
        set(value: T) { docs.set(name, value); },
        patch(partial: Partial<T>) {
          const next = { ...(docs.get(name) as T || {} as T), ...partial };
          docs.set(name, next);
          return next;
        },
      };
    },
    files: {
      readText: (path) => files.get(path),
      readJson: <T>(path: string) => {
        const text = files.get(path);
        return text ? JSON.parse(text) as T : undefined;
      },
      writeText: (path, text) => { files.set(path, text); },
      writeJson: (path, value) => { files.set(path, JSON.stringify(value)); },
      exists: (path) => files.has(path),
      changed: () => [...files.entries()].some(([path, text]) => !fileOrigin.has(`${path}:${text}`)),
      list: () => Object.fromEntries(files),
    },
    extraTables: () => [...tables.keys()].filter((name) => name !== "_data_migrations" && !PRODUCT_TABLES.includes(name as typeof PRODUCT_TABLES[number])),
    snapshot: (name) => JSON.stringify({ table: tables.get(name) || [], doc: docs.get(name) ?? null }),
  };
}

function extrasBag(data: Record<string, unknown>): OrmExtras {
  const current = data[ORM_EXTRAS_KEY] as OrmExtras | undefined;
  const bag: OrmExtras = {
    tables: { ...(current?.tables || {}) },
    files: { ...(current?.files || {}) },
  };
  data[ORM_EXTRAS_KEY] = bag;
  return bag;
}

export function ormFromProductData(data: Record<string, unknown> & { courses?: Identified[] }): MigrationOrm {
  const extras = extrasBag(data);
  const tables = new Map<string, Identified[]>();
  const docs = new Map<string, unknown>();
  const files = new Map<string, string>(Object.entries(extras.files));
  const fileOrigin = new Set([...files.entries()].map(([path, text]) => `${path}:${text}`));
  for (const name of PRODUCT_TABLES) {
    const rows = asRows<Identified>(data[name]);
    data[name] = rows;
    tables.set(name, rows);
  }
  for (const [name, rows] of Object.entries(extras.tables)) {
    const bound = asRows<Identified>(rows);
    extras.tables[name] = bound;
    tables.set(name, bound);
  }
  for (const name of PRODUCT_DOCS) {
    if (name in data) docs.set(name, data[name]);
  }
  return {
    table<T extends Identified>(name: string) {
      if (!tables.has(name)) {
        if (name === "_data_migrations") {
          tables.set(name, []);
        } else {
          const extra = asRows<Identified>(extras.tables[name]);
          extras.tables[name] = extra;
          tables.set(name, extra);
        }
      }
      return tableApi(tables.get(name) as T[]);
    },
    doc<T>(name: string) {
      return {
        get: () => (docs.has(name) ? docs.get(name) : data[name]) as T | undefined,
        set(value: T) {
          docs.set(name, value);
          data[name] = value;
        },
        patch(partial: Partial<T>) {
          const current = (docs.get(name) ?? data[name] ?? {}) as T;
          const next = { ...current, ...partial };
          docs.set(name, next);
          data[name] = next;
          return next;
        },
      };
    },
    files: {
      readText: (path) => files.get(path),
      readJson: <T>(path: string) => {
        const text = files.get(path);
        return text ? JSON.parse(text) as T : undefined;
      },
      writeText: (path, text) => {
        files.set(path, text);
        extras.files[path] = text;
      },
      writeJson: (path, value) => {
        const text = JSON.stringify(value);
        files.set(path, text);
        extras.files[path] = text;
      },
      exists: (path) => files.has(path),
      changed: () => [...files.entries()].some(([path, text]) => !fileOrigin.has(`${path}:${text}`)),
      list: () => Object.fromEntries(files),
    },
    extraTables: () => [...tables.keys()].filter((name) => name !== "_data_migrations" && !PRODUCT_TABLES.includes(name as typeof PRODUCT_TABLES[number])),
    snapshot: (name) => JSON.stringify({ table: tables.get(name) || asRows(data[name]), doc: docs.get(name) ?? data[name] ?? null }),
  };
}

export function exportOrmExtras(orm: MigrationOrm): OrmExtras {
  return {
    tables: Object.fromEntries(orm.extraTables().map((name) => [name, orm.table(name).all()])),
    files: orm.files.list(),
  };
}
