# Production configuration

This is the configuration contract for the live Learning Guide website. The application is one Next.js service running on AWS App Runner. Secrets are injected by App Runner from AWS Secrets Manager; they are not committed to GitHub and are not entered in the browser.

## Current local state

The checked-out local environment is intentionally a development environment:

```text
APP_ENV=DEV
STORAGE_BACKEND=local
PAYMENT_MODE=demo
LOCAL_SOCIAL_LOGIN=1
```

That combination is why the local application does not call Google, WeChat or Stripe. It is useful for building the product path, but it is not a production configuration and must not be used to sell a course.

## Required App Runner configuration

Set these as App Runner environment variables or Secrets Manager references for the live service.

| Variable | Type | Required value | Used by |
|---|---|---|---|
| `APP_ENV` | variable | `PPE/PROD` or `PROD` | Enables production rules and disables local providers |
| `NEXT_PUBLIC_APP_URL` | variable | Exact public HTTPS origin, for example `https://learn.example.com` | Google callback, WeChat callback, Stripe return URLs and email links |
| `STORAGE_BACKEND` | variable | Leave empty or set to the PostgreSQL/S3 path; never `local` | Selects persistent storage |
| `DATABASE_URL` | secret | RDS PostgreSQL connection string | Product data, sessions, orders and webhook records |
| `DATA_S3_BUCKET` | variable | Private S3 bucket name | Files and persistent virtual-file-system objects |
| `DATA_S3_PREFIX` | variable | `learning-guide/prod` | Prevents environment data mixing |
| `AWS_REGION` | variable | `ap-southeast-1` | RDS/S3/SES clients |
| `PAYMENT_MODE` | variable | `stripe` | Selects real checkout |
| `STRIPE_SECRET_KEY` | secret | Stripe server key for the target account | Creates Hosted Checkout and manages subscriptions/refunds |
| `STRIPE_WEBHOOK_SECRET` | secret | Signing secret for `/api/payment/webhook` | Verifies payment facts before granting access |
| `GOOGLE_CLIENT_ID` | variable | Web OAuth client ID | Starts Google sign-in |
| `GOOGLE_CLIENT_SECRET` | secret | Web OAuth client secret | Exchanges the Google authorization code |
| `SESSION_SECRET` | secret | At least 32 random characters | Signs Google OAuth transactions and protects callback state |
| `WECHAT_APP_ID` | variable | WeChat Open Platform website application ID | Starts QR sign-in |
| `WECHAT_APP_SECRET` | secret | WeChat application secret | Exchanges the WeChat authorization code |
| `LOCAL_SOCIAL_LOGIN` | variable | `0` or leave empty | Ensures no local social account is used |
| `SES_FROM_EMAIL` | variable | Verified SES sender address | Verification and password-reset email |
| `OPENROUTER_API_KEY` | secret | Server-side OpenRouter key | AI Tutor requests |
| `OPENROUTER_SITE_URL` | variable | Public product URL | OpenRouter attribution header |
| `OPENROUTER_APP_NAME` | variable | `Learning Guide` | OpenRouter attribution header |

## Provider callback registration

Register the exact URLs below. The scheme, host, path and trailing slash must match the value sent by the application.

```text
Google:
https://learn.example.com/api/auth/google/callback

WeChat Open Platform:
https://learn.example.com/api/auth/wechat/callback

Stripe webhook:
https://learn.example.com/api/payment/webhook
```

Google must be configured as a Web application OAuth client. WeChat must be an Open Platform website application that supports `snsapi_login`. Stripe must send at least these events to the webhook:

```text
checkout.session.completed
checkout.session.async_payment_succeeded
invoice.paid
invoice.payment_failed
```

The application never grants an entitlement from the browser success page. It grants access only after a verified Stripe webhook is processed. This prevents a user from obtaining a course by calling the return URL directly.

## Release check

Run the preflight with the same environment variables that will be injected into App Runner:

```bash
npm run preflight:production
```

The application also exposes a non-secret diagnostic endpoint:

```text
GET /api/health/config
```

It reports only `configured`, `missing`, `local` and `postgresql+s3` states. It never returns a secret or a connection string. `/api/health` returns `503` for a PPE/PROD service that is missing a required production setting.

## Storage requirement

The local product file works for local development and a disposable single-process test. AWS App Runner instances are stateless and their container file system is ephemeral. A live service must therefore use the existing PostgreSQL/S3 virtual-file-system path. App Runner may scale to more than one instance, so the local file path is not an acceptable production data store.

## References

- AWS App Runner storage and stateless application guidance: https://docs.aws.amazon.com/apprunner/latest/dg/develop.html
- Google OAuth web-server applications: https://developers.google.com/identity/protocols/oauth2/web-server
- Stripe Checkout subscriptions and webhooks: https://docs.stripe.com/billing/subscriptions/overview
- WeChat Open Platform website login: https://developers.weixin.qq.com/doc/oplatform/Website_App/WeChat_Login/Wechat_Login.html
