# Category → Everything：新订阅与一次性抵扣

## 业务基线

依据 2026-11-13 的 Learning_Guide_Stripe_Upgrade_Business_Briefing.html。新升级创建 Everything Subscription，不在原订阅上 proration；6m 的基础金额为 9900 − 3900 = 6000 cents，12m 为 19800 − 7800 = 12000 cents。一次性 Coupon 只影响首次 Invoice，后续按完整 Everything Price 续费。税费以 Stripe 的真实 Checkout/Invoice 为准。

只允许当前已付费、有效、单个 PC Category 的同周期升级。现有的多分类、试用、归属、欠费、重复购买限制继续生效。报价/付款前核对原 Stripe Subscription、已付订单、Customer、Price 和实际周期；浏览器不能指定价格、Coupon 或抵扣额。

保留本地 dailytest 配置，不将它迁移到标准周期，也不使用它代替 6m/12m 的业务验收。可使用其他标准 Category 做 Sandbox 验收。

## 两个新增配置

```dotenv
STRIPE_COUPON_UPGRADE_SIX_MONTHS=Off_Upgrade-39
STRIPE_COUPON_UPGRADE_ONE_YEAR=Off_Upgrade-78
```

值为实际 Coupon ID，不是名称或 Promotion Code。每个环境独立配置，应用读取前校验 USD、金额、Once、valid、Everything Product 限制；必须展开 applies_to。已有 STRIPE_PRICE_UPGRADE_* 仅兼容旧的一次性升级订单，不用于新升级。

## 开发及调用流程

1. contracts/stripe-upgrade.ts 定义不可变 upgradeCredit 报价快照；保留 upgradeProration 历史格式。
2. POST /api/subscription/quote，body 为 `{kind:"upgrade",subscriptionId}`。Session 决定用户；服务器返回 upgradeCredit、目标 Price、报价及有效期。任何客户端 couponId、amountMinor、termMonths 均不作为依据。
3. POST /api/purchase/checkout，提交 quoteId、locale 和三个购买同意项。事务内保留来源订阅的唯一待支付升级订单，多报价/多标签不能重复占用同一来源。
4. 新 Checkout 使用原 Customer、同周期 Everything recurring Price 和一个后端 Coupon；不试用，不继承旧 anchor，只支持 card。不要同时传 allow_promotion_codes 和 discounts，Stripe 即使收到 false 也会拒绝这两个参数组合。
5. Checkout / invoice.paid 回调均读取 Stripe 当前对象，验证所有归属、价格、折扣、支付和新订阅状态。仅首次 Invoice paid 且新 Subscription active 才落库。
6. 同一事务将新订单保存为 Paid（标准价、折扣、税费、实付分别保存）、创建新 Subscription/Entitlement、撤销旧权限并以 supersededBy 标明替代关系、保存取消旧订阅待办。旧订单保持 Paid。
7. 立即取消旧 Stripe Subscription，invoice_now=false、prorate=false。失败时保持 Everything 权限和 Paid 订单，记录 pending、attempts、lastFailureAt、nextAttemptAt 并输出 upgrade_action_required 告警；不能重新创建新订阅。
8. instrumentation 启动每 30 秒的重试循环；待办保存在订单 payload，重启后仍可读取，指数退避最高一小时。取消前先查询旧订阅，已 canceled 则完成本地待办。多实例重复执行通过远端状态查询及本地事务终态保护保持重复安全。
9. 管理页的 check/resume/cancel 使用原 Checkout；过期/失败保留旧权限。晚到的旧 Invoice 可以保留财务记录，但不能恢复已被替代的 Category 权限。

数据仍经 productTransactionRepository 的 PostgreSQL advisory lock、事务及 product_payment_keys 唯一键提交；本次只有 JSON payload 的增量字段，无 SQL schema 迁移。不得手工改历史订单金额或批量重建订阅。

实际新周期取首次 Stripe Invoice 的行项目 period，不按 Webhook 抵达时间计算。页面说明付款后新周期生效，不承诺手算日期；首版只开放 card，跨天异步支付不在当前 Checkout 支付方式内。

## 测试流程

先使用独立测试数据运行 lint → typecheck → 单元/API/支付集成 → build。不要将现有 52 个旧交易回归改成新规则：它们显式使用 createProrationUpgradeQuote 保留旧交易恢复的验证；生产 quote API 只创建新版报价。

```powershell
node node_modules/eslint/bin/eslint.js services/stripeUpgradeCreditPrice.ts services/stripeCreditUpgradePayment.ts services/productStore.ts services/paymentService.ts services/stripeCheckoutPayment.ts services/orderPaymentService.ts components/portal/SubscriptionConfirmation.tsx contracts/payment.ts contracts/stripe-upgrade.ts instrumentation.ts
node node_modules/typescript/bin/tsc --noEmit --incremental false
node --import tsx --require ./scripts/register-tsconfig-paths.cjs --test --test-concurrency=1 tests/unit/stripe-upgrade-coupon.test.ts tests/unit/stripe-upgrade-confirmation-page.test.ts tests/unit/preflight-production.test.ts
node node_modules/playwright/cli.js test --config=playwright.payment.config.ts --reporter=line
npm run build
```

自动验收：6m/12m 新订阅与新到期日、首次折扣、下一次全价 Invoice、旧订单不变、取消失败持久化重试、重复/乱序回调、不同报价并发、未付不开通、金额/Coupon/归属篡改、原 Session 恢复/取消、创建响应丢失、税费分离。浏览器测试覆盖两种语言和 1440/390/320px，保留旧 proration 页面兼容检查。

PostgreSQL 多进程证明必须使用一次性测试数据库，不能指向 DEV/生产数据；已有 payment-persistence.test.ts 会清表。没有独立数据库时记录未执行，不把文件存储测试称为 PostgreSQL 验证。

## 真实 Sandbox 配置探测（不扣款）

需要在当前环境配置上述两个新增项和现有 Everything Price、test secret、STRIPE_SANDBOX=1。

Portal 内的配置探测脚本已按用户的目录整理要求移除，本节保留测试方法和历史结果。通过 Stripe Dashboard 核对两个 Coupon 和目标 Price；未付款 Checkout 探测的验收值为折扣 39/78、基础费用 60/120，创建后应立即过期，不输入卡号、不修改商品/Coupon。配置探测不等于完整付款验收。

## 真实付款验收与发布

1. 保持 Stripe CLI 和本地网站运行，用标准 Category 价格准备独立测试账户。
2. 使用 Stripe 官方测试卡分别购买 6m 和 12m Category，再走 UI 升级；截图保留原价、抵扣、实付、下一次续费说明。
3. 核实新 Stripe sub_ 与旧 sub_ 不同、Customer 相同；首次 Invoice paid、新 Subscription active；本地 Everything 权限生效；旧 Subscription canceled；旧订单仍 Paid。
4. Stripe Test Clock 推进一个周期，确认下一次完整 Everything 价格且没有升级抵扣，确认本地续费记录一致。
5. 另外验收拒付/3DS未完成/关闭、重复事件、故障后重启、旧订阅取消失败告警及重试完成。保留事件 ID 和订单 ID，不记录密钥或卡数据。
6. 在目标环境执行 production preflight、核对 Webhook 订阅事件、Coupon/Price 所属环境和两个配置的注入，然后按 DEV → SIT → UAT → 生产验收推进。提交、推送和部署仍需单独授权。

回滚只停止新交易入口，不删除新订单或已付新订阅；回调和取消重试必须继续可用。已有 proration 和旧固定费订单按原快照处理，不迁移其金额、周期或付款方式。

## 本次执行记录（2026-11-15）

- 相关文件 ESLint、全项目 TypeScript 检查通过。
- 支付集成 62 passed（52 项既有回归 + 10 项新升级场景）；单元/API I/O/双语浏览器相关回归 68 passed。
- 两个真实 Sandbox Coupon 已只读核实：Off_Upgrade-39 / Off_Upgrade-78，USD 39/78、Once、valid、Everything Product 限制均正确。
- 真实 Sandbox 未付款 Checkout 探测分别返回 6000/12000 cents，随后已过期，未提交银行卡、未扣款。
- 本地只补两个 Coupon 配置，其余配置逐项比对不变，Science dailytest 保留。没有新增依赖、SQL schema 迁移或修改 CI。
- 尚未执行：完整真实测试卡付款与 Webhook 到本地的闭环、新订阅 Test Clock 续费、目标独立 PostgreSQL 多进程及部署环境冒烟。没有独立数据库配置，不能执行会清表的 PostgreSQL harness。
- 代码未 commit/push/部署。

## 本次改动文件清单

```text
.env.example
.env.local（忽略文件，仅新增两个 Coupon 配置）
contracts/payment.ts
contracts/stripe-upgrade.ts
services/stripeUpgradeCreditPrice.ts
services/stripeCreditUpgradePayment.ts
services/productStore.ts
services/paymentService.ts
services/stripeCheckoutPayment.ts
services/orderPaymentService.ts
instrumentation.ts
components/portal/SubscriptionConfirmation.tsx
messages/en-GB.json
messages/zh-CN.json
scripts/preflight-production.mjs
tests/integration/stripe-payment.spec.ts
tests/unit/stripe-upgrade-coupon.test.ts
tests/unit/stripe-upgrade-confirmation-page.test.ts
tests/unit/preflight-production.test.ts
docs/phase1/requirements-map.md
docs/phase1/domain-model.md
docs/phase1/api-contracts.md
docs/phase1/release-runbook.md
docs/phase1/stripe-coupon-upgrade.md
```
