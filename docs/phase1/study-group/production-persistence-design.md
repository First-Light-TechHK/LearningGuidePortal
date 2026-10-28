# Study Group production persistence design — Phase C slice 1

Historical reference note (2026-10-28): the WeChat relay and `repositories/wechatTicketRepository.ts` examples cited below have since been removed. Migration 011 remains immutable history; its table is no longer part of runtime bootstrap. Those examples describe the original design's precedents, not current WeChat behavior. Current repository/DDL examples include `repositories/productTransactionRepository.ts` and migration 012.

Design for the Study Group production core on the product's existing RDS PostgreSQL, replacing the container-local `study-group.json` store (`modules/group-study/repository.ts`) before the feature may be enabled in any managed environment. This document is design only; no code changes accompany it.

Sources this design is built from and must stay consistent with:

- The work handoff's "Completion criteria for the next delivery" and "Phase C — implement the production safety core" sections (the handoff is kept outside the repository; its requirements are restated below).
- The out-of-repository cross-process race reproductions (seat oversubscription, duplicate tutor drain, whole-file lost update, duplicate reminders; 30/30 reproduced each) and their fix proposal, kept alongside the work handoff. This document is the concrete, repo-grounded version of that proposal.
- `docs/phase1/study-group/study-group-architecture.md` § "Atomic steps" and the RDS-gated wording (line 50, 60–80).
- `docs/phase1/release-runbook.md` § "Study Group / LiveKit release gate" (lines 101–109).
- `AGENTS.md` (repositories own SQL; services own rules; external idempotency keys need unique constraints; Order/Payment/Subscription/Entitlement writes repeatable).
- `docs/phase1/domain-model.md` (entity tables and constraints; the orm_rows JSONB convention at line 5, 61; the study group entity table list at lines 50–54; the webhook-receipt uniqueness rule at line 45).
- `db/migrations/README.md` + `009_product_payment_keys.sql`, `010_orm_runtime.sql`, `011_wechat_login_tickets.sql` (the established `.sql` conventions).
- `db/data-migrations/README.md`, `docs/phase1/writing-data-migrations.md`, `docs/phase1/data-migrations.md` (when TS data migrations apply).

## 0. Slice 1 definition

In scope:

1. **Migration `db/migrations/012_study_group_persistence.sql`** — the full durable schema (all Study Group records + webhook receipt table; the webhook *route* is a later slice, the table and its repository operations land now so slice 2 needs no new migration).
2. **PostgreSQL repository** implementing the module's port, with durable claim/lease/outbox/receipt operations.
3. **Service rewiring** for the four reproduced hazards: atomic seat admission, single-flight tutor delivery with lease/retry/dead-letter, immutable-before-provisioning session-to-project assignment, reminder de-duplication.
4. **PostgreSQL-backed I/O tests** for the four proofs, plus the updated unit-suite statement.
5. **Fail-closed store selection** in `modules/group-study/runtime.ts`.

Out of scope (later slices, section 5): the signed webhook route and reconciliation, alarms/metrics/preflight, reminder notification/email outbox legs, removing the file adapter.

## 1. Target schema on RDS PostgreSQL

### 1.1 Where the schema lives and why (against the repo conventions)

Two persistence idioms exist in this repo:

- **JSONB aggregate rows** — `orm_rows (table_name, id, payload JSONB)` and `learning_guide/product.json` in `app_files` (`services/persistence/db.ts:36–66`, `services/ormRuntime.ts:34–46`). This is the interim convention for the product aggregate while the `001`–`008` column tables remain outstanding (`docs/phase1/domain-model.md:5`). `hydrateOrmFromSql` loads **every** `orm_rows` row into the product aggregate on boot and for data migrations (`services/ormRuntime.ts:210–249`), so `orm_rows` is the VFS of the product/CMS ORM and the TS data-migration framework — not a hot transactional store.
- **Dedicated column tables** — `product_payment_keys` (009; its comment: "The aggregate remains in app_files; unique provider identities commit with it"), `wechat_login_tickets` (011; TTL + single-use consume via `DELETE … RETURNING`, `repositories/wechatTicketRepository.ts:9–12`). DDL must be `.sql`: "SQL schema | Postgres tables/constraints | `db/migrations/*.sql` only — never data seeds. Data scripts do not ALTER tables." (`docs/phase1/data-migrations.md:19`); a TS data migration "is **not** a SQL script" and CI cannot see a database (`docs/phase1/writing-data-migrations.md:5–22`).

Study Group has no product aggregate of its own (its store is a separate container-local file, `modules/group-study/runtime.ts:102,108`). Every record in it participates in cross-instance check-then-write today, because every service write goes through `repository.update(mutate)` on the whole store (`modules/group-study/repository.ts:66–75`) — which is exactly the lost-update generator the race suite reproduced (FIX-PROPOSAL §1 hazard 3). None of the four hazards can be expressed as JSONB payload content: conditional `INSERT … WHERE count < max`, partial unique indexes (one active seat per user, one in-flight item per session), `FOR UPDATE SKIP LOCKED` claims, and `CHECK` guards have no JSONB equivalent, and `orm_rows` would additionally drag every Study Group row through the product-aggregate hydration on every boot.

Therefore: **all Study Group records become dedicated column tables in `012`**, the 009/011 pattern extended to a whole module. This also implements the standard data model that `docs/phase1/domain-model.md:50–54` already defines for `study_groups`, `study_group_memberships`, `live_sessions`, `study_group_meetings`, and `study_group_tutor_requests` (names are taken from there verbatim).

### 1.2 Per-record decision table

| Record | Shape | Why (must-have) | Hazard |
|---|---|---|---|
| Study Group (`study_groups`) | Table | Edits run through the same serialized transaction as memberships/sessions; one store, one write mechanism; `groups` read on every list/discover path and joined in SQL. | 3 |
| Membership (`study_group_memberships`) | Table | `UNIQUE (group_id, user_id)` enforces decisions.md's "a second join does not add a member" (`docs/phase1/study-group/decisions.md:3`); partial index on active members. | 3 |
| Live Session (`live_sessions`) | Table | Immutable `livekit_project_id` first-wins write before `ensureRoom`; `occupancy` counter with `CHECK (occupancy <= max_participants)`; status/duration/max CHECK constraints mirror the domain rules (`modules/group-study/domain.ts:98`, `service.ts:459–460`). | 1, 3 |
| Attendance intent (`study_group_attendance_intents`) | Table | `UNIQUE (session_id, user_id)`; part of the leave/reminder cascade inside one transaction. | 3 |
| Presence (`study_group_presences`) | Table | Atomic capacity check-and-insert; `UNIQUE (session_id, user_id)` (file semantics keep exactly one row per user+session, re-entry flips `left_at`); backstop for one active seat. | 1 |
| Meeting (`study_group_meetings`) | Table | `UNIQUE (session_id)` enforces "one meeting row" (`decisions.md:3`). | 3 |
| Reminder (`study_group_reminders`) | Table | `UNIQUE (session_id, user_id)` is the de-dupe; dispatch notify/mail only for rows this transaction inserted. | 4 |
| Tutor request (`study_group_tutor_requests`) | Table | Lease columns, `seq BIGSERIAL` receipt order, partial unique index "at most one `in_flight` per session", `UNIQUE (session_id, user_id, client_event_id)` enqueue idempotency. | 2 |
| Room-message outbox (`study_group_outbox`) | Table | Publish + settle in one transaction; `UNIQUE (dedupe_key)`; claim with lease; retry bookkeeping; `messageId` carried to the gateway. Extensible to reminder notification/email kinds later. | 2 |
| Token issuance log (`study_group_token_log`) | Table (append-only) | Replaces read-whole-file + rewrite (`repository.ts:51–61`); `INSERT` only. Encrypted line stays opaque (`modules/group-study/tokenLog.ts`). | 3 |
| Webhook receipt (`study_group_webhook_receipts`) | Table | `receipt_id` primary key; mirrors the established `stripe_events` rule "event_id unique; duplicate webhook returns 200 without a second write" (`docs/phase1/domain-model.md:45`). | slice 2 route, uniqueness now |

"No JSONB aggregate" is an explicit choice per record, not a default: any record here could be stored as an `orm_rows` payload, but its transition could not then be enforced by the database, and the four release-gate guarantees (atomic admission, single-flight claim, unique dedupe, immutable assignment) would regress to application timing — the defect this slice exists to remove.

### 1.3 DDL sketch (the content of `012_study_group_persistence.sql`)

```sql
-- Study Group production store (Phase C slice 1). Apply before enabling the
-- PostgreSQL Study Group store (STUDY_GROUP_STORE=postgres) in any environment.
-- Every constraint below is a release-gate guarantee from
-- docs/phase1/study-group/study-group-architecture.md § Atomic steps.
-- Timestamps are TIMESTAMPTZ; the repository maps ISO-8601 strings.

CREATE TABLE IF NOT EXISTS study_groups (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  course_id TEXT NOT NULL,
  about TEXT NOT NULL,
  host_user_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('active', 'cancelled')),
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS study_group_memberships (
  id TEXT PRIMARY KEY,
  group_id TEXT NOT NULL REFERENCES study_groups(id),
  user_id TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('host', 'member')),
  joined_at TIMESTAMPTZ NOT NULL,
  left_at TIMESTAMPTZ,
  UNIQUE (group_id, user_id)
);
CREATE INDEX IF NOT EXISTS study_group_memberships_active_user_idx
  ON study_group_memberships (user_id) WHERE left_at IS NULL;

CREATE TABLE IF NOT EXISTS live_sessions (
  id TEXT PRIMARY KEY,
  group_id TEXT NOT NULL REFERENCES study_groups(id),
  title TEXT NOT NULL,
  related_lesson_id TEXT,
  starts_at TIMESTAMPTZ NOT NULL,
  duration_seconds INTEGER NOT NULL CHECK (duration_seconds IN (1800, 2700, 3600, 5400)),
  max_participants INTEGER NOT NULL CHECK (max_participants BETWEEN 2 AND 6),
  focus TEXT,
  ai_tutor_enabled BOOLEAN NOT NULL,
  livekit_project_id TEXT,                -- immutable once provisioning was attempted / live
  status TEXT NOT NULL CHECK (status IN ('scheduled', 'live', 'completed', 'removed')),
  occupancy INTEGER NOT NULL DEFAULT 0 CHECK (occupancy >= 0),
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  CHECK (occupancy <= max_participants)   -- capacity backstop (hazard 1)
);
CREATE INDEX IF NOT EXISTS live_sessions_group_idx ON live_sessions (group_id);

CREATE TABLE IF NOT EXISTS study_group_attendance_intents (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES live_sessions(id),
  user_id TEXT NOT NULL,
  planned_at TIMESTAMPTZ NOT NULL,
  cancelled_at TIMESTAMPTZ,
  UNIQUE (session_id, user_id)
);

CREATE TABLE IF NOT EXISTS study_group_presences (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES live_sessions(id),
  user_id TEXT NOT NULL,
  requested_at TEXT NOT NULL,             -- "<ISO>#00000001" receipt string (enter route)
  entered_at TIMESTAMPTZ,
  left_at TIMESTAMPTZ,
  phase TEXT NOT NULL CHECK (phase IN ('waiting', 'live')),
  UNIQUE (session_id, user_id)            -- one row per user+session; re-entry flips left_at
);
CREATE INDEX IF NOT EXISTS study_group_presences_seated_idx
  ON study_group_presences (session_id) WHERE entered_at IS NOT NULL AND left_at IS NULL;

CREATE TABLE IF NOT EXISTS study_group_meetings (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES live_sessions(id),
  started_at TIMESTAMPTZ NOT NULL,
  ended_at TIMESTAMPTZ,
  UNIQUE (session_id)                     -- one meeting row per session
);

CREATE TABLE IF NOT EXISTS study_group_reminders (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES live_sessions(id),
  user_id TEXT NOT NULL,
  sent_at TIMESTAMPTZ NOT NULL,
  UNIQUE (session_id, user_id)            -- reminder de-dup (hazard 4)
);

CREATE TABLE IF NOT EXISTS study_group_tutor_requests (
  id TEXT PRIMARY KEY,
  seq BIGSERIAL NOT NULL,                 -- receipt order tie-break (received_at + seq)
  session_id TEXT NOT NULL REFERENCES live_sessions(id),
  user_id TEXT NOT NULL,
  client_event_id TEXT NOT NULL,
  text TEXT NOT NULL,
  received_at TIMESTAMPTZ NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('queued', 'in_flight', 'answered', 'dead_letter')),
  lease_owner TEXT,
  lease_expires_at TIMESTAMPTZ,           -- claim lease (60 s)
  next_attempt_at TIMESTAMPTZ,            -- retry schedule / claimable-at; NULL = claimable now
  attempts INTEGER NOT NULL DEFAULT 0,
  terminal_reason TEXT,                   -- 'answered' | 'model_failed' | 'attempts_exhausted' (legacy rows may carry 'course_material_absent')
  outbox_message_id TEXT,                 -- set when an answer was handed to the outbox
  answered_at TIMESTAMPTZ,
  UNIQUE (session_id, user_id, client_event_id)   -- enqueue idempotency (external id)
);
CREATE UNIQUE INDEX IF NOT EXISTS study_group_tutor_requests_single_flight_uidx
  ON study_group_tutor_requests (session_id) WHERE status = 'in_flight';  -- one in-flight per session (hazard 2)
CREATE INDEX IF NOT EXISTS study_group_tutor_requests_claim_idx
  ON study_group_tutor_requests (session_id, status, received_at, seq);

CREATE TABLE IF NOT EXISTS study_group_outbox (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('room_message')),  -- later slices extend the CHECK
  dedupe_key TEXT NOT NULL UNIQUE,        -- tutor request id == LiveKit messageId
  session_id TEXT NOT NULL REFERENCES live_sessions(id),
  payload JSONB NOT NULL,                 -- { room, projectId, text, messageId, mode } ('mode' optional on legacy rows)
  status TEXT NOT NULL CHECK (status IN ('queued', 'sending', 'delivered', 'failed', 'dead')),
  attempts INTEGER NOT NULL DEFAULT 0,
  lease_owner TEXT,
  lease_expires_at TIMESTAMPTZ,
  next_attempt_at TIMESTAMPTZ,
  failure_class TEXT,                     -- redacted gateway failure code
  created_at TIMESTAMPTZ NOT NULL,
  delivered_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS study_group_outbox_claim_idx
  ON study_group_outbox (status, next_attempt_at);

CREATE TABLE IF NOT EXISTS study_group_token_log (
  id BIGSERIAL PRIMARY KEY,               -- append-only; replaces token-issuance.log
  line TEXT NOT NULL,                     -- encrypted issuance line, no token, no secret
  issued_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS study_group_webhook_receipts (
  receipt_id TEXT PRIMARY KEY,            -- provider receipt id (unique receipt id)
  event_type TEXT NOT NULL,
  session_id TEXT,                        -- resolved room name at processing time (slice 2)
  payload JSONB NOT NULL,
  status TEXT NOT NULL DEFAULT 'received'
    CHECK (status IN ('received', 'processed', 'ignored', 'failed')),
  failure_class TEXT,
  received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  processed_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS study_group_webhook_receipts_received_idx
  ON study_group_webhook_receipts (received_at);
```

Notes:

- `requested_at` stays `TEXT` because the enter route writes `"<ISO>#00000001"` (`app/api/study-groups/sessions/[sessionId]/enter/route.ts`); it is a record, not an ordering key across instances (admission is commit order under the lock — see §3.1).
- Presences are only inserted by a successful admission (`service.ts:241–257` sets `enteredAt` at insert, `leftAt` on leave); the partial index name `_seated_idx` mirrors the occupancy predicate `entered_at IS NOT NULL AND left_at IS NULL` (`service.ts:80–82`).
- The `study_groups.title`/`about` length caps (50/200) are already service validation (`service.ts:264–265`); no DB CHECK is added to avoid duplicating validation constants, consistent with 011's style (CHECK only for enums).

### 1.4 Conflict resolution for repeated writes

All writes are idempotent where AGENTS requires it:

- Enqueue tutor: `ON CONFLICT (session_id, user_id, client_event_id) DO NOTHING RETURNING`; on conflict, `SELECT` and return the original row — "same client event id returns the original text" (`docs/phase1/domain-model.md:54`, pinned by `tests/unit/study-group-service.test.ts:756–766`).
- Reminder: `ON CONFLICT (session_id, user_id) DO NOTHING RETURNING` — only returned rows get notifications (FIX-PROPOSAL §2.5).
- Webhook receipt: `ON CONFLICT (receipt_id) DO NOTHING RETURNING` — returns "duplicate" without a second write (mirror of `stripe_events`).
- Session project assignment: first writer wins (`SET livekit_project_id = COALESCE(livekit_project_id, $candidate)`), never overwritten; see §3.2 "Session project assignment".

## 2. The migration

### 2.1 Choice: `db/migrations/012_study_group_persistence.sql` (SQL DDL), not a TS data migration

- DDL and constraints belong in `db/migrations/*.sql` ("Data scripts do not ALTER tables", `docs/phase1/data-migrations.md:19`). A TS data migration compiles to `orm_rows` upserts through the ORM (`services/ormRuntime.ts:142–204`) and cannot express `UNIQUE`, partial indexes, `CHECK`, or `BIGSERIAL`; CI's memory-ORM story (no database, `docs/phase1/writing-data-migrations.md:5–22`) also cannot unit-test those.
- `012` is the next number after 009–011. Data-migration numbering is independent and stays at 005; **no TS data migration is added** because no product/CMS data changes and the Study Group store is not product aggregate data. If rejection of this choice is desired, the only viable alternative is a TS data-migration writing JSONB rows into `orm_rows`, which cannot satisfy section 1 — do not choose it without replacing the four constraints.

### 2.2 How 012 is applied per environment

Two established mechanisms, both used, matching 010/011:

1. **Versioned artifact + provisioning/release step.** The bootstrap lambda pattern already copies and executes `db/migrations/*.sql` (`scripts/provision-sit.mjs:77–78`, `scripts/provision-uat.mjs:104–105`, applied in `deploy/sit-bootstrap.cjs:29–35`). `012` is added to those copies. The release-runbook Study Group gate gains one line: "With PostgreSQL, apply `db/migrations/012_study_group_persistence.sql` before deploying the code that selects the PostgreSQL Study Group store" (same sentence shape as the 009 rollout line, `release-runbook.md:64`).
2. **Runtime `ensureSchema`** — the same DDL is added to `services/persistence/db.ts:32–73`, exactly as `wechat_login_tickets` is both an `011` file and inline DDL (`db.ts:58–65`, comment in `010_orm_runtime.sql:1–3`). This makes local Docker PostgreSQL, DEV, and any environment whose schema job has not run self-healing on first query, and makes the fail-closed selection in §3.5 safe (no window where the store is selected and the tables do not exist).

Both copies are plain `CREATE TABLE IF NOT EXISTS` / `CREATE INDEX IF NOT EXISTS`: re-running is a no-op, and boot order does not matter. A new unit test asserts the two sources declare the same table set (section 4.4). `012` must never be edited after it has been applied anywhere; changes go into `013`.

### 2.3 Backfill / import stance for the existing `study-group.json`

**Not imported, documented as not-imported.** Reasons, grounded:

- The Study Group feature has never been enabled in a managed environment; the runbook gate states production stays disabled until the RDS implementation exists (`release-runbook.md:105`), and the file repository is "temporary local/test compatibility only" (`decisions.md:3`).
- Every existing file is container-local (`repository.ts:31–33` reads a path under `systemRoot()` with `node:fs`, bypassing the VFS/`app_files`), so nothing durable exists to migrate in DEV/SIT/UAT/PROD; ephemeral App Runner containers have already discarded any prior copies.
- The only known file is local DEV e2e residue: `data/knowledge_system/learning_guide/study-group/study-group.json` contains "E2E Live Group" groups created by the local two-browser LiveKit run.
- HANDOFF Phase C.1 explicitly says: "Do not auto-import unknown production JSON; make any import explicit, reviewed, idempotent, and backed up."

Optional convenience (only if the user wants their local dev data in local Docker PostgreSQL): a standalone `scripts/import-study-group-json.mjs` — dry-run by default, `--apply` required, insert-only (`ON CONFLICT (id) DO NOTHING`), refuses to run when `NODE_ENV=production`/managed `APP_ENV`, never invoked at boot or in CI. It is not part of the migration and not required for slice 1.

### 2.4 Rollback story

- The migration is additive-only (new tables; nothing existing is altered). Older code never reads the new tables, so reverting the application image alone fully restores prior behavior ("应用错误：把 App Runner 指回上一个已验证 image digest", `release-runbook.md:138`); `ensureSchema` re-creating the tables on an old image is inert.
- A bad-data problem in the new store is handled by the runbook's DB-error path: stop promotion, restore from backup or execute a reviewed reverse operation; never drop production tables directly (`release-runbook.md:139`). Because this store starts empty and the feature is release-gated off, the realistic rollback is: disable the Study Group surface, revert the image, leave the tables in place for the forward fix.
- Roll-forward safety: all `INSERT`s are idempotent and every status transition is a guarded `UPDATE … WHERE`, so a rolling deploy of two image versions during rollback cannot corrupt state (the old image does not touch these tables at all).

## 3. Repository boundary, store selection, locking strategy

### 3.1 The PostgreSQL repository module

New file `repositories/studyGroupRepository.ts` (SQL-bearing adapters live in `repositories/`, per `AGENTS.md` and the `wechatTicketRepository.ts` / `productTransactionRepository.ts` precedent), implementing the module's port. The port type stays in `modules/group-study/repository.ts` and is **extended** (additive):

```ts
export type StudyGroupRepository = {
  // today's three methods, unchanged in shape (modules/group-study/repository.ts:5–9)
  read(): Promise<StudyGroupStore>;
  appendTokenLog(line: string): Promise<void>;
  update<T>(mutate: (store: StudyGroupStore) => T | Promise<T>): Promise<T>;

  // durable tutor queue (hazard 2)
  claimNextTutorRequest(input: {
    sessionId: string; leaseOwner: string; leaseSeconds: number; maxAttempts: number;
  }): Promise<TutorRequestRow | null>;
  settleTutorRequest(input: {
    id: string; leaseOwner: string;
    outcome: { status: "answered" | "dead_letter"; terminalReason: string };
    outbox?: { room: string; projectId: string; text: string; messageId: string };
  }): Promise<void>;

  // durable room-message outbox (at-least-once publish, bounded)
  claimNextOutboxMessage(input: { sessionId: string; leaseOwner: string; leaseSeconds: number }): Promise<OutboxRow | null>;
  markOutboxDelivered(input: { id: string; leaseOwner: string }): Promise<void>;
  markOutboxFailed(input: { id: string; leaseOwner: string; failureClass: string; maxAttempts: number; retryDelaySeconds: number }): Promise<void>;

  // webhook receipts (used by the slice-2 route; operations land now)
  insertWebhookReceipt(input: { receiptId: string; eventType: string; sessionId: string | null; payload: unknown }): Promise<boolean>;
  markWebhookProcessed(input: { receiptId: string; result: "processed" | "ignored" | "failed"; failureClass?: string }): Promise<void>;
};
```

Both adapters implement the full port so the service keeps ONE code path:

- **PostgreSQL adapter** (`repositories/studyGroupRepository.ts`): raw SQL through `services/persistence/db.ts` (`query`, `getPool`, `ensureSchema`), transaction idiom copied from `productTransactionRepository.ts:20–43` (`getPool().connect()`, `BEGIN`/`COMMIT`/`ROLLBACK`, `finally client.release()`).
- **File adapter** (`modules/group-study/repository.ts`, DEV/tests only): same methods on the in-memory chain; lease/outbox fields are additive on `TutorRequestRow`, so existing suites keep compiling. Its cross-process guarantees remain the documented DEV stopgap (FIX-PROPOSAL §3 — do not claim the file lockfile as production behavior; this design does not ship it).

`appendTokenLog` (PG): `INSERT INTO study_group_token_log (line) VALUES ($1)` — append-only (FIX-PROPOSAL §2.4). `read()` (PG): one `BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY` transaction selecting all eleven tables and rebuilding the `StudyGroupStore` shape (ISO strings, camelCase), so the service continues to receive the same snapshot type (`modules/group-study/domain.ts:87–96`).

### 3.2 Transaction/locking strategy per operation, per hazard

Global rule (FIX-PROPOSAL §2.1): no read-modify-write of a shared document; each service transition is one database transaction.

`update(mutate)` (PG) — the workhorse that keeps the existing service logic:

```
BEGIN;
SELECT pg_advisory_xact_lock(719302, 1);      -- study-group write lock; 719301 is the payment aggregate's (productTransactionRepository.ts:24)
  SELECT * FROM all study-group tables;        -- fresh snapshot
  result = mutate(snapshot);                   -- SYNCHRONOUS mutate only (runtime-enforced assertion)
  diff snapshot vs mutations:
    upsert changed rows (INSERT … ON CONFLICT (id) DO UPDATE);   -- per-row, never whole-document
    order: base tables → presences → live_sessions (occupancy derived last, see below)
COMMIT;
```

- Why an advisory xact lock and not `SELECT … FOR UPDATE` on the tables: row locks cannot serialize writers when the store is empty (nothing to lock). The advisory lock is the repo's own established answer for serialize + commit constraints together (`docs/phase1/domain-model.md:61`, `productTransactionRepository.ts:24`), and it makes every in-mutate check-then-act atomic across App Runner instances.
- `live_sessions.occupancy` is derived in the write: after presence upserts, each changed session is written with `occupancy = (SELECT count(*) FROM study_group_presences WHERE session_id = live_sessions.id AND entered_at IS NOT NULL AND left_at IS NULL)`; the `CHECK (occupancy <= max_participants)` then fails closed if any code path ever bypasses the in-transaction capacity check (FIX-PROPOSAL §2.2 backstops).
- Mutates must be synchronous: today all ~20 `deps.repository.update` call sites in `service.ts` are synchronous (verified in `modules/group-study/service.ts`; only `read`/gateway/deps calls are async). The PG adapter asserts the mutate promise never pends before the diff stage (throw → ROLLBACK) so a future async mutate cannot hold the lock across awaits.
- Scale note: the lock serializes Study Group writes module-wide. Traffic is a 2–6-person session feature with a 30 s reminder tick; the write transactions are short (snapshot + a handful of upserts) and model calls/emails/LiveKit calls never run inside them.

`read()` — REPEATABLE READ read-only transaction: consistent multi-table snapshot; uncommitted writers invisible. The service's own occupancy math counts presence rows from this snapshot (`service.ts:80–82`), so a straddling read cannot mis-count capacity decisions (decisions happen inside `update` anyway).

**Hazard 1 — seat admission (`seat`, `service.ts:221–260`, helper `enterSession` 576–578):** unchanged service logic, now atomic: capacity check (`occupancy(sum) < session.maxParticipants`) and the presence insert/undeaden all happen inside one serialized transaction. Losers get `session_full` with no row. Backstops: `UNIQUE (session_id, user_id)` (double-enter cannot add a row), occupancy `CHECK` (oversubscription fails closed). I/O test proof: §4.1.1.

**Hazard 2 — tutor delivery (`deliverTutorAnswer`, `service.ts:796–859`):** rewritten to claim-before-call:

1. `claimNextTutorRequest` — ONE statement, outside the advisory lock (per-session granularity, FIX-PROPOSAL §2.3 shape, with two refinements marked ✱):

```sql
UPDATE study_group_tutor_requests SET
  status = 'in_flight', lease_owner = $1,
  lease_expires_at = NOW() + ($2::int * INTERVAL '1 second'),
  attempts = attempts + 1, next_attempt_at = NULL
WHERE id = (
  SELECT id FROM study_group_tutor_requests
  WHERE session_id = $3
    AND (next_attempt_at IS NULL OR next_attempt_at <= NOW())      -- retry schedule gate
    AND (
      status = 'queued'
      OR (status = 'in_flight' AND lease_expires_at <= NOW())          -- expired lease reclaim
    )
    AND NOT EXISTS (                                                   -- ✱ one in-flight per session
      SELECT 1 FROM study_group_tutor_requests other
      WHERE other.session_id = $3 AND other.status = 'in_flight'
        AND other.lease_expires_at > NOW())
  ORDER BY received_at, seq                                            -- ✱ seq fixes equal-timestamp order
  LIMIT 1 FOR UPDATE SKIP LOCKED)
RETURNING *;
```

   ✱ These two refinements fix holes in the FIX-PROPOSAL sketch: its `WHERE status IN ('queued')` would let a second claim take the next queued row while the first is in flight, and `ORDER BY received_at, id` is not receipt order for UUID ids. The partial unique index `… (session_id) WHERE status='in_flight'` is the hard backstop. When the candidate row is an expired lease whose `attempts` has already reached `maxAttempts`, `claimNextTutorRequest` marks it `dead_letter` (`terminal_reason='attempts_exhausted'`) and re-runs its (bounded) claim once more before returning, so dead letters never block later questions within the same drain call and a single poisoned item cannot stall the queue. A claimer that loses a concurrent claim race surfaces as a partial-index unique violation (23505) on the second `UPDATE`; the adapter catches that code and returns "no claim" — the loser performs no model call, which is the single-flight guarantee, not an error path.
2. Model call + grounding — outside every lock and transaction.
3. `settleTutorRequest` — one short transaction: guarded `UPDATE … WHERE id=$ AND lease_owner=$ AND status='in_flight'` sets `answered`/`dead_letter` + `terminal_reason` + `outbox_message_id`; every settled tutor item now carries a reply — a grounded or general answer, or an empty-text unavailable notice — so it does `INSERT INTO study_group_outbox (dedupe_key = request id, kind='room_message', payload {room, projectId, text, messageId=request id, mode}) ON CONFLICT (dedupe_key) DO NOTHING`. This is the FIX-PROPOSAL §2.3 outbox, with `dedupe_key` giving "at most one outbox row per tutor item".
4. Publish — `claimNextOutboxMessage` (same `FOR UPDATE SKIP LOCKED` pattern) → `deps.publishRoomChat` (unchanged deps shape, `service.ts:166–169`) → `markOutboxDelivered`; failure → `markOutboxFailed` with backoff, bounded by `maxAttempts` (5) → `dead` with a redacted `failure_class`. The drain loop never blocks on a failed publish: the item is already settled, and the outbox row retries on the next drain.

   Honesty correction to the backbone: the FIX-PROPOSAL says "LiveKit's `messageId` dedupes at-least-once retries". In this codebase it does not — the gateway embeds `id` in the payload (`modules/group-study/liveKitCloudGateway.ts:135–146`) and the room appends every tutor message without id de-duplication (`components/portal/StudySessionRoom.tsx:186–191`). Slice 1 therefore includes the tiny client-side companion: key tutor chat entries by the payload `id` and drop repeats, so a crash between publish and `markOutboxDelivered` cannot double-render an answer. Server-side, the only duplicate window is exactly that crash window (claim lease prevents concurrent publishers).

   `markAnswered`'s old "flip the next item's `inFlight`" pointer (`service.ts:804–813`) is deleted with the marker: `inFlight` remains on the row view as `status === 'in_flight'` (see §4.4), and the queue is derived from `status`/*seq*, so a crash between settle and any flip cannot strand it.

**Hazard 3 — lost update:** every former whole-file write (`repository.ts:44–49`) becomes per-row upserts inside the serialized transaction; `appendTokenLog` becomes an append-only `INSERT`. No code path writes a whole snapshot over another writer's commit.

**Hazard 4 — reminders (`dispatchDueReminders`, `service.ts:861–894`):** unchanged logic, serialized: the `update` mutate re-evaluates the due audience against the fresh snapshot and inserts `study_group_reminders` rows with `ON CONFLICT (session_id, user_id) DO NOTHING`; notify/mail run after commit for the rows this transaction inserted only (`service.ts:884–892` shape). Two instances ticking concurrently: the loser's mutate sees the winner's rows and returns no jobs — one notification, one email. The reminder notification/email outbox (FIX-PROPOSAL §2.5's second half) is deliberately deferred to a later slice: it changes `deps.sendMail`'s swallowed-failure contract (`runtime.ts:139–145`) and belongs with the dead-letter/observability slice; the reproduced defect (duplicate sends) is fully fixed by the constraint + serialization. Noted in §5 and open question 1.

**Session project assignment (immutable before provisioning)** — `startSession` (`service.ts:584–667`) is reordered; the defect is HANDOFF P1.1 ("ensureRoom before persisting the selected project"):

1. Validate host/session state from a read (unchanged checks, `service.ts:595–600`).
2. **Durable assignment write (before any provider call):**

```sql
UPDATE live_sessions SET livekit_project_id = $candidate, updated_at = NOW()
WHERE id = $session AND livekit_project_id IS NULL
RETURNING livekit_project_id;
-- no row returned → SELECT livekit_project_id (another instance won); use the stored value
```

   The service then uses the **effective** value (first writer wins). A crashed or failed provisioning retry re-reads the same value, so a retry can never choose a different project, and two instances racing a start converge on one assignment (this closes the "or choose a different project" part of HANDOFF P1.1). `issueToken`'s lazy assignment (`service.ts:698–703`) uses the same first-wins pattern.
3. `ensureRoom(effectiveProject)` — repeated calls are the provider-idempotent "same room name returns the existing room" path (`liveKitCloudGateway.ts:109–121`); a new gateway test pins repeat-call behavior.
4. Go-live `update` (unchanged: status, waiting presences `phase='live'`, one meeting row, `service.ts:649–661`).

   Provisioning failure handling keeps the current exclude-based candidate choice but makes it safe: a candidate may be replaced **only** while no provider attempt with an ambiguous outcome has happened and the session is not live. Classifier on the existing typed codes (`liveKitGateway.ts:5`): `credential_unavailable` and `unauthorized` are definitive (no room can have been created) → assignment may CAS-advance to the next candidate; `unreachable`, `rate_limited`, `unverified` are ambiguous → the assignment is pinned, the incident is emitted (`service.ts:606–616` shape), and the start stays `unavailable` for retry against the same project. "Never move an active room to another project" (`release-runbook.md:108`) is preserved: the only time the assignment changes is before any successful room creation. This intentionally amends one pinned unit expectation — see §4.4.

### 3.3 What the service keeps vs changes (implementation order for slice 1.5)

Keeps (no signature/behavior change): `seat`/`enterSession`/`grantSeat`, `enqueueTutor` validation, reminder audience logic, all read paths (`listMine`, `getGroup`, `sessionView`, …), error codes/messages, `orderEntry` in-process entry queue, in-process `startingSessions` single-flight.

Changes: (a) `deliverTutorAnswer` → claim/outbox loop of §3.2; (b) `startSession`/`issueToken` assignment ordering of §3.2; (c) `enqueueTutor` no longer pre-marks `inFlight` (every new item is `queued`; §4.4 lists the two assertions this touches); (d) `markAnswered` removed.

### 3.4 Store selection in `runtime.ts` (fail-closed)

`modules/group-study/runtime.ts:101–108` currently always builds `createStudyGroupRepository(directory)`. New selection, following `services/runtimeConfig.ts`'s managed-environment style (`isManagedEnvironment()` at `runtimeConfig.ts:11–13`, required-config pattern at 83–98):

```ts
function studyGroupPersistenceBackend(): "postgres" | "file" {
  const explicit = (process.env.STUDY_GROUP_STORE || "").trim().toLowerCase();
  if (explicit === "postgres") return "postgres";
  if (explicit === "file") {
    if (isManagedEnvironment()) throw new Error("The file Study Group store is not available in managed environments.");
    return "file";
  }
  const hasDb = Boolean(process.env.DATABASE_URL?.trim());
  if (isManagedEnvironment() || hasDb) return "postgres";
  return "file"; // local DEV without PostgreSQL — unit tests and file-backed io tests
}
```

- Managed environments (`SIT`, `UAT`, `PROD`, `PPE/PROD`) can never fall back to the file store; construction throws instead of silently serving local JSON (fail-closed, mirroring `runtimeConfig.ts:84–98`).
- `STUDY_GROUP_STORE=file` remains available for DEV only; `STUDY_GROUP_STORE=postgres` requires `DATABASE_URL` (the PG adapter throws its own clear error otherwise via `getPool`, `db.ts:17–30`).
- The service cache key changes from the directory path to the backend (`"postgres"` or the directory), keeping the per-key reminder timer (`runtime.ts:172–180`) working unchanged.
- Wiring into `/api/health/config` / `preflight:production` (a `studyGroup: "postgresql" | "local"` surfaced as a production blocker) is listed in §5 for the preflight slice; construction-time throw is the slice-1 guarantee.

## 4. Test plan

### 4.1 New PostgreSQL I/O tests (the four proofs)

New directory `tests/io/postgres/` + script `test:io:pg` (`node --import tsx --require ./scripts/register-tsconfig-paths.cjs --test --test-concurrency=1 tests/io/postgres/*.test.ts`). Conventions from `tests/io/harness.ts`: `node:test` + `assert/strict`, route handlers imported and invoked directly (`callRoute`/`jsonRequest`), but a dedicated setup helper because `isolate()` deletes `DATABASE_URL` and assumes the file store (`harness.ts:190–225`). The helper: requires `DATABASE_URL` (fail-closed — prints the Docker command and exits non-zero when missing; it never silently skips), runs `012`'s SQL from the artifact file itself (the file under test is the one applied), truncates the study-group tables between tests, and builds **two independent service instances over two repository instances** to act as the two workers. Each worker's queries take separate pooled connections, so the database arbitrates; no in-process lock can mask a defect. (Optional later strengthening: re-run the `studygroup-races` multi-process drivers against PostgreSQL for the same four scenarios.)

1. **Atomic seat admission (hazard 1).** Session with `maxParticipants=2`; N concurrent `enterSession` calls from two service instances. Assert: exactly 2 succeed, the rest fail `session_full` (`service.ts:240`), persisted presences = 2, `live_sessions.occupancy = 2`, and a concurrent duplicate enter by one seated user still leaves one row. Also assert `update` from both instances never observes `occupancy > max` (the CHECK would throw).
2. **Duplicate client events (enqueue idempotency).** Two concurrent `enqueueTutor` with the same `(session_id, user_id, client_event_id)` from two instances: one row, both calls return the same `id` and the original text (mirrors `study-group-service.test.ts:756–766`).
3. **Duplicate tutor drain (hazard 2 end-to-end).** Two concurrent `deliverTutorAnswer` on one session with one queued question: exactly one model call and one publish (fixture counters), exactly one outbox row, item `answered`. This converts the reproduced race (`studygroup-races/tutor/driver.mjs`) into a pass test.
4. **Lease expiry / retry / dead-letter.** Claim with `leaseSeconds=1` and `maxAttempts=2`: second claim before expiry → `null`; after expiry → re-claim (attempts 2); after the second expiry the claim transaction sets `dead_letter`/`attempts_exhausted` and the next queued question is still served, proving dead letters do not block (`decisions.md:17`). A crashed-claimer simulation is just "claim and never settle".
5. **Duplicate webhook receipts across two workers.** Two concurrent `insertWebhookReceipt(same receiptId)`: exactly one `true`; row count 1; second call is a no-op like `stripe_events` (`domain-model.md:45`).
6. **Duplicate reminders across two workers (hazard 4).** Two instances call `dispatchDueReminders` concurrently at T-10 with a due audience: total notify calls and mail calls = one per (session,user), one reminder row each.
7. **Immutable project assignment.** Two concurrent `startSession` on two instances: one `livekit_project_id` persisted, all `ensureRoom` calls reference it; a failed `ensureRoom` (ambiguous `unreachable`) → retry re-uses the same project; a definitive `unauthorized` first candidate → assignment advances once, then pins.
8. **Outbox retry.** Publish fails twice then succeeds: two `markOutboxFailed` with backoff then `markOutboxDelivered`; after `maxAttempts` failures the row is `dead` with a redacted class and the tutor queue still advances.

### 4.2 Where the PG tests run

- Local: documented Docker command (`docker run --rm -e POSTGRES_PASSWORD=… -p 5432:5432 postgres:16`) against `DATABASE_URL=postgresql://…/lg_study_group_test`, then `npm run test:io:pg`. `db/migrations/README.md:5` already sanctions local Docker PostgreSQL.
- CI: `Verify` deliberately does not run `test:io` (`overlay-check.yml:5` comment: "不要把 test:io 加进 Verify"), and it has no database. Recommendation (open question 3): record `test:io:pg` evidence against the release candidate locally/in a runner with a Postgres service, and add a dedicated non-Verify CI job only with maintainer approval.

### 4.3 File-adapter coverage stays

The file adapter retains all four operations so `npm run test:unit` (tests/unit/*.test.ts) exercises a single service path. The file store remains single-process-only (documented; FIX-PROPOSAL §3).

### 4.4 Which existing suites must keep passing unchanged

Unchanged (must keep passing byte-for-byte):

- `tests/unit/study-group-service.test.ts` except two amended assertions (below); `study-group-state-space.test.ts` except wrapper literals; `study-group-corners.test.ts`; `study-group-api.test.ts`; `study-group-ui.test.ts`; all LiveKit suites (`-config`, `-gateway`, `-credentials`, `-health`, `-incident`, `-client-recovery`, `-staging-smoke`); `study-group-tutor-keys.test.ts`.
- Everything outside the suite: `npm run typecheck`, `typecheck:io`, `test:unit` (whole), `build`; data-migration registry tests (no new TS data migration); payment/portal suites untouched.

Explicitly amended (each mechanical, with the contract reason):

1. The two `StudyGroupRepository` object literals now forward the new methods: `tests/unit/study-group-service.test.ts:625–630` and `tests/unit/study-group-state-space.test.ts:122–132` (compile-forced by interface extension; body unchanged).
2. `tests/unit/study-group-service.test.ts:837–838`: asserts the first enqueued item is pre-marked `inFlight` before any delivery. The durable queue intentionally removes enqueue-time marking (it is the mechanism the duplicate-drain race exploited); replace with: after enqueue, all items are `queued` (`inFlight === false`), and after `deliverTutorAnswer` completes, the settled state assertions (already at lines 1118/1141/1173 and state-space 447–467) continue to pin at-most-one-in-flight and settled-clears-marker.
3. `tests/unit/study-group-service.test.ts:525–556` (fallback on first `ensureRoom` failure): the fixture throws `unreachable` (ambiguous) and expects a fallback. Under the immutable-assignment contract, switch the fixture to a definitive code (`unauthorized`) and keep the fallback assertions; add a new case: `unreachable` pins the assignment (one `ensureRoom` call, no fallback) and a second `startSession` retries the same project.

These three edits are the full blast radius. `docs/phase1/study-group/study-group-architecture.md` § "Tutor queue" wording ("an `inFlight` flag") and § 50's RDS-gated sentences are updated in the same change set to describe the implemented storage (truthful-docs rule from HANDOFF P1.5).

### 4.5 New unit tests added in slice 1

- Migration parity: parse `db/migrations/012_study_group_persistence.sql` and `services/persistence/db.ts` ensureSchema text; assert identical table-name sets (drift guard).
- Gateway: repeat `ensureRoom` for the same room name is idempotent (fake RoomService returns the existing room); ambiguous vs definitive failure classification helper.
- Service-level: claim-before-model ordering with a gated repository (extends the existing gate fixtures); outbox publish failure advances the queue and retries on the next drain.
- Client: tutor chat entries de-duplicate by payload `id` (`StudySessionRoom` message reducer unit).

## 5. Explicitly out of scope for slice 1 (later slices)

1. **Slice 2 — signed webhook route + reconciliation:** `app/api/livekit/webhook/route.ts` with raw-body signature verification (new `verifyWebhook` on the gateway boundary, `modules/group-study/liveKitGateway.ts`), receipt-first idempotency using `insertWebhookReceipt` (already implemented by this slice), event mapping restricted to known `live_sessions` (session id == room name, `runtime.ts:151–152`), seat release on trusted participant-left, bounded reconciliation job. Webhooks never grant membership or authorize a user (`HANDOFF` C.4).
2. **Slice 3 — observability + preflight:** CloudWatch metrics/alarms (provider error rate, webhook failures, reconciliation drift, tutor queue age, dead-letter count — counts come from `status='dead_letter'` / outbox `dead`, payloads stay redacted), fail-closed production preflight entry (`studyGroup` store must be `postgres`), incident-drill evidence (`release-runbook.md:109`).
3. **Reminder notification/email outbox legs** (kinds on `study_group_outbox`): changes the swallowed `sendMail` failure contract (`runtime.ts:139–145`); the reproduced duplicate-send defect is fixed by this slice's constraint + serialization. Open question 1.
4. **Removing the file adapter** or shipping any file-lockfile production stopgap (FIX-PROPOSAL §3 remains DEV-only, unimplemented here). Open question 5.
5. **Per-request targeted read queries** (the PG `read()` still loads the whole store; acceptable at study-group scale; revisit only with volume evidence).
6. **Provider cleanup/retry lifecycle on leave/end** (`removeParticipant` idempotent policy — HANDOFF P1.3) and the non-production end-to-end smoke (`HANDOFF` C.7).

## 6. Open questions (each with a recommendation)

1. **Reminder notification/email outbox now or later?** The FIX-PROPOSAL puts reminder notify/mail into outbox rows in the same transaction; this design fixes the reproduced hazard with the unique constraint + serialized dispatch and defers the outbox legs (they change `sendMail`'s error contract and pair with the dead-letter slice).
   *Recommendation: defer to slice 3; keep both kinds reserved in the `study_group_outbox` CHECK so no migration is needed later.*
2. **Backfill of local `study-group.json`:** none exists in any managed environment (feature never enabled; container-local only). *Recommendation: document as not-imported; ship the optional reviewed `scripts/import-study-group-json.mjs` only if you want your local DEV groups in local Docker PostgreSQL.*
3. **Where do the PostgreSQL I/O tests run in CI?** Verify deliberately excludes `test:io` and has no database. *Recommendation: `npm run test:io:pg` locally against Docker Postgres with recorded evidence now; propose a separate `postgres:16` service job to the maintainer as a follow-up, not inside Verify.*
4. **Interface extension blast radius:** extending `StudyGroupRepository` with required claim/lease/receipt methods forces two mechanical literal edits and two behavioral test amendments (§4.4), versus keeping the 3-method interface and doing claims through `update()` (zero test edits, but global-lock claim granularity and no statement-level SKIP LOCKED). *Recommendation: extend the interface as designed — the statement-level claim and the `receipt` operations are the backbone contract, and the edits are listed and bounded.*
5. **DEV multi-process file-store races:** the FIX-PROPOSAL's `O_CREAT|O_EXCL` lockfile stopgap is unimplemented. *Recommendation: skip; keep DEV single-process (playwright studygroup config runs one server), and treat the PostgreSQL adapter as the only concurrency fix.*

## 7. Acceptance mapping (what slice 1 will let us claim)

| Completion criterion (HANDOFF § Completion criteria; AGENTS § 完成定义) | Slice 1 evidence |
|---|---|
| RDS migration present, applied through the approved path, verified by I/O tests | `012_*.sql` + ensureSchema parity test + §4.1 suite |
| Session-to-project assignment durable and immutable before provisioning; capacity atomic across instances | §3.2 assignment flow + I/O tests 1, 7 + amended unit case |
| Tutor delivery durable queue/lease/retry/dead-letter/outbox with recovery tests | §3.2 + I/O tests 3, 4, 8 |
| External idempotency keys have unique constraints (AGENTS) | `UNIQUE` on tutor `(session,user,client_event)`, reminders `(session,user)`, receipts `receipt_id`, memberships, meeting `(session)`, plus §4.1 tests 2, 5, 6 |
| Every implemented path has a service test and an I/O test; existing suites stay green | §4.4 unchanged list + §4.5 additions |

Still required before the feature may be enabled in production (not claimed by this slice): webhook route, reconciliation, alarms, preflight, smoke — slices 2–3 above and `release-runbook.md:101–109`.
