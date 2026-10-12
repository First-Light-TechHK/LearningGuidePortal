# Phase 1：API contract

Study Group uses `{ ok, code, message, data }`. `GET /api/study-groups?view=discover|mine|courses|reminders` lists public groups, the caller's groups, courses the caller can access, or the caller's reminder notifications. `POST /api/study-groups` creates a Group for a caller with valid Course access. Group and Session mutations live under `/api/study-groups/:groupId` and `/api/study-groups/sessions/:sessionId` (`join`, `leave`, `cancel`, `plan`, `cancel-attendance`, `enter`, `start`, `token`, `ai-tutor`, `tutor`). Session duration is `durationSeconds` and must be 1800, 2700, 3600, or 5400. `POST /api/study-groups/sessions/:sessionId/ai-tutor` accepts `{ message }` from the room. `POST /api/study-groups/sessions/:sessionId/tutor` accepts `{ text, clientEventId }`. Both call `enqueueTutor`. The response is the queue item and has no tutor answer. The answer, when one is published, goes to the shared LiveKit chat. The system prompt stays on the server. The token response is a short-lived LiveKit participant token for that user and Session, with no Host grant and no stored raw token. LiveKit configuration, project state or provider failure returns a typed `unavailable` (503) that keeps the caller's admission row and writes no audit record; no response includes a credential, secret reference, or internal project id. Title is at most 50 characters, the session title is at most 20, and About is at most 200. Maximum participants is 2–6, including the Host. A full session refuses another entry, including the Host.

`view=reminders` requires a signed-in caller and returns up to five `{ body, createdAt }` Live Session reminder or Study Group cancelled notifications for that caller; other notification types are not returned. The `token` route body must be a JSON object, and `{ recovery: true }` requests the provider-recovery path; an invalid recovery value returns `validation` (400), and when recovery is unavailable or fails the response is a typed `unavailable` (503) that keeps the caller's admission row for a later retry. `POST /api/study-groups/sessions/:sessionId/livekit-incident` accepts `{ code }` from the bounded client-reportable incident set, requires an entered participant, and returns `202 { accepted: true }`; an invalid code returns `validation` (400) and a caller without an active presence returns `forbidden` (403). The incident endpoint records redacted client telemetry only: it is never an authority for provider lifecycle events and never releases a seat. Operator health is `GET /api/backoffice/study-group/livekit-health`: an active operator session is required (otherwise 403), the response is redacted health (snapshot `checkedAt`, `ready`, `attentionRequired`; per project `id`, `endpointHost`, optional `region`, `state`, `status`, `evidence`, `providerVerified`, `checkedAt`, `latencyMs`, optional `activeRooms`), it returns 200 when ready and 503 otherwise, and it never includes credentials, secret references, tokens, or participant content.

```ts
// POST /api/livekit/webhook (provider → Portal)
// Header: Authorization — LiveKit-signed HS256 JWT with the `sha256` body claim and `exp`
// Body: LiveKit webhook JSON, read raw before parsing
```

`POST /api/livekit/webhook` carries no session; the provider signature is the authentication. Processing is verify → unique webhook receipt → event mapping: `participant_left` for a known session closes that identity's open presence, anything else is recorded and ignored, and a duplicate event id returns `duplicate` with no side effects. Responses: 200 `{ ok: true, status: "processed" | "ignored" | "duplicate" }`; 400 `{ ok: false, code: "invalid_signature" }` for a missing or unverifiable signature; 503 `{ ok: false, code: "webhook_unavailable" }` on the file store or unverifiable configuration (fail-closed); 500 `{ ok: false, code: "webhook_failed" }`, after which the provider's retry carries the same event id and processing resumes. Webhooks never grant membership or authorization. The endpoint requires the PostgreSQL store.

Course-authoring extension: `PUT /api/backoffice/courses/:courseId/draft`, contract `contracts/course-authoring.ts`; active operator and same-origin request required. A stale `expectedUpdatedAt` returns 409. See `lgteacher-integration.md` for response codes and preservation rules.

所有 JSON API 使用：

Email registration uses `POST /api/auth/sign-up`, activation uses `POST /api/auth/verify-email`, and resend uses `POST /api/auth/resend-verification`. Only an explicit resend action can request a link; loading the check-email page never sends mail. A pending account can receive at most one verification email every 60 seconds and ten within a rolling 24-hour period. A successful response includes `data.retryAfter`; the 60-second cooldown returns `429 VERIFICATION_RATE_LIMITED` with its server-calculated `data.retryAfter`, and the daily cap returns `429 VERIFICATION_DAILY_LIMIT`. Email input is limited to 254 characters; `POST /api/auth/check-email` returns `400 EMAIL_TOO_LONG` when that limit is exceeded. Issuing a new link invalidates the previous one. Authentication endpoints return stable `code` values rather than display text; the Portal and Learning Guide Backoffice Portal render user-facing errors from `messages/en-GB.json` or `messages/zh-CN.json` according to the current locale.

Google authentication uses `GET /api/auth/google` and `GET /api/auth/google/callback`. The first route creates a signed state/nonce/PKCE transaction and redirects to Google. The callback verifies the transaction and Google ID Token before calling the User Authentication service and creating the application Session cookie. A newly created Google user receives the verified email prefix as Name, including email-prefix characters normally rejected by manual Name validation; a later callback never overwrites it. Existing email accounts are not automatically linked.

WeChat uses `GET /api/auth/wechat?locale=en-GB&returnTo=/en-GB/account/my-learning` and `GET /api/auth/wechat/callback?code=...&state=...`. Callbacks return a 303 redirect and expire the transaction cookie on success and failure. Failures preserve a validated locale/returnTo and use `oauthError=state|cancelled|disabled|wechat-conflict|wechat`. The trusted identity contract is `contracts/wechat.ts`: subject is always `appId:openid`; UnionID is metadata. WeChat users may have `email: null` and `emailVerifiedAt: null`; an active linked WeChat account can hold a Session without email verification. Email/password authentication still requires verified email. No accounts are merged by profile or email. Provider tokens and codes are never returned to the client.

```ts
type ApiResult<T> =
  | { ok: true; data: T; requestId: string }
  | { ok: false; code: string; message: string; requestId: string };
```

## Portal / User Registration

WeChat callbacks now redirect unbound users to `/{locale}/portal/bind-email?returnTo=...`. `POST /api/auth/email-binding/request` accepts `{ email, locale, returnTo }` and a valid restricted WeChat session, returns `{ ok: true, accepted: true, retryAfter: 60 }`, and never returns the token. Errors use `code`: unauthorised (401), cooldown (429), email_unavailable (503), invalid_email/email_in_use/already_bound (400). `POST /api/auth/email-binding/confirm` accepts `{ token, locale, returnTo }` without requiring a session, verifies ownership, and returns `{ ok: true, alreadyBound, sameUser, continueUrl }`. It never creates a Session; only the matching existing session may continue directly. Other devices/accounts receive a WeChat login URL. Invalid/expired/superseded links and ownership conflicts fail. Normal business APIs reject unverified WeChat sessions. These rules supersede earlier statements permitting no-email authenticated access.

Password reset uses `POST /api/auth/password-reset/request` with `{ email, locale, returnTo }` (`contracts/passwordReset.ts`). Accepted responses are `{ ok: true, accepted: true, retryAfter: 60, resetUrl: null }`, including unknown/ineligible accounts and requests within the per-account cooldown. Invalid input returns 400; unavailable mail delivery returns 503 with `code: email_unavailable`. `services/passwordResetService.ts` sends through configured SMTP/SES in DEV, SIT, UAT and production. A direct preview link is returned only with `APP_ENV=DEV`, `LOCAL_PASSWORD_RESET_PREVIEW=1` and no configured mail transport. With configured delivery, tokens never appear in API responses. Mail links use the configured public origin and a validated local returnTo. Tokens expire after one hour; reissue invalidates prior tokens. Confirmation still uses `{ token, newPassword }`, consumes the token and revokes existing sessions. No database migration is required.

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

Overview `99:41` temporary display revision: authenticated My Learning renders fixed Figma samples through `contracts/overview-design-sample.ts` and `overviewDesignSample`, replacing real progress presentation on this page by explicit user request. No new endpoint or progress write. Actual knowledge-point APIs and saved positions remain intact. Navigation only uses published course identities and rechecks access on the destination; sample completion percentages never establish Entitlement or a completed Study event.

Knowledge-point progress revision (user-requested): study `open` events may include `learningMode: "video" | "text"` and `contentId: string | null`, plus a unique `clientEventId` for each navigation. Null content identifies a legacy text-body lesson. Server validates active content ownership/type and existing Session/Entitlement or first-lesson preview access before updating the position. Current knowledge-point ordinal across all course lessons / total active points of the same mode × 100, rounded to a whole percent, is course progress. PDF counts as text; exhibits do not count. Each mode keeps its own position; moving back recalculates from the current point. Duplicate requests never move the position again. No new endpoint; `GET` overview and course-page presentation use this authoritative position, and Continue carries lessonId/contentId/viewMode. Legacy clients without point identity retain their previous lesson-based progress until the next point-aware navigation; no historical point is fabricated.

Authorised Lesson access includes all active `LessonContent` knowledge points belonging to that Lesson (1.1, 1.2, etc.). The protected learning route checks Session, published Course, Lesson ownership and Entitlement before signing the Lesson's content resources. Content selection adds no separate unlock or previous-point completion requirement. Preview-only access retains existing Lesson and playback limits.

`POST /api/study/preview` accepts `{ courseId, lessonId, event: "open" | "complete", seconds? }` for a verified signed-in user. Without Entitlement, only an `open` event for the published course's public first lesson is permitted; completion and private lessons are denied. A deterministic per-user event key makes repeated opens idempotent. Opening the preview creates a Study Record visible in Overview; it grants no course access. This explicitly supersedes the earlier preview-does-not-create-record rule for signed-in preview history. Anonymous requests remain rejected.

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

Category-to-Everything upgrade revision: upgrade quote/order JSON adds `upgradePrice: StripePriceSnapshot` for the one-time collection, while `price` remains the target Everything recurring Price. The server resolves `STRIPE_PRICE_UPGRADE_SIX_MONTHS` ($60 USD) or `STRIPE_PRICE_UPGRADE_ONE_YEAR` ($120 USD), validates one-time/active/USD/per-unit configuration, and pins its ID and amount. Client still sends only owned source Subscription/quote IDs. Checkout uses mode payment and the configured upgrade Price; Webhook verifies exact line-item Price and amount before updating the original recurring Subscription to Everything with proration disabled. Original term/end date remains. New Checkout rejects legacy quotes without an upgradePrice; already-issued legacy Checkout Webhooks retain existing compatibility.

`StripePriceSnapshot` optionally includes `stripeProductId`, `productName`, and `productImage` (HTTPS URL or null). My Subscriptions server rendering adds order `presentation: { name, image, termMonths }`; it uses saved metadata or the historical order's Stripe Price, never a browser-supplied product. Product lookup failures leave imagery empty and preserve the recorded plan/term. This is additive JSON metadata, with no relational migration.

Checkout success URLs (purchase, trial activation and upgrade) are `/{locale}/account/my-learning/subscription?orderId={orderId}` on the trusted Checkout origin. Completed Checkout retries return the same local destination. The order ID selects an owned pending order for UI refresh only; it never proves payment or grants access. Cancellation URLs remain on subscription confirmation.

`POST /api/subscription/quote` accepts `{ planId, kind: "purchase" | "trial" }`. The server resolves the configured lookup key, validates a licensed USD recurring Price with a 6/12-month period, and snapshots Price ID, amount, currency and term. Checkout accepts only the owned quote ID and required consents, never a client-supplied price. All eight Pricing combinations use subscription Checkout. Unavailable/misconfigured prices are disabled; no demo amount is charged as a fallback. Webhooks verify the current provider objects and apply payment, subscription and entitlement state with event deduplication. Existing course/mobile prices are not mapped to category prices.

Portal login links carry `returnTo=<encoded local pathname + query + hash>`. Email entry, password sign-in, registration switches and OAuth links retain it. The sign-in page validates it with `safeReturnTo`; external, protocol-relative and backslash/control-character URLs fall back to My Learning. Login and registration pages are not used as the source when switching auth entry points. No login API payload or database change is required.

WeChat shared callback: `GET /api/auth/wechat` sets a signed host-only handoff cookie on DEV/SIT and redirects to UAT. UAT starts `snsapi_login`; `GET /api/auth/wechat/callback` validates state and issues a two-minute single-use ticket. `POST /api/auth/wechat/redeem` requires an environment-specific bearer secret and atomically deletes the ticket. `GET /api/auth/wechat/complete?ticket=...` requires the origin's signed cookie, checks nonce, then creates the account and Session in the origin environment. Failures create no Session.

### Lesson summary
Course Management draft PUT `/api/backoffice/courses/:courseId/draft` accepts optional `sections[].lessons[].summary`: plain-text string, maximum 500 characters before trimming. Empty string clears it; omitted preserves existing summaries for legacy clients. Lesson creation POST `/api/backoffice/courses/:courseId` also accepts optional `summary`. Invalid values return the existing `invalid` error. Summary is public syllabus metadata, rendered as escaped text; body/contents remain protected teaching content.

### Course learning mode

First course entry shows the chooser only when the published course has both video and text modes and the user has no saved preference. Availability is computed on the server across all lessons from active video/text/PDF content and legacy text bodies. Single-mode courses skip the chooser without a preference write; existing content selection falls back to the available content. No access-policy or HTTP payload change.

`PUT /api/courses/:courseId/learning-mode` accepts `{ mode: "video" | "text" }`. A verified active Session and matching request Origin are required. The application service validates a published course and writes only the current user's course preference. Repeated writes update the same `(userId, courseId)` value. Success: `{ ok: true, code: "saved", message, data: { courseId, mode } }`. Failure uses `{ ok: false, code, message }`: invalid input 400, missing Session 401, cross-origin 403, unavailable course 404, persistence failure 500. No price, subscription, entitlement or protected course-content access is changed.

Course detail reads preferences from the server; only courses with no confirmed preference show the chooser. Visitors select a mode and Continue to sign-in with a safe local returnTo carrying `learningMode`; after login that selection is retained for explicit Continue confirmation. Direct first entries start with both options unselected. Closing/escaping or a failed save records nothing. Saved preferences apply across browsers/devices for the same account and remain scoped to the course. The optional URL mode never grants access or saves by itself.


Overview display (temporary): no new HTTP API or database write. The authenticated server page calls `getLearningOverviewDisplay()` for a `LearningOverviewDisplay` defined in `contracts/learning-overview-display.ts`; every published course appears in both lists. Learning includes mock progress/mode/current lesson, preview excludes progress entirely. Continue/Review uses the existing protected learning route; Course detail uses the existing public course route. Unauthenticated Overview requests retain the existing sign-in redirect. Real study APIs and access checks are unchanged.


My Subscription `47:230` presentation update: no API signature changes or new database writes. Server page supplies authorised Subscription/Order DTOs defined in `contracts/subscription-records.ts`; pure `groupSubscriptionRecords` groups the provided records for display. Payment history toggles only local visibility. Existing `/api/subscription`, `/api/subscription/portal` and authenticated `/api/my-learning/orders/:id/receipt` retain cancellation/resume, billing/payment and receipt enforcement. Receipt links appear only for successful non-trial payments with a recorded invoice (or local demo receipt). Failed standalone Checkout does not count as a subscribed product.


Video completion strip: `VideoPlaybackProgress` in `contracts/video-progress.ts` is a client presentation callback (contentId/currentTime/duration), not a new HTTP endpoint. >=98% controls visibility only. Explicit Complete lesson calls existing `/api/study/preview` for the public lesson or `/api/study/events` for protected learning with the existing stable complete_course_lesson event key; server Entitlement validation remains authoritative. Preview opens still persist through the existing API; unentitled viewers never receive a completion strip. No API/schema migration.


Video completion dialog uses existing complete Study events, including native video ended for entitled viewers. No API or access-policy changes. Keep watching dismisses only the strip, not ended handling; seeking to 100% alone does not save. Success precedes dialog display, concurrent click/ended writes share the stable clientEventId, failure remains retryable. Test buttons do not call unrelated assessment APIs.


View exhibit strips use the existing server-filtered LessonContent.nodes and LessonNode fields id/title/type/url/html/active/triggerTime (seconds). No new endpoint, persistence or Entitlement calculation. Only actual playback crossing a configured active node time offers the strip; Not Now is per-player presentation state. Viewing reuses the existing media modal and sanitised URLs/HTML; trial enforcement runs first.


Exhibit dialog consumes existing server-authorised LessonNode image/video/model3d URLs and title; no endpoint or schema changes. contracts/exhibit-viewer.ts defines local renderer zoom/reset controls and 25-400% limits, without database writes. Existing media URL checks and OBJ/embedded GLB resource restrictions remain intact. Image transforms and model camera changes do not affect Study completion or Entitlement. Closing media exhibit dialogs leaves lesson playback paused.


Text exhibit entries are temporary user-authorised display samples only; contracts/text-exhibit.ts constrains the supported image/video/model3d modes. No API, database or course-content write. TextExhibitContent splits sanitised top-level blocks and inserts entries after evenly distributed paragraphs; existing inline node titles/clicks and safe media rules remain. lib/textExhibitSamples.ts supplies replaceable local sample resource URLs. Production course content remains authoritative for all original text/nodes.


Completion Continue uses a server-derived next-lesson URL in the same course. Existing successful Study completion is required before the popup; subsequent learning route rechecks Session, published course and Entitlement. No API/schema change or Entitlement write. Escape dismisses without navigation; final lesson Continue routes to localised My Learning.
# Local sample Knowledge Test contract

`contracts/knowledge-test.ts`: question `{id,prompt,referenceAnswer}`, response `{answer,rating:"right"|"wrong"|null}`; answer input limit 2,000 characters. `reviewKnowledgeResponses` returns ordered Strong / Needs Review indices, rounded correct percentage and a complete flag requiring every rating. Next requires the current rating. Six distinct sample questions are supplied locally. There is no new HTTP endpoint or persistent assessment write in this sample implementation; existing server completion/entitlement contracts are unchanged.


## Local Application Test sample contract

`contracts/application-test.ts`: phases answer/evaluating/result; answer limit 2,000; evaluation duration 3,000 ms. `services/applicationTestSample.ts` returns one localized sample prompt and fixed sample feedback, validates a nonblank bounded answer, and clamps elapsed-time progress to 0..100. No HTTP API or database migration is introduced for this simulation. Result Review echoes the exact submitted answer. Cancelling unmounts the test and clears timers; no asynchronous result can reopen it.


## Course Understanding page contract

`GET /{locale}/portal/courses/{slug-or-id}/understanding?lessonId={id}&from=preview` is a server-rendered page, not a new JSON API. Published course and course-owned lesson are required (404 otherwise); missing session redirects to sign-in preserving the destination; denied/expired Entitlement redirects to course detail. Only the recognized preview source chooses a preview return route; no arbitrary return URL is accepted. Data is the local typed UnderstandingOverviewDisplay sample from `services/understandingOverview.ts`. Assessment actions are session-local sample dialogs; no database or AI result endpoint/migration is added.


## Local Exploration display contract

Playback outline metadata includes `modes: ("video" | "text")[]` calculated by the server from active lesson content. Text includes PDF and legacy lesson bodies. Playback pages accept optional validated `viewMode=video|text` as a presentation filter, falling back to the saved preference for invalid/missing values. It does not change Entitlement or persist a preference. Filtered lesson links retain this value; protected content remains server-authorised. No new API endpoint or migration.

ExplorationDisplay comprises reading entries `{id,kind,title,author,description,lessonNumber}` and exhibit entries `{node:LessonNode,lessonNumber,thumbnail}`. `explorationSamples(locale,courseId,lessonNumber)` returns four design readings and five scoped fake exhibits with image/video/model first. Whole course displays all five; lesson scope filters on lessonNumber. The contract is presentation-only: no new HTTP endpoint, database migration, assessment write or access grant. Existing server-rendered lesson access checks continue to apply.
