# Learning Guide：开发设计约束

## 目录结构

```text
app/
  [locale]/                         # native i18n 页面入口
    portal/                         # Learning Guide Portal
    account/                        # My Learning
    backoffice/                     # Learning Guide Backoffice Portal
  api/                              # Route Handler；不直接写业务规则
components/                         # 可复用 UI，不读数据库
modules/
  portal/
  user-registration/
  course-management/
  purchase/
  subscription-management/
  payment-management/
  order-management/
  my-learning/
  study/
  understanding-assessment/
  ai-tutor/
basic-components/
  user-authentication/
  rule-engine/
  process-engine/
  message-queue/
  data-management/
db/migrations/                       # 顺序 SQL；生产只通过发布流程执行
contracts/                           # zod input/output schema 与 TypeScript type
messages/en-GB.json
messages/zh-CN.json
knowledge/                           # AI Tutor / KS 只读种子包
prompts/                             # AI Tutor 系统 prompt；版本化
tests/unit/
tests/integration/
tests/e2e/
```

## 模块接口

模块之间不直接读取别的模块的表。跨模块访问只能经过明确的 service 函数。例如：

```ts
// modules/subscription-management/services/checkEntitlement.ts
export type EntitlementDecision = {
  allowed: boolean;
  scope: 'course' | 'category' | 'everything' | null;
  device: 'pc' | 'mobile' | null;
  validTo: string | null;
  reason: 'active' | 'trial' | 'grace' | 'expired' | 'missing' | 'device_denied';
};

export async function checkEntitlement(input: {
  userId: string;
  courseId: string;
  device: 'pc' | 'mobile';
}): Promise<EntitlementDecision>;
```

`Portal`、`Study`、`AI Tutor` 都调用这个函数，不自行解释 Subscription 状态。

## 页面和 API 的边界

- Server component 可以读取 application service 返回的已过滤数据。
- Client component 只管理输入、加载状态、错误显示和页面交互。
- Client component 不接收或保存 Stripe secret、数据库连接、OAuth secret 或 OpenRouter key。
- Client 发送 `course_id`、`lesson_id`、`mode`、`message`、`conversation_id`、`locale`；AI Tutor 服务端自己加载已发布的 prompt 和 Course/Lesson 知识。
- 服务端返回 `code`、`message`、`data`；不要用不同模块各自定义错误格式。

## 页面状态

每个生产页面至少实现：loading、empty、error、unauthorised、expired 或 disabled（适用时）、success。支付结果页面只展示服务端同步后的状态，不能根据 URL 参数直接显示成功。

## i18n

- URL 使用 `en-GB` 和 `zh-CN` locale。
- 默认 locale 为 `en-GB`。
- 页面静态文字、错误文案、状态名称和 CTA 必须进入 `messages/<locale>.json`。
- Course content、video subtitle、Stripe Hosted Checkout 不放入 UI messages。
- 新增文字时两种语言同时增加 key；禁止在组件中散落中文或英文常量。
