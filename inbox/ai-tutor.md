---
id: ai-tutor
kind: prd
readiness: ready
source:
  repo: LibertychaserUS/LearningGuidePortal
  path: docs/phase1/study-group-ai-tutor-plan.md
  ref: f667d8b442f26d280e2ef470f409678b170058aa
packages:
  - components/portal/TutorChat.tsx
  - components/portal/TutorDrawer.tsx
  - components/portal/tutorChatError.ts
  - services/ksTutorClient.ts
locale: en-GB
---

# Intent

The AI Tutor as the learner meets it on the lesson page: whether it is offered, the chat panel, the lines it shows on failure, and which course it answers for.

# In scope

- AIT-01 Availability from KnowledgeSystem.
- AIT-02 Failure lines.
- AIT-03 The chat panel.
- AIT-04 Course and language of an answer.

# Out of scope

- KnowledgeSystem internals and answer quality.
- The AI Tutor in a live room (see `inbox/study-group.md`).
- Hitting production ilovelearningguide.com.

# User cases

1. A learner opens the AI Tutor on a lesson, switches mode, asks a question, and sees a plain line when the Tutor cannot answer.

# Notes

Compiled from existing tests. Suite is active. The API the Tutor calls is not changed by this suite.
