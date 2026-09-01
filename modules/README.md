# Business Function 模块

每个目录对应原架构图中的一个 Business Function。模块内部可以有 `domain.ts`、`repository.ts`、`services/` 和 `__tests__/`；模块之间不能直接读取对方的表。

```text
portal
user-registration
course-management
purchase
subscription-management
payment-management
order-management
my-learning
study
understanding-assessment
ai-tutor
reporting
```

Phase 1 的主链路是：`Course Management -> Portal -> User Registration -> Subscription Management -> Payment Management -> Order Management/Entitlement -> My Learning/Study -> AI Tutor`。
