# Learning Guide Phase 1

## Project target

This repository is the production Learning Guide website. It is not a Knowledge System product. The Knowledge System is one part of `Study`, `Understanding/Assessment` and `AI Tutor`, and KS Phase 2 may be developed alongside this work without changing the Phase 1 product boundary.

Phase 1 must deliver a usable website for:

- public course discovery and a Public First Lesson;
- User Registration and User Authentication;
- Purchase, Payment Management, Subscription Management and Entitlement;
- My Learning, Study progress, notifications, settings and help;
- a server-controlled AI Tutor entry point inside an entitled Lesson;
- Learning Guide Backoffice Portal functions needed to publish Course content and operate orders and payments;
- English (UK) and Simplified Chinese through native i18n.

The seven source requirements are stored in `docs/phase1/source-prd/`. The implementation map is `docs/phase1/requirements-map.md`. Do not add product scope from a framework or an open-source project.

## Fixed product vocabulary

Use these terms in code, routes, documentation and UI:

`Role`, `User Interface`, `Business Function`, `Basic Components`, `Cloud`, `Channel`, `Partner`; `Tourists/Users`, `Course Manager/Operator`; `Learning Guide Portal`, `Learning Guide App`, `Learning Guide Backoffice Portal`; `Tourists Visit`, `User Registration`, `Purchase`, `Student Management`, `Course Management`, `Study`, `Understanding/Assessment`, `Group Study`, `Order Management`, `Payment Management`, `Exploration`, `AI Tutor`, `Reporting`; `User Authentication`, `Rule Engine`, `Process Engine`, `Message Queue`, `Data Management`; `Database`, `Containers`, `Network`, `Monitor`, `Security Strategy`; `Payment`, `Accounting`, `HR`, `BI/Dashboard`.

## Target implementation

- One Next.js App Router application in TypeScript.
- One deployment unit per environment on AWS App Runner.
- RDS PostgreSQL for business data and transactions.
- S3 for private media, avatar files and source/KS files; use signed URLs.
- Secrets Manager for database, Stripe, OAuth, SES, session and OpenRouter secrets.
- SES for application email and CloudWatch for operational records and alarms.
- Stripe Hosted Checkout and Stripe Webhooks for payment facts.
- Google and WeChat through server-side authentication adapters.
- OpenRouter through one server-side AI Tutor adapter.
- Four environments: `DEV`, `SIT`, `UAT`, `PPE/PROD`.

Do not create separate microservices, ECS workloads, an independent queue, Redis or a separate vector database for Phase 1. Keep the business functions as modules in one application. Add infrastructure only when a PRD or a measured production problem requires it.

## Start here

```bash
npm ci
cp .env.example .env.local
npm run dev
```

The production-shaped starter page is available at `/en-GB/portal`; `/zh-CN/portal` is the Chinese route. The root route redirects to `/en-GB/portal`. Existing `/knowledge/*` and `/course/*` paths remain the KS/Backoffice POC area until the production pages replace them.

Before writing code, read:

1. `AGENTS.md`
2. `DESIGN.md`
3. `docs/phase1/requirements-map.md`
4. `docs/phase1/domain-model.md`
5. `docs/phase1/api-contracts.md`
6. `docs/phase1/release-runbook.md`
7. `docs/phase1/ai-coding-prompt.md`

## Completion rule

A feature is not complete when its page opens. It is complete only when its service, data migration, API contract, page states, i18n keys and tests are present, and the relevant user path has passed in the target environment. Never commit `.env`, credentials, real payment data, full student prompts or private source material.
