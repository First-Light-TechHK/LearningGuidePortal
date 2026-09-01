# Database migrations

Migration 按数字顺序执行。每次变更都要有唯一约束、回滚说明和 integration test。当前计划顺序见 `docs/phase1/domain-model.md`：User/Account → Course → Plan/Price → Order/Payment → Subscription/Entitlement → Study → Notification/Audit → KS links。

本地可以使用 Docker PostgreSQL；DEV、SIT、UAT、PPE/PROD 使用各自的 RDS 数据，不共享生产数据。不要在 Route Handler 中直接写 SQL。
