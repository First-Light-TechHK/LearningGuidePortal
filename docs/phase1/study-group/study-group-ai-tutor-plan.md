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

The queue that exists in this design is per Live Session only. Items are ordered by server receipt time. One question for that Session is in flight at a time. A later question does not cancel or merge with an earlier one. An answer is tied to the asker and to the original text. This plan does not add a per-user tutor identity or a course-wide tutor identity.

decisions.md closes this: the tutor is the Related Course tutor, shared in the Live Session chat, with no private per-user channel.

## Server-side prompt

The prompt wording is a server-side constant. It is not returned by the token route, not written into LiveKit metadata, and not shipped to the browser. Participant text is untrusted data inside a delimiter and cannot override these limits. The tutor does not parse the screen. Replies are for the shared room. The model call happens on the implemented delivery path, not in this prompt constant.

Answers may use the course context that a later design supplies. decisions.md closes that shape, and later revised it (2026-10-13, owner decision, recorded deviation from PRD BR-030): the course's existing stored text — published lesson text plus every file in the course's `knowledge/<slug>/` directory — is supplied whole to the model, which fuzzy-matches the question against it, by meaning and across languages. The tutor never refuses. When the material does not cover the question it answers from general knowledge and flags the reply GENERAL (published mode `general`), which the client marks as not from the course material; a course-grounded reply is flagged COURSE (published mode `course`). A model completion is never presented as a course fact — the client label, not the text, carries the distinction.

## Knowledge base

Closed by decisions.md: no new knowledge base, table, schema, or import is added. A piece of knowledge is the course's existing stored text, supplied whole to the model instead of being filtered server-side.

## Call

The model call is direct. No new framework is added. `package.json` on `main` has no agent framework. The call layer is a lightweight distributed service, not a heavy platform. It keeps a pool of API keys. On auth failure, rate limit, or quota, it switches to another key. It records request count, errors, and latency per key, and sends traffic only to healthy keys. Raw keys are never logged, never put in the repo, and never sent to the browser.

This plan left the model vendor and the reply path open. decisions.md later closed both: a direct OpenRouter-compatible chat completion (with `STUDY_GROUP_TUTOR_URL` as an OpenAI-compatible alternative) and one shared, reliable LiveKit data message with no destination list (`{ type: "tutor", id, text, mode }` with mode `course`, `general`, or `unavailable`).

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
