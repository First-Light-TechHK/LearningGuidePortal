# Overlay / Forge 已知问题与待定意图

单一登记处。[`overlay-forge-brief.md`](./overlay-forge-brief.md) 只写「现在是什么」；这里写「哪里不对、证据、谁定、状态」。修掉一条就把状态改成「已修 (#PR)」，不要删行。

编号 `OF-nn`。状态：**待定意图**（要 Oliver 拍板）/ **待修** / **已修** / **不修**（写原因）。

基线（2026-09-14）：Learning Guide `origin/dev` `5ae17e9`（pin `forge-check.yml` → `forge-v1.1.3`）；`origin/main` `8bac302`（随后一条 promote）。官方针 `overlay-v2.0.0` / `forge-v1.1.3`（git tag @ `9071fa1`）。GitHub Release 页已补齐；Latest 徽章仍可能是 `forge-v1.0.0`（`make_latest=false`）。两仓 Ruleset 均为 0。Oliver：leftover **应该一起**——先打 `dev`，合完再一条 promote。#17+#18 并行是反例。

---

## A. 使用问题（Learning Guide 侧）

### OF-01 Cloud Agent 没有 `FORGE_SUBMIT_TOKEN`，`forge submit` 用不了 — 待定意图

- 现象：`python -m forge submit --dry-run` 缺 `FORGE_SUBMIT_TOKEN` 就退出 2（fail-closed，见工具仓 `docs/submit-credential.md`）。本仓 Cloud Agent 环境里没有这个变量（`env | grep FORGE` 为空）。
- 后果：#4 / #5 / #6 / #7 全部走 host 的 PR 工具（cursor[bot]），Forge 在本仓实际只有 `check` 一道。文档里「同意后默认跑 `check` / `submit`」不成立。
- 选项：(a) Oliver 在 Cloud Agent 环境加 fine-grained PAT（只对 fork：contents:write + pull_requests:write）作 `FORGE_SUBMIT_TOKEN`，`submit` 成真；(b) 承认 host PR 路径就是落地，Forge 定位改成「`check` 门禁」，文档改口。
- 已做：brief §11 已注明当前只有 `check`。
- 2026-09-11 仍待 Oliver：把 `FORGE_SUBMIT_TOKEN` 配成环境密钥（agent 永不粘贴）。`forge promote` 同一把钥匙。
- 2026-09-14：对话里给过一把 PAT，要求直接用来开 fork PR。核过：身份是 `First-Light-TechHK`，对源仓 `First-Light-TechHK/LearningGuidePortal` 是 admin，对 fork `LibertychaserUS/LearningGuidePortal` 和 `LibertychaserUS/AIOps` 只有 pull、没有 push。不能当 `FORGE_SUBMIT_TOKEN`（那把钥匙必须是 **fork** 的 `contents:write` + `pull_requests:write`，配成环境密钥，不要贴进对话）。agent 不用这把钥匙打源仓、不 `apply`。这把钥匙已出现在对话里，应立刻作废轮换。同日 Oliver 明示「你来直接合入」后，#17 / #18 由 host `cursor[bot]` 合入，不是这把 PAT。

### OF-02 CI 钉 `overlay-v1.0.0`，本地钉 `overlay-v1.0.1` — 已修（本 PR：CI pin overlay-v2.0.0 / forge-v1.1.2）

- 现象：`.github/workflows/overlay-check.yml` checkout `overlay-v1.0.0`；AGENTS / brief / skills 全写 1.0.1。
- 事实：两 tag 之间 `overlay/` 代码只差 `__version__`，行为相同；差别在 `forge/`（release、sop_lock、submit base 校验）和工作流。
- 阻塞：`overlay-check.yml` 在 `deny_paths`，agent 不能改。
- 选项：Oliver 自己提交换到 1.0.1；或明确「CI 钉 1.0.0 不动，直到 1.0.2」。
- 2026-09-11 已修（本 PR）：CI pin 为 `overlay-v2.0.0` / `forge-v1.1.2`。

### OF-03 密钥和产物在 pod 之间丢 — 待修（Oliver 一次操作）

- 现象：deploy key `cursor-cloud-aiops-deploy-2e0c` 17:46 推成功；19:25 前 `~/.ssh` 与 `~/.local/share/lg-secrets` 被清空，`/tmp` 却保留。`/opt/cursor/artifacts` 上传后本地清空。后到的 worker 找不到私钥，只能再造 `448c`。
- 根因：Cloud Agent 磁盘不是持久层。任何只放在 pod 上的私钥都是一次性的。
- 修法：把 `448c` 私钥存成环境密钥（#7 正文建议名 `AIOPS_DEPLOY_SSH_KEY`），或走 APPLY.md Path B（Environment 挂 `LibertychaserUS/AIOps` + contents:write，之后 cursor[bot] 直接可推，不再需要 deploy key）。Path B 更干净。
- 不做：不再造第三把 key。

### OF-04 「把 AIOps 补丁存进 Learning Guide 仓再 `git am`」是权限缺失的绕路 — 待定意图

- 现象：`docs/phase1/aiops-release/000*.patch` + `land-docs-pin.sh` 存在的唯一原因是 agent 推不了 AIOps。0001–0008 现已全部在 AIOps `main`。
- 风险：两仓真相分裂；补丁在 LG 里会过期（0001 已对当前 AIOps main `git am` 失败，见 OF-05）；产品仓 PR 被 AIOps 内容污染（PR #5 的教训）。
- 选项：OF-03 解决后退役 lander，只留 APPLY.md 作历史记录；AIOps 改动直接在 AIOps 开分支 + PR。

### OF-05 lander 对当前 AIOps main 不可重入 — 已修（本 PR）

- 现象：`bash docs/phase1/aiops-release/land-docs-pin.sh --dir /tmp/x`（不 push）对 AIOps `main`（`075341a`）执行：`Patch failed at 0001`，退出 2。原因是 0001–0006 已在 main，脚本无条件 `git am` 全部 `000*.patch`。
- 修法：按 `git mailinfo` 取 Subject，与 `origin/main` 已有提交比对后跳过；`LAST_VERIFIED_MAIN` 更新到 `075341a`。若采纳 OF-04 退役，则只改 APPLY.md 说明。
- 2026-09-11 已修（本 PR）：lander 退役为历史；APPLY.md 写明新针 `overlay-v2.0.0` / `forge-v1.1.2` 与 dev → promote。

### OF-06 文档互相打架 — 已修（#7 + 本 PR；由 `tests/unit/overlay-forge-contract.test.ts` 锁定）

- #7 修：套件 draft → armed、`default_ref`、Release 404 改 `/tree/`、`selected=0`。
- 本 PR 修：AGENTS L43 与 brief L471 的「reusable `uses:` + wrapper」（main 从 #4 起是单 job inline）；`dev-pr` L28 的「login / payment 是 draft」；brief §11 补 `release` 子命令与 `submit` 现状；brief 补 `--branch main` 真实语义（见 OF-11）。
- 2026-09-11：由 `tests/unit/overlay-forge-contract.test.ts` 锁定入口文档与树一致。

---

## B. Learning Guide 合作链路

### OF-07 fork `main` 与源仓 First-Light `main` 分叉 — 待定意图

- 对象是 **LG 源仓** `First-Light-TechHK/LearningGuidePortal`（remote `upstream`），不是 AIOps。
- 事实（2026-09-15 复查）：`git rev-list --left-right --count origin/main...upstream/main` = **36 领先 / 13 落后**，merge-base 仍是 `006536f`。源仓尖 `ec9e129`。回灌谁开、多久一次仍按 §F 暂缓。
- **Overlay 层：源仓比 fork 旧，没有可搬叶子。** 他们只有 login / payment / portal / my-learning 四套，仍是 `status: armed` + `reviewed_by` / `armed_reason`，`overlay.yaml` 仍 `never_red_statuses: [draft, blocked]`，CI pin `overlay-v1.0.0`。fork 已有这四套的超集（另加 `order` / `visitor-trial`）、`overlay-suite/v2` + `active`、更厚的 `cases.md` / `tests/io`、`INV-expired-no-learn`。9-14 两个产品提交（`7f42330` / `ec9e129`）**没改** `inbox/` `suites/` `overlay.yaml`。把源仓 Overlay 合进来会删叶子、退回 v1 词汇。**不要 merge / cherry-pick 那 11 个 CI 提交，不要抄他们的 `overlay-check.yml`。**
- **2026-09-15 Oliver：合进源仓 Overlay 会减弱本仓开发，不收。** 本仓已经是更新后的 Overlay（v2 / 六套 / 厚 I/O）。
- **产品层不是本 fork 的开发范围。** 密码重置、订阅展示、微信绑邮箱由源仓做。本仓不移植、不代写。
- **回灌方向（2026-09-15）：** 只把 **Forge + Overlay + 更多测试** 推到 LG 源仓。不 `git merge` 产品树。源仓没有 `dev`，第一次 `forge.yaml` 只保护 `main`。他们的 `overlay-check.yml` 必须升到 `overlay-v2.0.0` 才能吃 v2 套件。agent 不直推 `First-Light-TechHK`；在 fork 上从 `upstream/main` 开回灌枝，PR 由 Oliver 打源仓。
- **回灌枝：** `cursor/lg-upstream-of-9bdf` @ `1890b8f` 已快进 `First-Light-TechHK/LearningGuidePortal` `main`（`ec9e129..1890b8f`）。**2026-09-15 Oliver：源仓未 apply，不开 PR，授权直合。** agent 不 live-apply、不发新针、不把 PAT 写入仓库。Ruleset 仍要人对本仓 `forge.yaml` `apply`。
- **黑盒 I/O 是规格，一般来说肯定是对的。** 规格叶子是权威。产品对不上是产品红，不改测试、不改 cases。AUTH-01 / AUTH-02 叶子两边相同。本仓测试绿。源仓 `ec9e129` 上同一条测试红：`check-email` 回 `{ exists: true|false }`；无邮件时 reset 回 **503** `email_unavailable`。这是产品漏枚举 / 把邮件未配置暴露给客户端，不是测试写错。PAY-10 / TRIAL-02 同类：取消后再 complete、已购后再 trial 必须 400。回灌不改这些规格，不改他们的产品代码。他们要绿，自己改产品。
- **回灌包：** 升针 + 迁 `armed`→`active` + 规格叶子 / 已有 I/O + 能在他们路由签名下编译的额外测试。不整棵替换成 fork 的 `login.test.ts`（他们 `GET()` 无 request 参数；回灌只给 0 参 `GET` 套 `callRoute`，断言不动）。第一次 `forge.yaml` 不设 `deny_paths`。

### OF-08 AIOps `main` 没有 Ruleset，agent 三次直推 — 待修（Oliver）

- 事实：`878a690`、`b4afc10`、`075341a` 都是 agent 用 deploy key 快进 `main`；无 PR、无人审、无 required checks。AIOps 上 GitHub Rulesets 为 `[]`。
- 与设计相悖：Forge 自己的 SOP 是 `check → submit → 人 + Ruleset 合`。工具仓没吃自己的药。
- 修法：Oliver 以 Ops 身份在 **AIOps**（不是 Learning Guide）跑一次 `forge apply`，`main` 受保护后 deploy key 只能推分支。
- 记录：两次直推（0007/0008 那次）是本会话的指令，不是 worker 自作主张。
- 2026-09-11 仍待 Oliver：`FORGE_GITHUB_TOKEN`；对 fork 的 `dev`+`main` 以及 AIOps 跑 `forge apply`；各已发布 tag 的 GitHub Release 页面各点一次。

### OF-09 1.0.1 tag 由 Cursor Agent 打 — 不修（记录）

- 事实：`overlay-v1.0.1` / `forge-v1.0.1` tagger 是 `Cursor Agent <cursoragent@cursor.com>`，17:51。`docs/release.md` 说 Human/Ops。
- 不 retag（禁止 force-move）。下一个版本走 `release` workflow（workflow_dispatch，人点）。

### OF-10 Dev → Main 设想 vs `forge submit` — 已定做 dev（本 PR）

- 事实：1.0.1 `forge/submit.py` 拒绝 base 不在 `protect` 里（`refusing to submit onto …; base must be protect`）。Oliver 设想的 local → squash 到 Dev → CI 升 Main，要 Dev 也进 `protect`，否则 submit 不开 PR。本仓也没有 `Dev` 分支；DEV/SIT/UAT/PPE 是 App Runner 环境，不是 git 分支。
- 选项：不做 Dev（小改直接 PR 到 main，现状）；或加 `Dev` 进 `protect` 并补 CI 升级流程。
- 2026-09-11 已定（§F + 本 PR）：A 路线，`protect: [dev, main]`；agent PR → `dev`；`forge promote` → `main`。

### OF-11 `reviewed_by` 由 agent 提交写入，人 squash 收下 — 关闭

- 事实：`suites/*/suite.yaml` 的 `reviewed_by: LibertychaserUS` 来自 Cursor Agent 提交（`f0c9973` / `c3aee96`），Oliver 以 #4 squash 合入。
- 处理：规则（agent 不得写 `reviewed_by`）被绕过，但结果由人接受，不回滚。以后靠 OF-12 的拦截。
- 2026-09-11 关闭：`armed` / `reviewed_by` 已从 Overlay v2 删除；人审改走 PR 审批 + CODEOWNERS。

---

## C. Forge / Overlay 本体

### OF-12 `overlay select --branch X` 不是「按 main 上已 armed 的集合」 — 关闭

- 事实：`overlay/select.py` 用 `--branch` 查 `overlay.yaml` 的 `branches.<X>` 策略（`unknown_branch` 就全部丢掉）；套件 `status` 读当前 checkout。CI 在 `pull_request` 上 checkout 的是 PR 树。
- 后果：agent 在 PR 分支把 `status` 改 `armed` 并写 `reviewed_by`，该 PR 的 overlay-check 就会跑它；没有任何工具拦截。「agent 不得 arm」只是文字。
- 选项：在 Forge `check` 加一条规则——agent 分支的 diff 若让 `suites/*/suite.yaml` 出现 `status: armed` 或非 null `reviewed_by`，退出 2（与 0008 的 deny_paths 同一机制）；或把 `suites/*/suite.yaml` 直接加进 `deny_paths`（代价：agent 也不能新建 draft 套件）。
- 2026-09-11 关闭：`armed` 已删；agent 分支把套件改成 `blocked` 由 forge-v1.1.x `suite_guard` 拦截。

### OF-13 发布针 1.0.1 没有 deny_paths 执行 — 已修

- 事实：`forge check` 对 deny_paths 报错的提交 `075341a` 只在 AIOps `main`；发布针 `b4afc10` 上 `forge check` 对触碰 `overlay-check.yml` 的 agent 分支仍是 ok。
- 修法：`release` workflow → version `1.0.2` → both。之后 LG 把本地针改 1.0.2。
- 2026-09-11 已修：已发布 `overlay-v2.0.0` / `forge-v1.1.2`；针上有 `deny_paths` + `suite_guard`。

### OF-14 1.0.1 没有 GitHub Release 对象；`forge release` 不核对已有 tag 的 SHA — 已修

- 事实：`gh release list` 只有 1.0.0 两条。README 已改链 `/tree/…`（0007）。`forge/release.py` 只查 `GET /releases/tags/{tag}`，不查 tag 是否存在、是否指向目标 SHA；GitHub 创建 Release 时若 tag 已存在会**忽略** `target_commitish`。
- 后果：`release` workflow 填 `1.0.1` 可以补建 Release（因为 tag 已在 `b4afc10` = main HEAD）；但一般情况下如果 tag 指向别的提交，会静默发出指错 SHA 的 Release。
- 修法：release 前 `GET /git/ref/tags/{tag}`，存在且 peeled SHA ≠ target → 退出 2；存在且相等 → 只补 Release。先写测试。
- 2026-09-11 已修：`forge release` 核 SHA。Release 页面仍需 Oliver 每个 tag 点一次。

### OF-15 reusable `overlay.yml` 不装产品依赖 — 已修

- 事实：工具仓 `.github/workflows/overlay.yml` 的 `run` job 只装 Python；`product_command` 是 node 就跑不起来。Learning Guide 因此在 #4 放弃 reusable，改成 inline（多 `setup-node` + `npm ci`）。
- 后果：README 说「可以 `uses:` reusable」，实际上任何非纯 Python 产品都要自己写 inline。作为标准件这条不成立。
- 选项：reusable 加 `setup_command` 输入；或 README 改口「reusable 只做 validate/select，run 请 inline」。
- 2026-09-11 已修：reusable `overlay.yml` 加 `setup_command`。本仓 overlay-check 仍是 inline（checkout + `npm ci`），形状不换。

### OF-16 `FORBIDDEN_REPOS` 只列源仓，不列 fork — 反转 + 已修

- 事实：`forge/__init__.py` 只有 `first-light-techhk/learningguideportal`。`forge apply` / `release` 对 `LibertychaserUS/LearningGuidePortal` 不拒绝。
- 与文档相悖：本仓所有文档都说「不要 live-apply 到本仓」。
- 选项：加 fork 进列表（1.0.2）；或保持只靠文档。
- 2026-09-11 反转并已修：源码常量改为 `forge.yaml` 的 `forbidden_live_repos`（默认空），因为 fork 要 apply。

### OF-17 workshop 专用检查经 `forge check` 泄进接入方 — 观察

- 事实：`forge check` 在接入方根目录打印 `pr-title skip` / `pr-body skip` / `schema/check.py skip` / `unittest skip`，真正执行的只有 `overlay validate` / `cover` / `sop-lock` /（main 上）`deny_paths`。`sop-lock` 锁的是 workshop 的工作流形状；对接入方是否有意义待审。
- 详细审计（Overlay / Forge 代码质量、第三方接入干跑）另行登记为 OF-18 起。

### OF-18 文档跟踪：docs_sync + STATE + ADR + CHANGELOG（已落地于 AIOps；LG 由 forge-check 执行） — 已修

- 工具仓：ADR 0005、`docs/STATE.md` 由 `forge status --write` 生成、CHANGELOG Keep a Changelog、`docs_sync` 同时在 `forge check` 与 CI。
- Learning Guide：`forge.yaml` 配了 `docs_sync`；CI `forge-check` 跑 `forge check` + `forge status --check-state`。入口文档不再手抄 SHA。

### OF-19 monorepo `--root` 子目录路径 — 已修（forge-v1.1.1）

- `forge check` 在 `--root` 为 git 子目录时，diff 路径相对 `--root`，`deny_paths` 与 `suite_guard` 才对得上。

### OF-20 `docs_sync` 扫 node_modules / 站点根链接 / pin 引用误判 — 已修（1.1.1 / 1.1.2）

- 1.1.1：只扫 git 跟踪且未忽略的 `*.md`；以 `/` 开头的链接视为站点根路径。
- 1.1.2：版本引用必须是已有 tag 的规则只在工作本根执行；接入方引用工具 tag（`overlay-v2.0.0`）不再被自己仓库没有该 tag 判红。

### OF-21 PR 正文与 diff 的对应度、审查时的全局上下文维护 — 规则已记（本 PR）；工具化待做

- 规则（Oliver 2026-09-11 22:23）：云 agent 审 PR 时必须逐条核对正文「做了什么」与实际 diff，对不上不批；同时维护项目全局上下文，尤其是文档（`docs/STATE.md`、本登记表、brief 的 `docs_sync` 表、ADR、工具仓 `CHANGELOG.md`）。开 PR 的 agent 正文必须从 diff 写出。已写进 `AGENTS.md` §PR 审查、`skills/dev-pr` 第 8–9 条、`skills/manage-repo` 第 6 条。
- 机器可判定的一部分已有：`forge check` 的 `docs_sync`（路径表 + 链接 + 版本引用）与 `status --check-state`。
- 待做（Forge 候选，记在工具仓）：`pr-body` 步骤增加「正文提到的文件路径必须在 diff 或树里存在」「diff 触碰 `deny_paths` / `suites/*/suite.yaml` / `forge.yaml` / `overlay.yaml` 时正文必须出现对应路径」两条可判定规则；其余靠审查 agent。
- 和 OF-23 分工：本条锁「正文是否描述了 diff」；OF-23 锁「这一单该装哪一层」。

### OF-22 PR 规格夹具没锁到 push × 空 `PR_TITLE` — 已修（本 PR：pin `forge-v1.1.3`）

- 现象：#12 的 `push` job `forge-check`（run `34669346160`）红：`pr-title FAIL empty PR title`。同 SHA 的 `pull_request` `forge-check`、Verify、overlay-check 全绿。
- 根因：旧夹具只锁「好 `--title` / `--title ""` / 缺 actor」。没锁 `GITHUB_EVENT_NAME`、Actions 把 `github.event.pull_request.title` 写成的空串、以及 `forge check` 在 push 上嵌 pr-title。`forge-v1.1.2` 见空串 `is not None` 就 lint，得到 `empty PR title`。
- 不是修法：空白环境变量当省略（skip）；本仓 `25a3a3c` 在 push 上不设 `PR_TITLE`；把 `deny_paths` 改成 advisory；agent 分支改 `.github/workflows/`；force-move `forge-v1.1.2`。
- 规格（未发布 `forge-1.1.3`）：按事件 × 来源取值。`--title` / `--body`（含显式空串）按参数 lint；非空环境变量按环境 lint；`pull_request` + 空白或未设 → 空规格红；`push` 或 Actions 空串 → lint HEAD 提交第一行；本地无事件且环境未设才 skip。叶子 `FN-forge-pr-title`，invariant `INV-pr-spec-event-states`。
- 工具仓：`LibertychaserUS/AIOps` `dev` 与 `cursor/forge-empty-pr-title-9bdf` 均 `efbc74e`。CHANGELOG 已登记 `## [forge-1.1.3]`。`cursor[bot]` 开不了 AIOps PR（403）。发针走 `release` workflow，不要 force-move `forge-v1.1.2`。
- 本仓本 PR：`forge-check.yml` pin `forge-v1.1.3`。push 上空 `PR_TITLE` 锁提交 subject。升针包走非 agent 前缀（`deny_paths` 只拦 agent 分支）。不 force-move `1.1.2`。

### OF-23 提交内容包按层配对 — 补设计（一开始没写）；待接受；未实现新锁

- 问法：每次提交是不是都要同时交文档、代码、CI workflow？
- 缺口：一开始只实现了 `docs_sync` / `deny_paths` / workflow，没有先定义一单内容包是什么。锁先于设计。
- 设计（提议）：**否，不是三件套。** 包是进保护枝的 squash PR。碰哪一层，同单带那一层的配对物。权威表在 brief §5。工具仓 [ADR 0007](https://github.com/LibertychaserUS/AIOps/blob/dev/docs/adr/0007-content-package-layers.md) 已进 AIOps `origin/dev`（`5354959`），状态仍是**提议**，不是已接受。未 promote 到 AIOps `main`。
- 顺序：先设计 → 人把 0007 / 本条改成已接受 → 再决定要不要加新锁。未接受之前不改 `forge.yaml`、不加 `docs_sync` 行、不改 `.github/workflows/`。
- 已经在跑、先于本设计的锁：`docs_sync`（套件 / 配置 → brief）；`deny_paths`；`status --check-state`。不当成本条已实现。
- 不是修法：把「每个 agent PR 必须改 workflow」写成规则；把升针塞进功能切片（#12 / OF-22）；先加锁再补说明。
- 接受之后才点头的实现：要不要给 `overlay-check.yml` / `forge-check.yml` 加一条 `docs_sync` → brief。STATE 不走这条（`check-state` 已锁一致性）。
- 和 OF-21 分工：OF-21 = 正文 ↔ diff；本条 = 这一单该装哪一层。
- 2026-09-14 Oliver：leftover **应该一起**。正确链是先打 `dev`，合完再一条 `dev` → `main` promote。#17 打 `dev`、#18 同时打 `main` 是权宜，不是设计。本 PR 把这条写进 brief §0 / §5 和 `$dev-pr`。未接受前仍不加新锁。

### OF-24 别人冷启动：错针 / 空根假绿 / Release 仍是 1.0.0 — 部分已修（2026-09-14）

- **已修：** `forge-v1.1.3` @ `9071fa1` 上空根 `check` 退出 2。本仓 CI pin `forge-v1.1.3`。GitHub Release 页已补齐（`overlay-v1.0.1` / `overlay-v2.0.0` / `forge-v1.0.1`…`forge-v1.1.3`）。
- **仍真：** `overlay-v2.0.0` peel 仍是 Forge **1.1.0**（只 checkout Overlay 针 → 空根假绿）。`forge-v1.1.3` **tag 上的** `use-forge` / README 仍写当前针 `1.1.2`（发针时写「发 1.1.3 后再改」）；要读到改口必须看 AIOps `dev`/`main` 上未发的文档提交，或等下一针。GitHub Latest 徽章仍是 `forge-v1.0.0`（`make_latest=false`，不是「页还缺」）。
- 另：`pip install -r requirements.txt` **不会** 装出 `forge` 命令，必须 `PYTHONPATH` + `python3 -m`。两针：Overlay `overlay-v2.0.0`，Forge CLI `forge-v1.1.3`。`gh skill install --pin overlay-v2.0.0 --all` 会装到 Overlay 针上的旧 Forge 文案。
- 不是修法：pin `main`；force-move `1.1.2` / `1.1.3`；agent 改本仓 `.github/workflows/`；接受 OF-23 / ADR 0007；加新 `docs_sync`。
- 本仓本 PR：薄 skill（`dev-pr` / `manage-repo` / `use-overlay` / `design-cases`）改口到 `forge-v1.1.3` / `overlay-v2.0.0`；APPLY 文首不再说「每个 tag 再点一次 Release」；`docs/STATE.md` 用 `forge-v1.1.3` `--write`。

---

## D. 现在还开着的（2026-09-14；源仓 PAT 不能当 fork 钥匙）

已定或已修、不再列在这里：OF-02 / OF-05 / OF-06 / OF-09 / OF-10 / OF-11 / OF-12 / OF-13 / OF-15 / OF-16 / OF-18 / OF-19 / OF-20 / OF-22。见 §E / §F。

本轮先放下（要 **fork** 写钥匙或 Ops 点按钮）：

| 编号 | 一句话 | 何时再做 |
|---|---|---|
| OF-01 | `FORGE_SUBMIT_TOKEN`（fork `contents:write` + `pull_requests:write`） | 配环境密钥；源仓 admin PAT 不算 |
| OF-03 | deploy key 持久化 / Path B | 密钥轮 |
| OF-08 | `forge apply`（LG `dev`+`main` 与 AIOps；现在 Ruleset = 0） | Ops 持 `FORGE_GITHUB_TOKEN`，`--path` 必须是那一仓自己的 `forge.yaml` |
| OF-24 余 | Overlay 针 peel 仍是 Forge 1.1.0；`forge-v1.1.3` tag 文案仍写 1.1.2；Latest 徽章仍是 1.0.0 | 工具仓文档改口（本轮）；不 force-move；不把 Latest 当针 |

本轮可做 / 已开：

| 项 | 状态 |
|---|---|
| [#21](https://github.com/LibertychaserUS/LearningGuidePortal/pull/21) | 已合 `dev`（`e53c382`） |
| [#22](https://github.com/LibertychaserUS/LearningGuidePortal/pull/22) | 已合 `main`（`1d7867d`）；#21 合完后一条 promote |
| pin `forge-v1.1.3` | `dev` `5ae17e9` → `main` `8bac302` |
| AIOps `dev`/`main` | `9071fa1`；tag `forge-v1.1.3`；Release 页已补齐 |

仍待拍板（不要密钥也能定）：

| 编号 | 一句话 | 选项 |
|---|---|---|
| OF-04 | lander 退役 | 有 write 后只留 APPLY.md |
| OF-07 | 回灌源仓：只 Forge + Overlay + 测试；产品不代做 | 回灌枝从 `upstream/main` 开；Oliver 打源仓 PR |
| OF-21 | `pr-body` 路径机检 | 做 / 先靠审查 |
| OF-23 | 接受内容包补设计 | 接受 / 改设计；接受之后再决定加不加升针 `docs_sync` |

---

## F. 2026-09-11 20:44 Oliver 拍板（覆盖 D 节里对应条目）

1. 采用 A 路线：fork 上建 `dev`；agent / 开发 PR → `dev`（CI required，不要人批）；`dev → main` 升级 PR 由 `forge promote` 开/更新（1 人批 + CODEOWNERS，merge commit）。`dev` 与 `main` 都上 Ruleset。→ OF-01 用 `FORGE_SUBMIT_TOKEN` 环境密钥让 `submit` / `promote` 成真；OF-10 定为做 Dev；OF-08 AIOps 与 fork 都 apply。
2. Overlay 去掉 `armed`：状态只剩 `active | blocked`，删 `reviewed_by / reviewed_at / armed_reason`；人审改为 PR 审批 + CODEOWNERS（`suites/**`、`inbox/**`、`.github/workflows/**`）；`blocked` 必须带链接的 `blocked_reason`。agent 分支不得把套件改成 `blocked`（`forge check` 的 `suite_guard`）。→ OF-11 / OF-12 关闭方式。
3. 版本：`overlay-v2.0.0`（契约破坏）+ `forge-v1.1.0`。AIOps 这轮由 agent 直推 `main`、打 tag、建 Release（Oliver 明示授权）；之后 AIOps 也建 `dev` 吃自己的药。→ OF-09 / OF-13 / OF-14。
4. 文档：中文为权威语言，英文只留 README 一页；ADR + CHANGELOG（Keep a Changelog）+ `docs/cli.md` 由 `--help` 生成 + `docs/STATE.md` 由 `forge status --write` 生成；`docs_sync` 检查同时在 `forge check`（本地）和 CI。去掉 Learning Guide 口音，用标准表达。→ OF-06 的根治。
5. reusable `overlay.yml` 加 `setup_command`；Overlay CLI 本身语言无关。→ OF-15。
6. `FORBIDDEN_LIVE_REPOS` 改成 `forge.yaml` 配置项（默认空），因为 fork 要 apply。→ OF-16 反转。
7. LG 的 `ci.yml` / `overlay-check.yml` 这轮由 agent 修改（授权），`apprunner-deploy.yml` 不碰；源仓 First-Light 这轮不动。→ OF-02 / OF-07 暂缓。
8. 做完工具后，LG 多写有效测试：先认证 / 支付 / 订阅 / Entitlement，再 My Learning / Portal / Trial；进 `test:ci` 与 `tests/io`。
9. （22:23 补）云 agent 审 PR 要查正文与实际内容的对应程度，并维护项目全局上下文（尤其文档）。→ OF-21。

执行规格：`/tmp/audit/v2-spec.md`（会随 AIOps 大提交进 `docs/adr/` 与 `CHANGELOG.md`）。

## E. 已修记录

- 2026-09-11 #7：brief 套件状态、`default_ref`、Release → `/tree/`、`selected=0`；APPLY / lander 记 `075341a`；密钥 `448c`。
- 2026-09-11 本 PR：OF-06 列出的四处；新增本文件；AGENTS.md 与 brief 链到这里。
- 2026-09-11 本 PR（v2 采纳）：OF-02 / OF-05 / OF-10 / OF-13 / OF-14 / OF-15 / OF-16 / OF-18 / OF-19 / OF-20 已修；OF-11 / OF-12 关闭；入口文档改 pin `overlay-v2.0.0` / `forge-v1.1.2`，路线 A `dev`→`main`。
- 2026-09-12 #12 合入 `dev`。OF-22 不是工作流绕过：工具仓 `efbc74e` 已按事件 × 来源锁 PR 规格；本仓仍 pin `forge-v1.1.2`，等 `forge-v1.1.3`。
- 2026-09-12 #13 / #14 合入 `dev`。OF-23 是补设计、提议，未接受、未加新锁。
- 2026-09-14：#15 开 `dev` → `main` 升级 PR。密钥本轮不管。D 表改成现在还开着的。
- 2026-09-14：#15 已 squash 合入 `main`（`a31fe5b`）。#16 已 squash 合入 `dev`（`b4c4661`）。对话里的 PAT 是源仓 `First-Light-TechHK` admin，对 fork 无 write；已登记 OF-01，应轮换。D 表改成现在还开着的。
- 2026-09-14：#17 squash 合入 `dev`（`535778a`）；#18 merge 合入 `main`（`a25ca70`）。Oliver 指出 leftover 应该一起（先 `dev` 再一条 promote）。#19 合入 `dev`（`bf276d8`）；#20 是随后一条 promote 合入 `main`（`7dd9b3d`）。
- 2026-09-14 #21 合入 `dev`（`e53c382`）；#22 promote 合入 `main`（`1d7867d`）。
- 2026-09-14 本 PR：OF-22 升针 `forge-check.yml` → `forge-v1.1.3`。AIOps `dev`/`main`/`forge-v1.1.3` @ `9071fa1`。Release 页与 `apply` 仍 403。
- 2026-09-14 随后：Release 页已补齐。本 PR：薄 skill / APPLY / OF-24 / STATE 改口；`apply` 仍未 live（OF-08）。
- 2026-09-14 #23 squash 合入 `dev`（`e4da21b`）；尚未 promote 到 `main`（Oliver：先只更新 Overlay，不 promote）。
- 2026-09-15 本 PR：OF-07 写明对象是 LG 源仓 First-Light。Oliver：黑盒 I/O 是规格，一般来说肯定是对的；AUTH-01/02 / PAY-10 / TRIAL-02 红是源仓产品。回灌 Forge + Overlay + 规格测试，不改产品、不改叶子。brief §9.7 / §9.11 / §9.12 同步。
