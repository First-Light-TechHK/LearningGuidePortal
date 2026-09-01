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

## Current implementation and target

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

The current runnable product path is implemented in the same Next.js application:

- `/en-GB/portal` and `/zh-CN/portal` show published Courses and Public First Lesson content;
- User Registration and User Authentication create an httpOnly session; the configured `BACKOFFICE_OPERATOR_EMAIL` receives the `operator` Role when that account is created;
- Visitor / Trial gives a seven-day local trial in `PAYMENT_MODE=demo`;
- Purchase, Payment Management and Subscription Management support a local Demo checkout, or Stripe Hosted Checkout plus `/api/payment/webhook` when `PAYMENT_MODE=stripe` and Stripe secrets are configured;
- My Learning lists active access even before the first Study event, records Lesson progress with server-side limits and idempotency, and permits trial/subscription cancellation and resumption;
- Learning Room supports every published Lesson in a Course, Lecture/Socratic Tutor modes, restored conversations and the last six turns of context;
- Learning Guide Backoffice Portal permits an Operator to create Courses, add Lessons, mark a Public First Lesson and publish or unpublish Course content.

For local development, the product store uses the existing virtual file system. With `DATABASE_URL` and `DATA_S3_BUCKET`, the same file operations use the configured PostgreSQL/S3 persistence layer; the normalised relational tables in `db/migrations` remain the next scale-up step before high-volume production. `PAYMENT_MODE=demo` is deliberately the default for development and must not be used for live charging.

Do not create separate microservices, ECS workloads, an independent queue, Redis or a separate vector database for Phase 1. Keep the business functions as modules in one application. Add infrastructure only when a PRD or a measured production problem requires it.

## Start here

```bash
npm ci
cp .env.example .env.local
npm run dev
```

The production website is available at `/en-GB/portal`; `/zh-CN/portal` is the Chinese route. The root route redirects to `/en-GB/portal`. Existing `/knowledge/*` and `/course/*` paths remain the KS POC area and are not part of the public Phase 1 navigation.

To enable Course Manager/Operator locally, set `BACKOFFICE_OPERATOR_EMAIL` in `.env.local`, then create a new account with that exact email and open `/en-GB/backoffice/courses`. To enable live payment, set `PAYMENT_MODE=stripe`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` and `NEXT_PUBLIC_APP_URL`; do not grant access from the browser return page because access is granted by the webhook.

Before writing code, read:

1. `AGENTS.md`
2. `DESIGN.md`
3. `docs/phase1/requirements-map.md`
4. `docs/phase1/domain-model.md`
5. `docs/phase1/api-contracts.md`
6. `docs/phase1/release-runbook.md`
7. `docs/phase1/ai-coding-prompt.md`

Useful checks:

```bash
npm run lint
npm run build
```

## Completion rule

A feature is not complete when its page opens. It is complete only when its service, data migration, API contract, page states, i18n keys and tests are present, and the relevant user path has passed in the target environment. Never commit `.env`, credentials, real payment data, full student prompts or private source material.
