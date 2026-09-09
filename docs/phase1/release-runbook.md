# Phase 1：发布和上线运行手册

邮箱注册在 PPE/PROD 必须配置 `EMAIL_VERIFICATION_REQUIRED=1`、`SES_FROM_EMAIL`、`AWS_REGION` 和使用 HTTPS 的 `NEXT_PUBLIC_APP_URL`。冒烟测试必须确认待激活账号不能登录、验证链接只能成功使用一次，并且重新发送后旧链接失效。

## 1. 环境

| 环境 | 用途 | 数据 | 发布方式 |
|---|---|---|---|
| DEV | 开发人员联调 | 测试数据，可重置 | pull request 合并后自动部署 |
| SIT | 系统集成和支付测试 | 固定集成数据，Stripe test mode | DEV smoke 通过后发布 |
| UAT | 客户验收 | 脱敏验收数据，Stripe test mode | 版本候选人工批准 |
| PPE/PROD | 生产预演和正式站点 | 生产数据，Stripe live mode 仅在批准后打开 | 受控发布窗口 |

每个环境都是一个 AWS App Runner 服务，运行同一个 Docker image；配置通过 App Runner environment variables 和 Secrets Manager 注入。不要用代码分支复制业务逻辑。

## 2. Cloud 配置

- **Containers**：Docker image 启动 `next start`，监听 App Runner 提供的 `PORT`（当前配置为 8080）。
- **Database**：RDS PostgreSQL；生产只允许应用安全组访问；migration 由发布流程执行。
- **S3**：保存 avatar、course media、source material、KS 文件；bucket private；应用只生成短期 signed URL。
- **Network**：App Runner 通过 VPC Connector 访问 RDS；RDS 不公开暴露；S3、Stripe、Google、WeChat、OpenRouter 使用出站 HTTPS。
- **Security Strategy**：Secrets Manager 保存 `DATABASE_URL`、`STRIPE_SECRET_KEY`、`STRIPE_WEBHOOK_SECRET`、OAuth secrets、`OPENROUTER_API_KEY`、session secret；代码仓库和浏览器不保存 secret。
- **Monitor**：CloudWatch 记录 request error、latency、App Runner instance、database connection、payment webhook failure；不记录密码、卡信息、OAuth code 或完整 prompt/学生隐私内容。
- **Message Queue**：Phase 1 不单独部署队列；只有确有异步需求的邮件/通知才使用 database outbox，发送失败可重试。

## 3. CI/CD

### Stripe lookup-key rollout

- Set `PAYMENT_MODE=stripe`; keep each `STRIPE_PRICE_*` value as its Stripe lookup key. All eight mapped Prices must be active, licensed recurring USD Prices; six months means `month/6`, one year means `year/1` or `month/12`. A monthly Price is rejected for a yearly selection.
- With PostgreSQL, apply `db/migrations/009_product_payment_keys.sql` before deploying this version. Product writers now serialize the existing JSON aggregate and commit provider identity uniqueness in the same database transaction. Back up the aggregate first; this migration does not rewrite existing user or purchase records.
- Run `npm run test:auth`, `npm run test:payment`, and `npm run build`. Then run `node scripts/verify-stripe-checkout.mjs` with test credentials: it uses a disposable local store, creates and expires unpaid Checkout sessions, validates all available choices, and captures bilingual Pricing screenshots. It refuses live keys and does not submit a card.
- Configure the target endpoint `/api/payment/webhook` for Checkout completion/async success/async failure/expiry, invoice paid/failed, and subscription updated/deleted. Stripe CLI forwarding uses its own signing secret. Verify delivery and retry using the actual endpoint; test helpers alone do not verify deployed webhook configuration.
- Complete a real Stripe sandbox payment, renewal failure/recovery, cancellation, and Category-to-Everything upgrade before promotion. Check Order, Subscription and Entitlement, both locales, no-email WeChat users, and webhook-before/after-browser-return. The return page refreshes pending state but never grants access itself.
- Upgrades retain the existing one-time difference collection and change the original recurring subscription only after verified payment, with no proration or new subscription. Source and target must use the same Stripe interval/count so the renewal anchor is preserved.
- The remote sandbox verification records the Science annual lookup key correction; see `stripe-sandbox.md`. Revalidate the current catalogue before each release.

```text
GitHub pull request
  -> typecheck / lint / unit / integration / build
  -> Docker build
  -> push Amazon ECR
  -> deploy DEV
  -> smoke: health, auth, course, quote, Stripe test webhook, entitlement
  -> promote same image to SIT -> UAT -> PPE/PROD
```

每次发布记录：git SHA、Docker image digest、database migration、环境、批准人、回滚 image。禁止在 App Runner 控制台直接改代码或手工执行生产 SQL。

## 4. 上线前必须完成

1. 四个环境的 App Runner、RDS、S3、Secrets Manager、CloudWatch 配置已逐项核对。
2. Domain、TLS、trusted origins、Google/WeChat callback 和 SES sender 已验证。
3. Stripe test mode 已完成成功、失败、取消、重复 webhook、乱序 webhook、全额 refund、异常订单 Resynchronise Payment。
4. 真实 plan、term、currency、税务规则、business timezone 和 trial 窗口已由业务确认。
5. `/my-learning/*`、`/learn/:course_id`、AI Tutor、Expired、Payment Grace、reset password 和中英文切换已通过 UAT。
6. 1–7 October 中国国庆假期不做 PPE/PROD 数据库变更或正式发布；release candidate 要么在假期前完成，要么 8 October 后执行。

正式发布前还必须运行 `npm run preflight:production`。如果 `/api/health/config` 返回 `ready: false`，不得把该 App Runner 服务当作生产站点开放购买或登录。生产环境必须使用真实 Google、WeChat、Stripe、SES 和 PostgreSQL/S3 配置；`LOCAL_SOCIAL_LOGIN=1`、`PAYMENT_MODE=demo` 或 `STORAGE_BACKEND=local` 均为阻断项。

## 5. 回滚

### WeChat login smoke test

- In WeChat Open Platform, confirm the website application is approved for website login and its authorised domain is the hostname only, for example `www.ilovelearningguide.com`.
- Use the configured HTTPS origin for both the login page and `/api/auth/wechat/callback`; set `LOCAL_SOCIAL_LOGIN=0`. The application sends the full callback URL to WeChat at runtime.
- Scan the QR code with a real WeChat account, approve access, confirm the browser returns to the requested page, confirm a session cookie is issued, and confirm the new user has no fabricated email address.
- `configured` health status checks presence of credentials, not provider acceptance; this real QR test remains mandatory.
- Run `npm run test:auth` and `npm run build` before deploying. Tests use fake provider responses and isolated temporary stores, never real credentials.
- On the target domain, scan and confirm: first sign-in creates one student Account, repeated sign-in retains userId, and `/api/auth/me` accepts the Session even when email is absent. Check both locales and returnTo from Purchase/My Learning.
- Cancel/expire the QR flow, retry, and verify that failures clear the temporary cookie without issuing a Session. Verify disabled accounts cannot sign in and expired/missing Entitlement still denies protected course access.
- Test paid and trial Checkout with an absent email; no placeholder address is sent. Do not treat a Checkout contact email as verified application email.
- Legacy subjects migrate lazily on successful login; back up product data before rollout. Do not roll back to code that requires verified email for all Sessions after no-email accounts exist. Prefer a forward fix or a tested compatibility build; preserve Orders and learning records.

- 应用错误：把 App Runner 指回上一个已验证 image digest。
- 数据库错误：先停止继续发布，按 migration 的反向操作或备份恢复方案处理；不得直接删除生产表。
- Stripe/Entitlement 错误：停止新 checkout，保留 webhook 接收，修复后按 Stripe 当前对象重新同步；不得手工在页面上“补开权限”。
