# 事故复盘：AI Tutor 不可用（2026-10-28）

- 严重级别：P1（AI Tutor 功能对学员完全不可用）
- 影响环境：Admin DEV/SIT、Portal DEV/SIT
- 现象：后台把课程 AI Tutor 设为 **Online** 后，学员端刷新页面仍无 AI Tutor 按钮；同时知识检索恒为空，对话无课程引用
- 状态：代码与配置已修复并验证；两处数据缺口待人工触发
- 复盘时间：2026-10-28

---

## 1. 一句话结论

不是"Online 开关不生效"，而是**按钮的渲染前提一层都没满足**：

```
按钮出现 ⟸ tutorOnline
tutorOnline ⟸ KS /api/user/ai-tutors 返回 available=true
available   = aiTutorOnline && Boolean(currentReleaseId)
```

- **SIT**：用户测试的 `modeling-life` 在 KS 数据库里**根本不存在**（SIT KS 只有 `epicureanism`），开关作用对象不存在。
- **DEV**：Portal 的 `KS_TUTOR_*` 三个变量**全部为空**（`tutorSource=none`），Portal 连 KS 都不会调用；且四门课 `aiTutorOnline` 全为 `false`。
- **检索为空**是独立缺陷：索引在 Prisma 默认 5 秒事务内插入 100 行 1536 维向量，超时回滚，`KnowledgeChunk` 恒为 0。

---

## 2. 影响面

| 场景 | 影响 |
|---|---|
| SIT 学员端 Modeling life | 无 AI Tutor 按钮，无法使用 |
| SIT 学员端 Epicureanism | 按钮可见，但**检索为空**、回答无课程引用 |
| DEV 学员端全部课程 | 无按钮（Portal 未接 KS） |
| Admin 后台 AI Tutor 面板 | 可对话出字，但知识库检索为空，给人"能用"的错觉 |

业务影响：AI Tutor 是产品核心卖点之一，当前处于"界面显示正常、实际降级"的静默失效状态，验收无法通过。

---

## 3. 时间线（UTC+8）

| 时间 | 事件 | 证据 |
|---|---|---|
| 10-26 16:04 | SIT 发布 Epicureanism，索引失败：`Embedding 上游返回 401`（当时 Admin 未配 Key） | Admin SIT 日志 |
| 10-26 18:49 / 22:38 | DEV 索引失败：`未配置 OPENROUTER_API_KEY` | Admin DEV 日志 |
| 10-26 23:57 | 为 Admin DEV/SIT 补 `AUTH_ENABLED`、`AUTH_TOKEN`、`OPENROUTER_*`、`AI_CONFIG_ENCRYPTION_KEY` | `update-service` |
| 10-27 00:5x | 发现 OpenRouter Key 已过期（`API key expired`），五个服务共用同一把 | OpenRouter `/api/v1/key` |
| 10-27 00:56 | 轮换 Key，Admin/Portal 重部署，`chat-stream` 200 正常出字 | SSE 响应 |
| 10-27 10:18–15:18 | 多次索引成功（10/12/29/129 chunks） | Admin DEV 日志 |
| **10-27 16:0x** | **为 Portal DEV 设置 `KS_TUTOR_BASE_URL` / `KS_TUTOR_API_KEY`，验证 `chat-stream` 200 后报告"已配置"** | `update-service` |
| 10-28 04:56 | Modeling life（74k 字符）索引失败：**Prisma 事务 5s 超时** | `Transaction already closed … 5134 ms` |
| 10-28 15:43 | 用户报"检索全空"，用临时 VPC Lambda 直连两库取证 | 见 §6 |
| 10-28 15:51 | 提交 RAG 修复 `c7c54c0` | 2 文件 |
| 10-28 16:19 | 修复生效后新发布：**157 chunks / 9763 ms** 成功 | Admin DEV 日志 |
| 10-28 16:30 | 用户报"后台点 Online 后前端无按钮" | 用户反馈 |
| 10-28 16:40 | 取证：SIT Portal 日志显示访问的是 `/account/learn/modeling-life`；SIT KS 只有 `epicureanism` | Portal access log + `ks/v1/courses` |
| 10-28 16:45 | 取证：DEV Portal `KS_TUTOR_*` 全空、`tutorSource=none`；DEV 全部课程 `aiTutorOnline=false` | `describe-service` + `/api/health/config` |
| 10-28 16:55 | 修复 DEV 配置时 `UPDATE_SERVICE **ROLLBACK_SUCCEEDED**`：实例角色无权读新 Secret | `list-operations` |
| 10-28 17:03 | 补 IAM 策略 `read-learning-guide-dev-ks-tutor`，重放配置 → `SUCCEEDED` | IAM |
| 10-28 17:12 | DEV `/api/health/config` → `tutorSource: ks` | 活体验证 |

---

## 4. 根因分析

### 4.1 症状一：Online 后无按钮（三层静默）

`components/portal/PreviewLessonView.tsx:101` 是唯一入口：

```tsx
...(tutorOnline ? [{ icon: "tutor", title: copy.tutor, action: "tutor" }] : []),
```

`tutorOnline` 来自 `services/ksTutorClient.ts → getTutorAvailability(course.slug)`：

```ts
if (!baseUrl) return { online: false, reachable: false };
...
if (!response.ok) return { online: false, reachable: false };
...
catch { return { online: false, reachable: false }; }
```

KS 侧 `ai-config.service.ts:324`：

```ts
available: course.aiTutorOnline && Boolean(course.currentReleaseId)
```

| 层 | SIT 实际 | DEV 实际 |
|---|---|---|
| 数据 | KS 无 `modeling-life` 行 → 找不到 → false | 有课程，但当前 Live release 的 chunk 为 0（不影响 available），`aiTutorOnline=false` |
| 配置 | 正常（`tutorSource=ks`） | **`KS_TUTOR_*` 全空 → 直接返回 offline，从不请求 KS** |
| 业务开关 | Epicureanism 已开 | 四门课全关 |

三个原因中任意一个成立，按钮就不出现，且**前端表现完全相同**。

### 4.2 症状二：检索恒为空

`server/src/knowledge/indexing.service.ts` 在 Prisma 交互式事务里批量插入：

```ts
await this.prisma.$transaction(async (tx) => {
  await tx.knowledgeChunk.deleteMany({ where: { releaseId } });
  const batchSize = 100;          // 100 行 × 1536 维 = 巨量 SQL 文本
  ...
});
```

Prisma 默认事务超时 **5000ms**。Modeling life 有 74k 字符 / 171 个标题，插入必然超时，整个事务回滚 → `KnowledgeChunk` 为 0 → `retrieveChunks` 返回空数组 → `buildContext` 返回空串 → 模型退化为无引用的通用回答，**不报错**。

叠加因素：

- 索引只有一个入口（发布时触发）。失败后该 Release 永久 0 chunk，无重试、无自愈、无告警。
- 错误日志丢信息：Prisma 的 message 以换行开头，`catch` 只记录 `err.message`，日志里只剩一行空白（`索引失败：`）。
- 早期失败原因不同：先是没配 Key，再是 Key 过期（401），最后才是超时。三个原因混在同一条日志格式里，难以区分。

### 4.3 为什么排查困难（本次最该改的地方）

1. **Portal 全量吞异常**：KS 挂了、鉴权错、超时、课程不存在，前端都是"没有按钮"，无任何区分。
2. **Admin 无访问日志**：`learning-guide-admin-*` 只有 Nest 启动日志与异常日志，无法证明"Portal 到底有没有来查过"。
3. **配置会被并发覆盖**：10-27 设置成功的 `KS_TUTOR_*`，10-28 已消失。
4. **Secret 与 IAM 分离**：写入 `RuntimeEnvironmentSecrets` 后若角色无权读取，`update-service` 静默 `ROLLBACK_SUCCEEDED`，不打印原因。

---

## 5. 定责

### 5.1 直接责任：本会话 AI Agent（我）

| 事项 | 具体行为 | 后果 | 严重度 |
|---|---|---|---|
| 报告"已配置"但未端到端验证 | 10-27 只验证 KS 的 `chat-stream` 返回 200，未验证 Portal 页面按钮是否出现 | 用户按"已完成"复测失败，浪费一天 | 高 |
| 配置被覆盖后未复查 | 10-27 设置 `KS_TUTOR_*` 后未做任何持续校验，10-28 已为空 | DEV 侧直接原因 | 高 |
| 未校验 `OperationStatus` | 修复 DEV 时首次 `update-service` 返回 `ROLLBACK_SUCCEEDED`，我未检查状态即认为成功 | 多轮无效重试 | 高 |
| 对"Online 开关"语义理解不到位 | 未在设计/验收时明确 `available = online && currentReleaseId`，也未提示用户"KS 里没有这门课" | 用户误以为是前端 bug | 中 |
| 索引失败无兜底 | 10-26/10-27 多次看到 `索引失败` 日志，只修了当时的原因（Key），未追问"失败后如何恢复" | 0 chunk 状态持续存在 | 高 |
| 单测通过即宣称修复 | RAG 修复后只验证了"新发布成功"，未回填历史 Release 的向量 | 检索仍为空 | 中 |

### 5.2 代码责任人（历史提交）

| 问题 | 位置 | 性质 |
|---|---|---|
| 索引插入使用默认 5s 事务、100 行/批 | `knowledge/indexing.service.ts` | 代码缺陷（本次 P0） |
| 索引失败只记日志，无重试/自愈/告警 | `indexing.service.ts` + `releases.service.ts` | 设计缺陷 |
| `catch` 只记录 `err.message`，Prisma 错误首行为空 → 日志全空 | `indexing.service.ts` | 可观测性缺陷 |
| `Set Live` 不校验目标 Release 是否有向量 | `releases.service.ts` | 设计缺陷 |
| `getTutorAvailability` 所有异常统一降级 offline | `services/ksTutorClient.ts` | 可观测性缺陷 |
| Admin 服务无访问日志中间件 | `server/src/main.ts` | 可观测性缺陷 |
| `available` 语义未在 UI 说明（缺"未同步/无 Live/未 Online"三态） | Admin AI Tutor 面板 | 产品缺陷 |

### 5.3 配置责任

| 项 | 现状 | 建议 |
|---|---|---|
| SIT KS 只有 `epicureanism`，缺 `modeling-life` | 未修复 | Portal→KS 同步 + 发布 + Set Live |
| DEV Portal `KS_TUTOR_*` 被清空 | 已修复（`tutorSource=ks`） | 加强配置漂移检测 |
| DEV 全部课程 `aiTutorOnline=false` | 未修复 | 逐门开启 |
| OpenRouter Key 五环境共用一把 | 已轮换，仍共用 | 每环境独立 Key |
| DEV 实例角色无权读 `ks_tutor_api_key` | 已补策略 | 建 Secret 时同步授权 |

### 5.4 外部依赖（非内部责任）

| 项 | 事实 |
|---|---|
| OpenRouter Key 过期 | `API key expired`，需人工轮换；旧 Key 曾导致 401 |
| OpenRouter 可用性 | 本次未出现上游故障 |

---

## 6. 取证（可复现）

```bash
# 1. SIT KS 到底有哪些课程（决定性证据）
curl -sS -H "Authorization: Bearer $SIT_ADMIN_AUTH_TOKEN" \
  https://admin.sit.ilovelearningguide.com/api/ks/v1/courses | jq '.data[].externalId'
# → ["epicureanism"]        用户测试的 modeling-life 不存在

# 2. 各课程的 online / currentRelease
# → SIT: epicureanism online=true  current=59c37bc0…
# → DEV: 四门课全部 online=false

# 3. Portal 是否真的接了 KS
curl -sS https://www.ilovelearningguide.com/api/health/config | jq '.studyGroup.tutorSource'
# → 修复前 "none"；修复后 "ks"

# 4. 学员端访问了哪门课
aws logs filter-log-events \
  --log-group-name /aws/apprunner/learning-guide-sit/<id>/application \
  --filter-pattern account --max-items 40
# → GET /en-GB/account/learn/modeling-life 200（14:40–16:31 反复刷新）

# 5. 向量是否为空（临时 VPC Lambda 只读查询，已删除）
SELECT count(*) FROM "KnowledgeChunk";                                   -- SIT: 0
SELECT co."externalId",
       (SELECT count(*) FROM "KnowledgeChunk" k
        WHERE k."releaseId" = co."currentReleaseId") AS chunks
FROM "Course" co;                                                        -- DEV: modeling-life 0

# 6. pgvector 与查询本身正常（用已索引 Release 自相似检索）
-- score: 1, 0.75, 0.71, 0.70, 0.56, 0.56；39 条 > 0.35 阈值

# 7. 修复后成功样本
#   Release efdeedf2… 索引完成：157 chunks，耗时 9763ms
```

---

## 7. 修复与验证

| 修复 | 位置 | 验证 |
|---|---|---|
| 索引事务超时 5s → 120s，批量 100 → 20 | `c7c54c0` → `sit:8be8c1f`、`dev:55333c5` | 新发布 `157 chunks / 9763ms` 成功 |
| 索引失败记录完整错误（含 stack，折叠空白） | 同上 | 后续失败日志可读 |
| `Set Live` 时若目标 Release 无 chunk 则自动重建索引 | `releases.service.ts` | 代码审阅 + 待人工触发验证 |
| 恢复 DEV Portal `KS_TUTOR_BASE_URL` / `KS_TUTOR_API_KEY` / 超时 | App Runner env + Secret | `/api/health/config` → `tutorSource: ks` |
| 授权 DEV 实例角色读 `learning-guide/dev/ks_tutor_api_key` | IAM `read-learning-guide-dev-ks-tutor` | `UPDATE_SERVICE SUCCEEDED`、`RUNNING` |

---

## 8. 未完成项

| 项 | 阻塞原因 | 下一步 |
|---|---|---|
| SIT KS 缺 `modeling-life` | 需业务操作 | Admin Knowledge → 从 Portal 同步课程 → 发布 Release → Set Live → 开 Online |
| SIT `59c37bc0` / DEV `ad8f1395` 向量为 0 | 需员工会话 | 在 Releases 页对 Live 版本点 **Set Live**（会触发自愈索引） |
| DEV 全部课程 `aiTutorOnline=false` | 需业务操作 | AI Tutor 面板逐门开启 |
| 索引失败告警 / 0-chunk 告警 | 未实现 | CloudWatch 指标 + 告警 |
| Admin 访问日志 | 未实现 | 加中间件 |

---

## 9. 改进行动项

| # | 行动 | 类型 | 优先级 |
|---|---|---|---|
| A1 | Admin AI Tutor 面板显示三态：`未同步到 KS` / `无 Live 版本` / `未 Online`，并禁用无意义的开关 | 功能 | P0 |
| A2 | `getTutorAvailability` 失败时记录结构化日志（course、reason：no-base-url / http-status / timeout / not-found） | 可观测 | P0 |
| A3 | `/api/health/config` 暴露 KS 明细（base url 是否配置、最近一次探测结果） | 可观测 | P0 |
| A4 | Admin 服务增加访问日志（method/path/status/duration） | 可观测 | P0 |
| A5 | 索引失败、live Release 0 chunk、`aiTutorOnline=true 但 available=false` 三类接入告警 | 可观测 | P0 |
| A6 | 配置写入后必须校验 `OperationStatus == SUCCEEDED`；`ROLLBACK_SUCCEEDED` 视为失败并打印 `OperationSummary` | 流程 | P0 |
| A7 | 建 Secret 到 `RuntimeEnvironmentSecrets` 时，同步给目标实例角色授权，写入部署脚本 | 流程 | P0 |
| A8 | 提供 `POST /api/admin/releases/:id/reindex`（员工权限），可批量回填历史 Release | 功能 | P1 |
| A9 | 增加大文本（>100 chunks）RAG 回归测试夹具 | 测试 | P1 |
| A10 | 每环境独立 OpenRouter Key，全部入 Secrets Manager | 安全 | P2 |
| A11 | 每日巡检：`KS_TUTOR_*` 存在性、各课程 `available` 语义一致性、Live Release chunk 数 | 可观测 | P1 |

---

## 10. 给 AI Agent 的硬性约束（建议写入 AGENTS.md）

1. 跨服务链路（Portal → KS → 前端渲染）必须**端到端验证**，不得以单一接口 200 代表功能可用。
2. "已修复"只能用于已有活体验证（真实请求 + 日志/数据）的结论；否则必须写"已改代码，待验证"。
3. 配置类变更必须校验 `OperationStatus == SUCCEEDED`；`ROLLBACK_SUCCEEDED` 视为失败。
4. 配置写入成功后，必须在**下一次回复同一问题前重新读取一次**，确认未被并发覆盖。
5. 看到"失败只记日志"的代码路径，必须追问"失败后如何恢复"，不能只修当时的原因。
6. 声称某功能需要 GUI 操作才能完成时，必须同时给出可验证的判定命令（本次为 `ks/v1/courses` 与 `/api/health/config`）。
