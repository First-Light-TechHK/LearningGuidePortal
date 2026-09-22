# SIT deployment

SIT is a separate Learning Guide Phase 1 environment. It does not deploy KS Phase II or modify the existing `learning-guide-portal` service.

## Infrastructure

- Account: `851987565851`; region: `ap-southeast-1`.
- CloudFormation stack: `learning-guide-sit`; template: `deploy/sit-infrastructure.yml`.
- App Runner: `learning-guide-sit`, Node.js 22, 1 vCPU, 2 GiB; minimum 1 and maximum 2 instances. No automatic deployment. SIT uses the existing GitHub connection and the separately verified release branch. An optional digest-pinned ECR deployment is supported by the operator scripts but is not required for source deployment.
- RDS: `learning-guide-sit`, PostgreSQL 16.13, db.t4g.micro, 20 GiB gp3, encrypted, seven-day backups. Private address only. TCP 5432 is allowed only from the SIT application security group.
- Separate database `learning_guide_sit` and restricted `lg_sit_app` login. The application does not use the RDS administrator credential. Tables: `app_files`, `product_payment_keys` (migration 009), `data_migrations` and `orm_rows` (migration 010). Product entities persist as `orm_rows` JSONB plus an `app_files` snapshot; binaries live in SIT S3. DEV uses the same schema on its own RDS. Learner data is never copied from DEV.
- S3: `learning-guide-sit-851987565851`, prefix `learning-guide/sit`; versioned, public access blocked, HTTPS required. Runtime IAM cannot read the DEV bucket.
- One NAT Gateway permits outbound OAuth, Stripe, SMTP and OpenRouter traffic. An S3 gateway endpoint avoids NAT processing for S3. Two private subnets occupy `172.31.64.0/24` and `172.31.65.0/24` in the existing VPC.
- App Runner receives secrets from `learning-guide/sit/*`. Separate database, session and Stripe webhook secrets prevent cross-environment state sharing. Existing provider client credentials are reused; their authorised domains/callbacks must include SIT.

Infrastructure starts with `aws cloudformation deploy --region ap-southeast-1 --stack-name learning-guide-sit --template-file deploy/sit-infrastructure.yml --capabilities CAPABILITY_NAMED_IAM --tags Project=LearningGuide Environment=SIT`.

`node scripts/provision-sit.mjs --bootstrap` creates the SIT secrets, test-mode Stripe webhook, database login and required tables. A temporary VPC Lambda performs the database setup and is deleted afterwards. Only curriculum and plan data are copied from DEV; learner data, accounts, sessions, payments and conversations are excluded. SQL imports use `ON CONFLICT DO NOTHING`, so repeated setup cannot overwrite SIT activity. Temporary credential files have mode 0600 and are removed after each AWS call.

Developer handover (Word, filled by DEV): [Learning_Guide_SIT_Migration_Checklist.docx](Learning_Guide_SIT_Migration_Checklist.docx). Operator go-live notes: [sit-go-live-checklist.md](sit-go-live-checklist.md).

## Domain and providers

Intended origin: `https://sit.ilovelearningguide.com`. The customer manages DNSPod. Obtain the App Runner custom-domain CNAME and validation records from `describe-custom-domains`; publish precisely those records, then wait for domain status `active`.

- Google authorised redirect URI: `https://sit.ilovelearningguide.com/api/auth/google/callback`.
- WeChat website-login authorised domain: `sit.ilovelearningguide.com`; callback: `https://sit.ilovelearningguide.com/api/auth/wechat/callback`. Confirm the provider supports adding SIT without replacing the current site's approved domain. Otherwise create a separate approved SIT website application.
- Email: the same 163 SMTP mailbox as DEV (`smtp.163.com:465`, From `learningguide@163.com`). That is why DEV can mail `*.qq.com`. `SMTP_PASS` is Secrets Manager `learning-guide/sit/smtp_pass`, not a plaintext App Runner variable. SES remains a fallback only if SMTP is unset; the Singapore account is still in sandbox. Registration and reset links use the configured SIT origin. No remote response includes a reset token.
- Stripe: sandbox only, eight recurring USD lookup keys. Endpoint: `https://sit.ilovelearningguide.com/api/payment/webhook`, separate signing secret. Events: Checkout completed, async succeeded/failed, expired; invoice paid/failed; subscription updated/deleted. The browser return cannot grant access.
- No secrets are placed in this document or Git. Do not replace test keys with live keys in SIT.

## Release process

1. Commit the change and push the release branch. `Verify` runs typecheck, lint, build, unit, authentication and payment tests. The missing-configuration health test expects 503 and is not evidence of deployment readiness.
2. Initial source deployment uses `node scripts/provision-sit.mjs --deploy` after Verify passes. Subsequent releases use `Deploy SIT` with source mode, or `node scripts/release-sit.mjs`. Image mode is only for a service already configured for ECR; `node scripts/publish-sit-image.mjs` builds linux/amd64 from a clean committed tree and returns the digest.
3. The release script requires a successful Verify run for the exact SHA, confirms the branch tip, points the SIT service at that branch, then `start-deployment` pulls and builds it. Writing `APP_VERSION` is only a label. Do not push more commits to the release branch during a source build. Source mode rechecks the branch tip after deployment; image mode pins an immutable digest.
4. It waits for that source build to succeed, then requires `/api/health` to return HTTP 200, `environment=SIT`, the expected SHA, and successful database, migration and S3 checks. A failed operation, missing dependency or branch movement fails the release. The Deploy SIT workflow then runs live e2e (`scripts/after-deploy.mjs`). Failure rebuilds the previous SHA and notifies SNS.
5. Exercise email verification/reset, Google/WeChat consent, every plan, sandbox Checkout/webhook and resulting entitlement, failed/cancelled payments, renewal/cancellation, cross-user isolation, My Learning and both locales. Provider consent and DNS readiness are separate acceptance conditions, not implied by configured credentials.
6. Save the SHA, operation ID, test results and known outstanding external actions.

## Rollback (standard protocol)

Any SIT failure after a publish — Verify red, App Runner `ROLLBACK`/`FAILED`, health not ready, live e2e failure, or a tester-facing defect on the new SHA — is a rollback, not a live hotfix. Deploy SIT runs this automatically after the revision is RUNNING.

1. Identify the last SHA that **passed Verify** and **previously ran** on `learning-guide-sit`.
2. Point git branch `sit` at that SHA (`git push --force origin <sha>:sit`). `sit` is not `main`.
3. `update-service` on `learning-guide-sit` only, then `start-deployment` so App Runner pulls and builds that SHA. Do not change RDS, S3 objects, or payment rows.
4. Wait for the source build `SUCCEEDED` (not `ROLLBACK_SUCCEEDED`). Confirm `GET /api/health` is 200, `environment=SIT`, `version` equals the rollback SHA, checks true.
5. Record the failed SHA, rollback SHA, and operation id. Fix forward on `dev`, then publish a new verified SHA.

Do not roll back by pointing SIT at the DEV service, DEV RDS, or DEV S3. Provider/IAM/SES/DNS failures still need ops after the app revision is restored.

## Operations

Readiness checks validate PostgreSQL certificate trust using the AWS Singapore CA bundle, table availability and S3 read permissions. The storage marker `.deployment-ready` is provisioned once. Checks are cached for 15 seconds to avoid probing dependencies on every request. Failure returns HTTP 503 without leaking connection details.

Inspect App Runner deployment/application logs and RDS health before retrying a release. Use 30-day log retention and alarms for HTTP 5xx, latency, database CPU and free storage. Alarm subscriptions require a verified operations recipient.

SIT adds an ongoing infrastructure charge, including a NAT Gateway. Budget approximately USD 80–100/month before credits and variable usage; review actual Cost Explorer charges after one full day. This estimate excludes external LLM, domain, email and payment-provider costs. Removing the stack retains the S3 bucket and snapshots the database; review retained resources before closing the environment.
