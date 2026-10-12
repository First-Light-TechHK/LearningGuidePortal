# Group study 需求对照表（REQ-0078 → REQ-0097）

- 对照来源：需求跟踪矩阵导出 + **PRD 原件**（`docs/phase1/source-prd/Learning_Guide_Study_Group_PRD_v0.10_EN.docx`，2026-10-12 入库，逐句核对）
- 对照对象：upstream `dev` @ `79ee620` + 本轮按 PRD 修复的提交
- 结论：**20 条全部符合**（本轮按 PRD 修复 3 处实现差异）；与跟踪表有 3 处措辞差异，建议同步修表

## 逐条对照

| REQ | 符合 | 实现要点 | 验证 |
|---|---|---|---|
| 0078 首页与发现 | ✅ | My（已加入/主持）与 Discover（排除已加入/主持）；Live 徽标 = 有任一进行中会话（BR-006） | service（分区 + **徽标行为新增测试**）；ui |
| 0079 创建 | ✅ | 三字段必填；下拉仅有效权限课程（BR-003）；创建者即 Host | service/api |
| 0080 发现 | ✅ | 无权限可看基本信息；已加入/主持不重复出现 | service |
| 0081 权限控制 | ✅ | Join 需权限；非成员看不到 Live Sessions；无权限页入口=**View Course**（进入课程→订阅/购买路径；界面文字非字面 "Get Course Access"） | api（hides until join）；手工 |
| 0082 Join/Leave | ✅ | 免审批；Leave 取消未来报名与提醒（派发时按意向过滤） | service + **离开→提醒端到端新增测试** |
| 0083 Host 管理 | ✅ | 标题/简介可改、课程锁定；取消组=不可访问+未来场次取消+通知成员+完成数据保留（BR-011） | service |
| 0084 Members | ✅ | 不限成员；右侧总数+可滚动列表+Host 标识（BR-009） | ui/CSS |
| 0085 Schedule | ✅ | 全字段就位；Related Lesson 可选且不影响使用（BR-013） | service/手工 |
| 0086 人数 2–6 | ✅ | 服务端+界面双重校验；含 Host；并发安全 | service/state-space/PG |
| 0087 生命周期 | ✅ | Scheduled→T-10 Starting Soon→Host Start 才 Live→最后一人离开 Completed（含回调/对账）；**PRD 原文即 T-10 开放进入（BR-015/020、SC-013、7.2、TC-044）**——跟踪表"无论提前多久"与 PRD 不符 | state-space/reconcile/e2e |
| 0088 编辑与取消 | ✅ | 开始前可编辑/取消；开始后拒绝；Cancel 后记录不再出现（BR-017） | service/state-space |
| 0089 Plan | ✅ | 仅意向不占座（BR-018/033）；取消即取消提醒 | state-space/service |
| 0090 Entry | ✅ | 已加入+权限即可进；不要求 Plan；满员拦截（BR-021）。进入窗口同 0087=PRD 原文 | service/api/PG 并发 |
| 0091 完成历史 | ✅ | 只读；实际参与人（头像+查看全部弹窗）；不能 Start/Edit/Cancel。**查看名单语义按 PRD 6.6 修正：未开始（含 Starting Soon）=计划名单；Live/Completed=实际名单** | service（含新测试） |
| 0092 基础会议 | ✅ | Mic/Camera/Share/Participants/Chat/Raise Hand/Leave 全员一致；Host 仅标签（BR-024） | ui/e2e |
| 0093 Raise Hand | ✅ | 数据消息 + 名单/画面标识；无审批、不改麦克风（BR-025） | ui（源码+纯函数钉） |
| 0094 Screen Share | ✅ | 任意参与者；共享为主显示区、面板保留；不做 AI 解析（BR-031） | e2e |
| 0095 AI Tutor | ✅ | 默认开、可关；进房者可 @；问答全员可见（BR-014/029） | service/e2e |
| 0096 Grounding | ✅* | 接地检索+材料缺失拒答完整；**理解检查题生成本轮补上**（提示词条款+测试，PRD 6.11/TC-040）；*课程 AI Tutor 配置对齐为架构文档既有 open 项（BR-030/SC-011 partial） | service/新检索测试 |
| 0097 Reminder | ✅ | 受众=Host+已 Plan；站内+邮件；每人每场一次；T-10 窗口（BR-019/TC-049） | service/PG 并发 |

## 与需求跟踪表（飞书表）的 3 处措辞差异（建议改表）

1. **REQ-0087/0090"无论提前多久"**：PRD 原文明文"From T-10 / Starting Soon 才可进入等待"（v0.10 更新日志、SC-013、BR-015/020、7.2、6.6、6.9、TC-044 共 7 处）。实现与 PRD 一致，**跟踪表这句应改为"开始前 10 分钟起可进入等待"**。
2. **REQ-0096"如果该 Course 没有配置 AI Tutor，用默认 LLM 回答（Open router Auto）"**：PRD 中不存在此条；PRD 的口径是"必须遵循课程 AI Tutor 配置与课程知识接地"（BR-030/8.4），且"Study Group 不选择独立 Knowledge Release"。**建议删除跟踪表该句**（该口径会导致"无接地即自由作答"，与 PRD 的接地原则相反）。
3. **REQ-0096"以及主动生成的问题"**：PRD 6.11 "Understanding check: AI Tutor may generate a relevant question for the group"——本轮已实现（请求理解检查题时，用课程语境生成一道可答的题；语境不足则拒答）。跟踪表保留此句即可，现已符合。

## 本轮按 PRD 修复的 3 处实现差异（附测试）

1. **查看参与者名单语义（6.6）**：此前 Starting Soon 即显示实际进入者；现改为未开始=计划名单、Live/Completed=实际名单（等待人数仍计入 Currently in session，BR-033 不受影响）。测试：`study-group-service.test.ts` "View attendees shows planners until the Session is live…"。
2. **中文提问检索（TC-042）**：无空格中文整句此前会被当作单一词条、永远检索不到；现按重叠 2 字词条展开 + 中文虚词停用表。测试：`study-group-tutor-retrieval.test.ts`（含"覆盖主题可检索 / 未覆盖主题仍拒答"双向）。
3. **理解检查题生成（6.11/TC-040）**：新增提示词条款（一次一题、必须在课程语境内；语境不足则明说），英文检查类请求不再被虚词误判为"材料缺失"。测试同上文件 + 既有 tutor 套件全绿。

## 检查方式说明

- "service/state-space/ui/e2e/PG" = 已提交上游的自动化测试；"手工" = 测试同事在 DEV 按 test-handover.pdf 步骤验证。
- 需求表签发方：请按上文 3 处措辞差异更新跟踪表；更新后本对照表可作为该 20 条的验收依据。
