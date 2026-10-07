# UAT deployment

UAT is a separate Learning Guide Phase 1 acceptance environment with its own RDS, upload bucket and session state. Existing curriculum media remains in a shared, versioned archive; UAT reads pinned object versions without write permission.

## Infrastructure

- Account: `851987565851`; region: `ap-southeast-1`.
- CloudFormation stack: `learning-guide-uat`; template: `deploy/uat-infrastructure.yml`.
- App Runner: `learning-guide-uat`, Node.js 22, 1 vCPU, 2 GiB; minimum 1 and maximum 2 instances. No automatic deployment. Uses the existing GitHub connection and the `uat` branch.
- RDS: `learning-guide-uat`, PostgreSQL 16.13, db.t4g.micro, 20 GiB gp3, encrypted, seven-day backups. Private address only.
- Database `learning_guide_uat` and restricted `lg_uat_app` login. Learner data is never copied from SIT or DEV; bootstrap imports curriculum and plans only.
- S3: `learning-guide-uat-851987565851`, prefix `learning-guide/uat`.
- Static curriculum media is read from the legacy archive at `aitutor-data-851987565851/learning-guide/dev/documents/mvp/` using only `s3:GetObject` and `s3:GetObjectVersion`. `deploy/uat-course-media.json` pins every approved archive object version, byte size and ETag. The runtime refuses unlisted archive media in UAT. New author-uploaded media remains in the isolated UAT bucket. The source archive has no lifecycle expiry rule as checked on 30 September; privileged deletion of a pinned version remains an operational risk, not something application code can prevent.
- Private subnets: `172.31.66.0/24` and `172.31.67.0/24`. Secrets: `learning-guide/uat/*`.

## Setup

```bash
aws cloudformation deploy --region ap-southeast-1 --stack-name learning-guide-uat \
  --template-file deploy/uat-infrastructure.yml --capabilities CAPABILITY_NAMED_IAM \
  --tags Project=LearningGuide Environment=UAT

# Curriculum from SIT only (no learner rows)
node scripts/provision-uat.mjs --bootstrap

# Initial service creation only; existing UAT services must use the release command below.
# Merge the reviewed SIT change through Git; never reset a shared checkout to promote it.
GITHUB_REF_NAME=uat node scripts/provision-uat.mjs --deploy
```

Subsequent releases: `GITHUB_REF_NAME=uat node scripts/release-uat.mjs` from a clean checkout at the current remote UAT SHA. Initial provisioning is not acceptance and exits with a non-success acceptance status.

## Mandatory acceptance

1. The latest push run of Verify, Forge and Overlay must succeed for the exact UAT SHA, including all required jobs. An earlier successful run cannot override a newer failed, skipped, cancelled or pending run.
2. Capture published SIT curriculum from the same snapshot-plus-ORM precedence used by the application. Compare every published UAT course, section, lesson, body/content hash and media reference. The current reference has eight courses and 22 lessons. This is the requested interim source, not a claim that placeholder lesson bodies are academically complete.
3. Resolve every remote asset, compare its S3 version, bytes and ETag to the committed media manifest, and verify the source has not drifted during acceptance. New or changed media requires an explicit reviewed manifest update; never auto-refresh the pins to turn a failed test green.
4. Create two unique, temporary UAT-only synthetic learners: one with a two-hour test entitlement and one without entitlement. Use normal login and session APIs. No email, payment, real user account or production database is involved. Remove the fixtures and their study/session state in `finally`; a cleanup failure fails acceptance.
5. Exercise all course and lesson identities in both locales in Chromium. Decode images, play and seek actual audio/video, inspect text and embedded content, verify locked-course redirects and the video-preview gate, and capture desktop/mobile catalogue screenshots. A successful sign-in page is not a successful lesson.
6. Recheck source and deployed revision. Retain `test-results/uat-acceptance/receipt.json` and browser evidence, including failures. The workflow uploads these for 30 days. Local operators must retain the same directory outside temporary storage.

CLI and GitHub UAT deployment use this same runner. Browser checks cannot be bypassed by `SKIP_PLAYWRIGHT`. A service being RUNNING or `/api/health` being ready does not establish acceptance. Mail inbox delivery, provider OAuth completion and Stripe settlement are separate suites and are explicitly excluded from the course acceptance receipt. Their configuration checks cannot substitute for real provider acceptance.

Private database checks run in temporary VPC Lambdas with access to only the selected environment's database secret. They take the application's advisory transaction lock for synthetic fixture changes and never replace curriculum or copy learner data between environments. Temporary Lambda/IAM resources are removed after use. Operator AWS permissions are required; missing permissions fail the release rather than skipping a check.

## Domain and providers

Intended origin: `https://uat.ilovelearningguide.com` (admin: `https://admin.uat.ilovelearningguide.com`). DNS is customer-owned (DNSPod). After the App Runner service exists, associate custom domains and publish the exact CNAME / validation records from `describe-custom-domains`.

- Google redirect: `https://uat.ilovelearningguide.com/api/auth/google/callback`
- WeChat authorised domain: `uat.ilovelearningguide.com`
- Stripe sandbox webhook: `https://uat.ilovelearningguide.com/api/payment/webhook` (separate signing secret)
- SMTP: same 163 mailbox as SIT; `SMTP_PASS` in Secrets Manager only

Until DNS is active, health and smoke checks use the App Runner service URL. `NEXT_PUBLIC_APP_URL` stays the UAT hostname so mail and OAuth match the intended origin once DNS is published.

## Rollback

Do not force-push the UAT branch or restore databases merely because an acceptance test fails. Diagnose whether the failed dependency is code, data, media or permissions. For a code regression, create a reviewed revert commit, run all required CI and release the exact new SHA through the same gate. Restore media access/version permissions separately when that is the failure. Never roll back learner records, orders, payments or another environment as part of a code release.

## SIT promotion, 7 October 2026

The promotion merges SIT branch revision `6b69d0f37afc5744a70afc62d8d1925b36c1876e`, including its sign-in, pricing, course-card and custom-video-control changes. This is newer than the running SIT revision `73bfc6f79d75d9591c1b794d5b3cf1b396eeeed2`; the release includes those branch changes without changing the SIT service. Existing UAT lesson identity, streamed-rendering, responsive layout, media pinning and acceptance safeguards are retained.

Configuration is not copied wholesale. Preserve UAT's origin, admin hosts, private database, upload bucket/prefix, session secret, payment webhook secret and IAM bindings. Google, WeChat, SMTP, Stripe test-account and OpenRouter credentials currently use equal values through separate environment secret references. Stripe stays in sandbox mode; its UAT endpoint remains `https://uat.ilovelearningguide.com/api/payment/webhook`. The public Google and direct WeChat callbacks remain UAT-specific. The new shared-WeChat hand-off code is present, but `WECHAT_AUTH_ORIGIN` remains unset, matching the actual SIT configuration; shared-provider routing is not silently enabled by promotion.

Compare courses, plans and portal content read-only before deployment; preserve UAT learner accounts, sessions, progress, orders and payments. Runtime schema initialisation adds the new `wechat_login_tickets` table without replacing existing data. The complete post-deployment course checks also click the custom video toolbar (play, pause, keyboard seek, mute and fullscreen) against actual course assets in both locales, rather than relying only on media API calls. Save local evidence outside `test-results`, because local Playwright runs may clear that directory. A failed receipt is not an accepted migration.

Pre-deployment comparison on 7 October found identical published curricula (eight courses), all 14 plan records and no environment-specific portal-content override. UAT's private RDS instance was available with seven-day point-in-time recovery enabled. Google accepted the UAT authorisation request and presented its sign-in page; this verifies the callback configuration preflight, not a completed user's consent/session. The UAT Stripe test webhook was enabled with its separate signing secret. WeChat QR completion, mail inbox delivery and a settled test payment are not claimed by these checks.
