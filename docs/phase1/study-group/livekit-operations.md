# Study Group LiveKit operations

## Scope and ownership

Learning Guide owns course entitlement, Study Group membership, seats, session lifecycle and tutor queue state. Storing those records in the product RDS PostgreSQL database is a release gate (see the release runbook's Study Group gate), not the current implementation: today the code persists them through the container-local file repository, and production remains disabled until the RDS-backed implementation exists. LiveKit Cloud owns real-time rooms and transport. The application selects one LiveKit project for each new Live Session and persists that assignment; it does not move active rooms between projects.

The operator maintains a registry of projects. A project contains a stable id, websocket endpoint, optional region, weight, lifecycle state and references to Secrets Manager credentials. It never contains a raw key in source, browser state or ordinary logs.

| State | New sessions | Existing assigned sessions |
|---|---|---|
| `active` | eligible | supported |
| `draining` | not eligible | supported until finish/expiry |
| `disabled` | rejected | rejected after planned retirement |

## Normal monitoring

Monitor, per project: room provision success/latency, token issuance failure, capacity rejection and provider error rate today; signed webhook verification, duplicate/late webhook events, stale presence reconciliation and tutor lease age/retry/dead-letter count become monitorable with the release-gated signed webhook receiver and durable tutor queue. Metrics contain a project id and failure class only; they contain no participant content, tokens, prompts or credentials.

The service performs a redacted control-plane probe when Study Group starts and every five minutes thereafter. The probe resolves the server-side credential and calls the non-mutating Room Service room listing for every `active` and `draining` project; it caches a completed snapshot for one minute and emits a structured state-change event only when a project's health changes. The Operator-only `GET /api/backoffice/study-group/livekit-health` endpoint exposes the cached project id, endpoint host, lifecycle state, health class, evidence source, `providerVerified`, latency and active-room count. `activeRooms` exists only when the evidence source is `provider_api` and `providerVerified=true`, meaning the current Room Service call returned it; credential-resolution, provider-error and simulated states never invent an equivalent value. `LIVEKIT_FAKE_GATEWAY=1` returns `unverified` / `simulated` only when `APP_ENV=DEV` (any other environment ignores the flag), so local or CI fakes cannot be offered as account evidence. It never returns a raw provider error, credential reference, token, learner identity or room name. A failed `active` probe makes new-session readiness false; a failed `draining` probe is an explicit alert because assigned rooms may still depend on it.

This probe validates application credentials and Room Service reachability. It cannot prove remaining paid allowance, plan feature entitlement or every media path: LiveKit enforces quotas per project and may reject new operations when a limit is reached. Capacity monitoring therefore also needs the LiveKit dashboard/Analytics API where the plan permits it, CloudWatch alarms over the redacted application events, and an application-side admission budget that is lower than the provider's confirmed limit. Do not scrape the browser dashboard or put a dashboard session/token in the application.

Participant access tokens are different from the project API credential. The browser must not poll or retain the project credential. It should use the short-lived participant token returned by the application, rely on LiveKit's connected-session refresh behaviour, and request one replacement from the server only for a bounded reconnect/expiry flow. The server repeats membership, session-state, seat, room assignment and project-state checks before issuing that replacement today; adding a Course-entitlement recheck to that path is a release-gated design item, not current behaviour.

The pre-enable release smoke — required once the RDS-backed seat lifecycle and the signed webhook receiver exist — runs only against an authorised non-production project: provision a room, connect two test identities, send one reliable shared message, leave, verify a signed webhook and confirm the RDS seat is released. It must not use a personal account or a production learner identity. The control-plane staging smoke described below proves only that the staging credentials are accepted and can manage a room; it is not this gate.

## Incident model and LiveKit joint testing

The application reduces browser disconnect reasons, connection quality and server gateway errors to a small, redacted incident code. This is the only vocabulary sent to metrics. It deliberately does not record a provider response, a room name, a participant identity, a token or a credential reference.

| Signal | Product response | Provider / operator response |
|---|---|---|
| `JOIN_FAILURE` | Request one server-verified replacement token; do not retry indefinitely | Forced current-credential read plus Room Service permission check before signing the replacement |
| `ROOM_DELETED` | End the local meeting view and re-read the session; do not mint a new token | Investigate room lifecycle and the corresponding signed webhook once webhook delivery is enabled |
| `DUPLICATE_IDENTITY` / `PARTICIPANT_REMOVED` | Give the learner a specific terminal explanation; never call it a network error | Check deliberate moderation, account/session policy and provider event evidence |
| media quality `Lost` / `Reconnecting` | Let the LiveKit SDK reconnect; show reconnecting; no project switch or token loop | Correlate network-quality and reconnect outcomes by redacted project id and incident class |
| credentials, 401/403 | Keep the learner's seat, expose temporary unavailability, and do not leak the provider result | Alert immediately; verify the current secret version, then use the documented overlapping-key rollback/rotation path |
| 429 / 5xx / unreachable | A new room may try a standby active project once; an assigned room remains pinned | Alert by project and failure class. Do not migrate a live room across projects |

The active Overlay `study-group` suite includes every `tests/unit/study-group-*.test.ts` file, including the incident classifier, API authorization, recovery UI and staging-smoke cleanup tests. This makes the deterministic state machine part of ordinary fork CI, not an operator-only check.

For real-provider validation, run **LiveKit staging smoke** manually in GitHub Actions. It is protected by the `livekit-staging` Environment and requires the explicit confirmation value `RUN_STAGING_LIVEKIT_SMOKE`. Store only these Environment secrets there: `LIVEKIT_STAGING_URL`, `LIVEKIT_STAGING_API_KEY`, and `LIVEKIT_STAGING_API_SECRET`. The job creates one uniquely named two-seat room, confirms that the Room Service returns that exact room, signs and locally verifies one 60-second participant token, then deletes the room even if verification fails. Its output is success/failure only; it never prints the room name, key, secret or token.

This control-plane smoke proves that the configured staging credentials are currently accepted and can manage a room. It does **not** prove browser media transport, webhook delivery, plan allowance or the production account. Before release, run a separate deployed-browser exercise against the same staging project with two disposable test users: join, publish one reliable data message, toggle offline/online to observe SDK reconnect, close the room, and save the redacted incident events plus the provider event trace. Do not simulate a 401/429 by corrupting production secrets or exhausting a real quota; cover those fault mappings in deterministic tests and use a pre-approved staging rotation drill for the credentials path.

A local deterministic counterpart covers the join, shared-message and lifecycle parts: `npm run test:e2e:studygroup` drives two browser contexts into one real LiveKit room (a local docker LiveKit server behind a TLS proxy by default; a real cloud project when `STUDYGROUP_E2E_LIVEKIT_URL`, `STUDYGROUP_E2E_LIVEKIT_KEY` and `STUDYGROUP_E2E_LIVEKIT_SECRET` are set), asserts the shared tutor data message appears in both browsers and that the final leave completes the Session. Its screen-share visual assertion needs a machine that can start `getDisplayMedia` and is skipped with a loud marker otherwise. This harness does not replace the staging exercise above.

## Key rotation

Credential stores are write-only by design: GitHub environment secrets cannot be read back, and AWS Secrets Manager versions are rotated by writing a new version and revoking the old version's stage. Rotation is therefore always create → inject → overlap → revoke, and the recovery path is minting a replacement key, never reading back the old value. Keep one canonical credential store per environment (AWS Secrets Manager) and update any CI-only copy (the GitHub `livekit-staging` environment secret) in the same rotation step so the two cannot drift.

1. Create a replacement key in the current LiveKit project; do not revoke the working key yet.
2. Store the replacement under a new AWS Secrets Manager version/reference and update the registry without putting raw credentials in source or browser configuration.
3. Deploy/reload the server-side resolver and complete the non-production room/token smoke (plus the webhook step once the signed webhook receiver exists).
4. Keep both versions for at least the maximum issued token TTL and the agreed rollback window. Monitor provider authentication failures.
5. Revoke the old key only after the overlap and verification period; record project id, timestamp, actor and redacted evidence in the release record.
6. If verification fails, return the resolver to the old secret version; do not move active sessions to another project.

## Project outage and retirement

For a new-session provider failure, return a typed temporary-unavailable state and alert. The registry may select another healthy active project only before a room is created. Do not silently fail over an existing room.

For retirement, mark the project `draining`; ensure no new session is assigned; wait for every assigned session, token TTL and reconciliation window to end; then mark it `disabled` and revoke the credential. Keep the operational evidence with the release record.

## Incident response

The webhook, reconciliation and durable tutor-delivery responses below describe the target operational model; they apply once those release-gated features exist. Today there is no LiveKit webhook receiver, no reconciliation loop, and tutor delivery ownership is in-process (container-local JSON and in-memory delivery ownership are release blockers).

- Invalid webhook signature: reject, do not write state, alert on sustained failures.
- Missing webhook or browser crash: reconciliation checks the provider/session mapping after the configured grace period and records the reason for any seat release.
- Tutor publication failure: use the durable retry/lease policy. Terminal failure advances the queue and creates a redacted operational event; it never leaves a permanently in-flight request.
- Quota, 5xx or credential failure: classify the fault, open the circuit for new sessions if necessary, preserve existing room assignment, and use the documented rollback/rotation path.
