# AI coding tool 任务模板

把下面的内容作为每个开发任务的起始 Prompt。任务必须具体到文件、输入、输出和测试，不能只说“实现购买功能”。

```text
你正在修改 Learning Guide Phase 1 production website。

先阅读：
- PROJECT.md
- AGENTS.md
- DESIGN.md
- docs/phase1/requirements-map.md
- docs/phase1/domain-model.md
- docs/phase1/api-contracts.md
- 与本任务对应的 PRD：docs/phase1/source-prd/<file>.docx

任务：<一个可在一次 PR 中完成的功能>
涉及 Business Function：<使用图中的名称>
允许修改的目录：<明确列出>
API 输入：<字段、类型、限制>
服务输出：<字段、状态和错误>
数据库变化：<migration 文件和唯一约束；没有变化就写 none>
页面状态：loading、empty、error、unauthorised、expired/disabled（适用时）和 success。

必须遵守：
1. Route Handler 不写业务规则、SQL 或第三方 SDK 细节。
2. 浏览器不能决定金额、Payment、Subscription、Entitlement 或 Course 访问权限。
3. 外部系统只通过 adapter 调用；Stripe Webhook 使用 raw body 验签和 event id 去重。
4. en-GB 和 zh-CN 的 UI 文案同时增加 message key。
5. 不把 secret、完整 Prompt、卡号或真实个人资料写入日志或测试 fixture。

测试：
- service/unit：<列出规则和边界>
- API/integration：<列出权限、错误和重复请求>
- E2E：<列出用户可以看到的完整路径>

完成标准：
- npm run build 通过；
- 所有测试通过；
- requirements-map.md 有实现路径；
- 没有新增超出 PRD 的功能；
- 最终说明修改文件、数据库 migration、测试命令和已知限制。
```

## 一个真实任务例子

```text
任务：实现 POST /api/purchase/quote。
涉及 Business Function：Purchase、Subscription Management、Rule Engine。
输入：planId、termMonths（只能 6 或 12）、device（pc 或 mobile）、sourceCourseId 可选。
服务顺序：requireUser -> 读取 Plan -> 检查 trial/已有 Subscription -> 读取当前 Course Price -> 写入有效期 quote。
禁止：接受浏览器传来的 amount、currency、stripePriceId 或 entitlement。
测试：过期 quote、错误 device、termMonths=3、重复请求、无权升级、有效 6/12 月报价。
```
