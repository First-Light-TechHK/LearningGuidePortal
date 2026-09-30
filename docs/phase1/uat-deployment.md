# UAT deployment

UAT is a separate Learning Guide Phase 1 acceptance environment. It does not share RDS, S3 or session state with DEV or SIT.

## Infrastructure

- Account: `851987565851`; region: `ap-southeast-1`.
- CloudFormation stack: `learning-guide-uat`; template: `deploy/uat-infrastructure.yml`.
- App Runner: `learning-guide-uat`, Node.js 22, 1 vCPU, 2 GiB; minimum 1 and maximum 2 instances. No automatic deployment. Uses the existing GitHub connection and the `uat` branch.
- RDS: `learning-guide-uat`, PostgreSQL 16.13, db.t4g.micro, 20 GiB gp3, encrypted, seven-day backups. Private address only.
- Database `learning_guide_uat` and restricted `lg_uat_app` login. Learner data is never copied from SIT or DEV; bootstrap imports curriculum and plans only.
- S3: `learning-guide-uat-851987565851`, prefix `learning-guide/uat`.
- Static curriculum media is read from the legacy archive at `aitutor-data-851987565851/learning-guide/dev/documents/mvp/` using a UAT-role, `s3:GetObject`-only policy. This contains course images, video and audio only; it does not grant access to learner records or other DEV objects. New author-uploaded media remains in the isolated UAT bucket.
- Private subnets: `172.31.66.0/24` and `172.31.67.0/24`. Secrets: `learning-guide/uat/*`.

## Setup

```bash
aws cloudformation deploy --region ap-southeast-1 --stack-name learning-guide-uat \
  --template-file deploy/uat-infrastructure.yml --capabilities CAPABILITY_NAMED_IAM \
  --tags Project=LearningGuide Environment=UAT

# Curriculum from SIT only (no learner rows)
node scripts/provision-uat.mjs --bootstrap

# Point App Runner at the uat branch (must equal a Verify-passed SHA)
git checkout uat && git reset --hard <sit-sha>
GITHUB_REF_NAME=uat node scripts/provision-uat.mjs --deploy
```

Subsequent releases: `GITHUB_REF_NAME=uat node scripts/release-uat.mjs` from that SHA after Verify passes.

## Domain and providers

Intended origin: `https://uat.ilovelearningguide.com` (admin: `https://admin.uat.ilovelearningguide.com`). DNS is customer-owned (DNSPod). After the App Runner service exists, associate custom domains and publish the exact CNAME / validation records from `describe-custom-domains`.

- Google redirect: `https://uat.ilovelearningguide.com/api/auth/google/callback`
- WeChat authorised domain: `uat.ilovelearningguide.com`
- Stripe sandbox webhook: `https://uat.ilovelearningguide.com/api/payment/webhook` (separate signing secret)
- SMTP: same 163 mailbox as SIT; `SMTP_PASS` in Secrets Manager only

Until DNS is active, health and smoke checks use the App Runner service URL. `NEXT_PUBLIC_APP_URL` stays the UAT hostname so mail and OAuth match the intended origin once DNS is published.

## Rollback

Same protocol as SIT: force `uat` to the last good Verify SHA, `update-service` + `start-deployment` on `learning-guide-uat` only. Do not roll back RDS, S3 or payments.
