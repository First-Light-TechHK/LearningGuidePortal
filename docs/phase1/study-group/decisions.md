# Study Group decisions

PRD v0.10 section 8.1 lists the records and fields. It does not name PostgreSQL, RDS, or SQL. This branch keeps the Study Group store it already uses: the file repository in `modules/group-study/repository.ts`. No database, migration, or new store technology is added for Study Group. Writes that already repeat safely stay that way: a second join does not add a member, the same client event id returns the original tutor item, and a session has one meeting row.

Where `study-group-architecture.md`, `study-group-tech-selection.md`, or `study-group-ai-tutor-plan.md` left a point open, this file is the choice.

## Tutor

The tutor is the Related Course tutor, shared in the Live Session chat. It is not a private tutor per user and not a second tutor product.

Answers are grounded by lexical retrieval over Course Knowledge text that already exists for that course: published lesson text, and the Course Knowledge files the course tutor already reads (`knowledge-pack.json`, `canon-excerpts.md`, `sources.md`). No new knowledge base, table, or import is added. A piece of knowledge is that stored text. If retrieval returns nothing, the shared chat says: "The course material does not contain the answer." The model is not called in that case.

The model call is a direct OpenRouter chat completion through `fetchOpenRouter`, the same client the course tutor uses. The model id is `OPENROUTER_MODEL`. No agent framework is added.

The answer is published into the shared LiveKit room as one data message every current participant can read. The packet has no destination list. Screen, video, and exhibit pixels are not sent.

One question is in flight per Live Session. Later questions wait. Order is the server receipt time. The asker and the original text stay on the queue item. Enqueue writes that item and does not call the model.

## API keys

`STUDY_GROUP_TUTOR_KEYS` is one environment variable. Its value is a JSON list of `{ "id", "secret" }`. On auth failure, rate limit, or quota, the next healthy key is used. Request counts, errors, and latency stay in memory. Changing keys means editing that variable. There is no admin UI, no key file, and no secret in the repo, logs, or responses.

## Labels and seats

The Join control for a Study Group reads "Join Study Group". The Hosting chip is shown only when the current user is the Host. A Live Session does not reserve a Host seat. The maximum of 6 includes the Host. A full session refuses another entry, including the Host.

## Duration

The Host chooses 30, 45, 60, or 90 minutes. Those choices are stored as 1800, 2700, 3600, and 5400 seconds. No other duration is accepted. The session title is at most 20 characters.
