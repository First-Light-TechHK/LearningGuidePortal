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
npm ci
npm run setup:local
# Edit .env.local and add OPENROUTER_API_KEY from the team's secure secret store.
npm run dev
```

The product smoke flow can be run against a started local server with `npm run smoke:product`.

Do not commit `.env` / `.env.local`.

For a local operator account, set `BACKOFFICE_OPERATOR_EMAIL` before starting the server and register that exact address. With `LOCAL_SOCIAL_LOGIN=1` (the local default), Google and WeChat buttons use local accounts without external credentials, and `PAYMENT_MODE=demo` uses a local checkout. This is not a live site configuration. For real local provider testing, each developer uses credentials issued for the shared Google/WeChat development applications or their own test applications, and the Stripe test key plus Stripe CLI secret from the team's secure secret store. Follow [`docs/phase1/local-provider-testing.md`](docs/phase1/local-provider-testing.md); never copy another developer's `.env.local` through Git or chat.

The repository contains the safe configuration template, not secrets. A new developer needs:

```text
GitHub repository access
Node.js and npm
the team's local OpenRouter key
optional Google/WeChat development credentials
optional Stripe test secret and Stripe CLI login for real payment testing
```

For PPE/PROD, run `npm run preflight:production` with the App Runner environment variables first, then use real Google and WeChat server-side credentials, `PAYMENT_MODE=stripe`, Stripe secret and webhook secrets, HTTPS `NEXT_PUBLIC_APP_URL`, RDS PostgreSQL, S3 and SES. See [`docs/phase1/production-configuration.md`](docs/phase1/production-configuration.md).

## Legacy reference

The older Spring Boot + Vue admin MVP remains a read-only reference for behavior and data shapes until migration completes; it is not the deploy source.
