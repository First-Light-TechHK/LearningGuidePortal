# Study Group production persistence design — Phase C slice 2 (signed webhook route + bounded reconciliation)

Implements section 5.1 of `production-persistence-design.md`. No new migration: `study_group_webhook_receipts` and its repository operations landed in `012_study_group_persistence.sql` (slice 1). Slice 3 (alarms/metrics/preflight, reminder outbox legs, removing the file adapter) stays out of scope.

## 1. Surface map

- `app/api/livekit/webhook/route.ts` (new) — POST only. The route does exactly: read the raw body (`await request.text()`), read the `Authorization` header, call the application service, map its typed outcome to JSON. There is no session; the provider signature is the authentication. Precedent: `app/api/payment/webhook/route.ts` (thin route, verification in service).
- `modules/group-study/liveKitGateway.ts` — the `LiveKitRoomGateway` interface gains two **optional** members (`recoverParticipantToken?` precedent: an implementation without them is read as typed `unverified` / skipped, never as acceptance):
  - `verifyWebhook(input: { rawBody: string; authHeader: string | null }): Promise<LiveKitWebhookEvent>` with `LiveKitWebhookEvent = Readonly<{ eventId: string; eventType: string; room: string | null; participantIdentity: string | null; createdAt: string | null; projectId: string }>`;
  - `listParticipants(input: { project: LiveKitProjectRef; room: string }): Promise<ReadonlyArray<{ identity: string }>>` (reconciliation sweep B; provider read only).
  - Typed failure uses the existing `LiveKitGatewayError` / `LiveKitGatewayFailureCode = "unverified"` — no secret, key id, or provider body ever leaves the gateway.
- `modules/group-study/liveKitProjectRegistry.ts` — gains `all(): ReadonlyArray<LiveKitProjectRef>` so webhook attribution can enumerate every configured project (any state: a draining project's rooms outlive its draining flag). The parser is the only implementer.
- `modules/group-study/liveKitCloudGateway.ts` — real `verifyWebhook`: decode the JWT payload **without trusting it** to read `iss`; resolve each candidate project's credentials through the existing resolver (60 s cache) and select the project whose `apiKey === iss` (unknown issuer ⇒ typed `unverified`, no crypto attempted); then `new WebhookReceiver(apiKey, apiSecret).receive(rawBody, authHeader)` — the SDK validates signature, the `sha256` body claim and `exp` — and map the parsed event. `id` (provider event id, `EV_…`) is required; a payload without it is `unverified`. The gateway takes the registry as a new `registry?` construction dependency (`runtime.ts` wires `liveKit.projects`); without it every verification is typed `unverified`. `listParticipants` wraps `RoomServiceClient.listParticipants`.
- fake gateway (`LIVEKIT_FAKE_GATEWAY=1`, DEV only): `verifyWebhook` always rejects with typed `unverified` — unsigned or unverifiable events are never accepted anywhere (route: 400); it has no `listParticipants` member, so reconciliation sweep B is skipped entirely (never read as "empty room"). Local DEV additionally runs the file store, where the route answers 503 (section 5), so no webhook path is reachable in DEV.
- `modules/group-study/service.ts` — two new functions:
  - `handleLiveKitWebhook({ rawBody, authHeader })`;
  - `reconcileLiveKitState()` (bounded; section 4).
- `repositories/studyGroupRepository.ts` — PG: new `getWebhookReceipt(receiptId)` (read status) and `abandonStaleWebhookReceipts({ olderThanSeconds, limit })` (mark `received` older than the window as `failed`/`abandoned`; returns affected count). File adapter keeps throwing `StudyGroupStoreUnsupportedError` for every receipt operation.
- `modules/group-study/runtime.ts` — reconciliation timer (5 min, `unref`, one per store key, same pattern as the health timer), started only when the backend is `postgres` and the gateway is provider-verified (not fake).

## 2. Verification scheme

LiveKit signs each webhook with the per-project API key/secret (HS256 over the compact JWT; the token's `sha256` claim is the SHA-256 of the raw body). Webhook endpoints are configured per provider project, so the event must be attributed to a project before it can be validated. Attribution uses the unverified `iss` claim **as routing input only** — it selects which project's secret will be used; the SDK receiver then performs the cryptographic validation against that project's secret. Unknown `iss`, wrong signature, tampered body, expired token, or missing `Authorization` all collapse to the typed `unverified` failure (route: 400 `invalid_signature`). The incident log line carries only the event type and receipt id — never the payload, key id, or issuer.

## 3. Receipt-first semantics and event mapping

Order of operations: verify → `insertWebhookReceipt({ receiptId: eventId, … })` → if the insert returns **false** (duplicate id), read the existing row with `getWebhookReceipt(eventId)`:

- existing `status` is `received`, **or** `failed` with `failureClass = 'abandoned'` → the previous delivery crashed (or was abandoned) mid-processing; **resume** the mapping action, then mark. Actions are conditional and idempotent, so a resume cannot double-apply, and a provider retry after a sweep-A abandonment still lands.
- any other existing state (processed / ignored / failed-with-other-class) → respond `{ ok: true, status: "duplicate" }` with **no side effects** and no second mark (mirrors the `stripe_events` rule).

Then act on the event and, **only on success**, `markWebhookProcessed(receiptId, "processed" | "ignored")`, respond 200. On an unexpected processing failure the row is deliberately left `received` and the error propagates (route 500): the provider's retry resumes it, and sweep A (section 4) bounds the row's life if no retry ever arrives. Marking `failed` on the first failure would turn every retry into a swallowed duplicate — the exact event-loss defect this ordering exists to prevent.

Event mapping is deliberately minimal and can never grant anything (HANDOFF C.4):

| Event | Action |
|---|---|
| `participant_left`, room resolves to a **known session** | Close that identity's **open** presence row (conditional update: `left_at IS NULL` → set `left_at`, inside the repository's serialized `update()` mutate). No open row ⇒ no-op. |
| `participant_left`, unknown room | no-op (`ignored`) |
| any other type, known or unknown room | recorded, `ignored` |

Webhooks never create memberships, change roles, issue tokens, or authorize a user. A `participant_left` can only shrink occupancy.

HTTP mapping: success → 200 `{ ok: true, status: "processed" | "ignored" | "duplicate" }`; `unverified` / missing header → 400 `{ ok: false, code: "invalid_signature" }`; file backend or unverifiable configuration → 503 `{ ok: false, code: "webhook_unavailable" }` (mirrors the payment webhook's 503 when its secret is absent); unexpected failure → 500 `{ ok: false, code: "webhook_failed" }` — the provider's retry then arrives with the same event id, and section 3's resume path processes it.

## 4. Bounded reconciliation (`reconcileLiveKitState`)

The endpoint can be down when the provider sends an event; reconciliation is the repair path. Two sweeps, both strictly bounded per tick:

- **A — stale receipts.** `abandonStaleWebhookReceipts({ olderThanSeconds: 300, limit: 50 })`: receipts stuck in `received` past a 5-minute grace window (no retry arrived, or a resume crashed) become `failed`/`abandoned` so they are visible to slice-3 dead-letter metrics instead of leaking silently. A retry that arrives before the sweep resumes processing (section 3); a retry that arrives **after** the sweep also resumes (section 3's resume rule includes `failed`/`abandoned`), so abandonment is bounded bookkeeping, not event loss. The affected count is reported in the redacted incident log.
- **B — presence drift.** For at most 5 sessions in status `live` that still have open presences (oldest-observed first): call `listParticipants` for the session's project/room and close every open presence that is both **past a two-minute grace window** (age = `enteredAt ?? requestedAt`) and whose identity the provider no longer lists; rows younger than the grace are left alone so a user mid-join or mid-re-join is never raced. Closing happens inside the repository's serialized `update()` mutate, so the re-check and the close are atomic. Provider failure ⇒ redacted incident line, session skipped, no state change. Skipped entirely when the gateway is not provider-verified (the DEV fake gateway has no `listParticipants`). This is the only sweep that repairs seats leaked by a *missed* webhook (browser crash + endpoint outage).

Both sweeps run from the timer of section 1; a tick that throws is swallowed and logged (same contract as the reminder and health timers).

## 5. Store gating

Receipt dedupe is a database guarantee: `insertWebhookReceipt` on the file adapter throws `StudyGroupStoreUnsupportedError`, which the service maps to the typed `webhook_unavailable` outcome (503). A managed environment whose store selection is broken therefore fails closed instead of accepting unverifiable deliveries. DEV file-store deployments cannot accept webhooks — deliberate, documented here.

## 6. Tests (existing commands pick the new files up)

- `tests/unit/study-group-webhook-gateway.test.ts` — real HS256 JWT vectors built in-test: happy path (event parsed, `projectId` attributed); tampered body, wrong secret, unknown `iss`, expired token, missing header, missing event id → typed `unverified`. No network.
- `tests/unit/study-group-webhook-service.test.ts` — duplicate (already processed) ⇒ no side effects; resume of a `received` row ⇒ exactly one conditional close; unknown room ⇒ `ignored`; `participant_left` closes only an open presence; failure mid-action ⇒ marked `failed`, error propagates; **failure tests required by AGENTS.md**: duplicate delivery, invalid signature, unavailable store — plus an assertion that no membership/role/token state changes on any webhook path.
- `tests/io/postgres/study-group-webhook.test.ts` — two workers delivering the **same signed event id** concurrently against real PostgreSQL: exactly one `processed`, one `duplicate`, one receipt row, presence closed once; pre-inserted `received` row ⇒ a retry resumes; sweep A bounds; sweep B closes only provider-absent identities and is a no-op on provider error (stub gateway).
- Route contract tests live with the unit service tests (route handler called directly; precedent `tests/io/harness.ts callRoute`).

## 7. Non-goals

Slice 3 only: CloudWatch metrics/alarms (webhook failure rate, dead-letter counts, reconciliation drift), fail-closed production preflight entry, reminder notification/email outbox legs, removing the file adapter. Also out: any `room_finished` ⇒ session-end mapping — webhook repair and reconciliation now COMPLETE a live session when its last open presence closes (the reducing counterpart of the leave rule), but a `room_finished` ⇒ session-end mapping remains out of scope.

## 8. Operations note (not code)

Each LiveKit project needs its webhook URL pointed at `/api/livekit/webhook` with the project's own key pair (the issuer routing makes multiple projects share one endpoint). This is a dashboard/ops step and belongs in `release-runbook.md` when the endpoint is first enabled in a managed environment.
