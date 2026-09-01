# Phase 1 基础骨架

## 第一条可运行切片

第一条切片的目的，是让开发者在不等待完整支付和 AI Tutor 的情况下，确认生产应用的入口、双语路由、课程读取和部署启动方式都正确。

```text
浏览器
  -> / 或 /en-GB/portal 或 /zh-CN/portal
  -> Learning Guide Portal
  -> Course Management.listPublishedCourses()
  -> 课程卡片 / Course Detail 占位页

GET /api/health
  -> 返回 { ok: true, environment, version }
```

当前 starter 页面不创建 User、Order、Payment 或 Entitlement。它只证明应用可以启动、路由可用、课程读取位置明确；真实权限必须在后续服务中加入。

## 目录约定

```text
app/[locale]/portal/                    Learning Guide Portal 页面
app/[locale]/account/                   Learning Guide App 页面
app/[locale]/backoffice/                Learning Guide Backoffice Portal 页面
app/api/                                Route Handler，只做边界处理
components/                             只负责 UI，不读数据库
contracts/                              Zod request/response contract
modules/<Business Function>/            页面背后的业务服务、repository 和测试
basic-components/                       User Authentication、Rule Engine 等共用能力
db/migrations/                          顺序 SQL
messages/                               en-GB 和 zh-CN UI 文案
tests/                                  unit、integration、e2e
knowledge/                              KS/AI Tutor 只读内容，不作为产品权限来源
prompts/                                版本化 AI Tutor Prompt
```

## 每个模块的最小文件

```text
modules/purchase/
  domain.ts
  repository.ts
  services/createQuote.ts
  services/createCheckout.ts
  index.ts
  __tests__/purchase.service.test.ts
```

Route Handler 不直接拼 SQL、读取 Stripe SDK 或解释 Subscription 状态。它只解析请求、取得 session、调用服务并返回统一结果。跨模块调用只能调用公开 service 函数，例如 `checkEntitlement()`、`createQuote()` 和 `recordStudyEvent()`。

## 本地配置

复制 `.env.example` 到 `.env.local`。本地开发明确支持不连接 PostgreSQL、Stripe、Google、WeChat 或 SES：设置 `STORAGE_BACKEND=local`、`PAYMENT_MODE=demo` 和 `LOCAL_SOCIAL_LOGIN=1`。本地支付页面仍使用 pending、paid、failed、cancelled 订单状态，因此可以验证与生产相同的产品边界但不会真实扣款。正式业务模块在配置环境变量后使用 PostgreSQL/S3 和真实 provider adapter。secret 只能出现在本地 `.env.local` 或 AWS Secrets Manager。
