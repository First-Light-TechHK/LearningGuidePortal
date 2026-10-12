# 环境配置提案：Study Group 的 LiveKit 供给（给平台 / 技术负责人）

目标：按商业化标准，为 DEV → SIT → UAT → PPE 路径中的每个环境提供 Study Group 配置。执行者不是 SG 开发。SG 开发只负责在 repo 内触发与测试。

范围界定（业主决定）：SG 侧只管 DEV。SIT / UAT / PPE 不在 SG 侧范围内——由平台按本提案自行决定与执行；SG 侧不为这些环境新增或维护 CI 工作流。本文档中涉及它们的部分仅作平台参考。

## 1. 商业化标准（五条）

1. 每环境真实 LiveKit 项目。钥按环境隔离。
2. 钥按消费方拆分。CI 一把、服务一把。吊销互不牵连。
3. 轮换按期执行。已暴露的钥（含曾出现在会话中的 staging 钥）必须实际轮换，不是演练。
4. 配置供给走 CI/CD 通道。可审计、可重复。
5. 生产 fail-closed：preflight 拦截缺配置的 PPE/PROD（已实现）。

## 2. 与代码分层的关系

- SG 代码只依赖两个接口：LiveKit 网关（房间、令牌、数据消息）与令牌日志加密钥。代码不接触具体凭据。
- 钥在 AWS 上自动签发与注入：LiveKit 钥对存入 Secrets Manager，运行时由实例读取（`credentialSecretId`）；令牌日志钥自动生成一次，经 App Runner 注入。人工不选择、不转抄钥值。
- 轮换沿用既有设计（`livekit-operations.md` §Key rotation）：create → inject → overlap → revoke，只存一份、从不回读。
- 零配置环境（配置尚未执行时）：数据功能照常（浏览 / 建组 / 入组 / 排期 / 开始）；直播类操作返回类型化 `unavailable`（HTTP 503）；后台健康面报告 not ready。生产由 preflight 直接阻断。

### 2.1 环境矩阵（本地 / 测试 / 线上，不混淆）

| 环境 | 钥来源 | 值类型 | 谁提供 |
|---|---|---|---|
| 本地开发（开发者机器） | 无配置也可用（数据功能）；要测直播用本地 docker LiveKit 或本地 `.env.local` 自建值 | 本地假值 | 开发者自己 |
| CI 单测 / 集成 | 测试文件内自带假 fixture（如 `wss://livekit.example.test`、`lk-secret-at-least-32-characters`） | 假值 | 不需要任何人提供 |
| CI staging 冒烟 | GitHub `livekit-staging` Environment 密钥（CI 专用消费钥） | 真实（staging 项目） | 平台 |
| DEV（线上） | Secrets Manager `lg-dev-studygroup-livekit` / `lg-dev-studygroup-token-log-key` | 真实（DEV 项目） | 平台 / 开通工作流 |
| SIT / UAT / PPE（线上） | 同上，按环境命名 | 真实（各环境项目） | 平台 / 开通工作流 |

规则：文档、代码示例、测试一律只用假值。真实值只存在于 AWS Secrets Manager（和 CI 专用的 GitHub Environment，按 §8 与 Secrets Manager 同步轮换）。repo、聊天、日志、浏览器永远不含真实值。本地临时脚本与探针放 `/tmp`，不进 repo 工作区。

## 3. 角色分工

| 角色 | 职责 |
|---|---|
| SG 开发 | 触发工作流。跑环境测试。不动 AWS |
| 平台 / 技术负责人 | LiveKit 项目与钥。AWS 密钥。IAM。轮换 |
| CI（GitHub Actions） | 持有 AWS 部署凭据（GitHub 仓库密钥）。执行开通步骤 |

## 4. 各环境计划

| 环境 | LiveKit 项目 | 状态 |
|---|---|---|
| DEV | 新建 `learning-guide-dev` | 代码已零配置可用（数据功能 200、直播操作 503）；真实钥待平台执行 |
| SIT | 新建 `learning-guide-sit` | 待平台执行 |
| UAT | 新建 `learning-guide-uat` | 待平台执行 |
| PPE/PROD | 新建生产项目 | 待平台执行 |

密钥命名：`lg-<env>-studygroup-livekit`（存 apiKey/apiSecret）、`lg-<env>-studygroup-token-log-key`（存 token 加密钥）、`lg-<env>-studygroup-tutor-keys`（存 AI Tutor 钥池 JSON，`[{"id","secret"}]`）。每环境三条，互不复用。三条都是真凭据，都只存 Secrets Manager；普通环境变量会被 `describe-service` 明文回显，禁止把任何钥值放进普通变量。
令牌日志钥由工作流自动签发（`openssl rand -base64 32`，首次创建；已存在则不覆盖）。LiveKit 钥对来自 LiveKit 控制台（平台建项目时创建），**一次性写入 Secrets Manager，此后只存这一处**——不再复制到 GitHub 或 repo。
工作流读取的仓库变量（非密）：`LIVEKIT_DEV_PROJECT_URL`（DEV 项目的 wss 网址，必填）、`LIVEKIT_DEV_PROJECT_ID`（可选，默认 `dev-primary`）。

## 5. 执行载体：repo 工作流

工作流草稿已按业主决定暂缓提交（先等等）。开通按下面的步骤执行：由平台手工完成，或在工作流经平台审过后落地复用。SIT/UAT/PPE 用同一套步骤（换环境名）。步骤：

1. 读仓库坐标表（非密）：每环境的 App Runner ARN、站点域名、密钥名、项目 id/网址。
2. 校验该环境已开通。未开通：立即失败。
3. 校验 `lg-<env>-studygroup-livekit` 与 `lg-<env>-studygroup-tutor-keys` 已存在于 Secrets Manager（平台各写入一次；值分别来自 LiveKit 控制台与 OpenRouter 控制台）。缺失：立即失败，并打印平台侧的一次性写入命令（值不经过 repo / 聊天 / GitHub）。
4. 令牌日志钥自动签发：不存在则以 `openssl rand -base64 32` 生成并写入 `lg-<env>-studygroup-token-log-key`；已存在则保持原值（不覆盖，旧日志行仍以旧钥版本解密）。
5. 合并进 App Runner 服务：`LIVEKIT_PROJECTS_JSON` 进普通变量；`STUDY_GROUP_TOKEN_LOG_KEY` 与 `STUDY_GROUP_TUTOR_KEYS` 进 `RuntimeEnvironmentSecrets`（引用密钥完整 ARN）。代码读的是同名环境变量，自身零改动。
6. 等部署完成。验证：`/api/health/config` 的 `studyGroup.configured` 为 true，且匿名 `GET /api/study-groups?view=discover` 返回 200（后者才证明配置可解析）。

未配置期间的已知行为（代码已固化，测试见 §9.4）：数据功能可用；直播操作 503；每个进程启动时打一行脱敏 `study_group.livekit_health`（`configured:false`），供 CloudWatch 报警。若会话在未配置时开始：房间在首次加入时由 LiveKit 按默认容量自动创建（应用侧席位上限仍生效），项目分配在第一次发令牌时自动补齐并持久化；补齐前对账可能每 5 分钟记录一条脱敏 `credential_unavailable` 事件（噪音，不是数据损坏）。

## 6. App Runner 机制笔记（实现者必读）

1. `describe-service` 会返回现有普通环境变量的**值**。输出只能进文件，禁止 echo / cat / set -x。
2. `update-service` 用你给它的 SourceConfiguration **整体替换**。必须先 describe 再合并回传。
3. `--cli-input-json` 只接受这些顶层键：`ServiceArn`、`SourceConfiguration`、`InstanceConfiguration`、`AutoScalingConfigurationArn`、`HealthCheckConfiguration`、`NetworkConfiguration`、`ObservabilityConfiguration`。其他键（含 `EncryptionConfiguration`）会被拒。
4. `AutoScalingConfigurationArn` 在 describe 输出的 `Service.AutoScalingConfigurationSummary` 下。
5. `RuntimeEnvironmentSecrets` 的值必须是 Secrets Manager 的**完整 ARN**（含随机后缀）。用 `--query ARN --output text` 取。
6. 离线校验技巧：`--endpoint-url http://127.0.0.1:9` 能跑完整客户端模型校验且触不到 AWS。可用于测试。
7. `configured: true` 只说明变量存在，不说明可解析。终验必须打匿名 discover API。

## 7. 需要的 AWS 权限（平台授予）

1. 执行工作流的 IAM 用户/角色：`apprunner:DescribeService`、`apprunner:UpdateService`、`secretsmanager:CreateSecret`、`secretsmanager:PutSecretValue`、`secretsmanager:DescribeSecret`。
2. App Runner **实例角色**：`secretsmanager:GetSecretValue`，覆盖全部三条密钥（启动注入 + 运行时读取）。

## 8. 轮换与已暴露钥处置

1. **LiveKit 钥对**：按 `livekit-operations.md` §Key rotation 执行 create → inject → overlap → revoke。写入 Secrets Manager 新版本即可——应用在运行时按 `credentialSecretId` 读取，**不需要改 App Runner 配置**；重叠期 ≥ 最大 token TTL（600 秒）+ 回滚窗口；监控鉴权失败后再吊销旧钥。每次轮换后跑一次冒烟。
2. **令牌日志钥**：轮换 = 生成新值写入 Secrets Manager 新版本 → 重新执行开通步骤（触发滚动重启把新值注入实例）→ 旧日志行以旧钥版本离线解密。已泄露的钥必须实际换掉。
3. **AI Tutor 钥池**：轮换 = 更新 `lg-<env>-studygroup-tutor-keys` 新版本（可整池或逐把）→ 重新部署（注入发生在实例启动）。池内的失败切换逻辑不变。
4. **staging 钥：实际轮换**（已暴露过）。步骤：LiveKit 控制台建新钥（命名 `ci-smoke`）→ 更新 GitHub `livekit-staging` 环境密钥（CI 冒烟专用副本，与 Secrets Manager 同步更新，避免漂移）→ 跑冒烟工作流确认绿 → 吊销旧钥 → 记录证据（项目 id、时间、操作人）。
5. SIT/UAT/PPE 首配即用各自的新钥。无历史包袱。

## 9. 验收

1. 每个已开通环境的 `configured` 为 true，且匿名 discover 200。
2. 轮换记录齐备。
3. 生产 preflight 在缺配置时阻断（已有测试）。
4. 零配置环境页面可用：数据功能 200、直播操作返回类型化 503——由 `tests/unit/study-group-livekit-degradation.test.ts` 固化；令牌日志钥先于签名解析（缺钥不签名、不写日志、保留席位）由 `tests/unit/study-group-service.test.ts` 固化。
