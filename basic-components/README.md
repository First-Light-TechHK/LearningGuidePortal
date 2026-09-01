# Basic Components

这些是共享能力，不是独立部署服务：

- `user-authentication`：session、密码、Email verification、OAuth callback 和权限边界。
- `rule-engine`：金额、资格、trial、Entitlement、状态转换等确定性规则。
- `process-engine`：跨模块的短事务流程，例如 Checkout 创建和 Webhook 同步。
- `message-queue`：Phase 1 先用 database outbox 处理需要重试的 email/notification，不先部署独立队列。
- `data-management`：PostgreSQL repository、S3、Secrets Manager 和 Data Management 的统一访问入口。
