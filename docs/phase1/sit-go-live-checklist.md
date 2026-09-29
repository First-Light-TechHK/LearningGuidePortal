# SIT go-live checklist (non-code)

Cite this file as `docs/phase1/sit-go-live-checklist.md`. Do not use a GitHub `/blob/` URL.

This is the operator checklist for making SIT usable for integration testers. It is **not** a code-change list. Architecture, Cloud services and provider rules stay in `AGENTS.md`, `sit-deployment.md` and `production-configuration.md`.

Checked against live AWS on 21 September 2026. Service `learning-guide-sit`, git branch `sit`, SHA `9104d11`. `/api/health` and `/api/health/config` both `ready: true`. **Do not paste secret values into this file or Git.**

## Config store: there is no Nacos

Learning Guide Phase 1 **does not** run Nacos, Consul, or Spring Cloud Config. Cloud is limited to App Runner, RDS PostgreSQL, S3, Secrets Manager, CloudWatch and SES.

| Need | Where it lives on SIT today |
|---|---|
| Non-secret config (`APP_ENV`, origins, Stripe lookup keys, `SES_FROM_EMAIL`) | App Runner **Runtime environment variables** |
| Secrets (`DATABASE_URL`, OAuth secrets, Stripe keys, session, OpenRouter) | **Secrets Manager** `learning-guide/sit/*`, injected as App Runner **Runtime environment secrets** |
| Feature flags / dynamic config at runtime | **Not used.** Restart / `update-service` is the change path |
| AWS AppConfig applications | **None** |
| SSM Parameter Store names for Learning Guide | **None** |

Do **not** add Nacos on AWS for SIT. It would be a second source of truth, another network dependency, and it is outside the Phase 1 Cloud list.

If a config centre is required later, the AWS equivalent is **AWS AppConfig** (plus Secrets Manager for secrets). That is a new Cloud service and needs an architecture decision; it is not needed to go live on SIT.

---

## Status key

| Mark | Meaning |
|---|---|
| **Done** | Present on live SIT and consistent with the contract |
| **External** | Must be done in a provider console, DNSPod, mailbox or Stripe Dashboard. Not a repo change |
| **Gap** | Missing or unsafe on live SIT; blocks real tester use |
| **Do not** | Explicitly forbidden |

---

## 1. AWS application and Cloud

| Item | Expected | Live 21 Sep 2026 | Mark |
|---|---|---|---|
| App Runner service | `learning-guide-sit`, Node 22, 1 vCPU / 2 GiB | RUNNING | Done |
| Git source | Release branch, auto-deploy **off** | Branch `sit`, `AutoDeploymentsEnabled=false` | Done |
| Origin | `https://sit.ilovelearningguide.com` | `NEXT_PUBLIC_APP_URL` matches | Done |
| `APP_ENV` | `SIT` | `SIT` | Done |
| `STORAGE_BACKEND` | not `local` | `postgresql` | Done |
| `LOCAL_SOCIAL_LOGIN` | `0` | `0` | Done |
| `PAYMENT_MODE` / `STRIPE_SANDBOX` | `stripe` / `1` | both set | Done |
| `EMAIL_VERIFICATION_REQUIRED` | `1` on SIT | `1` | Done |
| Secrets | `learning-guide/sit/*` only | database, session, Google secret, WeChat id/secret, Stripe secret+webhook, OpenRouter | Done |
| Instance role | SIT bucket + SIT secrets + SES send | `learning-guide-sit-runtime` policy `sit-only` | Done |
| RDS | Private `learning_guide_sit`, app login not master | stack `CREATE_COMPLETE` | Done |
| S3 | `learning-guide-sit-851987565851` / `learning-guide/sit`, public access blocked | matches; `.deployment-ready` present | Done |
| Health | `/api/health` 200, `environment=SIT` | ready; DB / payment migration / S3 checks true | Done |
| CloudWatch | 30-day logs; 5xx, latency, DB CPU, free storage | four alarms **OK** | Done |
| Alarm delivery | Verified operations mailbox on SNS | Topic `learning-guide-sit-alerts` has **0 subscriptions** | **Gap** |
| Leftover `S3_BUCKET=aitutor-data-851987565851` | Should not point at DEV | Present but unused (`DATA_S3_BUCKET` is the SIT bucket) | Gap (cleanup) |
| `learning-guide/sit/smtp_pass` | Injected as `SMTP_PASS` (same 163 mailbox as DEV) | Secret exists; App Runner secret mapping applied 21 Sep 2026 | Done |

`ADMIN_HOSTS` is unset. Defaults already include `admin.sit.ilovelearningguide.com`. Learner host `sit.ilovelearningguide.com/en-GB/backoffice` returns 404; admin host is active.

---

## 2. Domain and TLS (DNSPod)

Customer owns DNS. App Runner custom domains:

| Host | App Runner status | Public DNS | Mark |
|---|---|---|---|
| `sit.ilovelearningguide.com` | `active` | CNAME → `7zwm57gezh.ap-southeast-1.awsapprunner.com` | Done |
| `admin.sit.ilovelearningguide.com` | `active` | same CNAME | Done |

Keep ACM validation CNAMEs in DNSPod. Do not point SIT at `www.ilovelearningguide.com`.

---

## 3. Email (same 163 SMTP as DEV)

DEV can mail `*.qq.com` because it sends through **163 SMTP** (`smtp.163.com:465`), not SES sandbox. The app prefers SMTP whenever `SMTP_HOST`, `SMTP_USER` and `SMTP_PASS` are set (`services/emailService.ts`). SIT must use that same mailbox.

| Item | Expected | Live | Mark |
|---|---|---|---|
| Transport | 163 SMTP first; SES only if SMTP is unset | SIT now has `SMTP_HOST=smtp.163.com`, port `465` | Done 21 Sep 2026 |
| From | `Learning Guide <learningguide@163.com>` | `SMTP_FROM` copied from DEV | Done |
| Password | Secrets Manager, not Git | `learning-guide/sit/smtp_pass` injected as `SMTP_PASS` | Done |
| Egress | TCP 465 via NAT | App security group allows 465 | Done |
| `EMAIL_VERIFICATION_REQUIRED=1` | SIT always requires mail | set; links use SIT origin | Done |
| SES fallback | From `learningguide@163.com`, instance role can send | IAM `sit-only` allows `ses:FromAddress` to any destination | Done |
| SES production access | not required while SMTP is used | still `ProductionAccessEnabled=false` | n/a for SMTP |

Do **not** turn verification off. Do **not** put the 163 authorisation code in Git or in a plaintext App Runner variable. Future `provision-sit` deploys keep SMTP instead of stripping it.

Live release e2e registers `LIVE_TEST_EMAIL`. The SIT functional smoke must include `aa123456@qq.com`. `.qq.com` testers are valid on the 163 SMTP path.

---


## 4. Google login (Google Cloud console)

App has `GOOGLE_CLIENT_ID` (variable) and `GOOGLE_CLIENT_SECRET` (secret). Health reports `authentication.google=configured`. That only means credentials are injected, **not** that SIT is authorised.

| Item | Action | Mark |
|---|---|---|
| OAuth client type | Web application | External |
| Authorised JavaScript origin | `https://sit.ilovelearningguide.com` and `https://admin.sit.ilovelearningguide.com` if Google sign-in is used on admin | External |
| Authorised redirect URI (exact) | `https://sit.ilovelearningguide.com/api/auth/google/callback` | External |
| Admin callback if used | `https://admin.sit.ilovelearningguide.com/api/auth/google/callback` | External |
| Do not replace DEV/www URIs | add SIT; keep `www.ilovelearningguide.com` | External |
| Smoke | real Google account → session; no auto-merge by email | External |

---

## 5. WeChat login (WeChat Open Platform)

App has `WECHAT_APP_ID` and `WECHAT_APP_SECRET` as secrets. Health reports `authentication.wechat=configured`. Open Platform must allow the **hostname only**.

| Item | Action | Mark |
|---|---|---|
| Application type | Open Platform **website** app, `snsapi_login` | External |
| Authorised domain | `sit.ilovelearningguide.com` (no `https://`, no path, no slash) | External |
| Admin host | add `admin.sit.ilovelearningguide.com` if QR sign-in is used there | External |
| Callback the app sends | `https://sit.ilovelearningguide.com/api/auth/wechat/callback` | n/a (runtime) |
| Do not drop www | adding SIT must not remove `www.ilovelearningguide.com` | External |
| Email binding | unbound WeChat users must bind a real tester mailbox (163 SMTP can mail `.qq.com`) | External |
| Smoke | real QR, cancel/expire, locale/returnTo, no fabricated email | External |

If the existing website application cannot hold both www and SIT domains, create a **separate** SIT website application and put those credentials in `learning-guide/sit/wechat_*` only.

---

## 6. Stripe (Dashboard, test mode)

App has test lookup keys for all eight plans, `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET` from SIT secrets. Health reports payment configured. Browser return still cannot grant Entitlement.

| Item | Action | Mark |
|---|---|---|
| Key | `sk_test_…` only (provisioning refuses live keys) | Done on AWS (confirm in Dashboard) |
| Endpoint | `https://sit.ilovelearningguide.com/api/payment/webhook` | **External** confirm |
| Events | `checkout.session.completed`, `async_payment_succeeded`, `async_payment_failed`, `expired`, `invoice.paid`, `invoice.payment_failed`, `customer.subscription.updated`, `customer.subscription.deleted` | External |
| Signing secret | Dashboard endpoint secret = `learning-guide/sit/stripe_webhook_secret` (not Stripe CLI secret) | External |
| Prices | eight active licensed recurring USD Prices; lookup keys `lg_*_6m` / `lg_*_12m` | App vars set; re-check Dashboard |
| Success/cancel URLs | SIT origin | External |
| Smoke | pay, fail, cancel, duplicate webhook, refund, entitlement after webhook not after return | External |

---

## 7. OpenRouter (AI Tutor)

`OPENROUTER_API_KEY` is in SIT secrets. `OPENROUTER_SITE_URL` is the SIT origin. Confirm the key is a **test/dev** key the team intends for SIT, not a production spend key, and that the OpenRouter dashboard allows that HTTP referrer.

---

## 8. Data (not a DEV dump)

| Item | Rule | Mark |
|---|---|---|
| Copy DEV users, sessions, orders, payments, conversations | **Never** | Do not |
| Curriculum / plans / portal content | Bootstrap copies those keys `ON CONFLICT DO NOTHING` | Done historically |
| Boot data migrations | SIT start applies unrecorded `db/data-migrations` ids | Live catalogue: epicureanism, stoicism, quintus-horatius-flaccus | Done |
| Operator account | `BACKOFFICE_OPERATOR_EMAIL=info@firstlighthk.com` — that email must exist as a verified SIT user to open backoffice | **External** register/sign-in on SIT |
| Tester accounts | Create on SIT; 163 SMTP can mail `.qq.com` | External |
| Media | SIT S3 prefix only; COS/Tencent URLs in course HTML still depend on that public bucket remaining readable | External |
| DEV documents bucket | `aitutor-data-…/learning-guide/dev/documents/` is **not** readable by the SIT role | Do not rely on it from SIT |

---

## 9. GitHub / release process (not product code)

| Item | Mark |
|---|---|
| Branch `sit` | Republish latest `origin/dev` plus SMTP/live e2e | In progress |
| **Verify** | Unit test now matches check-email `exists` | Must be green before Deploy SIT |
| GitHub **Deploy SIT** | workflow_dispatch after Verify | After this SHA |
| Last publish | App Runner source on `sit` | After this SHA |

---

## 10. Smoke after externals (both locales)

- Health and config remain `ready` with `missing: []`.
- Email register → mail arrives → cannot sign in until verify → link once; resend invalidates old link.
- Password reset to a SES-verified tester mailbox.
- Google and WeChat as in sections 4–5.
- Public catalogue, public first lesson, entitled lesson after sandbox payment.
- Failed/cancelled Checkout does not grant access.
- My Learning, subscription, both locales.
- Backoffice only on `https://admin.sit.ilovelearningguide.com`.

---

## Operator order (recommended)

1. Subscribe a verified ops mailbox to `learning-guide-sit-alerts`.
2. SES-verify every tester (and operator) address, or wait for SES production access.
3. Add Google redirect URIs and WeChat authorised domains for SIT hosts.
4. Confirm the Stripe **SIT** webhook and its signing secret.
5. Create the operator user on SIT with `info@firstlighthk.com`.
6. Run the smoke list.
7. Unblock Verify, then use **Deploy SIT** for later SHAs.

Record SHA, App Runner operation id, provider console screenshots, and outstanding External rows. Do not write secrets into that record.
