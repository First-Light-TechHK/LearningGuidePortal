# Study Group AI Tutor plan

A participant in a live Session can enqueue their own text. One shared answer can then be published into that Session's LiveKit chat. Closed choices are in `docs/phase1/study-group/decisions.md`.

## This phase

- A participant who has entered a live Session with the flag on can enqueue a request.
- The item stores the user id, the session id, the text, and the server receipt time.
- The same client event id returns the original item.
- Enqueue does not call a model, change occupancy, or issue a token.
- One question is in flight per Session, in server receipt order. A later question waits.
- The room posts `{ message }` to `POST /api/study-groups/sessions/:sessionId/ai-tutor`. The server function is `enqueueTutor`.
- If Course Knowledge retrieval returns nothing, the shared chat says the course material does not contain the answer.
- Otherwise the server calls OpenRouter with the model id from one environment variable and publishes the reply to the shared LiveKit chat.

## Later behaviour

When a later phase attaches a tutor to the queue:

- Any current participant may invoke the tutor from the shared LiveKit chat.
- The prompt and the reply stay in that ephemeral chat. They are not database rows.
- Answers and understanding-check questions use the Related Course AI Tutor configuration and the current student-facing Course Knowledge. The Study Group does not pick a Knowledge Release.
- Related Lesson stays optional metadata and does not change grounding.
- Shared screen, video, and exhibits are not sent to the tutor.
- The Host label does not grant a private tutor channel.

## Out of this phase

- No private tutor channel and no screen parsing.
- No second knowledge base, table, or import.
- Chat text stays in LiveKit. The queue row is the request, not a tutor transcript.
