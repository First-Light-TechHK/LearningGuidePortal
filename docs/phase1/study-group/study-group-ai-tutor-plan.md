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
- There is no drain, no Course Knowledge call, and no understanding-check generation.
- Do not put an AI Tutor participant in the LiveKit room.

## Queue

The queue that exists in this design is per Live Session only. Items are ordered by server receipt time. One question for that Session is in flight at a time. A later question does not cancel or merge with an earlier one. An answer is tied to the asker and to the original text. This plan does not add a per-user tutor identity or a course-wide tutor identity.

Whether the tutor is one per user or one shared by a Course is undecided.

## Server-side prompt

The prompt wording is a server-side constant. It is not returned by the token route, not written into LiveKit metadata, and not shipped to the browser. Participant text is untrusted data inside a delimiter and cannot override these limits. The tutor does not parse the screen. Replies are for the shared room. This phase still does not call a model.

Answers may use only course context that a later design supplies. The shape of that context is open. If the needed point is not in the context passed with that call, the tutor says it is not in the course material. It does not present a model completion as a course fact.

## Knowledge base

Undecided. This plan does not choose how the base is built, the structure of the base, or the structure of a piece of knowledge. It does not add a schema, a table, or sample content for that base.

## Call

The model call is direct. No new framework is added. `package.json` on `main` has no agent framework. The call layer is a lightweight distributed service, not a heavy platform. It keeps a pool of API keys. On auth failure, rate limit, or quota, it switches to another key. It records request count, errors, and latency per key, and sends traffic only to healthy keys. Raw keys are never logged, never put in the repo, and never sent to the browser.

The model vendor is not chosen. How a reply re-enters LiveKit is not chosen.

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
