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
# Create .env.local with OPENROUTER_API_KEY (and DATABASE_URL/DATA_S3_BUCKET when using the AWS persistence path)
npm run dev
```

The product smoke flow can be run against a started local server with `npm run smoke:product`.

Do not commit `.env` / `.env.local`.

For a local operator account, set `BACKOFFICE_OPERATOR_EMAIL` before starting the server and register that exact address. For Stripe test mode, set `PAYMENT_MODE=stripe`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` and `NEXT_PUBLIC_APP_URL`; for production email verification and password reset, also set `SES_FROM_EMAIL` and grant the App Runner role permission to send through SES. Google and WeChat buttons appear only when their server credentials are configured.

## Legacy reference

The older Spring Boot + Vue admin MVP remains a read-only reference for behavior and data shapes until migration completes; it is not the deploy source.
