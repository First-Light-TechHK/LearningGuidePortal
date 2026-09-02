# Phase 1：API contract

所有 JSON API 使用：

Email registration uses `POST /api/auth/sign-up`, activation uses `POST /api/auth/verify-email`, and resend uses `POST /api/auth/resend-verification`. Resend always returns an accepted result; only a pending account receives a new link, and issuing that link invalidates the previous one.

Google authentication uses `GET /api/auth/google` and `GET /api/auth/google/callback`. The first route creates a signed state/nonce/PKCE transaction and redirects to Google. The callback verifies the transaction and Google ID Token before calling the User Authentication service and creating the application Session cookie. Existing email accounts are not automatically linked.

```ts
type ApiResult<T> =
  | { ok: true; data: T; requestId: string }
  | { ok: false; code: string; message: string; requestId: string };
```

## Portal / User Registration

| Method | Path | Request | Server action |
|---|---|---|---|
| GET | `/api/portal/courses` | locale、category、page | 只返回 published Course |
| GET | `/api/portal/courses/:slug` | slug | 返回公开 Course Detail 和 Public First Lesson 配置 |
| POST | `/api/auth/sign-up` | email、password、locale、returnTo | 校验 origin 和 returnTo；创建未验证 User；发送 SES email |
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

Webhook 处理：验签 → 写入唯一 `stripe_events` → 按 event type 重新读取 Stripe 对象 → 在一个数据库事务内更新 PaymentAttempt、Order、Subscription、Entitlement → 返回 200。重复 event 不重做业务写入。

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
