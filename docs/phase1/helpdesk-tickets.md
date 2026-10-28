# Helpdesk Tickets v1 — implementation spec (Portal + BackOffice)

Status: approved by owner 2026-10-28 ("把工单这个流程做好，页面做好，UI 做好，每个工单就是一个小卡片在 Back Office 上 … 按原有 UI UX 风格 … TDD 锁住 … 推 dev"). Out of scope for v1 (owner said): Feishu sync, front-end tracking / ring buffer / traceparent, AI agent, SaaS.

## 1. Ownership (follows docs/System_Architecture_4_Components.md in LearningGuideAdmin)

- **Portal is the single writer** of tickets, messages, attachments and ticket events (user data; Portal owns users and notifications).
- **Admin (BackOffice)** never touches Portal's DB. Admin server calls Portal's integration API (server-to-server) and adds the employee identity. Admin client calls only Admin server.
- No shared tables. No Prisma changes in Admin.

## 2. States (server is the only place state changes)

| State | Learner sees (en-GB / zh-CN) | Agent sees |
|---|---|---|
| OPEN | Submitted / 已提交 | New / 待受理 |
| ASSIGNED | In progress / 处理中 | In progress / 处理中 |
| WAITING_USER | Awaiting your reply / 待你回复 | Waiting for learner / 等待用户 |
| PENDING_CONFIRM | Awaiting your confirmation / 待你确认 | Awaiting confirmation / 待用户确认 |
| CLOSED | Completed / 已完成 | Closed / 已结束 |
| CANCELLED | Withdrawn / 已撤回 | Withdrawn / 已撤回 |

Transitions (anything not listed is rejected with 409 `invalid_transition`, state unchanged, a structured log line `{type:"helpdesk",event:"transition_rejected",...}` is written):

| From | Command | Actor | To | Notes |
|---|---|---|---|---|
| (none) | create | learner | OPEN | |
| OPEN | cancel | learner | CANCELLED | close_reason=cancelled |
| OPEN | claim | agent | ASSIGNED | sets assignee |
| OPEN, ASSIGNED, WAITING_USER | agent_reply (public) | agent | WAITING_USER | auto-claims if unassigned |
| any non-terminal, CLOSED | internal_note | agent | (unchanged) | never shown to learner |
| WAITING_USER | learner_reply | learner | ASSIGNED | |
| OPEN, ASSIGNED | learner_reply | learner | (unchanged) | |
| ASSIGNED, WAITING_USER | propose_resolution | agent | PENDING_CONFIRM | confirm_due_at = now + 72h |
| PENDING_CONFIRM | confirm | learner | CLOSED | close_reason=user_confirmed |
| PENDING_CONFIRM | reject ("Not solved yet / 还没解决") | learner | ASSIGNED | optional message |
| PENDING_CONFIRM | learner_reply | learner | ASSIGNED | replying = not solved |
| ASSIGNED, WAITING_USER | close ("My issue is solved / 问题已解决") | learner | CLOSED | close_reason=user_closed |
| PENDING_CONFIRM (due passed) | auto_confirm | system | CLOSED | close_reason=auto_confirmed; applied lazily whenever tickets are read or listed (no scheduler) |
| CLOSED (closed_at within 7 days) | learner_reply ("Follow up / 追问") | learner | ASSIGNED | event `reopened`; after 7 days → 409 `reopen_window_passed` |
| CLOSED | rate (1–5, once) | learner | (unchanged) | only within 7 days of close |

Constants in one place: CONFIRM_WINDOW_HOURS=72, REOPEN_WINDOW_DAYS=7.

## 3. Data (Portal, migration `db/migrations/017_helpdesk_tickets.sql`, additive + repeatable like 014)

- `helpdesk_tickets`: id uuid PK (UUIDv7), number text UNIQUE (`LG-YYMMDD-NNNN`, UTC day, per-day counter), user_id text NOT NULL, user_email, user_name, locale ('en-GB'|'zh-CN'), category ('account'|'billing'|'learning'|'study_group'|'other'), subject (1–120), status, assignee_id, assignee_name, sequence int NOT NULL (last event sequence), confirm_due_at, closed_at, close_reason, rating smallint NULL CHECK 1..5, created_at, updated_at, last_message_at, last_message_by ('learner'|'agent'|'system'), client_event_id uuid UNIQUE, payload_hash.
- `helpdesk_ticket_counters` (day text PK, last int) — UPSERT increment for numbers.
- `helpdesk_ticket_messages`: id uuid PK, ticket_id FK, author_kind ('learner'|'agent'|'system'), author_id, author_name, body (1–5000), internal boolean, attachment_ids uuid[] / jsonb, client_event_id uuid UNIQUE, payload_hash, created_at.
- `helpdesk_attachments`: id uuid PK, ticket_id, message_id, uploader_kind, file_name, content_type ('image/png'|'image/jpeg'|'image/webp'), size_bytes (≤ 5 MB), storage_key, created_at. Max 3 per message. Magic-byte sniffing, not trusting the declared type. Stored via Portal's existing storage abstraction (local file in DEV, S3 elsewhere — reuse whatever avatar/portal media upload uses).
- `helpdesk_ticket_events` — **CloudEvents 1.0 field names**: id (UUIDv7), specversion '1.0', source ('/portal/helpdesk'), type (`com.ilovelearningguide.helpdesk.ticket.<snake_event>`: created, claimed, agent_replied, internal_note_added, learner_replied, resolution_proposed, resolution_rejected, confirmed, auto_confirmed, closed_by_learner, cancelled, reopened, rated), subject (ticket id), time (timestamptz, RFC 3339 on the wire), datacontenttype 'application/json', data jsonb (from_state, to_state, actor {kind,id,name}, reason, message_id), sequence int, UNIQUE (subject, sequence). Ticket row update + event insert + message insert happen in ONE transaction; ticket.sequence must equal the previous sequence (optimistic concurrency).
- Local fallback when PostgreSQL persistence is off and STORAGE_BACKEND is local (DEV only), mirroring `repositories/contactRequestRepository.ts`. Never in production.

## 4. Standards (no home-made protocols)

- IDs: UUIDv7 (RFC 9562). Times: RFC 3339, stored UTC.
- Idempotency: `Idempotency-Key` request header (IETF httpapi draft) on every POST that creates something (ticket, message, action). Same key + same payload → same result (200, `Idempotent-Replayed: true` header); same key + different payload → 409 `idempotency_conflict`. Stored as client_event_id + payload_hash with UNIQUE constraint.
- Concurrency: actions carry `expectedSequence`; mismatch → 409 `stale_ticket` (page reloads).
- Errors for the new endpoints: RFC 9457 `application/problem+json` `{ type, title, status, detail, code }` (`type` = `https://www.ilovelearningguide.com/problems/<code>`). Success bodies are plain JSON (no `{ok:true}` envelope) for these new endpoints.
- Service auth (Admin → Portal): `Authorization: Bearer <token>` (RFC 6750). Portal env `PORTAL_HELPDESK_TOKEN`; read on every request (no caching) so a rotated value applies without code change; if unset → 503 problem `integration_disabled`. Constant-time compare. Admin env `PORTAL_HELPDESK_BASE_URL` + `PORTAL_HELPDESK_TOKEN`, also read per request.
- Events: CloudEvents 1.0 field names (above).

## 5. Portal API

Learner (session cookie; only own tickets; 401 problem if not signed in; 404 for someone else's ticket):
- `POST /api/helpdesk/tickets` — multipart/form-data: category, subject, body, locale, files[] (0–3 images). Header Idempotency-Key. → 201 ticket detail.
- `GET /api/helpdesk/tickets` → `{ tickets: TicketSummary[] }` newest activity first.
- `GET /api/helpdesk/tickets/{id}` → TicketDetail (messages without internal notes; attachments as URLs to the attachment endpoint).
- `POST /api/helpdesk/tickets/{id}/messages` — multipart: body, files[]; Idempotency-Key; expectedSequence.
- `POST /api/helpdesk/tickets/{id}/actions` — JSON `{ action: "cancel"|"confirm"|"reject"|"close"|"rate", expectedSequence, rating?, message? }`; Idempotency-Key.
- `GET /api/helpdesk/attachments/{id}` — owner only; `Cache-Control: private, no-store`.

Integration (Bearer token; actor = `{ id, name }` from Admin, required on writes):
- `GET /api/integration/helpdesk/tickets?status=&q=&limit=&cursor=` → `{ tickets: AgentTicketSummary[], nextCursor }` (q matches number, email, subject). Counts per status in `{ counts }`.
- `GET /api/integration/helpdesk/tickets/{id}` → AgentTicketDetail (all messages incl. internal, attachments, events timeline, learner id/email/name/locale).
- `POST /api/integration/helpdesk/tickets/{id}/messages` — JSON `{ body, internal, agent:{id,name}, expectedSequence }` (attachments from agents not in v1).
- `POST /api/integration/helpdesk/tickets/{id}/actions` — JSON `{ action: "claim"|"propose_resolution", agent:{id,name}, expectedSequence }`.
- `GET /api/integration/helpdesk/attachments/{id}`.

Notifications: when an agent replies publicly or proposes resolution, add an in-app notification for the learner through the existing Portal notification path (Notification Center), linking to the ticket. If that path cannot be used safely from this module, leave a TODO in docs and say so — do not invent a second notification store. No emails in v1.

## 6. Portal UI (follow existing account pages' components/CSS; no new visual language; flag "待视觉验收" in docs because there is no Figma frame)

- `components/portal/AccountNav.tsx`: "Contact support" → `/{locale}/account/my-learning/support` (signed-in area). Public `/contact` stays for visitors.
- `/{locale}/account/my-learning/support`: title "Contact support / 联系客服"; form (category select, subject, description, up to 3 screenshots with previews and remove, submit; client-side size/type checks mirror server); below it "My requests / 我的工单" list of cards (number, subject, status pill, last update). Empty state.
- `/{locale}/account/my-learning/support/{id}`: header (number, subject, status pill), conversation (learner right / agent left with agent name, system lines for state changes), attachments thumbnails; action area by state: OPEN → reply box + Withdraw; ASSIGNED/WAITING_USER → reply box + "My issue is solved"; PENDING_CONFIRM → banner "Support has handled your request. Is it solved?" with "Confirm and close" / "Not solved yet" and auto-confirm countdown (relative time); CLOSED → "Follow up" (within 7 days) + 1–5 rating (once); CANCELLED → read only. Errors shown once, inline. 409 stale → reload ticket and show "This request was updated, please check again".
- i18n en-GB + zh-CN in `messages/*.json`.

## 7. BackOffice (LearningGuideAdmin)

- Server: `server/src/backoffice/modules/helpdesk/` (Portal client + service) and a Nest controller under the existing backoffice module, e.g. `/api/backoffice/helpdesk/tickets…`, mirroring §5 integration endpoints, adding the signed-in employee as `agent {id, name}`. Guarded by the existing route-access/RBAC: menu `helpDesk` VIEW → read only, FULL → write (follow whatever action-level permission pattern exists, commit 0c6e571). If Portal env is not configured → clear 503 that the UI shows as "HelpDesk is not connected yet".
- Client: replace the `help-desk` PlaceholderPage. `/:locale/help-desk`: filter tabs with counts (Needs reply = OPEN + ASSIGNED where last message is from learner; Waiting for learner; Awaiting confirmation; Closed; All), search box, grid of ticket **cards** (number, subject, category, learner name/email, status pill, assignee, relative last update, highlight when it needs a reply). `/:locale/help-desk/:ticketId`: conversation with internal notes visually distinct, attachments (images through Admin server proxy), right panel with learner info, status, assignee, events timeline; actions: Claim, Reply, Internal note, "Handled — ask learner to confirm". VIEW role sees no action controls. Uses existing AppShell / backoffice.css styles and en-GB/zh-CN messages.
- Admin repo process rules: update `docs/Learning_Guide_BackOffice_Agent_Development_Document.md` (§2 design first), add `docs/AI_Collaboration_Log.md` entry. Never run `npm run lint` in server (it --fix rewrites unrelated files) — use `npx eslint <files>`.

## 8. Tests first (TDD), every behaviour locked

Portal: unit tests (node:test, `tests/unit/helpdesk-*.test.ts`) for the transition table (every allowed + representative forbidden), windows (72h, 7 days), number format/counter, UUIDv7, contract parsing/limits, idempotency replay/conflict, stale sequence, ownership, attachment sniffing; PG io test (`tests/io/postgres/helpdesk-*.test.ts`) for uniqueness and concurrent sequence; e2e (`tests/e2e/helpdesk-support.spec.ts`): learner submits with a screenshot → sees card → integration API agent replies → learner replies → agent proposes resolution → learner confirms → rating; and withdraw; and someone else's ticket 404. Admin: jest specs for the Portal client (fetch mocked: auth header, problem+json mapping, 503 when unset), controller RBAC (VIEW cannot write), service actor injection.

## 9. Delivery

- Branch `claude/project-thread-pn4rf0` in both repos, based on upstream dev (Portal fde700c, Admin 66af613). Conventional commits. Push to fork first; upstream dev push goes through the owner's Mac.
- Ops note (not ours): set `PORTAL_HELPDESK_TOKEN` on Portal and `PORTAL_HELPDESK_BASE_URL` + `PORTAL_HELPDESK_TOKEN` on Admin; run migration 017 on DEV RDS (normal startup migration path, if that's how 014 was applied).

## 10. Portal backend implementation notes (2026-10-28)

Code map: `contracts/helpdesk.ts` (types, `HELPDESK_LIMITS`, parsing, RFC 9457 problem codes), `modules/helpdesk/domain.ts` (records, the single `TRANSITIONS` table, `CONFIRM_WINDOW_HOURS` / `REOPEN_WINDOW_DAYS`, numbering), `modules/helpdesk/service.ts` (the only place state changes), `modules/helpdesk/repository.ts` (storage port), `repositories/helpdeskRepository.ts` (PostgreSQL + DEV-only local file fallback), `modules/helpdesk/http.ts` (auth, Idempotency-Key, multipart, problem+json), `modules/helpdesk/runtime.ts` (wiring), `lib/uuidv7.ts`, Route Handlers under `app/api/helpdesk/**` and `app/api/integration/helpdesk/**`.

- Check order for every command: ownership (404) → Idempotency-Key replay/conflict → lazy auto-confirm → `expectedSequence` (409 `stale_ticket`, body carries `currentSequence`) → transition table (409 `invalid_transition` / `reopen_window_passed` / `rating_window_passed` / `already_rated`) → one transaction (ticket UPDATE guarded by `sequence = expected`, message, attachments, event).
- Idempotency: the key must be a UUID (bare or as an sf-string `"…"`); missing → 400 `idempotency_key_required`. The payload hash covers actor, ticket and content (file SHA-256s), not `expectedSequence`, so a retry replays with 200 + `Idempotent-Replayed: true` and the current ticket view. The key is stored on the ticket (create), on the message (if any) and on the event (every command); all three columns are UNIQUE.
- Learner POSTs additionally require a same-origin `Origin` header (403 `forbidden_origin`), as `app/api/courses/[courseId]/learning-mode` does.
- Internal notes advance `sequence` (they are events) but not `updated_at` / `last_message_*`; a learner whose page predates an internal note gets one 409 `stale_ticket` and reloads.
- Auto-confirm (`closed_at = confirm_due_at`, actor `system`) is applied lazily on every learner/agent read and list (no scheduler); the follow-up and rating windows start at `closed_at`.
- Attachments: magic bytes via `sniffImage` (services/portalMedia.ts); bytes stored with `services/fileStore` `writeBinary` (local file in DEV, S3 + `app_files` with persistence) at `learning_guide/helpdesk_attachments/<ticketId>/<attachmentId>.bin`. Bytes are written before the DB transaction; a failed transaction can leave an unreferenced object (no learner-visible effect).
- Notifications: agent public reply and propose_resolution call `recordUserNotification` (services/productStore.ts) with a locale title and body `<number> · <subject>`. TODO: Notification Center rows have no link field and `/api/my-learning/notifications` is still the ML-FR-019 placeholder, so the row is stored but not yet shown and cannot link to the ticket; adding an optional link field is a separate change. Notification failures are logged (`notification_failed`) and never fail the agent's command.
- Schema: `db/migrations/017_helpdesk_tickets.sql` is mirrored in the `ensureSchema()` bootstrap batch and freshness probe (`services/persistence/db.ts`, pinned by `tests/unit/helpdesk-migration.test.ts`), so the normal startup path self-heals; `npm run helpdesk:migrate` (dry run) / `-- --apply` applies it explicitly. Deviation from §3: `helpdesk_ticket_events` also carries `client_event_id UUID UNIQUE` + `payload_hash` so actions without a message are idempotent.
- Tests: `tests/unit/helpdesk-{domain,contract,service,migration,api}.test.ts`, `tests/io/postgres/helpdesk-repository.test.ts` (`DATABASE_URL=… DATABASE_SSL=0 npm run test:io:pg`). The browser e2e in §8 belongs to the page slice.
- UI status: pages not part of this slice; when built they need 待视觉验收 (no Figma frame).
