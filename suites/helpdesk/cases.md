# Helpdesk — learner enquiries, assistant and Help Centre

Compiled from existing tests in `tests/unit/helpdesk-*.test.ts` and `tests/io/postgres/helpdesk-*.test.ts`.

## HD-01 Submit an enquiry

### Functional
- Title: A signed-in learner creates an enquiry
- Steps: Submit the form with valid fields
- Expected: Numbered per UTC day, OPEN, with one learner message (`helpdesk-service`)

### Negative
- Title: No session, bad input, or a file that is not what it claims
- Steps: Post without a session; post untrimmed, over-long or unknown values; attach a file whose bytes do not match its type
- Expected: 401 problem; validation failure; the attachment is refused by its magic bytes (`helpdesk-api`, `helpdesk-contract`, `helpdesk-attachments`)

### Edge
- Title: The same request twice
- Steps: Repeat with the same idempotency key, then with a changed payload
- Expected: The same key and payload replays; a changed payload is refused (`helpdesk-service`)

## HD-02 Ticket states

### Functional
- Title: Allowed transitions
- Steps: Apply every transition in the spec table
- Expected: Each reaches its target state (`helpdesk-domain`)

### Negative
- Title: Anything outside the table
- Steps: Apply every other event and state combination
- Expected: invalid_transition (`helpdesk-domain`)

### Edge
- Title: The time windows
- Steps: Act at the 72-hour confirmation window and the 7-day reopen and rating window
- Expected: auto_confirm only once the due time has passed; reopen and rating stop after 7 days (`helpdesk-domain`)

## HD-03 Ownership

### Functional
- Title: A learner reads their own enquiry
- Steps: Open an enquiry you created
- Expected: The enquiry and its attachments are shown (`helpdesk-service`)

### Negative
- Title: Someone else's enquiry
- Steps: Read or act on another learner's enquiry or attachment
- Expected: Refused (`helpdesk-service`); INV-helpdesk-own-tickets

### Edge
- Title: A rate limit counts per learner
- Steps: Exceed 10 new tickets in an hour, then replay, and let another learner submit
- Expected: 429 rate_limited with retryAfter; replays and other learners are not limited (`helpdesk-service`)

## HD-04 AI Support Assistant chat

### Functional
- Title: A person is offered when the assistant cannot help
- Steps: Ask for a person, or have two unsolved turns in a row
- Expected: The handover card shows, and the form opens with the chat's answers linked (`helpdesk-v4-chat-end`, `helpdesk-v4-chat-end-ui`)

### Negative
- Title: No reply
- Steps: Ask and receive nothing for 18 seconds
- Expected: The error shows and the question stays in the input (`helpdesk-contact-support-page`)

### Edge
- Title: A reload around a question
- Steps: Reload right after asking
- Expected: The question is saved before it is sent and comes back with the error, so the learner can ask again (`helpdesk-contact-support-page`)

## HD-05 Help Centre

### Functional
- Title: Popular, search and category
- Steps: Open the Help Centre, search, choose a topic
- Expected: Admin answers each mode with the right query (`helpdesk-help-centre`, `helpdesk-help-centre-page`)

### Negative
- Title: Admin is failing
- Steps: Load FAQs while Admin answers with an error
- Expected: Stale data on error, nothing when nothing is cached (`helpdesk-admin-client`)

### Edge
- Title: A link to a folded article
- Steps: Open `?faq=` for the 12th of 25 popular FAQs
- Expected: The list opens unfolded with that article open (`helpdesk-help-centre-page`)

## HD-06 Privacy of chat data

### Functional
- Title: Scrubbing
- Steps: Run the scrubber on the corpus shared with Admin
- Expected: Personal data is replaced with placeholders in zh-CN, zh-TW, English and mixed text (`helpdesk-pii-scrubber`, `helpdesk-pii-corpus-fixture`)

### Negative
- Title: Nothing leaks through logs
- Steps: Cause an unexpected failure with learner text in its message
- Expected: The log holds the error code, never the message (`helpdesk-problem-log`)

### Edge
- Title: Retention
- Steps: Run retention over rows older and newer than 180 days
- Expected: Older rows keep only scrubbed text and labels; newer rows keep the raw text (`helpdesk-v5-retention`)
