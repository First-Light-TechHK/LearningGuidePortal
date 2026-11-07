---
id: helpdesk
kind: prd
readiness: ready
source:
  repo: LibertychaserUS/LearningGuidePortal
  path: docs/phase1/helpdesk-tickets.md
  ref: f667d8b442f26d280e2ef470f409678b170058aa
packages:
  - modules/helpdesk
  - components/helpdesk
  - app/api/helpdesk
locale: en-GB
---

# Intent

Learner Helpdesk on the Portal: Contact Support, My enquiries, the AI Support Assistant and the Help Centre. The server is the only place a ticket changes state.

# In scope

- HD-01 Submit an enquiry.
- HD-02 Ticket states.
- HD-03 Ownership.
- HD-04 AI Support Assistant chat.
- HD-05 Help Centre.
- HD-06 Privacy of chat data.

# Out of scope

- The BackOffice agent screens and Admin server (LearningGuideAdmin has no Overlay).
- The two-app browser check (`npm run test:e2e:helpdesk`, part of Verify).
- Hitting production ilovelearningguide.com.

# User cases

1. A learner asks the assistant, is offered a person when it cannot help, and sends an enquiry only they can read.

# Notes

Compiled from existing tests. Suite is active. New `tests/unit/helpdesk-*.test.ts` files join automatically.
