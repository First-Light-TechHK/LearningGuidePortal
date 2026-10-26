# AWS SES setup — Portal (DEV/SIT/UAT) + Admin

Region: `ap-southeast-1`. Account: `851987565851`.

This is the complete setup for sending product email through SES instead of the
163 mailbox. It covers the Portal services (`learning-guide-portal`,
`learning-guide-sit`, `learning-guide-uat`) and the Admin service
(`learning-guide-admin-dev`). There is no Admin SIT/UAT service yet; add the
same values when those services are created.

## Current state (checked 2026-10-26)

| Item | State |
|---|---|
| SES production access | **DENIED** — sandbox only, 200/day, 1/s, verified recipients only |
| Domain identity `ilovelearningguide.com` | `PENDING`, sending disabled |
| Verified addresses | `yongthelaoma@gmail.com`, `learningguide@163.com` |
| DNS SPF / DMARC on the domain | missing |
| App transport | Portal: SMTP only (163). Admin: SES API when configured, otherwise SMTP |

**SES cannot deliver to real learners until production access is approved.**
Do steps 1–4, then resubmit the production request.

## 1. DNS records in DNSPod

Host record = the part before `ilovelearningguide.com`. Do not append the domain
or a trailing dot to CNAME values.

| 主机记录 | 类型 | 记录值 | TTL |
|---|---|---|---|
| `h26jx5lx3pcuumyhq46y4opwzn4tsy2y._domainkey` | CNAME | `h26jx5lx3pcuumyhq46y4opwzn4tsy2y.dkim.amazonses.com` | 600 |
| `wzwsa6mllrasip2zbmw5t6ppgwr6b5fe._domainkey` | CNAME | `wzwsa6mllrasip2zbmw5t6ppgwr6b5fe.dkim.amazonses.com` | 600 |
| `5hvbywndrh66xbcds52a6s6ph5fvd6ii._domainkey` | CNAME | `5hvbywndrh66xbcds52a6s6ph5fvd6ii.dkim.amazonses.com` | 600 |
| `mail` | MX (priority 10) | `feedback-smtp.ap-southeast-1.amazonses.com` | 600 |
| `mail` | TXT | `v=spf1 include:amazonses.com ~all` | 600 |
| `@` | TXT | `v=spf1 include:amazonses.com ~all` | 600 |
| `_dmarc` | TXT | `v=DMARC1; p=none; rua=mailto:dmarc@ilovelearningguide.com; adkim=s; aspf=s` | 600 |

Rules:

- Only one `v=spf1` TXT may exist on `@`. If another sender is added later,
  merge the includes into that single record.
- Keep DMARC at `p=none` until SES shows DKIM/SPF passing, then move to
  `quarantine`.
- The `mail` MX/TXT pair is the custom MAIL FROM domain. In SES, set
  `MailFromDomain=mail.ilovelearningguide.com` with
  `BehaviorOnMxFailure=USE_DEFAULT_VALUE`.
- The existing `MX` on `@` pointing at App Runner is unrelated to mail and can
  stay, but it is not a mail exchanger.

Verify:

```bash
dig +short h26jx5lx3pcuumyhq46y4opwzn4tsy2y._domainkey.ilovelearningguide.com CNAME
dig +short _dmarc.ilovelearningguide.com TXT
aws sesv2 get-email-identity --region ap-southeast-1 \
  --email-identity ilovelearningguide.com \
  --query '{Status:VerificationStatus,Dkim:DkimAttributes.Status}'
```

Both must report `SUCCESS`.

## 2. SES identity

Already created. Confirm with:

```bash
aws sesv2 get-email-identity --region ap-southeast-1 \
  --email-identity ilovelearningguide.com --output json
```

After DKIM verifies, set the MAIL FROM domain:

```bash
aws sesv2 put-email-identity-mail-from-attributes --region ap-southeast-1 \
  --email-identity ilovelearningguide.com \
  --mail-from-domain mail.ilovelearningguide.com \
  --behavior-on-mx-failure USE_DEFAULT_VALUE
```

## 3. Production access

The previous request is `DENIED`. Resubmit **after** the domain verifies:

```bash
aws sesv2 put-account-details --region ap-southeast-1 \
  --production-access-enabled --mail-type TRANSACTIONAL \
  --website-url https://www.ilovelearningguide.com \
  --use-case-description "Transactional account email only: address verification, password reset and study-group reminders for registered learners. Recipients opt in by creating an account. No marketing or purchased lists." \
  --contact-language EN
```

Check with `aws sesv2 get-account --query Details.ReviewDetails`.

## 4. SMTP credentials

The Portal app sends over SMTP, so SES SMTP credentials are the lowest-risk
integration. Use one IAM user per environment so a credential can be revoked
without touching the others.

```bash
for env in dev sit uat admin-dev; do
  aws iam create-user --user-name "lg-ses-$env"
  aws iam put-user-policy --user-name "lg-ses-$env" \
    --policy-name ses-send --policy-document '{
      "Version":"2012-10-17","Statement":[{
        "Effect":"Allow",
        "Action":["ses:SendEmail","ses:SendRawEmail"],
        "Resource":"*",
        "Condition":{"StringEquals":{"ses:FromAddress":"noreply@ilovelearningguide.com"}}
      }]}'
  aws iam create-access-key --user-name "lg-ses-$env"
done
```

SES SMTP credentials are derived from the IAM secret access key. Use the
derivation documented by AWS or the SES console (SMTP settings → Create SMTP
credentials), which creates the user and shows the password once. Store the
result in Secrets Manager per environment:

| Secret | Consumer |
|---|---|
| `learning-guide/dev/ses_smtp` | Portal DEV |
| `learning-guide/sit/ses_smtp` | Portal SIT |
| `learning-guide/uat/ses_smtp` | Portal UAT |
| `learning-guide/admin/dev/ses_smtp` | Admin DEV |

## 5. Per-service configuration

`SMTP_SECURE=0` with port 587 uses STARTTLS and is the preferred SES port.
Port 465 with `SMTP_SECURE=1` also works.

| Service | `SMTP_HOST` | `SMTP_PORT` | `SMTP_SECURE` | `SMTP_USER` | `SMTP_FROM` | `SMTP_PASS` |
|---|---|---|---|---|---|---|
| `learning-guide-portal` (DEV) | `email-smtp.ap-southeast-1.amazonaws.com` | `587` | `0` | DEV SMTP user | `Learning Guide <noreply@ilovelearningguide.com>` | secret `learning-guide/dev/ses_smtp` |
| `learning-guide-sit` | same | `587` | `0` | SIT SMTP user | same | secret `learning-guide/sit/ses_smtp` |
| `learning-guide-uat` | same | `587` | `0` | UAT SMTP user | same | secret `learning-guide/uat/ses_smtp` |
| `learning-guide-admin-dev` | same | `587` | `0` | Admin SMTP user | same | secret `learning-guide/admin/dev/ses_smtp` |

Also set on every service:

```
SES_FROM_EMAIL=noreply@ilovelearningguide.com
AWS_REGION=ap-southeast-1
EMAIL_VERIFICATION_REQUIRED=1
```

Admin can keep using the SES API instead: its instance role needs
`ses:SendEmail` on the identity, and `SES_FROM_EMAIL` must be set. SMTP is
simpler and matches the Portal.

## 6. Cutover order

Do **not** switch the environments before production access is approved —
cutting over early turns working 163 delivery into sandbox rejections.

1. DNS verified, production access `GRANTED`.
2. Create the four SMTP credentials and secrets.
3. Update SIT, deploy, register a real address, confirm delivery.
4. Repeat for UAT, then DEV, then Admin.
5. Remove the 163 `SMTP_*` values from each service only after the replacement
   has been proven.

## 7. Verification per environment

```bash
curl -sS -X POST https://<host>/api/auth/register \
  -H 'content-type: application/json' \
  -d '{"termsAccepted":true,"email":"you+test@example.com","password":"Test-Passw0rd!","nickname":"ses test","locale":"en-GB"}'

aws logs filter-log-events --region ap-southeast-1 \
  --log-group-name /aws/apprunner/<service>/<id>/application \
  --filter-pattern smtp --max-items 5
```

Expected: `{"type":"mail","event":"smtp_sent",...}` and `250` from SES, then
the message arrives with `dkim=pass` and `spf=pass` headers.

## 8. Rollback

Keep the current 163 values in each service's history. To roll back, restore
`SMTP_HOST=smtp.163.com`, port `465`, `SMTP_SECURE=1`, the 163 user/password and
`SMTP_FROM`, then redeploy.
