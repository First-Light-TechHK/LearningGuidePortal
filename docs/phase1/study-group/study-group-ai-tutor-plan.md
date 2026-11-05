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
- The enqueue path has no drain and no Course Knowledge call; the delivery path drains the queue (see "Answer path" below).
- Do not put an AI Tutor participant in the LiveKit room.

## Queue

The queue that exists in this design is per Live Session only. Items are answered in fair order (tutor infra, 2026-10-20): askers take turns, everyone's first question before anyone's second, an answered question still counting as that asker's turn, and server receipt order within a turn (`tutorFairTurn` in `domain.ts`; the PostgreSQL claim orders by the same key). One question for that Session is in flight at a time. A later question does not cancel or merge with an earlier one. An answer is tied to the asker and to the original text. This plan does not add a per-user tutor identity or a course-wide tutor identity.

decisions.md closes this: the tutor is the Related Course tutor, shared in the Live Session chat, with no private per-user channel.

## Answer path (current, since 2026-10-23)

The room Tutor is KnowledgeSystem's course AI Tutor in Lecture mode (owner decision 2026-10-23, `decisions.md`). Portal holds no prompt, model, provider key or course corpus for it.

- **Call**: `runtime.ts` `tutorKs` streams KS's learner chat (`streamTutorText`, `mode: "lecture"`, `channel: "study-group"`, so the room has its own KS quota bucket apart from the 1:1 Tutor). The course must be published in Portal. The KS endpoint is `KS_TUTOR_BASE_URL` / `KS_TUTOR_API_KEY`; the Lecture prompt, model and key are whatever the KS AI Tutor page sets.
- **Context**: only earlier `@AI Tutor` exchanges of the same Live Session (at most 12, each question cut to 500 characters; `tutorHistory` in `service.ts`). Ordinary room chat is never sent.
- **Deadlines**: one answer gets 45 seconds (`TUTOR_ANSWER_BUDGET_MS`); a claim lease is 60 seconds; one drain stops after 45 seconds and the recovery timer picks up the rest.
- **Reply**: the KS answer text as it comes, published once as `{ type: "tutor", id, text, mode, replyTo?, reason? }`. `mode` is `course` for an answer and `unavailable` (empty text, failure class in `reason`) when KS could not answer; the client shows its own "temporarily unavailable" line. `tutorAnswerText.ts` renders LaTeX and turns `[Source: …]` citations into a short source list under the answer.
- **Availability**: follows the related course's KS Online switch (cached 10 seconds). The session view carries `tutor: { available }` or `{ available: false, reason: "offline" }`. `GET /api/backoffice/study-group/tutor-health` returns that availability and `source: "ks"`; `/api/health/config` reports `studyGroup.tutorSource` (`ks` or `none`).
- **Unchanged from the queue design**: fair turns, one question in flight per session, two waiting per asker (`tutor_busy`), five per minute (`tutor_rate_limited`), withdrawal of a question not yet started, `replyTo` on every answer, and no call for a session that has ended or an asker who has left.

## History (superseded 2026-10-23)

From 2026-10-13 to 2026-10-22 Portal ran its own room Tutor: a server-side prompt with COURSE / GENERAL reply tags and understanding-check questions, the whole `knowledge/<slug>/` text in the prompt, an OpenRouter key pool (`STUDY_GROUP_TUTOR_KEYS` / `STUDY_GROUP_TUTOR_KEYS_SECRET_ID`), an ordered model list (`STUDY_GROUP_TUTOR_MODELS`), a daily budget (`STUDY_GROUP_TUTOR_DAILY_BUDGET_USD`), room tools, and `tutorEngine.ts` / `tutorPrompt.ts` / `tutorAnswer.ts` / `scripts/studygroup-tutor-eval.ts`. Commit 8b5f17e removed all of it. None of those variables or files is read any more.

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
