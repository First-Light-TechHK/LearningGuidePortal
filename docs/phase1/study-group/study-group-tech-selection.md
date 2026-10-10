# Study Group technology selection

Reviewed against PRD v0.10 and branch `cursor/study-group-backend-7481` at `18a1046ec71853f77d1b73eda545526c58964826` ([PR 37](https://github.com/LibertychaserUS/LearningGuidePortal/pull/37)). Later closed choices are in `decisions.md`.

The selections below are the ones this design uses. The branch has not moved Group Study onto PostgreSQL yet. That is recorded as the current code, not as a second choice.

## LiveKit Cloud

Live Sessions run in the browser on LiveKit Cloud. The PRD names that platform for the room, audio, video, screen share, presence, and data transport. Shared Chat stays in the room. It is not a database row.

The application service signs a short-lived participant token. The browser receives that token and the project WebSocket URL. The LiveKit API secret stays on the server.

Rejected:

- Daily, Agora, or Twilio. The PRD already names LiveKit Cloud, and the branch already depends on `livekit-client`.
- A self-hosted LiveKit or a second media service. Phase 1 Cloud stays on the existing App Runner, RDS, S3, Secrets Manager, CloudWatch, and SES set, plus the named external providers.
- A chat table or a message service. Chat would then outlive the room, which this phase does not do.

## PostgreSQL

Group, membership, Live Session, attendance intent, presence, the one meeting row, and reminder rows are product records. They belong in the same RDS PostgreSQL database as the rest of Learning Guide. DEV, SIT, UAT, and PPE/PROD already use that database. App Runner instances do not keep a private disk.

The logical tables are `study_groups`, `study_group_memberships`, `live_sessions`, `study_group_attendance_intents`, `study_group_presences`, `study_group_meetings`, `study_group_reminders`, and `study_group_tutor_queue`. The tutor queue is session-scoped. A row is user id, session id, text, and server receipt time. Nothing in this phase selects or deletes those rows. Chat is not one of these tables. `live_sessions.duration_seconds` is only 1800, 2700, 3600, or 5400, the stored form of the choices 30, 45, 60, and 90 minutes. The Figma session card shows `45 mins`. Seat grant and its release, and the single meeting insert, run inside a database transaction. External idempotency for a repeated Host Start is the unique meeting row for that Live Session.

The branch does not do this yet. `modules/group-study/repository.ts` reads and writes one JSON file, `study-group.json`, and appends `token-issuance.log` beside it. The in-process queue serializes writers only inside one process.

Rejected:

- The JSON file as the production store. A second App Runner instance would not share it, and the container disk is ephemeral.
- A new database engine. The Cloud list for this product is RDS PostgreSQL.
- Putting these rows into the payment aggregate. Group Study is its own Business Function. It reads Course access. It does not own Entitlement.

## Service and repository split

This follows the existing Learning Guide split.

- The page and `components/portal` render and call HTTP. They do not decide price, membership, capacity, or Course access.
- The Route Handler parses the request, reads the session, calls the application service, and returns `{ ok, code, message, data }`.
- `modules/group-study/service.ts` holds the rules: Course access, Host actions, state, the six-person cap, request-time order, token signing, and the encrypted log line.
- The repository is the only place that writes the rows.
- LiveKit is called only to connect the browser with a token the service already signed. Stripe is not involved.

Rejected:

- A Group Study microservice. Phase 1 is one Next.js application.
- SQL or LiveKit signing inside the Route Handler or the page.

## Token issuance

The service signs a participant token for one user and one Live Session. The grants are join, publish, subscribe, and data. Those grants are the same for the Host and for a Joined Member. The token carries the user id and display name. It does not carry a Host label, a Host role, or room admin.

The branch implements that shape in `modules/group-study/liveKitToken.ts` and returns it from `POST /api/study-groups/sessions/:sessionId/token`. The TTL in that code is 600 seconds. The PRD says the token is short-lived and does not give a number. 600 seconds is the branch value, not a second product rule.

Rejected:

- A LiveKit API key or secret in the browser.
- A Host-only or room-admin grant. In-room permissions match a participant.
- A long-lived token reused across Sessions.

## AI Tutor call

The Study Group tutor uses a direct model call. No agent framework is added. `package.json` on `main` has none. The call layer is a lightweight distributed service, not a heavy platform. It keeps a pool of API keys. On auth failure, rate limit, or quota, it uses another key. It records request count, errors, and latency per key, and sends traffic only to healthy keys. Raw keys are never logged, never committed, and never sent to the browser.

The model vendor is not chosen. How a reply re-enters the LiveKit room is not chosen. The queue remains per Live Session. Course context for an answer is supplied by a later design. The shape of that context, how a knowledge base is built, the structure of the base, and the structure of a piece of knowledge are not chosen. This note adds no schema, table, or sample content for that base.

Not used:

- Vercel AI SDK, LiveKit Agents, Claude Agent SDK, and LangGraph. The call stays direct. No new framework dependency is added.
- A per-user tutor identity or a course-wide tutor identity. Whether the tutor is one per user or one shared by a Course is not decided.

## Encrypted issuance log

Each successful issuance appends one line. The line is AES-256-GCM. The payload is user id, Group role, session id, the state `token_issued`, and the time. The line does not contain the raw token or the API secret. There is no token table and no token audit table.

The key is `STUDY_GROUP_TOKEN_LOG_KEY`, a 32-byte key separate from the LiveKit secret. The branch writes the line in `token-issuance.log`. Under the PostgreSQL selection, that line stays an append-only log, not a token row.

Rejected:

- A `livekit_tokens` table. That would keep a credential the locked decision says not to store.
- A plaintext log. The line would then be able to hold the token or the secret.
- Skipping the line. The locked decision asks for one encrypted line per issuance.
