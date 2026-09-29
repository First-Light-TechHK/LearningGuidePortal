# Phase 1：API contract

Course-authoring extension: `PUT /api/backoffice/courses/:courseId/draft`, contract `contracts/course-authoring.ts`; active operator and same-origin request required. A stale `expectedUpdatedAt` returns 409. See `lgteacher-integration.md` for response codes and preservation rules.

所有 JSON API 使用：

Email registration uses `POST /api/auth/sign-up`, activation uses `POST /api/auth/verify-email`, and resend uses `POST /api/auth/resend-verification`. When verification is required, register sends first and commits the user and token only after the send is accepted; a duplicate register returns `verificationRequired: true` and no user. Only an explicit resend action can request a link; loading the check-email page never sends mail. A pending account can receive at most one verification email every 60 seconds and ten within a rolling 24-hour period. A successful resend response is `{ ok: true, data: { accepted: true } }` for an unknown address, a cooldown, and a send failure, and the live token is replaced only after the send succeeds. The daily cap returns `429 VERIFICATION_DAILY_LIMIT` and does not replace the token. Email input is limited to 254 characters; `POST /api/auth/check-email` returns `400 EMAIL_TOO_LONG` when that limit is exceeded. Issuing a new link invalidates the previous one. Authentication endpoints return stable `code` values rather than display text; the Portal and Learning Guide Backoffice Portal render user-facing errors from `messages/en-GB.json` or `messages/zh-CN.json` according to the current locale.

Google authentication uses `GET /api/auth/google` and `GET /api/auth/google/callback`. The first route creates a signed state/nonce/PKCE transaction and redirects to Google. The callback verifies the transaction and Google ID Token before calling the User Authentication service and creating the application Session cookie. A newly created Google user receives the verified email prefix as Name, including email-prefix characters normally rejected by manual Name validation; a later callback never overwrites it. Existing email accounts are not automatically linked.

WeChat uses `GET /api/auth/wechat?locale=en-GB&returnTo=/en-GB/account/my-learning` and `GET /api/auth/wechat/callback?code=...&state=...`. Callbacks return a 303 redirect and expire the transaction cookie on success and failure. Failures preserve a validated locale/returnTo and use `oauthError=state|cancelled|disabled|wechat-conflict|wechat`. The trusted identity contract is `contracts/wechat.ts`: subject is always `appId:openid`; UnionID is metadata. WeChat users may have `email: null` and `emailVerifiedAt: null`; an active linked WeChat account can hold a Session without email verification. Email/password authentication still requires verified email. No accounts are merged by profile or email. Provider tokens and codes are never returned to the client.

```ts
type ApiResult<T> =
  | { ok: true; data: T; requestId: string }
  | { ok: false; code: string; message: string; requestId: string };
```

## Portal / User Registration

WeChat callbacks now redirect unbound users to `/{locale}/portal/bind-email?returnTo=...`. `POST /api/auth/email-binding/request` accepts `{ email, locale, returnTo }` and a valid restricted WeChat session, returns `{ ok: true, accepted: true, retryAfter: 60 }`, and never returns the token. Errors use `code`: unauthorised (401), cooldown (429), email_unavailable (503), invalid_email/email_in_use/already_bound (400). The link is stored only after the binding mail is accepted: a rejected send returns 503 `email_unavailable` without storing a link or starting the cooldown, the previous link stays valid, and the commit re-checks eligibility and email uniqueness. `POST /api/auth/email-binding/confirm` accepts `{ token, locale, returnTo }` without requiring a session, verifies ownership, and returns `{ ok: true, alreadyBound, sameUser, continueUrl }`. It never creates a Session; only the matching existing session may continue directly. Other devices/accounts receive a WeChat login URL. Invalid/expired/superseded links and ownership conflicts fail. Normal business APIs reject unverified WeChat sessions. These rules supersede earlier statements permitting no-email authenticated access.

Password reset uses `POST /api/auth/password-reset/request` with `{ email, locale, returnTo }` (`contracts/passwordReset.ts`). Accepted responses are exactly `{ ok: true, accepted: true, retryAfter: 60 }`, including unknown/ineligible accounts and requests within the per-account cooldown. The response has no `resetUrl` key and never contains a token, in every environment and delivery mode. Invalid input returns 400. When delivery is configured and the public origin resolves, an Origin header that matches neither the public origin nor the request origin also returns 400, for every address. 503 with `code: email_unavailable` is returned only when a managed environment has no configured mail delivery or no usable public origin; both are checked before the account lookup. A rejected send for an eligible account returns the same accepted response as an unknown address, writes nothing and does not start the cooldown; the live token is replaced only after the send is accepted. `services/passwordResetService.ts` sends through configured SMTP/SES in DEV, SIT, UAT and production; `EMAIL_DELIVERY=discard|fail` also counts as configured. In DEV without any configured transport the request returns the same 200 and stores a reset link for an eligible account that is never sent and never returned. There is no preview link: `LOCAL_PASSWORD_RESET_PREVIEW` is not read, because `f44301f` removed the preview to satisfy Overlay AUTH-02 (see `email-state-machine.md` 5.3.1). Mail links use the configured public origin and a validated local returnTo. Tokens expire after one hour; reissue invalidates prior tokens. Confirmation still uses `{ token, newPassword }`, consumes the token and revokes existing sessions. No database migration is required.

| Method | Path | Request | Server action |
|---|---|---|---|
| GET | `/api/portal/courses` | locale、category、page | 只返回 published Course |
| GET | `/api/portal/courses/:slug` | slug | 返回公开 Course Detail 和 Public First Lesson 配置 |
| POST | `/api/auth/sign-up` | email、password、locale、returnTo | 需要验证时先发信，发送被接受后才提交 User 与 token；重复注册返回 verificationRequired true 且无 user |
| POST | `/api/auth/sign-in` | email、password、returnTo | 创建 session；只允许安全 returnTo |
| POST | `/api/auth/verify-email` | token | 验证 token；token 单次使用、过期失效 |
| POST | `/api/auth/reset-password` | email | 发送不泄露账号是否存在的 reset email |
| POST | `/api/auth/reset-password/confirm` | token、newPassword | 修改密码并撤销旧 sessions |

Google 和 WeChat 回调必须在服务端校验 state、code、issuer/provider subject 和 trusted origin；不能把 provider profile 当成已登录事实直接信任。

## Purchase / Payment / Subscription

```ts
// POST /api/subscription/quote
type QuoteRequest = {
  planId: string;
  termMonths: 6 | 12;
  device: 'pc' | 'mobile';
  sourceCourseId?: string;
  sourceCategoryId?: string;
};

type QuoteResponse = {
  quoteId: string;
  currency: 'usd';
  amountMinor: number;
  expiresAt: string;
  plan: { id: string; scope: string; device: string; termMonths: number };
};
```

```ts
// POST /api/purchase/checkout
type CheckoutRequest = { quoteId: string; returnTo: '/pricing' | '/my-learning/subscription' };
type CheckoutResponse = { orderId: string; checkoutUrl: string };
```

执行顺序：重新读取 quote → 检查用户和 trial/已有 subscription 状态 → 创建 Order 和 PaymentAttempt → 用服务端金额创建 Stripe Hosted Checkout → 返回 checkoutUrl。浏览器只负责跳转。

```ts
// POST /api/payment/webhook
// Header: Stripe-Signature
// Body: raw Buffer，不先 parse JSON
```

Webhook 处理：验签 → 写入唯一 `stripe_events` → 按 event type 重新读取 Stripe 对象 → 在一个数据库事务内更新 PaymentAttempt、Order、Subscription、Entitlement → 返回 200。重复 event 不重做业务写入。浏览器 `success_url` 不是开通凭证；其他页面不订阅该事件，见 [`payment-state-propagation.md`](./payment-state-propagation.md)。

## Protected learning / My Learning

| Method | Path | Request | Server action |
|---|---|---|---|
| GET | `/api/entitlements/check` | courseId、device | 读取 session，调用 `checkEntitlement` |
| GET | `/api/my-learning/overview` | locale | 返回已开始 Course、progress、current Lesson、Subscription summary |
| POST | `/api/study/events` | courseId、lessonId、event、seconds、clientEventId | session、Entitlement、去重、校验时间上限后写 Study Event |
| GET | `/api/my-learning/notifications` | page | 返回当前 User 的通知和 unread count |
| PATCH | `/api/my-learning/notifications/:id` | `{ read: boolean }` | 只能改当前 User 的一条通知 |
| PATCH | `/api/my-learning/settings` | nickname、locale、avatar key | 复用字段校验；avatar 先 S3 上传再保存 key |

## AI Tutor

```ts
// POST /api/dialogue/send
type TutorRequest = {
  courseId: string;
  lessonId?: string;
  mode: 'lecture' | 'socratic';
  message: string;
  conversationId?: string;
  locale: 'en-GB' | 'zh-CN';
};
```

服务端顺序：session → `checkEntitlement` → 读取已发布 Course/Lesson 和 KS knowledge links → 读取版本化 prompt → 取最近六轮 conversation → 编译消息 → 调用 OpenRouter → 流式返回。浏览器不得上传 `knowledgePack`、`sources` 或完整 system prompt 作为可信输入。

## Stripe lookup-key subscriptions

`StripePriceSnapshot` optionally includes `stripeProductId`, `productName`, and `productImage` (HTTPS URL or null). My Subscriptions server rendering adds order `presentation: { name, image, termMonths }`; it uses saved metadata or the historical order's Stripe Price, never a browser-supplied product. Product lookup failures leave imagery empty and preserve the recorded plan/term. This is additive JSON metadata, with no relational migration.

Checkout success URLs (purchase, trial activation and upgrade) are `/{locale}/account/my-learning/subscription?orderId={orderId}` on the trusted Checkout origin. Completed Checkout retries return the same local destination. The order ID selects an owned pending order for UI refresh only; it never proves payment or grants access. Cancellation URLs remain on subscription confirmation.

`POST /api/subscription/quote` accepts `{ planId, kind: "purchase" | "trial" }`. The server resolves the configured lookup key, validates a licensed USD recurring Price with a 6/12-month period, and snapshots Price ID, amount, currency and term. Checkout accepts only the owned quote ID and required consents, never a client-supplied price. All eight Pricing combinations use subscription Checkout. Unavailable/misconfigured prices are disabled; no demo amount is charged as a fallback. Webhooks verify the current provider objects and apply payment, subscription and entitlement state with event deduplication. Existing course/mobile prices are not mapped to category prices.

Portal login links carry `returnTo=<encoded local pathname + query + hash>`. Email entry, password sign-in, registration switches and OAuth links retain it. The sign-in page validates it with `safeReturnTo`; external, protocol-relative and backslash/control-character URLs fall back to My Learning. Login and registration pages are not used as the source when switching auth entry points. No login API payload or database change is required.
