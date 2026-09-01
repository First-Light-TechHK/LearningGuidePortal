# Local testing with real providers

The local application supports two different modes. They must not be confused:

| Mode | Google / WeChat | Payment | Purpose |
|---|---|---|---|
| Default DEV | Local provider accounts | Local checkout | Product development without third-party accounts |
| DEV with real providers | Real OAuth applications | Stripe Test Mode | Integration testing before SIT |

The second mode is real integration testing. It requires test credentials from each provider; there is no credential-free way to test a real Google account, WeChat account or Stripe payment.

## 1. Local application configuration

Use one stable host consistently. If the browser is opened at `http://localhost:3011`, use that exact host in `NEXT_PUBLIC_APP_URL`; do not start on `127.0.0.1` and complete the provider callback on `localhost`.

```dotenv
APP_ENV=DEV
STORAGE_BACKEND=local
PAYMENT_MODE=stripe
LOCAL_SOCIAL_LOGIN=0
NEXT_PUBLIC_APP_URL=http://localhost:3011

STRIPE_SECRET_KEY=sk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...

GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
WECHAT_APP_ID=...
WECHAT_APP_SECRET=...
```

Restart Next.js after changing `.env.local`. Check the effective non-secret configuration:

```bash
curl -i http://localhost:3011/api/health/config
```

For real local testing, the response must show `authentication.google` and `authentication.wechat` as `configured`, and `payment.mode` as `stripe` with `payment.configured` set to `true`. It must not show either social provider as `local`.

## 2. Google

Create a Google OAuth client of type **Web application** and add this exact authorised redirect URI:

```text
http://localhost:3011/api/auth/google/callback
```

Start the application, open the sign-in page using `http://localhost:3011`, and select Google. The application sends the same callback origin in both the authorisation request and the code exchange. The callback validates the state cookie, exchanges the one-time code on the server and creates the application session.

For HTTPS local testing, replace the URL with the stable tunnel URL and register:

```text
https://your-tunnel.example.com/api/auth/google/callback
```

Google requires the redirect URI to match exactly, including scheme, host, path and trailing slash rules.

## 3. WeChat

WeChat website login does not complete against a plain local address. Use an HTTPS tunnel or a development domain that can be registered as the authorised website domain in the WeChat Open Platform. The browser, `NEXT_PUBLIC_APP_URL` and the WeChat callback must all use that same HTTPS origin.

Example:

```dotenv
NEXT_PUBLIC_APP_URL=https://your-dev-domain.example.com
WECHAT_APP_ID=...
WECHAT_APP_SECRET=...
```

Register:

```text
https://your-dev-domain.example.com/api/auth/wechat/callback
```

The route uses the WeChat Open Platform QR login endpoint with `scope=snsapi_login`, validates the state cookie, exchanges the code through WeChat and stores the provider subject. WeChat may not return an email address; the application therefore uses the stable provider subject as the identity key and does not merge it automatically with an existing password account.

## 4. Stripe Test Mode

Use Stripe test-mode keys only. Log in to Stripe CLI once, then forward signed webhook events to the local endpoint:

```bash
stripe login
npm run stripe:listen
```

The CLI prints a `whsec_...` signing secret. Put that value in `.env.local` as `STRIPE_WEBHOOK_SECRET` and restart Next.js. Keep the Stripe CLI process running while testing; it is the local receiver that forwards signed events.

The local product flow is then:

```text
sign in
  -> choose a published Course plan
  -> POST /api/purchase/quote
  -> POST /api/purchase/checkout
  -> Stripe Test Checkout
  -> checkout.session.completed
  -> POST /api/payment/webhook through Stripe CLI
  -> verified event updates Order, Subscription and Entitlement
```

Use Stripe test cards in the hosted Checkout page. The browser success page does not grant access; the entitlement appears only after the webhook is received and processed. Stripe recommends webhook-based fulfilment because a customer may pay successfully without returning to the application.

For a three-day trial, use the **Start trial** action. It creates a Stripe subscription with payment-method collection and a three-day trial. Test the subsequent `invoice.paid` and `invoice.payment_failed` lifecycle events through Stripe test mode.

## 5. Common failure causes

| Symptom | Cause | Fix |
|---|---|---|
| Provider buttons are absent | Credentials are missing or `LOCAL_SOCIAL_LOGIN=0` without real credentials | Set the complete provider pair and restart |
| Google `redirect_uri_mismatch` | Browser host differs from registered host | Use one exact `NEXT_PUBLIC_APP_URL` and register its callback |
| WeChat QR does not return | Plain localhost is not an authorised HTTPS website domain | Use a registered HTTPS development domain |
| Stripe checkout returns 503 | Secret, webhook secret or `NEXT_PUBLIC_APP_URL` is missing | Check `/api/health/config` |
| Stripe payment is successful but access is absent | Stripe CLI is not forwarding the webhook or signing secret is wrong | Keep `npm run stripe:listen` running and update `STRIPE_WEBHOOK_SECRET` |
| Local user is redirected but not signed in | `localhost` and `127.0.0.1` were mixed | Use one host for the complete browser flow |

The local provider switch does not create fake production credentials. `LOCAL_SOCIAL_LOGIN=1` and `PAYMENT_MODE=demo` remain available only for fast product development; they must be disabled for real provider integration tests and all production environments.
