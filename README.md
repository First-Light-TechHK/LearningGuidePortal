# LearningGuide

Product monorepo for Learning Guide (Next.js), based on the AITutor baseline.

- **GitHub**: https://github.com/Ashley-AIHR/LearningGuide
- **Deploy target**: AWS App Runner (see `Dockerfile`, `apprunner.yaml`)
- **Architecture**: [docs/architecture-ai-tutor-integration.md](docs/architecture-ai-tutor-integration.md)
- **Implementation plan**: [docs/implementation-plan-nextjs-migration.md](docs/implementation-plan-nextjs-migration.md)
- **Phase 1 developer rules**: [`AGENTS.md`](AGENTS.md), [`DESIGN.md`](DESIGN.md)
- **Phase 1 requirements and data contracts**: [`docs/phase1/requirements-map.md`](docs/phase1/requirements-map.md), [`docs/phase1/domain-model.md`](docs/phase1/domain-model.md), [`docs/phase1/api-contracts.md`](docs/phase1/api-contracts.md), [`docs/phase1/release-runbook.md`](docs/phase1/release-runbook.md)

## Baseline

This repository was initialized from [Ashley-AIHR/AITutor](https://github.com/Ashley-AIHR/AITutor). LMS features from the legacy Java/Vue Learning Guide MVP will be migrated here in phases (see implementation plan).

## Local development

```bash
npm install
# Create .env.local with OPENROUTER_API_KEY (and DATABASE_URL when using Postgres)
npm run dev
```

Do not commit `.env` / `.env.local`.

## Legacy reference

The older Spring Boot + Vue admin MVP remains a read-only reference for behavior and data shapes until migration completes; it is not the deploy source.
