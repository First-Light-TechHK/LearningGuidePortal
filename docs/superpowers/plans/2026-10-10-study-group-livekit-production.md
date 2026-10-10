# Study Group LiveKit production hardening

> **For the implementation agent:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

## Goal

Make Study Group's LiveKit integration production-safe without binding the product to one LiveKit Cloud project. A new Live Session must be assigned deterministically to one enabled LiveKit project; its assignment remains immutable for the lifetime of that session. Credentials remain server-only in AWS Secrets Manager and may be rotated or a second project introduced without a code deployment. The implementation must also close the discovered queue, capacity, reconnect, configuration and operational gaps.

## Design decisions and non-negotiable boundaries

- Production persistence is **RDS PostgreSQL**, not the current JSON/file repository. `AGENTS.md`, the architecture and release runbook all require it. Update the conflicting sentence in `decisions.md`; do not silently ship two incompatible production designs.
- Do not introduce a generic multi-vendor plug-in platform. Introduce one narrow `LiveKitRoomGateway` port and one `LiveKitProjectRegistry`; the LiveKit Cloud adapter is the only initial implementation.
- No LiveKit key, API secret, webhook secret, token, raw prompt or participant content may appear in source, browser responses, logs, metrics, test snapshots, or configuration diagnostics. A project id and non-secret endpoint are safe operational identifiers.
- `process.env` is read only by a configuration/secrets adapter. Application services receive interfaces, never `apiKey`, `apiSecret`, URL literals, `fetch`, or JWT signing primitives.
- Session-to-project mapping is persisted before creating the provider room. Existing sessions never fail over to a different project: cross-project room migration is not a safe operation. Failover is allowed only before a room exists, and only through an explicit retry of provisioning.
- Continue using short-lived participant credentials (10 minutes or less). Tokens are signed, not encrypted; that is correct because the browser must consume them. The signing secret is server-only.
- Current LiveKit Cloud evidence is recorded as operational context only: the active project is in the Frankfurt region, has served traffic, and has no deployed LiveKit Agents. This design does not require LiveKit Agents.

## Target shape

```text
Route Handler -> StudyGroupService -> LiveKitRoomGateway (port)
                                      |-- LiveKitCloudGateway (adapter)
                                      |-- FakeLiveKitGateway (tests)

StudyGroupService -> LiveKitProjectRegistry -> ProjectRef (non-secret)
                                       -> LiveKitCredentialResolver -> AWS Secrets Manager

RDS: live_session.livekit_project_id
     tutor_request (durable queue / lease / attempts)
     livekit_webhook_receipt (event de-duplication)
```

The registry contains only `id`, `url`, `region`, `enabled`, `weight`, and secret *references*. The resolver returns credentials to the Cloud adapter in memory. New sessions use deterministic weighted selection among enabled healthy projects, then save the chosen id. A project can be `active`, `draining`, or `disabled`: active accepts new sessions; draining supports existing sessions and key overlap; disabled rejects all new actions after planned retirement.

## Task 1 — reconcile the design and define release gates

**Files:**
- Modify: `docs/phase1/study-group/decisions.md`
- Modify: `docs/phase1/study-group/study-group-architecture.md`
- Modify: `docs/phase1/api-contracts.md`
- Modify: `docs/phase1/release-runbook.md`
- Create: `docs/phase1/study-group/livekit-operations.md`

1. Replace the file-store decision with PostgreSQL/RDS as the production implementation and identify the local file repository as test/dev-only until removed.
2. Make the architecture's closed tutor decision agree with the implemented shared tutor: direct completion, server-side course grounding, shared LiveKit data publication and no agent framework. Remove stale wording that says the tutor does not run or its vendor/re-entry path is undecided.
3. Document the stable project assignment rule, 10-minute token TTL, webhook security/de-duplication, project states, provider errors and the fact that the browser never receives a project secret.
4. Add an explicit release gate: no production Study Group release until RDS migration, signed webhook delivery, key rotation drill, reconnect/seat reconciliation, and the test-project smoke path have evidence.
5. In `livekit-operations.md`, write the normal/incident/rotation procedures described in Task 9 before implementation starts.

**Verification:** use `rg` to ensure no production document claims file storage is the selected store or that the tutor is deferred; review API responses for a documented, non-secret `unavailable`/`provider_unavailable` contract.

## Task 2 — configuration, project registry and secrets boundary (TDD)

**Files:**
- Create: `modules/group-study/liveKitConfig.ts`
- Create: `modules/group-study/liveKitProjectRegistry.ts`
- Create: `services/secrets.ts` (or extend the existing secret adapter if one exists)
- Modify: `modules/group-study/runtime.ts`
- Modify: `.env.example`
- Create: `tests/unit/study-group-livekit-config.test.ts`

1. First write failing tests for:
   - rejection of an empty/non-`wss://` URL, duplicate id, unknown lifecycle state, no active project, missing secret reference and an enabled project with invalid weight;
   - deterministic session-id selection, with the same id choosing the same active project;
   - a persisted project id resolving while its project is `draining`, but not when it is removed/disabled;
   - diagnostics that contain ids and endpoint hostnames but never a secret or token.
2. Define `LiveKitProjectRef` as a non-secret configuration record and `LiveKitCredentials` as an opaque server-only value. Define interfaces:

   ```ts
   interface LiveKitProjectRegistry {
     selectForNewSession(input: { sessionId: string; region?: string }): LiveKitProjectRef;
     getAssigned(projectId: string): LiveKitProjectRef;
   }
   interface LiveKitCredentialResolver {
     resolve(project: LiveKitProjectRef): Promise<LiveKitCredentials>;
   }
   ```

3. Parse a deployment-supplied `LIVEKIT_PROJECTS_JSON` that contains only non-secret configuration and AWS Secrets Manager references. The production resolver reads those references through an IAM role. Keep a clearly named local-test adapter, never a production fallback with real values.
4. Make `runtime.ts` construct this composition root once. Remove direct `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`, `LIVEKIT_URL` reads from service wiring and tutor publishing.
5. Preserve local developer ergonomics through fake projects/credentials in tests, not through a default zero/empty secret.

**Verification:** run the new unit tests before and after implementation; run `npm run typecheck` and check `.env.example` contains names/references only, no credentials.

## Task 3 — LiveKit gateway port and SDK adapter (TDD)

**Files:**
- Create: `modules/group-study/liveKitGateway.ts`
- Create: `modules/group-study/liveKitCloudGateway.ts`
- Modify or remove: `modules/group-study/liveKitToken.ts`
- Modify: `modules/group-study/tutorAnswer.ts`
- Modify: `package.json` and lockfile
- Create: `tests/unit/study-group-livekit-gateway.test.ts`

1. Add `livekit-server-sdk`; use its supported token, Room Service and webhook primitives rather than hand-assembled JWT and Twirp calls.
2. Define a narrow port: `ensureRoom`, `issueJoinToken`, `publishTutorMessage`, `removeParticipant`, `verifyWebhook`, and `healthCheck`. All methods return typed, retryable/non-retryable `LiveKitFault` values; none leak provider response bodies or secrets.
3. `ensureRoom` must apply the configured `maxParticipants`; application admission remains authoritative but LiveKit becomes a defence-in-depth room cap.
4. Add a deterministic tutor message id to the reliable data payload. The UI must later de-duplicate by that id, which makes replay after an uncertain provider outcome safe.
5. Keep grants minimally scoped: participants may join/publish/subscribe/data-publish only in their assigned room; the internal publishing credential is server-only and short lived.

**Verification:** use a fake gateway to prove correct room/identity/grant inputs and typed failure mapping. The unit test must prove a returned participant token has no API secret and a serialized diagnostic has none. Run the existing Study Group service tests too.

## Task 4 — durable RDS repository and atomic tutor claims (TDD + IO)

**Files:**
- Create: `db/migrations/012_study_group_livekit_and_queue.sql` (use the next unused number if 012 is already taken)
- Create: `repositories/studyGroupRepository.ts` and PostgreSQL implementation following existing repository conventions
- Modify: `modules/group-study/repository.ts`, `modules/group-study/service.ts`, `modules/group-study/runtime.ts`
- Create: `tests/io/study-group-postgres.test.ts`
- Modify: `tests/unit/study-group-service.test.ts`

1. Persist `livekit_project_id` on a Live Session and model provisioning state so a retry resumes the same project and room identity.
2. Replace the in-process `tutorDraining` set with a durable `tutor_request` status, attempt count, lease owner/until, schedule time, message id and terminal failure reason. Add a unique idempotency constraint for `(session_id, user_id, client_event_id)` and an index for the next eligible item.
3. Implement `claimNextTutorRequest` as one transaction (`FOR UPDATE SKIP LOCKED` or equivalent) that converts queued/expired-lease to leased. Only the lease owner may settle it. Do not hold a database transaction across an LLM/provider network call.
4. Make seat admission an atomic database transaction; preserve server-receipt order and cap behaviour under concurrent App Runner instances.
5. Add a migration/backfill decision for existing file data. Do not auto-import unknown production JSON; require a reviewed, idempotent import command with a backup/export check if data migration is needed.

**Verification:** write failing IO tests that run concurrent joins and two independent delivery workers; assert one successful capacity claim and one model claim. Run `npm run test:io` against an isolated PostgreSQL database, then `npm run test:unit`.

## Task 5 — room lifecycle, token issuance and capacity correctness (TDD)

**Files:**
- Modify: `modules/group-study/service.ts`
- Modify: `app/api/study-groups/sessions/[sessionId]/enter/route.ts`
- Modify: `app/api/study-groups/sessions/[sessionId]/token/route.ts`
- Modify: `tests/unit/study-group-service.test.ts`
- Modify: `tests/unit/study-group-api.test.ts`

1. On the first successful start/provision request, select and persist the project, validate all configuration, call `ensureRoom`, and transition to live only after the provider room is known good. A provider/configuration failure must leave no unusable seat or successful issuance log.
2. At token issuance, re-check signed-in user, course entitlement, active membership, current presence and session state; resolve the session's persisted project and issue only from that project. Never choose a project per token request.
3. Validate URL, project state and secret resolution before writing a token audit event or retaining a seat. Replace the current zero-key fallback for `STUDY_GROUP_TOKEN_LOG_KEY` with a fail-closed production configuration error.
4. On leave/end, attempt provider cleanup idempotently; provider failure becomes an observed retryable job, not a reason to retain an application seat forever.

**Verification:** test missing URL/secret leaves no seat/audit entry, repeated provisioning uses one project/room, project rotation does not move an existing room, and a sixth/seventh concurrent admission is correctly accepted/rejected at both app and provider boundaries.

## Task 6 — signed webhooks and reconciliation (TDD + IO)

**Files:**
- Create: `app/api/livekit/webhook/route.ts`
- Create: `modules/group-study/liveKitWebhookService.ts`
- Modify: `modules/group-study/service.ts`, repository and migration
- Create: `tests/unit/livekit-webhook-route.test.ts`
- Modify: `tests/io/study-group-postgres.test.ts`

1. Accept the raw webhook payload and authorization header; verify it through `LiveKitRoomGateway.verifyWebhook` before parsing business state.
2. Store the provider event id with a unique constraint before effects. Process participant joined/left and room-finished idempotently.
3. Webhooks may release/finish only a known session/project/participant mapping. They must not create membership, grant a seat or elevate permissions. Unknown/late events are safely audited and metered.
4. Add scheduled reconciliation for stale presence/room divergence, because webhook delivery is retryable but not a sole truth source. Give the job a bounded grace period and a visible alert, not silent seat deletion.

**Verification:** invalid signature returns 401 with no write; a duplicate event has exactly one effect; a real participant-left releases capacity; room-finished completes an eligible session. Test out-of-order/unknown events.

## Task 7 — reliable shared tutor delivery (TDD + IO)

**Files:**
- Modify: `modules/group-study/service.ts`
- Modify: `app/api/study-groups/sessions/[sessionId]/tutor/route.ts`
- Modify: `modules/group-study/tutorAnswer.ts`
- Modify: `components/portal/StudySessionRoom.tsx`
- Modify: `tests/unit/study-group-service.test.ts`
- Create: `tests/io/study-group-tutor-queue.test.ts`

1. Start with failing tests for the two discovered P0 cases: a publish failure must not permanently block subsequent questions, and two workers must not make two model calls for one item.
2. Replace boolean `inFlight` with explicit queued/leased/published/failed states. Retry bounded retryable provider failures with backoff; after the maximum attempt mark terminal failure, record a non-secret operational event, and atomically advance the next item. Decide and document whether a learner-facing error message is published; do not pretend success in the HTTP route.
3. Treat an uncertain publish as replayable using the stable message id. The browser ignores duplicate tutor message ids. Do not blindly call the model again after a successful model answer if only publication is uncertain; persist the safe reply representation or an outbox payload according to the data-retention decision.
4. Keep lexical course-material guards and multi-key health logic, but persist/durably scope state required across workers. Never write tutor secrets or user question text to generic logs.

**Verification:** queue ordering under same-millisecond timestamps, publish failure then next-item progress, lease expiry recovery, duplicate worker safety, client-event replay, and client data-message de-duplication. Run unit, IO and existing tutor tests.

## Task 8 — client failures, accessibility and reconnect (TDD)

**Files:**
- Modify: `components/portal/studyGroupClient.ts`
- Modify: `components/portal/StudyGroupsApp.tsx`
- Modify: `components/portal/StudySessionRoom.tsx`
- Modify: `messages/en-GB.json`, `messages/zh-CN.json`
- Modify: `tests/unit/study-group-ui.test.ts`
- Add a focused Playwright test under `tests/e2e/`

1. Normalize transport failures, invalid JSON and provider/configuration errors into the documented API result. Eliminate unhandled promise rejections and permanent loading states.
2. Show distinct actionable states for: session full, entitlement lost, token expired, temporarily unavailable, reconnecting, connection failed, and terminal tutor-delivery failure. Use accessible status/live regions and keyboard-reachable retry/leave actions in both locales.
3. Retry only typed retryable failures with bounded backoff. Re-fetch a new token only for expiry/connection recovery, never as a way to change the assigned LiveKit project.

**Verification:** unit tests for rejected/non-JSON fetch and every state; browser test for reconnect/failed-token screen. Run `npm run test:e2e` with a fake gateway and no real credentials.

## Task 9 — observability, rotation and release execution

**Files:**
- Modify: `docs/phase1/release-runbook.md`
- Modify: `docs/phase1/study-group/livekit-operations.md`
- Modify: `scripts/after-deploy.mjs` or add a dedicated non-production Study Group smoke script
- Modify: `.github/workflows/*` only where repository ownership permits
- Create: tests for production configuration/preflight

1. Emit redacted structured metrics for project id, room provisioning latency/failure, token issuance, webhook verification/retry/de-dup, capacity rejection, queue lease/retry/dead-letter, and reconnect outcome. Add CloudWatch alarms for provider error rate, webhook verification failures, queue age/dead letters and persistent reconciliation drift. Keep participant content, tokens and secrets out.
   Add a five-minute, cached Room Service permission probe for every active/draining project and expose its redacted snapshot only to an Operator. Treat it as a credential/reachability signal, not an assertion of remaining LiveKit plan allowance; obtain allowance/usage signals through the supported dashboard or Analytics API where the selected plan permits it.
2. Run one primary project in the registry first. Add a second only when a capacity/region/business requirement exists. Selection is deterministic and persisted; use per-project health/circuit breaking only for **new** sessions.
3. Rotation procedure: create a new key in the current LiveKit project; add its secret version in Secrets Manager; deploy/reload the resolver with overlapping old/new versions; validate a dedicated test room, token and signed webhook; wait at least the maximum issued token TTL plus rollback window; revoke the old key; record the actor/time/project. Never rotate by editing source or browser-stored secrets.
4. Project retirement procedure: mark the old project `draining`, stop allocating new sessions, wait for all assigned sessions/TTL/reconciliation window to end, then disable/revoke. Do not reassign live rooms.
5. Add deployment preflight checks that fail closed on invalid registry, unresolved secret reference, unsafe token-log key, webhook secret absence, missing RDS migration or file-store production selection. Add a non-production live smoke: provision room, two test participants, publish/retrieve tutor data, leave, receive verified webhook and confirm capacity release.
6. Execute an incident drill for: lost webhook, LiveKit 5xx, quota/project outage, key rotation rollback, duplicate provider event, failed tutor publish, and two App Runner workers. Attach redacted evidence to the release record.

**Verification:** `npm run typecheck`, `npm run lint`, `npm run test:unit`, `npm run test:io`, `npm run test:e2e`, `npm run build`, and fork GitHub Actions Verify/Forge/Overlay on the exact commit. Only then run the authorised DEV non-production LiveKit smoke and the documented rotation drill.

## Delivery order

Implement Tasks 1–4 before exposing the new runtime. Tasks 5–7 are the production safety core and must land together behind a disabled Study Group production feature flag. Task 8 follows the stable API errors. Task 9 is the release gate; enable the feature only after the full evidence set is green. Each task must be a reviewable commit with its tests and documentation in the same change.
