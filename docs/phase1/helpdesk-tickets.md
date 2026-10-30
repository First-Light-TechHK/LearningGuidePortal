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
- Idempotency: `Idempotency-Key` request header (IETF httpapi draft) on every POST that creates something (ticket, message, action). Same key + same payload → same result (200, `Idempotent-Replayed: true` header); same key + different payload → 422 `idempotency_conflict` (draft-ietf-httpapi-idempotency-key-header; 409 stays for stale/invalid state). Stored as client_event_id + payload_hash with UNIQUE constraint.
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
- Internal notes advance `sequence` (they are events) but not `updated_at` / `last_message_*`; a learner whose page predates an internal note gets one 409 `stale_ticket` and reloads (superseded in §12: agent-private events no longer make a learner stale).
- Auto-confirm (`closed_at = confirm_due_at`, actor `system`) is applied lazily on every learner/agent read and list (no scheduler); the follow-up and rating windows start at `closed_at`.
- Attachments (types and limits superseded in §12): magic bytes via `sniffImage` (services/portalMedia.ts); bytes stored with `services/fileStore` `writeBinary` (local file in DEV, S3 + `app_files` with persistence) at `learning_guide/helpdesk_attachments/<ticketId>/<attachmentId>.bin`. Bytes are written before the DB transaction; a failed transaction can leave an unreferenced object (no learner-visible effect).
- Notifications: agent public reply and propose_resolution call `recordUserNotification` (services/productStore.ts) with a locale title and body `<number> · <subject>`. TODO: Notification Center rows have no link field and `/api/my-learning/notifications` is still the ML-FR-019 placeholder, so the row is stored but not yet shown and cannot link to the ticket; adding an optional link field is a separate change. Notification failures are logged (`notification_failed`) and never fail the agent's command.
- Schema: `db/migrations/017_helpdesk_tickets.sql` is mirrored in the `ensureSchema()` bootstrap batch and freshness probe (`services/persistence/db.ts`, pinned by `tests/unit/helpdesk-migration.test.ts`), so the normal startup path self-heals; `npm run helpdesk:migrate` (dry run) / `-- --apply` applies it explicitly. Deviation from §3: `helpdesk_ticket_events` also carries `client_event_id UUID UNIQUE` + `payload_hash` so actions without a message are idempotent.
- Tests: `tests/unit/helpdesk-{domain,contract,service,migration,api}.test.ts`, `tests/io/postgres/helpdesk-repository.test.ts` (`DATABASE_URL=… DATABASE_SSL=0 npm run test:io:pg`). The browser e2e in §8 belongs to the page slice.
- UI status: pages not part of this slice; when built they need 待视觉验收 (no Figma frame).

## 11. Figma alignment addendum (2026-10-28, copied word for word; it overrides §1–9 where they differ)

Original title: Helpdesk v1: Figma alignment addendum (2026-10-28)

Source: Figma file sxro3x6YXENJvjhGExmlQ7, page 1180:2 "后台（Reporting+HelpDesk）". The owner said on 2026-10-28T06:45Z that the pages will still change somewhat, so build them to be easy to adjust.

| Frame | Node | Screenshot |
|---|---|---|
| 2.0 Learner entry (Personal settings → "Contact us" card → Contact support) | 1214:5 | /mnt/project-files/lg-helpdesk/figma/student-entry-1214-5.png |
| 2.1 Learner Contact Support form + Common Questions | 1216:6 | /mnt/project-files/lg-helpdesk/figma/student-contact-support-1216-6.png |
| 2.1 Learner AI Support Assistant modal | 1333:249 | /mnt/project-files/lg-helpdesk/figma/student-ai-assistant-1333-249.png |
| 2.2 BackOffice HelpDesk, Enquiries tab | 1324:2 | /mnt/project-files/lg-helpdesk/figma/backoffice-enquiries-1324-2.png |

The "废除" frame (1260:2) is obsolete. Ignore it.

Agents can call the Figma MCP tools for exact values: create_session with that fileKey, then get_design_context or get_screenshot on the nodes above.

This addendum OVERRIDES tickets-v1-spec.md wherever the two differ. The parts that stay unchanged are:
- Ownership: Portal is the single writer of tickets.
- The state machine.
- Concurrency: sequence plus 409 stale_ticket, idempotency, the per-day counter.
- Events, integration auth and the standards.

Visible UI follows Figma. When a needed state has no frame, reuse existing styles and list it under "待视觉验收" in the final report.

### A. QA knowledge-base data layer ("Common Questions"): Admin owns it

Admin owns Common Questions; Portal only reads the published ones. This follows the 4-component rule: one writer per dataset.

Admin Prisma migration with two tables:

- **helpdesk_questions**:
  - `id uuid` (UUIDv7)
  - `locale` ('en-GB' | 'zh-CN')
  - `category` (enquiry type, §B)
  - `question` (≤200)
  - `answer` (plain text with line breaks, ≤4000; URLs auto-linked at render)
  - `keywords text[]`
  - `status` ('draft' | 'published' | 'archived')
  - `featured bool`: shown in the Portal right column
  - `sort_order int`
  - `version int`: optimistic concurrency. Each update is `WHERE id AND version`, and a mismatch returns 409.
  - `created_by`, `updated_by` (employee id), `created_at`, `updated_at`
- **helpdesk_question_revisions** (append-only): `id`, `question_id`, `version`, `snapshot jsonb`, `action` (create | update | publish | unpublish | archive), `employee_id`, `at`. Written in the same transaction as the change.

BackOffice UI: the HelpDesk page has two tabs, "Enquiries" and "Common Questions" (Figma 1324:2).
- The "+ Add Question" button in the header opens a create/edit modal. Fields: locale, category, question, answer, keywords, featured, publish now.
- The Common Questions tab is a list/table with filters (locale, category, status), edit, publish/unpublish, archive and sort order. There is no Figma frame for this tab: reuse the existing Knowledge/AI Tutor table and modal styles, flagged 待视觉验收.
- RBAC: helpDesk FULL can write, VIEW is read-only.

Admin integration API for Portal (§E auth):
- `GET /api/integration/helpdesk/questions?locale=en-GB&featured=true` returns `{ questions: [{id, category, question, answer}], etag }`. It returns published questions only, ordered by sort_order, and supports `ETag` / `If-None-Match`.

### B. Learner (Portal)

**Entry.** The AccountNav sidebar "Contact us" card has a "Contact support" link (Figma 1214:5). It goes to the support page `/{locale}/account/my-learning/support`.

**Contact Support page** (Figma 1216:6). It is a full-width white card under the normal top nav, not inside the account sidebar layout. Left column, the form:
- Enquiry Type* is a select with "Select a topic" and four options. Store these four values as the ticket `category` and replace the old category list:

  | Stored value | Label |
  |---|---|
  | `technical_support` | Technical Support |
  | `course_content` | Course Content |
  | `payments_subscriptions` | Payments & Subscriptions |
  | `other` | Other Enquiries |

- Subject* (≤120) and Message* (≤5000).
- Attachment drop zone: "Paste screenshots here or upload attachments", "Upload files" button, "max 10 MB each".
  - Allow up to 5 files, 10 MB each. Allowed types: png, jpeg, webp, gif, pdf, txt, csv, docx, xlsx.
  - Validate by magic bytes or structure, not only the extension.
  - Serve images inline and everything else as a download. Always send `X-Content-Type-Options: nosniff`.
  - Never serve html or svg.
- Your Email* is the contact email. It defaults to the account email, can be edited, and is validated. Store it on the ticket as `contact_email`.
- The note "Our support team will review your enquiry and reply to you by email…", then Cancel (back) and Submit Enquiry.

Right column: "Common Questions". It shows the featured published questions for the locale, fetched server-side from Admin (§A) with a 60 s cache. On error it serves stale data, or hides the column if there is nothing cached. Clicking a row expands the answer inline (accordion, chevron rotates; 待视觉验收).

**Submit flow**, with the agent from §C:
1. Submit Enquiry first validates on the client, then calls `POST /api/helpdesk/suggestions {category, subject, message, locale}`. This creates no ticket and sends no attachments to the model.
2. If it returns a suggestion, show the AI Support Assistant modal (Figma 1333:249):
   - Top: the learner's enquiry (initials avatar, subject, type tag, email · time, body, attachment chips).
   - Middle: the answer block, "Hi {first name}! Here's a possible solution to your issue:" followed by the approved QA answer verbatim.
   - Footer: "Was this helpful?" with three buttons:
     - "Yes, this solved my issue": report outcome `solved` and create no ticket. Show a small thank-you state (待视觉验收), then go back to the account page.
     - "No, still submit to support team": create the ticket, with `suggestionId` recorded as event `ticket.suggestion_declined`. Report outcome `declined`.
     - "Edit my enquiry": close the modal and keep the form filled. Report outcome `edited`.
3. If there is no suggestion, or on any error or a 4 s timeout, create the ticket directly. The suggestion step must never block submitting.
4. After the ticket is created, show a success state with the ticket number and a link to "My enquiries" (待视觉验收).

**My enquiries.** The list, the detail view and the confirm-end flow have no Figma frame yet. Keep them minimal, reuse existing account styles, and flag them 待视觉验收. The owner asked for the Taobao-style confirm, so keep it:
- PENDING_CONFIRM shows a short prompt (owner asked 06:50Z to keep it short): zh-CN "问题解决了吗？" with buttons "已解决" / "没解决"; en-GB "Is it solved?" with "Solved" / "Not yet". In emails and notifications use the same short wording.
- Self-close, follow-up within 7 days, and the rating stay as in the spec.

**Email.** Figma says replies come by email. When an agent replies or marks the ticket handled, Portal sends an email to `contact_email` through the existing services/emailService.ts, with a link to the ticket. The in-site notification also stays. Email failure must not fail the action.

### C. Agent (suggestions): Admin's agent role

Admin already has an OpenRouter provider (server/src/ai/providers/openrouter.provider.ts, provider.registry.ts) and a DB rate limit (ai_rate_limit_hits). Reuse them, behind the existing ModelGateway/provider interface.

`POST /api/integration/helpdesk/suggest` takes `{learnerId, locale, category, subject, message}` and returns `{ suggestion: {id, qaId, question, answer} | null }`. Steps:
1. Retrieve candidates from published questions in that locale: PostgreSQL full-text search plus keyword match, with a boost for the same category. Keep the top 8. If there are none, return null without calling the model.
2. Call the model through OpenRouter with structured output `{qaId: string|null}`. The model may only choose one of the candidate ids or null; the server rejects anything else.
   - The model is `HELPDESK_SUGGEST_MODEL`, defaulting to the first cheap model in AI_AVAILABLE_MODELS.
   - Timeout is 3 s.
   - With no API key, or on any error, return null.
3. Return the stored answer verbatim. The model never writes text shown to the learner.
4. Rate limit is 10 per learner per hour; over the limit, return null.
5. Log each suggestion to **helpdesk_suggestions**:
   - Columns: `id` (UUIDv7), `learner_id`, `locale`, `category`, `query_text`, `candidate_ids`, `qa_id|null`, `model`, `latency_ms`, `outcome` (null | solved | declined | edited), `created_at`.
   - `query_text` is kept 90 days.
   - Clean-up is a delete in the existing scheduled path if one exists; otherwise document it as an ops note.

`POST /api/integration/helpdesk/suggestions/{id}/outcome {outcome}` is idempotent: the first value wins, and the same value repeated is OK.

The Common Questions tab shows per-question counters derived from helpdesk_suggestions: shown, solved, declined.

### D. BackOffice Enquiries tab (Figma 1324:2): replaces the card board

The layout has three columns inside the normal AppShell content card. The page header is "Help Desk" with the subtitle "Manage student enquiries and common questions", the "+ Add Question" button, and the tabs.

**Left (340 px)**
- Search: "Search students or enquiries…" matches name, email, subject or ticket number. The filter button opens filters for status, enquiry type and tag.
- Rows show:
  - an initials avatar, colour picked deterministically from the learner id
  - the name, and the time ("HH:mm" for today, else "16 May")
  - the subject (bold) and a one-line preview
  - an unread dot when `unreadByAgent` is set
- The selected row is highlighted with a left blue bar. Paged with a cursor; scrolling loads more.

**Middle**
- A date separator, then the enquiry card: subject, enquiry-type tag, "contact email · time", body, attachment chips (name + size, opens through the Admin proxy) and "Mark as reviewed".
- Below the card are later messages (learner and agent), then a reply composer. The composer has no Figma frame yet (待视觉验收).
- Internal notes are visually distinct and never shown to learners.
- "Mark as reviewed" maps to the existing `propose_resolution` action: the ticket goes to PENDING_CONFIRM and the learner is asked to confirm. This mapping is an assumption; report it as an open question.
- Replying auto-claims the ticket if it is unassigned.

**Right (387 px)**
- Name and email, then "Student Information": Account Email, Contact Email, Joined Date, Student ID, Total Enquiries, Current Course.
- "Current Subscription Plan" (calendar icon): Plan Name, Billing Cycle, Status pill (Active in green), Renewal Date. If there is no plan, show "—".
- "Tags" with "+ Add Tag": coloured chips, colour deterministic from the tag text; click × to remove (FULL only).

VIEW users see everything but no write controls.

Portal integration API changes (Portal stays the single writer):
- Agent summary adds `contactEmail`, `preview` (first 120 chars of the first message), `unreadByAgent` and `tags`.
- Agent detail adds:
  - `student {id, name, accountEmail, contactEmail, joinedAt, totalEnquiries, currentCourse:{id,title}|null}`: Student ID shows Portal's user id. Read-only from existing Portal data; no new writes to productStore.
  - `subscription {planName, billingCycle, status, renewalDate}|null`: read-only. Order/subscription logic belongs to the order/payment owner, so only read what already exists.
  - `tags`.
- New actions on `POST .../tickets/{id}/actions`: `add_tag {tag}`, `remove_tag {tag}` (tag ≤32 chars, ≤10 per ticket, idempotent, event `ticket.tag_added` / `ticket.tag_removed`) and `mark_read` (clears unreadByAgent).
  - Tags live in a new table `helpdesk_ticket_tags(ticket_id, tag, created_at, PRIMARY KEY(ticket_id, tag))` in a new migration `018_helpdesk_ticket_tags.sql`, or folded into 017 if 017 is not yet on any shared branch (it isn't).
  - `unread_by_agent bool` goes on helpdesk_tickets. It is set when a learner creates a ticket or posts a message, and cleared by `mark_read`, which the BackOffice calls when an agent opens the ticket.
- Learner create accepts `contactEmail` and `suggestionId`.

### E. Service-to-service auth

| Direction | Portal side | Admin side |
|---|---|---|
| Admin calls Portal (tickets) | `PORTAL_HELPDESK_TOKEN` | `PORTAL_HELPDESK_BASE_URL` + `PORTAL_HELPDESK_TOKEN` |
| Portal calls Admin (questions, suggest, outcome) | `ADMIN_HELPDESK_BASE_URL` + `ADMIN_HELPDESK_TOKEN` | `ADMIN_HELPDESK_TOKEN` |

Both directions read the env per request, compare with timingSafeEqual and return RFC 9457 errors.

The Admin integration routes must bypass the employee-login guard and use only the Bearer check. Make that exemption explicit in route-access, with a test.

### F. Tests (TDD, as in the spec)

**Admin**
- Questions repository/service: version conflict 409, revision rows, publish filter, ETag.
- Suggest:
  - no candidates → no model call
  - model returns a non-candidate id → null
  - timeout → null
  - rate limit → null
- Outcome idempotency.
- Integration auth: missing or wrong token → 401, empty env → 503.
- RBAC for the questions endpoints.

**Portal**
- Create with contactEmail and suggestionId.
- Attachment type and size limits (10 MB, 5 files, magic bytes).
- Tags and mark_read actions.
- Unread flag transitions.
- Student/subscription projection.
- Email sent on reply and on propose_resolution (mock the email service).
- e2e: form → suggestion modal (stub Admin via env base URL to a local stub server) → each of the three buttons → ticket created or not as expected.

## 12. Portal backend notes for the addendum (2026-10-28)

Scope of this slice: §B data/API, §D Portal integration changes, §E Portal→Admin client and the learner Route Handlers. Pages, the Admin side and the browser e2e are other slices.

- Schema: folded into `017_helpdesk_tickets.sql` (not on any shared branch yet): categories `technical_support | course_content | payments_subscriptions | other`; `contact_email` (3–254), `suggestion_id`, `unread_by_agent`; attachments ≤ 5 per message, ≤ 10 MB, nine content types; new `helpdesk_ticket_tags` (PK ticket_id + tag, tag 1–32) with a tag index. The bootstrap/probe mirror is updated and pinned by `tests/unit/helpdesk-migration.test.ts`. A database that already ran the earlier 017 (only local scratch databases) must drop the five helpdesk tables once; the io suite does this itself.
- Contact email: optional multipart field `contactEmail`; blank means the account email; an account without an email (WeChat) must send one (`validation_failed`, field `contactEmail`). Plain addresses only (no display name, no header characters).
- Declined suggestion: optional `suggestionId` (UUID). The ticket then has two events: `created` (sequence 1, carries the Idempotency-Key) and `suggestion_declined` (sequence 2, `data.suggestion_id`). The learner timeline hides it; agents see it and `suggestionId` on the detail.
- Attachments (`modules/helpdesk/attachments.ts`): PNG/JPEG/WebP (existing `sniffImage`), GIF and PDF by magic bytes; DOCX/XLSX by their ZIP central directory (`[Content_Types].xml` plus `word/document.xml` or `xl/workbook.xml`; macro documents with `vbaProject.bin` are refused); TXT/CSV need the extension plus text that does not look binary and has no markup start (`<html`, `<svg`, `<?xml`, …); the encodings are listed under "TXT / CSV encodings" below. Stored names always end with an extension of the detected type. Serving: images `inline`, everything else `attachment`; always `X-Content-Type-Options: nosniff`, `Content-Security-Policy: default-src 'none'; sandbox`, `Cache-Control: private, no-store`; text types add `; charset=utf-8` / `utf-16le` / `utf-16be` for what the bytes are, and no charset for a legacy encoding. BackOffice passes that charset through as it is (only those three) and never adds one of its own.
- Request size: Next 15 clones (and truncates at `experimental.middlewareClientMaxBodySize`, default 10 MB) the body of every request the middleware runs on. That default stays in force site-wide (`next.config.ts` is unchanged); instead the middleware matcher skips exactly the two multipart upload paths, `/api/helpdesk/tickets` and `/api/helpdesk/tickets/{id}/messages`. Their handlers apply the same admin-host rule first (`adminHostResponse` in `modules/helpdesk/http.ts`: the identical 404 / 307), and `readMultipart` bounds the body to `HELPDESK_MULTIPART_MAX_BYTES` (5 × 10 MB + 1 MB): an oversize `Content-Length` gets 413 `attachment_too_large` before anything is read, and a body without one is cut off with the same 413 as soon as it passes the bound. Any proxy in front of App Runner must allow 51 MB on those two paths.
- Attachment bytes are written (after type checks) before the ticket change commits; when the change does not commit (lost `sequence` race, reused Idempotency-Key, storage error) the service deletes them again (best effort, `attachment_cleanup_failed` is logged).
- Tags: `add_tag` / `remove_tag` with `{ tag }` (trimmed, inner spaces collapsed, NFKC, lower case, ≤ 32), at most 10 per ticket (409 `tag_limit_reached`). Adding a present tag or removing a missing one is a no-op (no event). Each real change is an event (`tag_added` / `tag_removed`, `data.tag`) that does not move `updatedAt`. `expectedSequence` is optional; tags apply to the current sequence and a lost race is retried (up to 6 times with jitter).
- Stale check refinement: tag events never make anyone stale, and agent-private events (internal notes, tags) never make a learner stale (`ignoredByStaleCheck` in `domain.ts`). This removes the §10 side effect where a learner's page went stale after an internal note.
- Unread flag: set on create, whenever a learner posts a message (reply, follow-up, "not solved" with a message), and when a learner presses "Not yet" / 没解决 without a message (`resolution_rejected` counts as learner activity: it also moves `lastMessageAt` / `lastMessageBy` to the learner, so the ticket is back in Needs reply and its count); cleared only by `mark_read`, which is not an event and does not change `sequence`. In SQL the flag is only ever raised by `appendChange` (`unread_by_agent OR $markUnread`) and cleared by `markRead`, so a stale snapshot cannot undo either. `mark_read` may carry `expectedSequence` (the sequence the agent's view showed; BackOffice always sends it): the flag is then cleared only while `sequence <= expectedSequence`, so a learner message that arrives between the agent loading the ticket and `mark_read` keeps its unread dot. Without it the flag is cleared unconditionally.
- Agent list: `q` also matches the learner name and the contact email; new filters `category` and `tag`; `counts` follow `q`, `category` and `tag` but not `status`. Summaries add `contactEmail`, `preview` (first message, whitespace collapsed, 120 characters), `unreadByAgent`, `tags`.
- Student / subscription projection (`modules/helpdesk/studentDirectory.ts`, wired in `runtime.ts` to `ensureProductData()` — the same read `getUserById` uses; nothing is written): `student {id (Portal user id), name, accountEmail, contactEmail, joinedAt, totalEnquiries (count of the learner's tickets), currentCourse (most recently updated study record whose course exists)}`; `subscription {planName, billingCycle ("annual" for 12-month plans, "semiannual" for 6-month, null if the plan is gone), status (active | cancel_at_period_end | grace), trial, renewalDate (validTo while active and renewing, else null), validTo}` from the live subscription (state active / cancel_at_period_end / grace and not past its end; latest end wins), else null. If the read fails, the detail still answers with the ticket's own learner fields and `subscription: null` (logged `student_directory_failed`).
- Email (`sendHelpdeskUpdateEmail`, existing SMTP path): agent public reply → subject `[<number>] Support replied to your enquiry` / `[<number>] 客服回复了你的咨询`, body with the reply text and a link; "handled" (propose_resolution) → subject `[<number>] Is it solved?` / `[<number>] 问题解决了吗？` (the owner's short wording) with a link and the 72-hour note. Link: `NEXT_PUBLIC_APP_URL` (via `publicAppOrigin()`) + `/{locale}/account/my-learning/support/{ticketId}`; without a public origin the link line is left out. Sent in the background; failures are logged as `email_failed` with ticket id only (no address) and never fail the action. The in-site notification title for "handled" is now the short "Is it solved?" / "问题解决了吗？".
- Portal→Admin client (`modules/helpdesk/adminClient.ts`): reads `ADMIN_HELPDESK_BASE_URL` + `ADMIN_HELPDESK_TOKEN` per call (http/https only; unset → questions hidden, no suggestion, outcome not delivered). Questions: `GET {ADMIN}/api/integration/helpdesk/questions?locale=&featured=true`, 60 s in-process cache per base URL + locale, revalidation with `If-None-Match`, a 304 restarts the 60 s window, stale data on any error, `null` (hide) when nothing is cached, 3 s timeout, malformed rows dropped. Suggest: `POST {ADMIN}/api/integration/helpdesk/suggest {learnerId, locale, category, subject, message}` with a 4 s timeout; any error, non-200, malformed body or timeout → `null`. Outcome: `POST {ADMIN}/api/integration/helpdesk/suggestions/{id}/outcome {outcome}`, 4 s timeout, 2xx → delivered. The token is never logged.
- Learner routes (thin): `GET /api/helpdesk/common-questions?locale=` (signed in) → `{ questions }` (`[]` = hide the column); `POST /api/helpdesk/suggestions` (signed in, same origin, JSON; no Idempotency-Key because nothing is created on Portal) → `{ suggestion | null }`; `POST /api/helpdesk/suggestions/{id}/outcome` (signed in, same origin) → 204, or 503 `assistant_unavailable` when Admin could not be told (pages ignore it).
- Open question kept from §D: "Mark as reviewed" maps to `propose_resolution` (the learner is asked "Is it solved?").

## 13. Portal learner pages (2026-10-28, addendum §B)

Routes (signed-in; a signed-out visit goes to sign-in with `returnTo`):

| Route | What | Design |
|---|---|---|
| `/{locale}/account/my-learning/support` | Contact Support form + Common Questions; AI Support Assistant modal; success state | Figma 1216:6 and 1333:249 (success state and expanded answer: 待视觉验收) |
| `/{locale}/account/my-learning/support/enquiries` | My enquiries: one card per ticket (number · type, subject, status pill, last update), empty and unavailable states | 待视觉验收 (account layout) |
| `/{locale}/account/my-learning/support/{id}` | Enquiry page: conversation (learner right, agent left with name, state lines), attachments, actions from `allowedActions` | 待视觉验收 (account layout) |

- `components/portal/AccountNav.tsx`: the "Contact us" card's "Contact support" link now goes to the support page (Figma 1214:5). Public `/contact` is unchanged for visitors.
- Code: `components/helpdesk/ContactSupport.tsx` (form, select, Common Questions accordion, modal, success), `components/helpdesk/EnquiryDetail.tsx`, `components/helpdesk/HelpdeskParts.tsx` (drop zone with paste, chips, status pill, attachments), `components/helpdesk/helpdeskApi.ts` (browser calls), `components/helpdesk/helpdesk.css` (all values in one file so the pages are easy to adjust), `modules/helpdesk/learnerUi.ts` (pure helpers), `modules/helpdesk/learnerUiConfig.ts` (limits/types from the contract, passed to the client as props because the contract imports `node:crypto`), `modules/helpdesk/learnerPages.ts`. Copy: `messages/*.json` → `helpdesk`.
- Submit flow: validate in the page → `POST /api/helpdesk/suggestions` (5 s browser timeout; any failure = no suggestion) → modal or direct create. Yes = outcome `solved`, no ticket, thank-you then back to `/account/my-learning` after 2 s. No = create with `suggestionId`, outcome `declined`. Edit (and the close button / Escape) = outcome `edited`, form kept. Outcomes are fire-and-forget.
- Writes: one `Idempotency-Key` per logical submit (reused when the same payload is retried after a network error or 5xx; new after success, after a 4xx or when the payload changes). Replies and actions send the shown `sequence` as `expectedSequence`; a 409 (`stale_ticket` / `invalid_transition`) reloads the ticket and shows "This request was updated, please check again". 401, 404, 413, 415, 400/422 and 5xx each map to one message (`problemMessageKey`).
- Attachments: up to 5 × 10 MB, extension list mirrors the server's nine types (the server still checks bytes and answers 415/413). Files can be chosen, dropped, or pasted anywhere in the form.
- PENDING_CONFIRM: short prompt "Is it solved?" / "问题解决了吗？" with "Solved"/"Not yet" ("已解决"/"没解决") and the auto-close time. CLOSED within 7 days: "Follow up" composer and 1–5 rating (once). OPEN: Withdraw (two-step). ASSIGNED / WAITING_USER: "My issue is solved". CANCELLED / closed window: read-only note.
- Tests: `tests/unit/helpdesk-learner-ui.test.ts`; browser `tests/e2e/helpdesk-support.spec.ts` (own config `playwright.helpdesk.config.ts`, `npm run test:e2e:helpdesk`, local only: it needs the DEV-only local store; DEV server on 127.0.0.1:3014 with `ADMIN_HOSTS` pinned as in `playwright.studygroup.config.ts`) with `tests/e2e/helpdesk-admin-stub.mjs` standing in for Admin. The shared `playwright.e2e.config.ts` is unchanged.

## 14. Two-app integration run and the locked wire contract (2026-10-28)

Portal (dev, DEV + local storage), the BackOffice server (local PostgreSQL 16 + pgvector, all Prisma migrations) and the BackOffice client (Vite) were run together on one machine, wired with local test tokens only (`PORTAL_HELPDESK_TOKEN`, `ADMIN_HELPDESK_BASE_URL` / `ADMIN_HELPDESK_TOKEN`). The suggestion model is a local fake OpenRouter endpoint; no real key is used. The start / reset / run scripts are kept outside the repo in the project folder `lg-helpdesk/integration-harness/`.

- `tests/e2e/helpdesk-integration.spec.ts` with `playwright.helpdesk-integration.config.ts` (local only; it starts nothing and every test is skipped unless `HELPDESK_INT_BACKOFFICE_URL` is set). It drives both apps in the browser: an employee creates and publishes three Common Questions (one featured) → the learner sees only the featured one → a matching enquiry opens the assistant modal → "No, still submit" with a pasted screenshot → the BackOffice row is unread → opening clears it; student info, plan "—", tag, internal note, reply → the learner sees the reply but not the note → a learner reply makes the row unread again → "Mark as reviewed" → the learner confirms → the BackOffice shows Closed. Also: "Yes, this solved my issue" creates no ticket and the question's counter shows solved; a helpDesk VIEW employee sees no write controls and sends no writes; zh-CN on both sides, including a learner with a plan (billing cycle and status labels).
- `tests/fixtures/helpdesk-contract.json` is the wire contract captured from that run and anonymised. The same file is in the Admin repo (`server/src/backoffice/tests/fixtures/` and `client/tests/fixtures/`); change all copies together. `tests/unit/helpdesk-contract-fixture.test.ts` locks the Portal side: enums (statuses, enquiry types, locales, agent actions, attachment types and which are inline, `SUBSCRIPTION_STATUSES`, `BILLING_CYCLES`, suggestion outcomes, the problem codes an agent call can get), the integration list and detail shapes served by the real route handlers, Admin's message and action bodies, the stale problem body, and the Portal→Admin client's requests and response parsing for questions, suggest and outcome.
- Fixes this run produced were all on the Admin side (labels for `semiannual` / `cancel_at_period_end` / `grace`, `expectedSequence` ≥ 1, Portal 400 codes mapped to one message, `charset=utf-8` kept on txt/csv (since the encodings change below: Portal's charset passed through, none added), 401 code `invalid_token` in both directions). Portal only gained the two exported constants above.
- Open (product): "Mark as reviewed" = `propose_resolution` is still an assumption, and the state machine only allows it on ASSIGNED / WAITING_USER, so a brand-new (OPEN) enquiry must be replied to first although Figma draws the button on a new enquiry.

## 15. Review fixes (2026-10-28)

- Text: subject, message, internal note, "not solved" message, agent `{id, name}`, contact email and the agent search `q` refuse control characters other than tab, line feed and carriage return (C0, DEL, C1) with 400 `validation_failed` (PostgreSQL TEXT cannot store U+0000; it used to surface as 503). Every length limit counts Unicode code points, as `char_length` does in migration 017, on the server and in the learner pages (one pure rule in `contracts/helpdeskText.ts`); text made only of whitespace and zero-width characters is empty. The pages' `maxLength` is twice the limit (UTF-16 units) so it never cuts off text the server accepts; the page's own check is the real limit.
- Rate limits (per learner, rolling hour, counted from the existing tables, no counter table): at most `ticketsPerHour` = 10 new tickets and `learnerMessagesPerHour` = 60 learner messages (every public learner message on the learner's tickets, a ticket's first message and a "not solved" message included). Over the limit: 429 `rate_limited` with `Retry-After` (seconds until the oldest counted item is an hour old; also `retryAfter` in the problem body), logged as `rate_limited`. Checked after the idempotency replay (a retried request still replays) and before any attachment is stored. Agents and learner actions without a message are not limited. Racing requests can pass a limit by a few: it is a brake on floods, not an exact quota.
- Upload memory: `readMultipart` no longer collects the body into chunks and then a second whole copy before parsing. The body goes through a counting pass-through stream straight into the multipart parser (413 from `Content-Length` up front, or once the bytes that went through pass `HELPDESK_MULTIPART_MAX_BYTES`, cancelling the source), so a 51 MB request holds the parser's copy and the file bytes, not two more.
- TXT / CSV encodings: besides UTF-8, a txt/csv attachment may be UTF-16 with a BOM (Notepad, Excel "Unicode Text") or a legacy ASCII-compatible encoding (GBK from Excel on Chinese Windows, Big5, Shift_JIS, Windows-1252, ...). It is refused only when it looks binary: a control byte other than tab / LF / FF / CR (NUL included; UTF-16 is checked after decoding), an invalid UTF-16 body, or a markup start. Served back with `; charset=utf-8` / `utf-16le` / `utf-16be` when that is what the bytes are, and with no charset for a legacy encoding (it is always a download).
- Common Questions never hold the Contact Support page on Admin: a fresh copy (60 s) is used as is; a stale copy is returned at once and revalidated in the background; with nothing cached the page waits at most `ADMIN_QUESTIONS_WAIT_MS` = 500 ms and otherwise renders without the column (the request goes on, up to its 3 s timeout, and its answer is cached for the next load). One request per base URL + locale is in flight at a time, and after a failure Admin is not asked again for `ADMIN_QUESTIONS_RETRY_MS` = 15 s.
- Contact Support page: Cancel (or leaving the page) while the suggestion check runs aborts it and never creates a ticket. A submit that failed in a way that may still have reached the server (network error or 5xx) is resent as it was when the learner presses Submit again with the same form: same Idempotency-Key, same declined `suggestionId`, no second suggestion check, so the server replays instead of creating a second ticket (the key no longer depends on which suggestion was declined). The assistant modal keeps Tab / Shift+Tab inside, closes on Escape wherever focus is (also after a click on the backdrop, which no longer moves focus to the page), and returns focus to Submit (X / Escape) or Subject (Edit). Pasting text that comes with a picture (Office cells) into a text field pastes the text; a clipboard with only a file still attaches it; nothing is attached while the form is busy. The four required fields carry `aria-required`, the drop zone is no longer a dead tab stop, and the enquiry type list closes when focus leaves it.
- Enquiry page: every 404 / 409 answer (stale, wrong state, follow-up or rating window passed, already rated) reloads the ticket, so controls the server no longer allows disappear; "This request was updated" is shown only when that reload worked.

## 16. Helpdesk v2, Portal side (2026-10-28, tickets-v2-figma-addendum §4)

The v2 addendum (`/mnt/project-files/lg-helpdesk/tickets-v2-figma-addendum.md`) overrides §11–15 where they differ. Admin now owns bilingual FAQs (it replaces Common Questions); Portal stays the only writer of tickets and of what the learner was shown.

- **Migration `018_helpdesk_v2.sql`** (additive, repeatable, mirrored in the `services/persistence/db.ts` bootstrap and freshness probe): `helpdesk_tickets.flagged_at` / `flagged_by` with a partial index, and `helpdesk_assist_log` (`id` = Admin's suggestion id, or a Portal UUIDv7 when Admin returned null; `learner_id`, `source` submit|chat|chip, `locale`, `question` ≤500, `faq_id`, `faq_question`, `answer` (verbatim, ≤4000), `feedback` helpful|not_helpful|solved|declined|edited (first wins), `ticket_id`, unique `client_event_id` + `payload_hash` for chat replays, `created_at`). Rollback: retain the columns and the table.
- **Flags:** agent actions `flag` / `unflag` (need `expectedSequence`; a repeat is a no-op without an event), events `ticket.flagged` / `ticket.unflagged`, agent-private, ignored by stale checks like tags. `flagged` is in every agent summary; the agent list accepts `flagged=true` and `learnerId=` (the student timeline).
- **Assist log and linking:** every answer the learner sees is logged: the chat (`POST /api/helpdesk/assistant`), a starter chip (same endpoint with `faqId`) and the submit-time check (`POST /api/helpdesk/suggestions`, source submit, question = subject). Ticket create takes `assistIds` (repeated multipart field, ≤10 UUIDs; part of the idempotency hash when present) and links them, plus `suggestionId`, only when the row is the learner's own, less than 24 h old and not yet linked. The agent detail returns `aiAssist: [{ id, source, question, faqId, faqQuestion, answer, feedback, createdAt }]`, oldest first, from the log only.
- **Learner assistant API:** `POST /api/helpdesk/assistant` `{ message (1–500), locale, faqId? }` with `Idempotency-Key` → `{ id, reply: { id, faqId, question, answer } | null }` (`id` is the logged row, so the chat can link even a null reply); 30 chat+chip questions per learner per rolling hour → 429 `rate_limited` + `Retry-After`; Admin gets 4 s, after which (or on any failure) the reply is null. `POST /api/helpdesk/assistant/{id}/feedback` `{ helpful }` with `Idempotency-Key` → `{ id, feedback }`, first value wins, forwarded to Admin as `helpful` / `not_helpful` only when first set. The submit-modal outcome (`solved` / `declined` / `edited`) is stored the same way and answers 204 even when Admin cannot be told. `GET /api/helpdesk/common-questions` is gone.
- **Portal → Admin client:** `GET /api/integration/helpdesk/faqs?locale&popular&category&q&limit` and `GET …/faqs/{id}?locale` (60 s cache per URL with `If-None-Match`, stale on error, 500 ms wait budget, 15 s retry window, 200 entries), `POST …/suggest { learnerId, locale, source, category?, subject?, message, faqId? }`, `POST …/suggestions/{id}/outcome { outcome }`. Wire examples: `tests/fixtures/helpdesk-contract.json` (version 2).
- **One Markdown renderer** (`modules/helpdesk/markdown.ts` + `components/helpdesk/Markdown.tsx`) for the chat, the submit-time modal and the Help Centre: `**bold**`, `1. ` / `- ` lists, links `text` → `https:` or `mailto:` targets, bare http(s) URLs, paragraphs; raw HTML stays text, any other link scheme keeps only its label, external links `target="_blank" rel="noopener noreferrer"`.
- **Contact Support (Figma 1216:6):** the right column is the AI Support Assistant chat panel (`components/helpdesk/AssistantChat.tsx`): greeting, "We'd love to hear your ideas, too!" (sets Other Enquiries and focuses Subject), the top 3 popular FAQs as chips (fetched server-side; hidden when none), learner / answer / fallback / error bubbles, Related FAQ → `/{locale}/help?faq={id}` (new tab, so the form is kept), Helpful? Yes / No, Enter sends and Shift+Enter adds a line, transcript in sessionStorage per account. On submit the newest 10 chat answer ids go as `assistIds`, and a retry resends the same ones.
- **Help Centre (Figma 1387:2), public `/{locale}/help`:** `modules/helpdesk/helpCentre.ts` + `components/helpdesk/HelpCentre.tsx`. Popular articles (popular FAQs, or the newest when none is popular), debounced search into `?q=` answered by Admin, `?category=`, `?faq=` opened and scrolled to (loaded by id when not listed), summary line = first plain line of the answer. Contact Support → the form, or sign-in with `returnTo` for visitors. Admin down with nothing cached → the static `messages.helpPage.design` items. `/{locale}/account/my-learning/help` and `/{locale}/my-learning/help` redirect here; AccountNav "Help Center / FAQ" links here.
- **待视觉验收 (no frame):** chat typing dots, error and fallback bubbles, pressed Yes / No, the ideas-link behaviour, the narrow-screen stacked panel; Help Centre search results heading and subtitle, empty states, the expanded answer, the fallback notice, the "Back to popular articles" link, and the narrow layout. zh-CN copy for all new strings is ours.
- **Tests:** `tests/unit/helpdesk-v2.test.ts`, `helpdesk-markdown.test.ts`, `helpdesk-help-centre.test.ts`, browser suites `helpdesk-contact-support-page.test.ts` (chat) and `helpdesk-help-centre-page.test.ts`, extended api / admin-client / contract / fixture / migration / PG suites, and `tests/e2e/helpdesk-support.spec.ts` (chip → Helpful → Admin outcome; chat + submit → the agent's `aiAssist` and flag / unflag / filters; the Help Centre for visitors and learners; the old help URLs). The stub Admin (`tests/e2e/helpdesk-admin-stub.mjs`) serves the v2 endpoints with the Figma example FAQs.
- **Two-app run, v2 (2026-10-28):** the same set-up as §14 (Portal dev with local storage, the Admin server on local PostgreSQL 16 with every Prisma migration, the Vite client, local-only tokens), with the scripts updated in `lg-helpdesk/integration-harness/` (`start-admin.sh` uses a local fake OpenRouter endpoint through `OPENROUTER_BASE_URL` that picks the first candidate id; `start-admin-nokey.sh` runs with no model key). `tests/e2e/helpdesk-integration.spec.ts` now drives the v2 screens end to end: an employee creates, edits, previews and deletes bilingual FAQs in the drawer (two popular) → the public Help Centre (popular list, search, topic, `?faq=` deep link, zh-CN, Contact Support `returnTo`) → the learner's chips and chat (Helpful No on a chat answer, Yes on a chip, a no-match fallback, transcript kept on reload) → a submit-time "No, still submit" with a pasted screenshot → the BackOffice student timeline (both enquiries, the attachment bytes, four AI blocks with the right feedback lines) → Claim, Email student, Internal note, Flag / Flagged filter / unflag, Mark as reviewed → the learner sees the reply but not the note and confirms 问题解决了吗？→ 已解决 → Closed; plan "—" and a tag in the right column; a zh-CN learner with a plan (方案名称 / 按半年 / 生效中) whose reply makes the row unread again until it is opened; a helpDesk VIEW employee sees no write controls and gets 403 on writes; zh-CN copy on both sides; with no model (fake answers null, or no key) chat and submit get no answer while a chip still returns its FAQ; "Yes, this solved my issue" creates no ticket. With the fake model: 10/10; with no key (`HELPDESK_INT_NO_MODEL=1 --grep "bilingual FAQs|model picks nothing"`): 2/2. The bugs it found were all in the BackOffice client and are locked by its component tests: a filter changed while the search was still debouncing was lost (FAQs tab and Enquiries list), the selected card's scroll hid the date separator above it, and a deep link to an older card was pushed out of view when the cards above it finished loading.

## 17. Helpdesk v2 verification pass (2026-10-29)

Fixes from the final review of v2. Each one is locked by a test that runs in CI.

- **One Markdown parser, three copies:** the Admin Preview (client) and the Admin save check (server) are line-for-line ports of `modules/helpdesk/markdown.ts`. Their parity is locked by `tests/fixtures/helpdesk-markdown-corpus.json`, which is sha256-pinned and byte-identical in Portal, Admin client and Admin server. The corpus covers bare URLs, `+` / `1)` items, lazy continuation lines, balanced parentheses in link targets and the summary line. Admin refuses to save an answer that has a link Portal would drop (`unsafeLinks`).
- **Assistant writes:**
  - The submit-time check is limited to `submitChecksPerHour` = 10 per learner; above that it returns null without calling Admin or logging.
  - Concurrent chat requests with the same Idempotency-Key share one Admin call. This is per instance only; the stored row still makes a retry replay.
  - The "declined" outcome is recorded in the ticket-create transaction, not by a separate client call.
- **Outcome redelivery:** migration `019_helpdesk_outcome_delivery.sql` adds `feedback_delivered_at` / `feedback_attempted_at` and a partial index. An outcome that Admin did not take is resent later: after the next successful delivery, at most 5 rows, least recently tried first, within 7 days.
- **Idempotency-Key reuse with a different payload** answers **422** `idempotency_conflict` (IETF idempotency-key draft); 409 stays for conflicts. The shared contract fixture is version-bumped in both repos.
- **`mark_read`:** an agent's tag, flag or internal note after the learner's message no longer turns it into a no-op. Only a newer *learner* event does.
- **Help Centre client to Admin:**
  - List and search caches are bounded and separate, and so is the failure map.
  - At most 120 Admin searches per minute per instance; above that the stale or static copy is shown.
  - `q` is normalised (whitespace collapsed, lower case) before it becomes a cache key.
- **Chat (1216:6):**
  - Scrolling:
    - the view scrolls only when the transcript grows;
    - a long answer lands at its top;
    - a Helpful vote no longer jumps the view.
  - Answers, errors and the typing state are announced through one polite live region.
  - Enter is ignored while an IME is composing (`isComposing` or keyCode 229).
  - A failed question gives its words back to the input.
  - A failed vote says so.
  - The assistant gives up after 15 s.
  - A question that a reload left unanswered gets an error bubble.
  - Chips carry their full question as a `title`.
  - The stacked (≤1100 px) layout points at "the form above". Visual sign-off for this layout is still pending (待视觉验收).
- **Help Centre (1387:2):**
  - The search box follows `?q=` on an in-place navigation (a topic link, All articles, Back) and keeps words typed while a search is running.
  - While a search runs the list is `aria-busy`; a polite status then gives the result count.
  - A `?faq=` for an archived or unknown FAQ shows a notice. Visual sign-off for the notice is still pending (待视觉验收).
  - A `?faq=` FAQ is loaded by id only into the popular list or into its own topic, never into search results.
  - With Admin down, a `?category=` shows the static copy under the popular heading, not under the topic's name.
- **CI:** `npm run test:e2e:helpdesk` is part of `test:integration`, and so of `test:ci`, which Verify runs after installing Chromium. `.github/workflows/ci.yml` is a forge `deny_paths` entry and is unchanged. The suite's dev server writes to `.next-ui-check`, so CI's production build in `.next` is untouched. A 20 s expect timeout covers `next dev` compiling a page on its first visit. This is locked by `tests/unit/helpdesk-ci.test.ts`.
- **Left open (low):**
  - The Help Centre has no paging. Lists stop at 10 popular articles and at 50 search or topic results, as §4d specifies with no frame for more.
  - "Popular articles" shows the newest FAQs when none is marked popular, as designed.
  - Admin's zh-CN retrieval does not match Latin words or one-character queries. That is a retrieval change for Admin.

## 18. Agent run ids and W3C trace context (2026-10-29, helpdesk-agent-v2-pi-dsh)

Admin now picks the suggested FAQ through a fixed workflow that runs one pi-agent-core step, and it records every run as an append-only event log that staff can open from each AI block ("View trace"). Portal's part is to send the ids and the trace header that link a learner's runs together. What learners see does not change.

- **Run id:** for `POST /api/integration/helpdesk/suggest`, Portal makes the run id itself (`runId`, UUIDv7) before it calls Admin. The same id is the `helpdesk_assist_log` row id and the Admin suggestion id. Admin returns it as `suggestion.id`. If an older Admin returns a different id, Portal keeps the id Admin returned.
- **Conversation link:** `parentRunId` is the learner's oldest assist row that is not yet linked to a ticket, inside the 24 h link window (`HELPDESK_LIMITS.assistLinkWindowHours`; `repository.conversationRootAssist`). It is null for the first question. If the lookup fails, Portal sends null and the suggestion goes ahead.
- **Wire order:** `runId` and `parentRunId` are the last two keys of the suggest body. The body is locked by `tests/fixtures/helpdesk-contract.json` v3, which is the same file in both repos.
- **traceparent:** every Portal → Admin helpdesk call sends a W3C `traceparent` header (`lib/traceparent.ts`):
  - if the incoming request has a valid `traceparent`, Portal sends a child span of it;
  - otherwise Portal starts a new trace;
  - the version is always `00`.
- **Where it is wired:** the route handlers pass the request into `helpdeskAssistant(request)`. The Help Centre and support pages pass `headers().get("traceparent")` into `createAdminHelpdeskClient`.
- **No new environment variables and no Portal migration.** Tokens are never logged.
- **Tests:**
  - `tests/unit/traceparent.test.ts`;
  - `tests/unit/helpdesk-admin-client.test.ts`: header, child span and key order;
  - `tests/unit/helpdesk-v2.test.ts` and `tests/unit/helpdesk-api.test.ts`: run ids and the root lookup;
  - `tests/io/postgres/helpdesk-repository.test.ts`: `conversationRootAssist`;
  - `tests/e2e/helpdesk-support.spec.ts`: the stub records `runId`, `parentRunId` and `traceparent`.

## 19. A solution before a person, and a rating at the end (2026-10-29, helpdesk-v3-alternatives-rating)

Oliver (2026-10-29): the AI support must give the learner a solution before a person takes over, and the service ends with a small rating card. Reference flow: JD / Taobao "猜你想问 → answer → 解决了吗？ → 未解决 goes to a person with the chat". Rule met: GB/T 47746-2026 (the human entry is always visible; the ticket carries what the learner saw).

- **Alternatives ("You might be asking / 你可能想问"):** Admin's suggest answer (contract v4) adds `alternatives: { faqId, question }[]` (0–3), only when `suggestion` is null, chosen in Admin's code (retrieval rank, else popular FAQs; never the model). Portal reads them tolerantly (`adminClient.suggestReply`; `suggest()` keeps its v2 meaning), passes at most 3, once each, never the chip just asked and never next to an answer, and keeps them with the logged row (`helpdesk_assist_log.alternatives`) so an Idempotency-Key replay is the same body.
  - `POST /api/helpdesk/suggestions` → `{ suggestion, alternatives }` (additive). Over the hourly budget, on an Admin failure or the 4 s timeout it is `{ suggestion: null, alternatives: [] }`.
  - `POST /api/helpdesk/assistant` → `{ id, reply, alternatives }` (additive; `[]` with an answer).
- **Submit modal (1333:249):** no suggestion and alternatives → the modal does not submit. It keeps the enquiry card and shows the alternatives as chips plus **"None of these, submit to support / 都不是，提交给客服"**, visible whenever the list is shown. A chip asks `POST /api/helpdesk/assistant { message: question, faqId }` like a starter chip; its verbatim answer replaces the list in the blue answer box with the helpful row: **Yes** → no ticket, then the rating card; **No** → the ticket, with no `suggestionId` (none was shown) and `assistIds` = the chat answers plus the chosen answers (newest 10, `linkedAssistIds`). Yes / No are also sent as that answer's Helpful? feedback. A failed or empty chip answer shows an alert and keeps the list and None. No suggestion and no alternatives, an error or the 5 s page timeout still submit directly; Cancel, Close, Escape and Edit behave as before (no outcome is reported when there was no suggestion).
- **Chat panel:** a fallback reply shows the fallback text, then the alternatives as chips (starter chip style). They are kept in the tab's transcript.
- **Rating card:** after "Yes, this solved my issue" (the suggestion or a chosen alternative) the modal shows "How was this help? / 本次服务满意吗？", 5 stars and "Skip / 跳过" before the thanks step; the 2 s return to the account starts only after a star or Skip. Focus moves to the card (a labelled group); Escape does nothing there, as on the thanks step. `POST /api/helpdesk/assistant/{id}/rating { rating: 1..5 }` + `Idempotency-Key` (same auth as feedback) → 200 `{ id, rating }`; one rating per answer, the first wins, the same value again is 200, another value is 409 `answer_already_rated` (RFC 9457, with the stored `rating`); 404 for an answer that is not the learner's or has no answer. Skip stores nothing. A failed save says so and can be retried or skipped; 409 counts as rated.
- **Storage:** `db/migrations/020_helpdesk_ai_ratings.sql` — `helpdesk_ai_ratings(run_id uuid primary key references helpdesk_assist_log(id), learner_id, source, rating smallint 1..5, created_at)` and `helpdesk_assist_log.alternatives jsonb` (nullable). Mirrored by the startup bootstrap and the freshness probe, so it runs on deploy like 017–019.
- **BackOffice payload:** each `aiAssist` item carries `rating` (1–5 or null) in the agent ticket detail (the student timeline reads the same). Ratings are not forwarded to Admin outside `aiAssist`. Contract fixture v4 (`tests/fixtures/helpdesk-contract.json`, identical in both repos; its first `aiAssist` item carries `rating: 4`).
- **Final check (2026-10-29):**
  - *What the agent sees.* The modal answers the learner was shown (the suggestion and each chosen alternative's answer, never a chip that came back empty) are kept for the tab per account in sessionStorage (`lg-helpdesk-seen:v1:<accountId>`, newest 10, inside the 24 h link window) and go with the learner's next enquiry as `assistIds`: after Edit / Close / Escape and a new Submit, and after "Yes, solved" + rating when the learner comes back with a new enquiry. So a rated answer shows on the agent's AI block with its feedback and "评分 n/5". A declined suggestion still goes as `suggestionId`, not twice. The list is cleared once a ticket links it. A rating of an answer that never leads to a ticket stays in Portal only (the BackOffice shows AI blocks per ticket).
  - *shownFaqIds.* Portal tells Admin which FAQs the learner's open conversation already showed (answered, unlinked rows of the last 24 h, newest first, at most 20: `conversationShownFaqIds`), as the additive suggest field `shownFaqIds` (left out when empty). Admin never offers those as alternatives, and Portal drops any it still sends.
  - *Back to the questions / 返回问题列表.* A text button above the chosen answer goes back to the same list (nothing asked or reported; focus returns to that question's chip).
  - *Late answers.* A chosen answer that arrives after Escape / Close / Edit / Cancel or after "None of these" (which stays enabled while an answer loads) is dropped and not linked.
  - *Rating never blocks.* Skip stays enabled while a star is saving, a save that lands after Skip changes nothing, and a save still open after 5 s (`RATING_TIMEOUT_MS`) shows the retry message.
- **待视觉验收:** there is no Figma frame for the alternatives state, the chosen-answer state (with its "Back to the questions" button), the rating card or the chat alternatives; they reuse `.helpdesk-chat-chip`, the 1333:249 answer box and footer buttons and the enquiry page's `.helpdesk-rating` / `.helpdesk-stars`.
- **Tests:** `tests/unit/helpdesk-v3.test.ts`, `helpdesk-admin-client.test.ts`, `helpdesk-api.test.ts`, `helpdesk-contract-fixture.test.ts`, `helpdesk-migration.test.ts`, `helpdesk-learner-ui.test.ts`, `helpdesk-contact-support-page.test.ts` (Chromium), `tests/io/postgres/helpdesk-repository.test.ts` (020) and `tests/e2e/helpdesk-support.spec.ts` (the stub Admin offers the account FAQs for an "account" question with no answer).

## 20. v4 Part A: order-linked enquiry, minimal (2026-10-29, helpdesk-v4-order-and-chat-end)

Oliver (2026-10-29): from a payment record a learner can contact support about that order, and the order number goes with the enquiry so the agent can look it up directly. The lookup and the hand-off are done by a program through an interface; the AI agent never queries orders or the database. Order problems today are refunds, payment not received, and paid without the entitlement, so this is the agreed small version.

- **Entry (My Learning > Subscription):** every payment-record row in the expanded payment history gets a small "Contact support / 联系客服" link (the existing table link style, stacked under "View receipt" or "—" in the last cell; `aria-label` "Contact support about order {number} / 就订单 {number} 联系客服"). It opens `/{locale}/account/my-learning/support?orderId=<order id>`. Which orders the page lists is unchanged (payment is not this module): `groupSubscriptionRecords` drops an unsuccessful checkout that matches no subscription, so a cancelled or failed demo checkout for a product the learner never subscribed to has no row today and so no link (see open issues).
- **Contact Support with `?orderId`:** the server page (`app/[locale]/account/my-learning/support/page.tsx`) reads the order with `learnerOrder(user.id, orderId)` and passes it to `ContactSupport` only when it is the learner's own (`supportOrder` in `modules/helpdesk/learnerPages.ts`). Anything else (malformed, another learner's, unknown, or an order store failure) opens the form on Payments & Subscriptions with an "Order / 订单" line saying "We couldn’t attach that order to this enquiry. Please mention the order number in your message. / 无法将该订单关联到本次咨询。请在留言中写明订单号。" (never which reason, never the number; 待视觉验收), so the learner does not believe the order went with the enquiry. Signed out, sign-in returns to the same `?orderId=` (`supportSignInPath`). Enquiry Type starts on Payments & Subscriptions and can still be changed. A read-only line "Order / 订单: <order number>" (a labelled group with the field label style; the number exactly as on the receipt, `order_<ms>_<hex>`, never invented) sits above Subject with a "Remove / 移除" text button (`aria-label` "Remove order {number} from this enquiry"); Remove moves focus to Subject and announces "The order was removed from this enquiry." in a polite status. The number goes with the ticket as the multipart field `orderId`; it is never part of the AI suggestion check (`POST /api/helpdesk/suggestions` still sends only category, subject, message, locale). A 400 `validation_failed` with `field: "orderId"` shows "This order can't be linked to your enquiry. Remove it and submit again." and keeps the line, so creation is never blocked.
- **Server:** `POST /api/helpdesk/tickets` takes an optional `orderId` (trimmed; letters, digits, `_`, `-`, at most 64; empty = none; anything else 400 `validation_failed` field `orderId`). `createTicket` checks by code (after the per-learner rate limit, so a learner over it costs no order-store read) that the order exists and belongs to the signed-in learner (`HelpdeskDeps.orders`, wired to `projectOrder(ensureProductData(), userId, orderId)` in `modules/helpdesk/runtime.ts`); another learner's or an unknown order is 400 `validation_failed` field `orderId`, so the browser can never attach someone else's order. If the order store itself fails, the enquiry is created without the link (logged as `order_lookup_failed`, no order number, no learner data): an order that could not be checked is never stored. `orderId` joins the idempotency hash only when sent, so every earlier request replays as before.
- **Storage:** `db/migrations/022_helpdesk_order_link.sql` adds the nullable `helpdesk_tickets.order_id TEXT` (1–64 characters; no foreign key, the order record stays the payment module's). Mirrored by the startup bootstrap and the freshness probe, so it runs on deploy like 017–020; existing tickets read as "no order". The DEV local store reads older files the same way.
- **Integration (Portal → BackOffice, additive):** `AgentTicketSummary.orderId: string | null` (list and detail) and `AgentTicketDetail.order: OrderProjection | null`, built by code from the order record each time an agent reads the ticket (so a later refund shows), for the ticket's own learner only: `{ id, status (paid|pending|failed|canceled|refunded), amount (minor units, 3900 = 39.00), currency ("usd"), planName (the plan snapshot the order was bought under, else the plan, else its id), kind (purchase|trial_activation|upgrade; a pre-kind order is a purchase), createdAt, paymentMode (demo|stripe) }` and nothing else: no card data, no Stripe ids or secrets, no addresses (`modules/helpdesk/orderDirectory.ts`, keys pinned by `ORDER_PROJECTION_FIELDS`). A lookup failure reads as `order: null` with `orderId` kept. The learner's own ticket views are unchanged. An Admin that ignores the new fields is unaffected.
- **The AI never touches orders:** order data flows only Portal store → Portal code → integration API → BackOffice UI. The Portal → Admin suggest payload is unchanged (tests check that no suggest request carries order data, in the unit suite, the Chromium page test, the contract fixture and the e2e against the stub Admin).
- **Contract fixture v5** (`tests/fixtures/helpdesk-contract.json`, byte-identical in Portal and in Admin's server and client copies; Portal pins its SHA-256): `orderId` on the list and detail ticket, the `order` example, and the `orderStatus`, `orderKind` and `paymentMode` enums Admin labels.
- **待视觉验收:** no Figma frame for the payment-record "Contact support" link or the Contact Support order line; they reuse the subscription table link style and `.helpdesk-field` / `.helpdesk-label` / `.helpdesk-text-link`. Screenshots: `test-results/helpdesk-shots/v4-order-line-{en-GB,zh-CN}.png` (e2e) and `test-results/subscription-records/*-current-v4.png`.
- **Tests:** `tests/unit/helpdesk-v4-order.test.ts` (contract, projection, ownership, idempotency, live read, never blocked, the AI path), `helpdesk-v4-order-ui.test.ts` (Chromium: preset, order line, Remove by keyboard, 400 orderId, no orderId to the AI check), `subscription-records-page.test.ts` (a link on every row), `helpdesk-contract-fixture.test.ts` (v5), `helpdesk-migration.test.ts` (022), `tests/io/postgres/helpdesk-repository.test.ts` (022) and `tests/e2e/helpdesk-support.spec.ts` (demo order → payment record → Contact Support → agent projection; another learner refused; Remove).

## 21. v4 Part B: ending or handing over a long AI chat (2026-10-29, helpdesk-v4-order-and-chat-end)

Oliver (2026-10-29): a learner who keeps chatting with the AI needs an ending, either a proactive one or a handover to a person. GB/T 47746-2026 asks that the human entry is visible, that an explicit request for a person is transferred promptly, and that the history goes with the handover. The rules are decided by code in the Portal chat panel; the model is never asked, and nothing changes on the server or in the Portal → Admin payloads.

- **Rules in one place:** `CHAT_SESSION_RULES` in `modules/helpdesk/chatSession.ts` (deep-frozen): `humanKeywords` (人工, 真人, 客服, 转人工 / 轉人工, 投诉 / 投訴, human, agent, real person, complaint, speak to someone), `humanKeywordExceptions` (人工智能, 人工智慧, "ai agent": course topics, not a request for a person), `unsolvedInARow: 2`, `checkInAfterQuestions: 8`, `idleMs: 10 min`. Matching is case-insensitive after NFKC (full-width letters too) with whitespace collapsed; English entries match whole words (with an "s" plural), Chinese entries anywhere. Only Latin letters, digits and a hyphen join an English word, so a keyword typed right next to Chinese ("我要human", "找agent") matches, while a hyphenated topic ("human-computer interaction", "multi-agent systems") does not; the English exceptions are cut as whole words too ("Thai agent" is no "AI agent").
- **A session** is everything in the chat transcript after the last end line, so the next message after an end starts a new session with every counter at zero. The transcript (sessionStorage, per account) keeps the new cards and lines, and questions and answers now carry the time they were shown (`at`); older transcripts read as before.
- **1. Explicit request for a person:** a typed message that matches (a starter or alternative chip is the FAQ's own question and is always asked) shows the learner's message and at once the handover card "Let’s get you to a person / 为你转接人工客服" with "Fill in the enquiry form and our support team will see this chat too…" and the primary button "Contact Support / 联系客服". No `POST /api/helpdesk/assistant` is made, so Admin never sees that message.
- **2. Two unsolved in a row:** a reply with no answer (the fallback) or an answer voted "No" counts as unsolved; two in a row in the session show the same card after the reply, below the fallback and its "You might be asking" chips. A "No" vote on the newest answer can complete the pair. An error bubble (network, 5xx, 429) is a turn with no answer too and counts as unsolved, so a learner whose questions keep failing is offered a person after the second (final review). A "No" vote while the next reply is still pending puts the card after the voted answer, before the waiting question. A card shown restarts the count.
- **3. Long session:** the reply to the 8th learner question of a session is followed by "Still need help? / 还需要帮忙吗？" with "End chat / 结束对话" and "Contact a person / 联系人工" (once per session). If that reply also completes an unsolved pair, the handover card alone offers the person and the check-in follows the next reply; if the 8th question asked for a person (no reply), the check-in follows the next reply. End chat appends "This chat has ended. / 本次对话已结束" with the v3 rating card (5 stars, Skip; `POST /api/helpdesk/assistant/{id}/rating`, first rating wins, 409 counts as rated) for the session's last answered assist (a fallback is not answered), or "Thanks for chatting. Ask again any time." when nothing was answered. Focus moves to the rating card (or the thanks); after a star or Skip it stays on the end line. End chat shows only on the open session's card.
- **4. Idle:** 10 minutes with no learner input on the Contact Support page (typing, a question, a vote, a card button in the panel; since the final review also typing, a key or a click in the enquiry form or the submit modal, so the chat never ends while a handed-over learner fills in the form) after an AI answer (the fallback counts) ends the session with the same end line and the rating card when there is an answered assist not yet rated. Focus is not moved; the polite live region says it. A chat left idle while the page was away ends as it loads. A session with no AI answer (only a request for a person) has no idle timer.
- **The handover:** the card buttons call `ContactSupport`'s `openFormFromChat` with the chat's assistIds (`assistIdsOf`, newest 10, the server's limit): focus moves to Subject in the form on the same page, and the enquiry links those answers as before, so the agent sees the conversation. After an enquiry was sent, it opens a fresh form (same topic and email) for the next one. While the submit modal is open nothing changes.
- **Never blocked:** the input, the send button, the chips and the form stay usable with every card; the info box (the human entry) is always shown.
- **待视觉验收:** no Figma frame for the handover card, the check-in, the end line, the in-chat rating card or the thanks. They reuse the answer bubble look, the greeting title and answer text sizes, `.helpdesk-submit-button` / `.helpdesk-secondary-button` (smaller padding inside the chat) and the v3 `.helpdesk-rating` / `.helpdesk-stars` (`components/helpdesk/helpdesk.css`, "v4 Part B chat cards"). Screenshots: `test-results/helpdesk-shots/v4-chat-handover-{en-GB,zh-CN}.png` (e2e).
- **Tests:** `tests/unit/helpdesk-v4-chat-end.test.ts` (the config object, keywords and exceptions, sessions, the unsolved run, the check-in, the rating target, the idle deadline, the stored transcript), `tests/unit/helpdesk-v4-chat-end-ui.test.ts` (Chromium, en-GB and zh-CN: no AI call for a request for a person, the form and assistIds, the unsolved pair, the check-in, End chat with rating, thanks, Skip and retry, idle with a fake clock, reload, after a sent enquiry) and `tests/e2e/helpdesk-support.spec.ts` ("v4 chat handover": the stub Admin never receives the request; the agent sees the earlier chat answer on the enquiry).

## 22. Helpdesk v5 contracts first (2026-10-30, helpdesk-v5-context-chips-and-smalltalk + helpdesk-v5-faq-graph-design)

Oliver (2026-10-29): situation chips, warm small talk, explaining a card, three-part answers and FAQ question trees. The contracts land first so the Admin and Portal builds can run in parallel. Everything is additive: an old Portal and an old Admin keep working, and per-FAQ publishing keeps working until the first release exists. Locked vs flexible: the model only picks enum values and ids from fixed lists and writes short strings that Admin's code guard checks (fixed template on any failure); it never states facts and never receives learner data.

- **Situation signals (Part A):** `SITUATION_SIGNALS` (trial_ending, payment_failed, payment_pending, recent_purchase, subscription_cancelled, subscription_expired, email_unverified, open_ticket_waiting, from_order) are computed by Portal code from Portal's own stores and never leave Portal (only enum names are logged). `FAQ_SIGNALS` are the tags an Admin FAQ can carry, in the order chips are picked; `open_ticket_waiting` is a fixed card, never an FAQ. Every published FAQ now carries `signals` (`HelpFaq.signals`, `[]` from an older Admin; unknown values are dropped by `adminClient`).
- **FAQ release (graph design §2.2, §4):** `GET /api/integration/helpdesk/faq-release/current?locale=` (bearer, like the other integration reads; the spec's `/api/helpdesk/integration/…` spelling is the BackOffice staff namespace, so the route sits under `/api/integration/helpdesk/**` where the bearer guard applies) returns `FaqRelease { version, publishedAt, locale, nodes, edges }`, `ETag: "v<version>"`, `If-None-Match` → 304, 404 = no release yet (also an older Admin). Nodes are `answer` (an FAQ card) or `choice` (a prompt with 2–4 `option` edges); `follow_up` edges are the chips under an answer; edge labels are resolved; each answer node carries `blocks` (`b1..bn`, split by Admin's code at release time: one per paragraph, numbered-steps group or list; each renders alone exactly as inside the answer). `adminClient.faqRelease(locale, ifNoneMatch)` makes one request and returns `ok` (with the release and its ETag) | `not_modified` | `none` | `unavailable`; the cache (60 s revalidation, keep the last good release) and click validation (an edge `fromNodeId → nodeId` must exist in the cached release) belong to the Portal build. `parseFaqRelease` drops malformed nodes and any edge whose ends are not both in the release.
- **Suggest request:** optional `context: { nodeId? (the card on screen; Part D's shownFaqId), sessionId? (helpdesk_chat_sessions), recentTurns? (the learner's own earlier words, oldest first, ≤3, each ≤500 code points) }`, built by `buildSuggestContext` (clips; never carries account data). Admin refuses a malformed context with 400.
- **Suggest answer (only when the request carried context):** `kind` answer|smalltalk|clarify|no_match, `intent` (the v2 seven + greeting, farewell, vague, clarify; null when no model call), `confidence` sure|unsure, `nodeId`, `blocks` (1–3 contiguous ids of the picked answer, `[]` = the whole answer), `opening` / `closing` (answer nodes; null for a choice node shown when unsure), `reply` (smalltalk), `explanation` + `covered` (clarify; not covered → explanation null and Portal shows its fixed copy with the handover), `guard` `{ result: passed|fallback, reason, fallback }` and `releaseVersion`. Strings are already guard-passed or Admin's fixed template (Admin picks zh-CN / zh-TW / en by the learner's script). `adminClient.suggestReply` adds `turn` (`parseSuggestTurn`) only when Admin sent `kind`; v5 answers read exactly as before.
- **Contract fixture v6** (`tests/fixtures/helpdesk-contract.json`, byte-identical in Portal and Admin server and client; Portal pins its SHA-256): the new enums, `signals` on the FAQ examples, the release request / response / headers / 304 / 404, the context request and one answer per kind (answer with an excerpt, choice, smalltalk, smalltalk fallback in zh-CN before the first release, clarify, clarify not covered, no match).
- **Tests:** `tests/unit/helpdesk-contract-fixture.test.ts` (v6 enums, the context request sent byte for byte, every v6 answer read, v5 answers without a turn, the release read / 304 / 404 / older Admin / wrong locale) and `tests/unit/helpdesk-v5-contract.test.ts` (the tolerant readers and the context builder).

## 23. Helpdesk v5, Portal server side (2026-10-30)

Built on §22. Everything is additive: a v4 chat page keeps working against it (no `sessionId` → the server starts one; the response keeps `{ id, reply, alternatives }` and adds `turn`). Neither the model nor Admin is asked on a click; the model never receives learner data.

- **Signals (Part A, `modules/helpdesk/learnerSignals.ts`, pure):** computed from Portal's own stores only (the user, their orders, subscriptions and tickets); every `SITUATION_SIGNALS` value has data, none was dropped. `trial_ending`: a trial subscription (active or cancel_at_period_end) whose `validTo` is within 3 days. `payment_failed`: a live grace subscription or the learner's latest order failed. `payment_pending`: the latest order is pending and older than 10 minutes. `recent_purchase`: an order paid in the last 7 days (orders have no paid-at time, so `createdAt` is used). `subscription_cancelled`: a purchase in cancel_at_period_end with `validTo` still ahead. `subscription_expired`: subscriptions exist and none is live. `email_unverified`: an email with no `emailVerifiedAt`. `open_ticket_waiting`: an enquiry in WAITING_USER. `from_order`: Contact Support opened from one of the learner's own orders. Only enum names are logged (`assistant_session_started { signals, chipSignals }`) and stored (`helpdesk_chat_sessions.signals`, `helpdesk_assist_log.signals`); signals are never returned to the browser nor sent to Admin.
- **Situation chips (`situationChips.ts`):** at most 3 (Figma 1394:30 draws 3), no duplicates, deterministic: FAQs tagged with an on signal in `FAQ_SIGNALS` priority, then popular entries. Chips are FAQ questions as staff wrote them (never amounts, order numbers or dates). `open_ticket_waiting` is the fixed `waitingTicket { id, number }` card linking the newest waiting enquiry.
- **Release cache (`faqReleaseCache.ts`):** per locale, in memory, revalidated at most every 60 s with `If-None-Match`; a failure keeps the last good release (`faq_release_stale`, then 15 s before the next try); 404 means no release, so the per-FAQ list is used as before. A first read waits at most 3 s.
- **Learner endpoints** (session, same origin): `POST /api/helpdesk/assistant/sessions { locale, orderId? }` → 201 `{ sessionId, chips: [{ id, question, reason: signal|popular }], situational, waitingTicket, releaseVersion }`. `POST /api/helpdesk/assistant/click { locale, nodeId, fromNodeId?, via: starter|signal|alternative|follow_up|option, sessionId?, label? }` + `Idempotency-Key` → 200 `{ id, reply, alternatives, turn }`: a follow-up or option must be an edge of that kind from `fromNodeId` in the cached release, a chip must open an entry node, else 400 `invalid_request` (`assistant_click_refused`); the node is shown verbatim with the fixed opening and closing; before the first release a chip goes through Admin's per-FAQ path with its `label`, and a follow-up or option is 400. `POST /api/helpdesk/assistant/sessions/{id}/end { reason: idle|ended_by_learner|handover }` → 200 `{ sessionId, endedAt, endReason }` (first end wins; 404 for another learner's). `POST /api/helpdesk/assistant/{id}/expanded` → 200 `{ id, expanded: true }` (own answer cards only; logged once). `POST /api/helpdesk/assistant` takes optional `sessionId`, and `via` (starter|signal|alternative, only with `faqId`).
- **Typed questions:** Portal sends `context { nodeId (the card on screen), sessionId, recentTurns (the learner's last 3 typed messages) }` from its own log, never from the browser. `turn` carries `kind`, `intent`, `opening` / `closing` / `reply` / `explanation`, `covered`, `excerpt` (null = the whole answer), `next` (follow-up chips or options from the release), `source`, `releaseVersion`, `sessionId`, `turnIndex`, `unsolved`, `countsAsQuestion`. Admin's guarded strings are screened again (length caps, no links, emails, digits or markup; an explanation must stay within its card) and rendered as plain text, never Markdown; a refused string becomes Portal's fixed template (`assistant_portal_guard { field, reason }`) and a refused explanation becomes "not covered".
- **Counting (`chatSession.ts`):** small talk and explanations do not count toward the 8-question check-in or the unsolved run; small talk does not break the run; a covered explanation is an answered turn (rated at the end, breaks the run unless voted down); an explanation the card does not cover counts as unsolved. Clicks count toward the hourly budget of 30.
- **Sessions:** server side. A session rolls over after 10 minutes idle (the old one ends `idle` at its last turn + 10 min); `turn_index` is assigned under the session row lock; an enquiry that links the chat ends it `ticket`. Feedback on a click answered from the release stays in Portal (Admin never saw that run), and the outcome sweep skips those rows.
- **Migration `023_helpdesk_chat_sessions.sql`:** the `helpdesk_chat_sessions` table plus additive `helpdesk_assist_log` columns (`session_id`, `turn_index`, `node_id`, `parent_node_id`, `via`, `kind`, `intent`, `guard`, `release_version`, `trace_id`, `signals`, `blocks`, `expanded`, `covered`, `texts`; unique `(session_id, turn_index)`), mirrored in the `db.ts` bootstrap and the freshness probe. `covered` and `texts` (the opening / closing / reply / explanation shown) were added beyond the spec's list for clarify statistics and an identical replay.
- **UI:** the chat page's new states (situation chips, three-part answer, small talk, explanation, choice options, "show the full answer") belong to the client build and are 待视觉验收.
- **Tests:** `tests/unit/helpdesk-v5-signals.test.ts`, `helpdesk-v5-release-cache.test.ts`, `helpdesk-v5-assistant.test.ts`, `helpdesk-v5-chat-session.test.ts`, `helpdesk-v5-api.test.ts`, the 023 case in `helpdesk-migration.test.ts` and in `tests/io/postgres/helpdesk-repository.test.ts`. Changed because the spec changes them: `helpdesk-api.test.ts` and `helpdesk-v2.test.ts` (each chat request to Admin now carries `context`).

## 24. Helpdesk v5, the chat panel (2026-10-30)

Built on §23 (`components/helpdesk/AssistantChat.tsx`, `helpdesk.css`, `messages/*.json` `helpdesk.chat`). The panel only renders what the server's `turn` says: it never asks the model, never shows a guarded string as Markdown, and the FAQ card is always the approved text verbatim. A chat with no `turn` (an older server, a stored v4 transcript) renders exactly as in v4. No Figma frame for any new state: they reuse the answer bubble, chip, button and star styles and are **待视觉验收**.

- **Session and greeting (Parts A, B §4):** the support page starts the chat session on the server (`startSession`, same rules as `POST /assistant/sessions`) and passes `{ sessionId, chips, situational, waitingTicket, releaseVersion }` to the panel; when it cannot start one the page falls back to the 3 popular starter chips. The greeting card keeps the Figma copy ("Hi! How can I help?" / "你好！有什么可以帮你？", 1394:23; the owner chose the design over the named greeting on 2026-10-30). The chips are titled "你可能遇到的问题：" / "You might be running into:" when a signal matched, else "试试问这些问题：". An enquiry waiting for the learner shows the fixed card "你有一个工单在等你回复" with "查看工单" (no number). Every request carries the session: the newest turn's `sessionId` (the server may roll it over), else the page's. End chat and the idle end send `POST /sessions/{id}/end` (`ended_by_learner` / `idle`) and start the next session, whose chips replace the greeting's; the handover button ends it as `handover`.
- **Clicks (graph design §4):** with a release (`releaseVersion`), a situation chip, a follow-up chip and an A/B/C/D option go to `POST /assistant/click` (`via` signal / starter / follow_up / option, `fromNodeId` = the card the button sits on, `label` = the text shown); "You might be asking" chips and chips before a release keep the per-FAQ ask (`faqId`, plus `sessionId` and `via` when the chat has a session; a v4 request is unchanged without one).
- **Three-part answer (Part H):** one bubble: the opening line, the quoted card (`blockquote.helpdesk-chat-excerpt`, styled as the Figma answer 1394:55-56 with no bar or fill: the picked blocks verbatim through the safe Markdown renderer, then the Figma "相关问题：<question>" / "Related FAQ: <question>" link to the whole answer in the Help Centre, and "查看完整答案 ⌄" / "收起" with `aria-expanded` / `aria-controls`, expanding in place and reported once to `POST /assistant/{id}/expanded`), the closing line, the follow-up chips under "你可能还想问：", then the vote. Without an excerpt (a short answer, a click) the whole card is quoted and there is no expand. The DOM order is the reading order, and the live region reads the opening, the excerpt, the closing and the follow-ups in that order.
- **Choice card:** the prompt and 2-4 options in the chip style with an A/B/C/D badge (the letter is `aria-hidden`; the prompt names the list). No vote; a choice card is a step: it neither counts as unsolved nor breaks the run, and the rating card never rates it (`isChoiceTurn`).
- **Small talk (Part B §3):** a plain reply line. Hello / "I have a problem" is followed by the situation chips; thanks / bye after an answered assist of the session by the v3 rating card (a `rate` line kept in the transcript; once per assist, never after it was rated; `ratingAfterFarewell`); no vote. The softened no-match copy is "这个问题我还答不好，你可以换个说法再问，或者直接联系人工客服。", and with alternatives "…你可能想问下面这些，或者直接联系人工客服。".
- **Explanation (Part D):** the explanation line, then "根据「<question>」解释", which shows that card again in place (or links it in the Help Centre when it is no longer in the transcript), then the vote. One the card does not cover shows the fixed "这一点答案里没有写到，我帮你转给客服确认一下。" and the v4 handover card at once.
- **Figma first, polish on interaction (owner 2026-10-30, "完全对齐到我们的设计", then middle ground):** at rest everything Figma 1394:2 draws matches it exactly: chips are 8 px rectangles with the #dce7f7 outline, the panel and bubbles have no shadow, the input is 351 × 70 with the #cad8ea border and the 43 px square #2468f5 send button sits 8 px to its right, at most 3 chips (1394:30). The Part C polish comes back only on hover and focus, which Figma does not draw: chips get the accent border, #eff5ff fill and the 3 px blue glow (no lift); the reply box and the form inputs get the glow on focus; the send and submit buttons get it on hover. These interaction states are 待视觉验收. `prefers-reduced-motion`: no transition.
- **Tests:** `tests/unit/helpdesk-v5-chat-ui.test.ts` (Chromium: greeting and chips, three-part answer and expand, choice and a 3-level chain, small talk and the rating card, explanation, the Figma 1394:2 values and reduced motion, session end and restart), `tests/unit/helpdesk-v5-chat-rules.test.ts` (choice, the rating after thanks, the session id), and five v5 cases in `tests/e2e/helpdesk-support.spec.ts` against the stub Admin, which now serves a zh-CN release (en-GB has none, so both paths run) and the v6 turn fields. Changed because the spec changes them: the session chips instead of the starter chips (still 3, as Figma draws), the softened fallback with alternatives; the greeting title and the "Related FAQ" link are the Figma copy again (2026-10-30) (`helpdesk-contact-support-page.test.ts` and `helpdesk-support.spec.ts`).

## 25. Helpdesk v5 final check (2026-10-30; nothing is pushed until the FKO expansion and the remaining real tests are done, user 2026-10-29)

- **Portal's own check of the strings** (`modules/helpdesk/assistantTurn.ts` `screenTurnText`): control characters become spaces and invisible format characters (`\p{Cf}`: zero-width, direction marks) are dropped before the check; any dotted host name counts as a link; numbers in words with a unit (十四天, 两个工作日, fourteen days, a few minutes) are `digit` in a short line and must appear in the card in an explanation; emails and links in an explanation must be in the card as the same token (scheme, `www.` and trailing slash ignored); an explanation keeps its line breaks (at most 8 lines, at most one blank line in a row) and may use a breadcrumb `>` inside a line, but no Markdown. Admin's phrase lists stay in Admin.
- **Clarify copy:** a turn carries `uncovered` (`not_covered` = the model said the card does not say it; `unavailable` = time-out, error or a refused explanation). For `unavailable` the chat shows a neutral line (`chat.clarifyUnavailable`, en-GB and zh-CN) that makes no claim about the card; the stored transcript keeps the field only when the turn had it. 待视觉验收.
- **Clicks:** a follow-up or option must be clicked on a card this chat showed (the session's card on screen, or an answer row of the session named or the one it rolled over to; `repository.sessionShowedNode`), otherwise 400. A chip through Admin's per-FAQ path is framed by the cached release's node type (a choice has no opening or closing), and as an answer when there is no release.
- **Sessions:** starting the chat while the learner's newest session in that locale is open, has no turns, is not idle and has the same release and signals hands that session out again (`repository.openEmptyChatSession`), so reloading the panel adds no rows.
- **Tokens:** the chat's colour tokens are on `:root`, so the enquiry pages that render the chat outside `.helpdesk-page` get them too.
- **Tests:** `helpdesk-v5-release-cache.test.ts` (number words, line breaks, hidden characters, links), `helpdesk-v5-assistant.test.ts` (uncovered, per-FAQ choice framing, session reuse), `helpdesk-v5-api.test.ts` (a step from a card never shown), `helpdesk-v5-chat-ui.test.ts` (the tokens on the enquiry page, the unavailable copy) and `tests/io/postgres/helpdesk-repository.test.ts` (both new repository reads). Changed because the spec changes them: "Only for a few minutes" against the refund card is now ungrounded ("a few minutes" is a duration in words the card does not have), and the PostgreSQL 023 case shows the choice card before clicking its option.

## 26. Helpdesk v5 Part G, the data flywheel: Portal side (2026-10-30)

Spec: helpdesk-v5-context-chips-and-smalltalk.md Part G (G1 capture, G2 clean) and helpdesk-v5-faq-graph-design.md §3 and §5 item 5. All changes are additive. There is no new ops config, no AWS and no model call. Admin's nightly gap mining consumes the feed; the model never writes FAQ facts.

- **G1 outcome link (migration `024_helpdesk_flywheel.sql`):** the view `helpdesk_assist_outcomes` links each assist turn to the ticket that followed it. That is the ticket the chat was linked to, otherwise the learner's next ticket within 24 hours. For that ticket the view gives the status, the close reason, `resolved_by_agent` (the learner confirmed the agent's proposed resolution, or it auto-confirmed) and the agent's last public reply. The view reads the tickets, so nothing is copied and no column can drift. The local DEV store computes the same thing in code.
- **G2 scrubber (`modules/helpdesk/piiScrubber.ts`):** pure code with no model, exported as `scrubPii` / `scrubPiiReport`. Before matching it folds full-width and other-script digits and letters to ASCII and drops invisible format characters. It replaces:
  - URLs with a query string, a fragment or a token-like segment (a plain URL stays);
  - emails, including obfuscated "at / dot" forms, and JWTs and long tokens;
  - UUIDs, Portal / Stripe ids, LG ticket numbers and IPv4 addresses;
  - order ids, student ids and handles;
  - CN / HK / TW / UK and +86 / +852 phone numbers, card-like 13–19 digit runs, other runs of 6 or more digits, and runs of Chinese number words;
  - the learner's own account name (full, the Han given name, Latin parts of 3 or more letters) and account email, and the names and emails on their enquiries.

  Dates and times are kept. Each match becomes a `<kind>` placeholder (the contract's `piiPlaceholder` enum). Running it twice gives the same result. A zh-CN / zh-TW / en / mixed corpus locks the behaviour in `tests/unit/helpdesk-pii-scrubber.test.ts`.
- **Feed:** `GET /api/integration/helpdesk/insights` (`modules/helpdesk/insights.ts`, see [api-contracts.md](api-contracts.md)) sends each turn's scrubbed text and its labels as enum names, together with the ticket outcome. It sends no learner id, account data, ticket id or number, subject, answer text or trace id. The agent's reply is sent (scrubbed) only when the agent resolved the enquiry, because it is the human answer Admin may turn into a draft FAQ (草稿 待核实). The feed is read-only and paged by `(createdAt, id)`, and the window end is fixed by the first page. Turns younger than a minute wait for the next read, so a cursor never skips a turn that is still being written.
- **Retention job (`modules/helpdesk/retention.ts`):** raw text in the assist log is kept for 180 days. After that, the question, the short strings shown with the card and a clarify's explanation are replaced by their scrubbed text, and `scrubbed_at` is set. FAQ answers (Admin's approved text), labels, votes, ratings and times are never touched. How the job runs:
  - Each run handles batches of 200 rows, at most 50 batches. When `moreDue` is set, the next tick (every 30 minutes) continues on the same day's row until nothing is left; only then is the day done.
  - It is in-process: `instrumentation.ts` → `startHelpdeskBackgroundJobs` on the Node.js runtime, only with PostgreSQL. The first tick comes 2–3 minutes after start and then every 30 minutes, on unref'd timers that are chained after each tick, so startup is never blocked.
  - It is safe with several instances: a PostgreSQL session advisory lock (`pg_try_advisory_lock(719310, 1)`) is held on one pooled connection during the work only.
  - It is idempotent per UTC day: the `helpdesk_job_runs` row plus a partial unique index allow one scheduled run per day. A failed run is retried on its own row, at most 3 attempts a day. A row left `running` by an instance that died is taken over.
  - It is observable: the run row, plus one structured log line per run (`{"type":"helpdesk","event":"job_run",…}` with counts, status, duration, instance and error code, never text) and `job_skipped` (`locked` / `gave_up`), `job_tick_failed`, `jobs_started` and `jobs_not_started` (`no_database`).
  - Staff "run now": `POST /api/integration/helpdesk/jobs/assist-retention/run`, through the BackOffice, which role-gates and audits it as it does the FAQ actions. It is idempotent by Idempotency-Key and records who asked. When another instance holds the lock it answers `already_running`. `GET …/jobs/assist-retention` lists the newest runs.
- **zh-TW fallback templates (`modules/helpdesk/assistantTurn.ts`):** the open issue from v5. Portal's own opening / closing / greeting / farewell / off-topic strings now have a zh-TW variant, chosen by the learner's script as Admin does it. Han text with a Traditional-only character (`modules/helpdesk/traditionalChinese.ts`) gets zh-TW, Latin text gets en-GB, and otherwise the page locale decides. A zh-CN chip or click chooses its frame from the learner's newest Han message in the session.
- **Contract fixture v7:** the `closeReason`, `turnKind`, `turnGuard`, `assistVia`, `chatEndReason`, `piiPlaceholder`, `helpdeskJob`, `jobTrigger` and `jobStatus` enums, and examples of the feed request, page, next page, last page and limits, the job runs list, run request, run response and `already_running`. The three copies are byte-identical, and Portal pins the SHA-256.
- **Ops:** there is nothing to configure. Migration 024 runs automatically on deploy through the bootstrap. To check a day's run: `SELECT * FROM helpdesk_job_runs ORDER BY started_at DESC LIMIT 5`, or the BackOffice runs list. The local DEV store does not schedule; staff "run now" still works there.
- **Tests:**
  - `tests/unit/helpdesk-pii-scrubber.test.ts`, `helpdesk-v5-insights.test.ts`, `helpdesk-v5-insights-api.test.ts` (routes, bearer, paging, run now, replay, conflict), `helpdesk-v5-retention.test.ts` (180 days, once a day, lock, retries, takeover, bounds, run now, the loop and the server start), `helpdesk-v5-zh-tw-templates.test.ts`, the 024 case in `helpdesk-migration.test.ts`, and v7 in `helpdesk-contract-fixture.test.ts`.
  - `tests/io/postgres/helpdesk-insights.test.ts` covers the view, SQL paging, retention, four instances racing (exactly one runs), the lock across connections, the run-row uniqueness and the 023 → 024 bootstrap. It is added to the Helpdesk PostgreSQL CI step.
