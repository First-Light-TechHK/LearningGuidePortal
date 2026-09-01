# Phase 1：七份 PRD 实施地图

本文件把七份 PRD 变成开发任务。它不新增产品范围。

## 1. 页面和功能

| PRD | 页面 | 服务 / Basic Components | 主要数据 | 先完成的验收 |
|---|---|---|---|---|
| Portal | `/`、`/courses`、`/courses/:course_slug`、`/courses/:course_slug/public-lesson`、`/pricing`、`/subscription/confirm`、Stripe result、`/learn/:course_id`、FAQ、legal | Portal、Course Management、Purchase、User Authentication、Rule Engine | Course、Section、Lesson、Plan、Entitlement、FAQ、Cookie Consent | 游客可浏览已发布课程和 Public First Lesson；完整 Course 必须再次由服务端检查 Entitlement |
| Registration & Authentication | `/sign-in`、`/sign-up`、`/verify-email`、`/reset-password`、`/api/auth/*` | User Registration、User Authentication、SES、Google、WeChat | User、Account、Session、Verification Token、Password Reset Token | Email 注册/验证/登录/重置；Google/WeChat 用 provider subject 识别；不按 email 或 nickname 自动合并 |
| Subscription Management | `/pricing`、`/subscription/confirm`、`/my-learning/subscription` | Subscription Management、Rule Engine、Process Engine | Plan、Price、Subscription、Entitlement、Trial | 四种 plan、6/12 month term、Trial Active/Canceled、Active Subscription、Cancel at Period End、Payment Grace、Expired 的状态和 CTA 可重复计算 |
| Payment Management | `/api/payment/webhook`、Backoffice Payment Management | Payment Management、Stripe Hosted Checkout、Stripe Customer Portal、Process Engine | Payment Gateway、Payment Attempt、Stripe Event | raw body 验签；event id 去重；同步订单/付款/订阅/权限；不在页面或浏览器提前开通 |
| Order Management | Backoffice Orders list/detail | Order Management、Payment Management、Rule Engine | Order、Payment Attempt、Refund、Order Activity | 正常订单只允许全额 Refund；异常订单允许 Resynchronise Payment；显示 Stripe 关联和活动记录 |
| My Learning | `/my-learning`、`/my-learning/subscription`、`/my-learning/notifications`、`/my-learning/settings`、`/my-learning/help` | My Learning、Study、Subscription Management、User Registration | Study Record、Study Event、Notification、User、Subscription、Payment Attempt | Overview 只列已开始课程，包含完成/过期历史；进度为 0–100 整数；通知逐条已读；昵称、语言和密码规则生效 |
| Visitor / Trial | Public First Lesson、sign-in/pricing/trial return | Visitor / Trial、Purchase、Subscription Management、Payment Management | Trial、Trial Activation Order、Entitlement、Subscription | 游客可看公开首课；Trial Activation 使用 Stripe payment-method setup 和 USD 0 order；取消立即移除 trial entitlement；原试用窗口内可恢复但不延长 |

## 2. Business Function 与依赖顺序

```text
Course Management
  -> Portal / Public First Lesson
  -> Pricing / Purchase
User Registration -> Subscription Management -> Payment Management
Payment Management -> Order Management + Entitlement
Entitlement -> Study + My Learning + AI Tutor
Study -> My Learning progress / current Lesson
```

`Group Study`、`Exploration`、`Reporting`、Partner 的 `Accounting`、`HR`、`BI/Dashboard` 在 Phase 1 只保留页面或接口位置，不把未给出业务规则的功能写成完成。

## 3. 不可变规则

- 只有 `published` Course、Section、Lesson 对游客可见。
- Public First Lesson 不创建完整 Course 的 Study Record。
- 完整 Course 首次打开且开始 Lesson 1 后才创建 Study Record。
- Course progress = 有效学习时间 / Course 总学习时间 × 100；只显示整数，最大 100。
- Video 和 text 不能对同一内容重复累计时间。
- `/my-learning/*` 必须有 session；失效或不存在的 Entitlement 只保留历史，不允许继续学习。
- Payment status 以 Stripe Webhook 同步结果为准；回跳页只查询结果。
- Business date/timezone、税费、6/12 month 的实际销售配置列为上线前确认项，不能由开发人员猜定。
