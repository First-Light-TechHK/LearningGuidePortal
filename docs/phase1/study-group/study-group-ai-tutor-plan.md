# Study Group AI Tutor plan

Later closed choices are in `decisions.md`.

This phase does not call a model from the enqueue path. It stores the Live Session flag and a session-scoped request queue. A later tutor can read that queue without changing seats, tokens, or chat.

## This phase

- Persist `aiTutorEnabled` on the Live Session. The Host can turn it off before the Session starts.
- A participant who is in a live Session with the flag on can enqueue one request.
- The queue item stores the user id, the session id, the text, and the server receipt time.
- The same client event id returns the original item.
- The item is not a chat row and not a token row.
- Enqueue does not change occupancy, does not issue a LiveKit token, and does not call a provider.
- The enqueue path has no drain and no Course Knowledge call; the implemented delivery path drains the queue (see decisions.md). On request in the shared Chat the tutor can ask one grounded understanding-check question (prompt constant in `tutorPrompt.ts`; reply-tag parsing and reply clamping in `tutorAnswer.ts`; `tests/unit/study-group-tutor-retrieval.test.ts`).
- Do not put an AI Tutor participant in the LiveKit room.

## Queue

The queue that exists in this design is per Live Session only. Items are answered in fair order (tutor infra, 2026-10-20): askers take turns, everyone's first question before anyone's second, an answered question still counting as that asker's turn, and server receipt order within a turn (`tutorFairTurn` in `domain.ts`; the PostgreSQL claim orders by the same key). One question for that Session is in flight at a time. A later question does not cancel or merge with an earlier one. An answer is tied to the asker and to the original text. This plan does not add a per-user tutor identity or a course-wide tutor identity.

decisions.md closes this: the tutor is the Related Course tutor, shared in the Live Session chat, with no private per-user channel.

## Server-side prompt

The prompt wording is a server-side constant. It is not returned by the token route, not written into LiveKit metadata, and not shipped to the browser. Participant text is untrusted data inside a delimiter and cannot override these limits. The tutor does not parse the screen. Replies are for the shared room. The model call happens on the implemented delivery path, not in this prompt constant.

Answers may use the course context that a later design supplies. decisions.md closes that shape, and later revised it (2026-10-13, owner decision, recorded deviation from PRD BR-030): the course's existing stored text — published lesson text plus every file in the course's `knowledge/<slug>/` directory — is supplied whole to the model, which fuzzy-matches the question against it, by meaning and across languages. The tutor never refuses. When the material does not cover the question it answers from general knowledge and flags the reply GENERAL (published mode `general`), which the client marks as not from the course material; a course-grounded reply is flagged COURSE (published mode `course`). A model completion is never presented as a course fact — the client label, not the text, carries the distinction.

## Knowledge base

Closed by decisions.md: no new knowledge base, table, schema, or import is added. A piece of knowledge is the course's existing stored text, supplied whole to the model instead of being filtered server-side.

## Call

The model call is direct. No new framework is added. `package.json` on `main` has no agent framework. The call layer is a lightweight distributed service, not a heavy platform. It keeps a pool of API keys. On auth failure, rate limit, or quota, it switches to another key. It records request count, errors, and latency per key, and sends traffic only to healthy keys. Raw keys are never logged, never put in the repo, and never sent to the browser.

This plan left the model vendor and the reply path open. decisions.md later closed both: a direct OpenRouter-compatible chat completion (with `STUDY_GROUP_TUTOR_URL` as an OpenAI-compatible alternative) and one shared, reliable LiveKit data message with no destination list (`{ type: "tutor", id, text, mode }` with mode `course`, `general`, or `unavailable`).

## Answer engine (tutor infra, 2026-10-20)

`tutorEngine.ts` owns one claimed question from the queue to an answer or a classified failure, inside the question's 45-second answer deadline and its claim lease:

- Models: an ordered list (`STUDY_GROUP_TUTOR_MODELS`, comma separated; else `STUDY_GROUP_TUTOR_MODEL`; else a pinned default list). `openrouter/auto` is no longer the default. A model the provider reports as gone (404 "No endpoints found") is skipped for 10 minutes and the next model answers; a model that refuses tool definitions is called without tools for an hour.
- Failures are classified (`auth`, `quota`, `rate_limited`, `timeout`, `upstream_error`, `model_gone`, `bad_request`, `empty`, `malformed`, `deadline`, `budget`, …). A refused key (401/403) rests for every model for 10 minutes; a rate limit or a quota rests the key for that model only, so the next model may still use it; a moderation 403 is the question's, not the key's. Each model call gets at most 20 seconds, so a stalled model leaves time for the next. Retryable classes go to the next model, for up to three rounds with a short backoff. The room's unavailable answer carries only a coarse `reason` (`busy`, `setup`, `refused`, `provider`); the log keeps the precise class.
- Replies are checked before the room sees them: the mode tag, a QUIZ tag for an understanding check (published with `kind: "quiz"` and labelled in the room), the length guard (480 Latin to 240 CJK characters), the question's language (a wrong-language reply is kept only if no model does better), and no key echoed.
- Room memory: the latest three exchanges of the session and any open understanding check (15 minutes) go into every call as `room_context`, built by the server from its own answered requests. Older exchanges are behind the read-only tool `get_room_history`; `get_open_quiz` returns the open check. The tool loop takes at most three model calls; every call of the loop carries the tool definitions, the last one with `tool_choice: "none"`, and at most three tool calls run per step. Room text goes into `room_context` on one line with `<`, `>` and `&` escaped, and the participant text is escaped the same way. Course knowledge tools join this registry when the Knowledge System module is integrated (owner, 2026-10-20); until then the course material goes in the prompt as before.
- Health, per process: three failed questions in a row (a refused question does not count) pause the Tutor for 60 seconds, and while paused or over budget the server refuses a new question with `tutor_unavailable` (503); a daily spend cap per instance (`STUDY_GROUP_TUTOR_DAILY_BUDGET_USD`, default 10, `off` to disable) from the cost OpenRouter reports. The session view carries `tutor: { available }` or `{ available: false, reason: no_key | provider_down | budget }`, and the room greys out the Tutor entry with the reason. Operators read the last hour (answered, failed, p95 latency, failure classes, spend, model marks) at `GET /api/backoffice/study-group/tutor-health`. Each question leaves one log line `study_group.tutor_answer` with classes and counts only, never text, names or keys.
- The asker sees their place in the queue (`viewerTutorQuestions` on the session view) and can withdraw a question the Tutor has not started (`DELETE …/ai-tutor` with `requestId`; `tutor_answering`, 409, once it has; a repeated withdrawal answers `withdrawn` again). The room's own answer timer never calls a question unavailable while the server still lists it as waiting.
- `scripts/studygroup-tutor-eval.ts` runs a fixed set of standard questions (Chinese and English, course and general, quiz, follow-up, injection) through the same engine and checks tag, language, cut and leaks per model. It targets the local mock unless a provider URL and key are given, and stops at a cost cap.

## Later phase

When a later phase drains this queue:

- Any current participant may invoke the tutor from the shared LiveKit Chat.
- The prompt and the reply stay in that Chat. Everyone currently in the room sees them. They are not database rows.
- The tutor does not pick a Knowledge Release. Related Lesson stays optional Session metadata.
- Shared screen, video, and Interactive Exhibit pixels are not sent to the tutor. A participant who wants a topic must type it.
- The Host label does not open a private tutor channel. There is no private Chat.

## Out of this plan

- Public persistent Discussion.
- A scored group assessment or a Host-submitted group answer.
- A post-session summary or a reusable group learning record.
- Tutor interpretation of the shared screen.
