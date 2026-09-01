# API contracts

所有外部输入和输出先定义 TypeScript 类型和 Zod schema，再实现 service 和页面。统一返回：

```ts
type ApiResult<T> =
  | { ok: true; data: T; requestId: string }
  | { ok: false; code: string; message: string; requestId: string };
```

价格、支付状态、Subscription、Entitlement 和 Course published 状态只能由服务端生成或读取，不能使用浏览器上传的同名字段作为事实。
