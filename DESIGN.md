# Learning Guide：开发设计约束

## UI 设计依据与验收

- 当前功能范围内的所有页面都必须对照 Figma 实现，不仅是 Excel 或 PowerPoint 提到的页面。未被修改清单点名，不代表可以沿用现有页面或自行设计。
- `1 (Copy).fig` 提供当前 Portal、My Learning、Pricing 和订阅弹窗设计；`LearningGuide (Copy).fig` 提供其他应用页面和组件参考。同一页面存在多个版本时，先核对对应功能及设计版本，不把不同版本的布局随意拼接。
- 七份 PRD 及已确认的修订决定功能范围和业务规则。`页面&功能修改.xlsx`、`页面_功能修改.pptx` 仅在涉及其对应功能时作为修改依据；明确要求变更的部分覆盖对应设计，不扩大到其他页面。
- 对照项目包括页面结构、组件、字体及字重、颜色、间距、尺寸、边框、圆角、阴影、图标、图片、对齐、按钮状态、弹窗及交互。使用原始设计资产，不以近似素材代替。
- 设计稿中的价格、日期、用户、课程及付款记录是展示样例，运行页面使用真实服务端数据，不为视觉一致而硬编码业务结果。
- 优先按设计稿已有的桌面、平板和手机版本实现。没有对应尺寸设计时，延续相同视觉样式，调整布局以避免溢出、遮挡和无法操作；不得把自行补充的响应式布局称为已与设计稿逐像素一致。
- 每个页面按具体 Figma 节点及版本检查，并使用实际浏览器截图核对。功能测试通过、没有横向溢出或成功读取设计文件，都不能代替视觉验收。尚未核对的页面必须明确标记为待验收。

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
