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

- `/en-GB/portal` and `/zh-CN/portal` show published Courses and Public First Lesson content; `/pricing` presents the configured plans for each published Course and preserves an optional Course context;
- User Registration and User Authentication create an httpOnly session; the configured `BACKOFFICE_OPERATOR_EMAIL` receives the `operator` Role when that account is created;
- Visitor / Trial gives a three-day local trial in `PAYMENT_MODE=demo`, or a Stripe payment-method collection flow with a three-day subscription trial in `PAYMENT_MODE=stripe`;
- Purchase, Payment Management and Subscription Management support a local Demo checkout, or Stripe Hosted Checkout plus `/api/payment/webhook` when `PAYMENT_MODE=stripe` and Stripe secrets are configured. Trial conversion, renewal success and payment failure are handled from Stripe invoice events;
- Payment Management has an operator configuration page for Stripe display settings and records whether the server-side Stripe secret is configured; the secret itself remains in environment configuration or AWS Secrets Manager;
- My Learning lists active access even before the first Study event, records Lesson progress with server-side limits and idempotency, exposes payment records and user-scoped demo/Stripe receipts, and permits trial/subscription cancellation and resumption;
- My Learning has independent Subscription, Notification Center, Personal Settings and Help Center routes; password recovery and email-verification routes are also present;
- Learning Room supports every published Lesson in a Course, Lecture/Socratic Tutor modes, restored conversations and the last six turns of context. OpenRouter has a bounded connection/stream timeout and a course-aware local fallback, so a slow provider does not leave a student request hanging indefinitely;
- Learning Guide Backoffice Portal permits an Operator to create Courses, add Lessons, mark a Public First Lesson, publish or unpublish Course content, configure Payment Management, and review Order Management with search, filters, detail, CSV export, full refunds and Stripe Payment resynchronisation;
- The public PRD routes (`/en-GB/courses`, `/en-GB/pricing`, `/en-GB/my-learning`, `/en-GB/learn/:courseId`, `/en-GB/sign-in` and their `zh-CN` equivalents) redirect to the implemented Portal and account pages, so existing requirement links remain usable;
- User Registration supports email/password plus optional server-side Google and WeChat adapters when their credentials are configured. Production email verification and password reset use SES; local development returns a safe one-time link for testing;

Live Stripe checkout, customer-portal and trial boundaries are implemented. Stripe must be configured with the correct Checkout settings and webhook events before `PPE/PROD`; no access is granted from the browser return page.

For local development, the product store uses the existing virtual file system. With `DATABASE_URL` and `DATA_S3_BUCKET`, the same file operations use the configured PostgreSQL/S3 persistence layer. App Runner's local container file is ephemeral and is not an acceptable production data store. `PAYMENT_MODE=demo` is deliberately the default for development and must not be used for live charging. See `docs/phase1/production-configuration.md` for the exact PPE/PROD configuration and provider callback contract.

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
