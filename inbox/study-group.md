---
id: study-group
kind: prd
readiness: not-ready
source:
  repo: LibertychaserUS/LearningGuidePortal
  path: docs/phase1/study-group-ai-tutor-plan.md
  ref: d0da33c27bd3ac7b20a9dc90c776955f69d34ae5
packages:
  - modules/group-study
locale: en-GB
---

# Intent

Study Group P0. A learner with Course access creates a public Group and becomes Host. Live Sessions hold at most six people. Chat and tokens are not database rows.

# In scope

- SG-01 Create a Group.
- SG-02 Join, leave, and discover.
- SG-03 Live Session capacity, start, and participant token.

# Out of scope

- AI Tutor runtime.
- Persisting chat.
- A token audit table.
- Hitting production ilovelearningguide.com.

# User cases

1. A learner with Course access creates a discoverable Group and is the Host.
2. Join is immediate; a user without Course access cannot join.
3. Entry is first-come-first-served up to the Session maximum, and the token is not a Host grant.
