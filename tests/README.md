# 测试目录

- `unit/`：Rule Engine、价格、资格、状态转换、progress、Prompt/knowledge selection 等确定性规则。
- `integration/`：repository transaction、API contract、Stripe Webhook 去重、session 和权限。
- `e2e/`：Portal、注册、试用、购买、My Learning、Study、AI Tutor、双语页面和失败状态。

- `npm run test:unit` / `test:integration` / `test:ci`：tsc + unit + integration；GitHub Actions 用（云构建形态，不启 demo 服务器）。
- `npm run test:e2e`：本机 only（Playwright e2e，3012/本机站点）。
- `npm run test:local` / `smoke:product`：本机 only（3011 + DEV/demo 断言；不进 Actions）。

每条 PRD 的用户路径至少需要一个 service test 和一个 API/E2E test。上线前用同一组 smoke script 在 DEV、SIT、UAT、PPE/PROD 逐步运行。
