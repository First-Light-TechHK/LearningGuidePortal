# LearningGuide

Product home for **Learning Guide × AITutor** consolidation inside [`Ashley-AIHR/AITutor`](https://github.com/Ashley-AIHR/AITutor).

## Canonical location

| Item | Path |
|------|------|
| GitHub repo | https://github.com/Ashley-AIHR/AITutor |
| Product folder | [`LearningGuide/`](./) |
| Architecture | [`docs/architecture-ai-tutor-integration.md`](./docs/architecture-ai-tutor-integration.md) |
| Implementation plan | [`docs/implementation-plan-nextjs-migration.md`](./docs/implementation-plan-nextjs-migration.md) |

## Runtime today

The Next.js App Runner app still lives at the **repository root** (`app/`, `services/`, `Dockerfile`, etc.). This `LearningGuide/` folder holds product docs and is the landing place for LMS migration work (schema notes, scripts, and later `app/(lms)` planning artifacts).

## Decision

- **Selected**: Option C — full Next.js on AWS App Runner
- **Not selected**: Port AITutor into Java; long-term Java LMS + Next AI dual stack
