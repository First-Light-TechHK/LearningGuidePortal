# 缺陷与测试锁

本文说明这次排出来的每一条问题：用户看到什么、为什么不对、对照的上游提交、代码位置、是已经在某个分支修好，还是只有一条会在上游失败的测试，以及测试文件和测试名。

上游提交是 `83778295398d37bd3de17d4a6566c0554e45f7cc`（短 SHA `8377829`，说明 `feat(portal): align learning pages with figma`）。下面凡是写「上游」都指这一版。

核对分支时先 `git fetch origin`，再用 `git ls-tree` 和 `git grep` 看 **origin** 上的树。本地工作区里还没提交的文件，不记成已经推送的锁。

## 怎么区分

| 条目 | 在哪 | 状态 |
| --- | --- | --- |
| 每门课都套生物学「你将学到什么」 | 本分支 `cursor/chrome-copy-fixes-e93d` | 已修，测试在本分支通过 |
| zh-CN 顶栏 / 公开首课仍是英文 | 同上 | 已修，测试在本分支通过 |
| 顶栏假人 Prof. Gordon / Subject Expert | 同上 | 已修，测试在本分支通过 |
| 通知铃没有点击行为 | 同上 | 已修（去掉死按钮），测试在本分支通过 |
| 注册验证信先发出、成功后再写入待验证账号 | `origin/cursor/register-legal-transition-e93d`（PR #25，`8382cfe`） | 该分支已改实现，并带有通过用的测试 |
| Portal 500、游客进不了已发布课程、zh-CN 价格/方法英文、390px 横滚、390px 看不到 Get Started、`0h 45m` | `origin/cursor/portal-bug-locks-e93d`（`b9426b1`） | 只锁。测试按该分支注释预期在上游失败。本分支没有修这些 |
| 试用取消文案与立即收回权限不符、买更大范围后试用行还在、PC 文案写成含手机、无权限卡片同一句话出现两次 | `origin/cursor/purchase-bug-locks-e93d`（`d841f4f`） | 只锁。该分支相对上游只有测试，没有产品代码修复 |
| check-email 区分 exists/pending、resend 429、重置 503、在 `8377829` 上注册先落库再发信 | `cursor/auth-bug-locks-e93d` | **测试尚未推送。** origin 上没有这个 ref |
| 课时 `data-instance-content` 被剥掉、markdown 的 figure 落在 p 里、zh-CN 试用弹层英文含 “futhur”、课时简介等于章节标题、目录为空时不能再发布 | `cursor/content-bug-locks-e93d` | **测试尚未推送。** origin 上没有这个 ref |
| 首页 hero 的 banner2.png / banner3.png 里烤进英文 | 无 | 不是代码缺陷。PR #27 已关闭，不要把那次改动重新打开 |

本分支的锁在 `tests/unit/chrome-copy-fixes.test.ts`。`npm run test:unit` 会跑到它（glob 是 `tests/unit/*.test.ts`）。购买锁放在 `tests/unit/purchase-bug-locks/` 子目录里，这条 glob **不会**跑到它们，所以它们可以保持「在上游失败」。本分支没有改 `test:ci` 脚本，也没有改 Verify 工作流。

## 本分支已修复

四条都从上游 `8377829` 修起。测试在本分支通过。把同一测试放到上游上会失败：课程页仍把共享科学列表画出来，zh-CN 的两个键仍是英文，`AppShell.tsx` 仍写着 Prof. Gordon，并且通知按钮没有 `onClick`。

### 1. 每门课都显示生物学学习成果

用户打开 Epicureanism，以及任何一门没有自己学习成果的课，在 en-GB 和 zh-CN 都会看到「What you'll learn / 你将学到什么」，下面是数学、生物、欧拉方法那六条，例如 “Model real biological systems mathematically” 和 “用数学建模真实的生物系统”。

这不对。那六条是 `messages/*.json` 里 `courseDetailDesign.outcomes` 的固定文案，来自另一门科学课的版式，不是这门课的目录数据。Epicureanism 讲的是快乐、欲望、友谊和死亡论证。

文件：`app/[locale]/portal/courses/[slug]/page.tsx` 原先对每一门课执行 `detail.outcomes.map`。种子课在 `services/productStore.ts` 的 `defaultCourse()`（id `epicureanism`），对象上没有 `outcomes`。

修复：`lib/courseDetailPresentation.ts` 的 `courseLearningOutcomes` 先读课程对象上的 `outcomes`，没有再读 `catalogueEntriesForCourse` 返回的学科条目，然后是分类条目。有非空字符串才显示；课程、学科、分类都没有，就整段不渲染，不用那六条科学文案顶上。`contracts/course-authoring.ts` 给课程和目录条目加了可选的 `outcomes`。科学文案仍留在 `messages/en-GB.json` 和 `messages/zh-CN.json` 的 `courseDetailDesign.outcomes`，因为 `tests/unit/course-detail-presentation.test.ts` 仍对照这组固定文案。某门课或它的目录条目如果自己存了同样的句子，显示的是那一份存储，不是消息文件里的替身。

测试文件：`tests/unit/chrome-copy-fixes.test.ts`  
测试名：`Epicureanism does not render the shared science outcomes`  
断言：没有 `outcomes` 的 Epicureanism 夹具渲染结果里没有 “Model real biological systems”，也没有 “用数学建模真实的生物系统”；课程自己的成果优先于目录上的科学句子；页面源码不再出现 `detail.outcomes`（`outcomesTitle` 除外）。

### 2. zh-CN 顶栏和公开首课仍是英文

zh-CN 已登录顶栏链到「我的学习」的文字是 `My Learning`。公开首课页眉 `portal-eyebrow` 的文案是 `Public First Lesson`。样式 `text-transform: uppercase`（`app/styles.css` 的 `.portal-eyebrow`）会把它画成 `PUBLIC FIRST LESSON`。

en-GB 保持英文是对的。zh-CN 不应该把这两个产品词留成英文。旁边的作者文案已经用「公开首课」（`authoring.publicLesson`），顶栏学习入口用「我的学习」和现有「继续学习」「学习中」同一口气。

文件：`messages/zh-CN.json` 的 `portal.myLearning`、`portal.publicFirstLesson`。同一处英文还出现在课时页顶栏 `learning.title`（`app/[locale]/account/learn/[courseId]/page.tsx`）和后台勾选 `backoffice.publicLesson`，这两处一并改成「我的学习」和「公开首课」。组件里没有新写中文或英文。en-GB 的对应键没改。

测试文件：`tests/unit/chrome-copy-fixes.test.ts`  
测试名：`zh-CN header and public lesson use Chinese chrome`  
断言：`getMessages("zh-CN")` 的这两个键不是 `My Learning` / `Public First Lesson`，值是「我的学习」和「公开首课」；en-GB 仍是英文。顶栏源码使用 `copy.myLearning`，渲染出的链接文字是「我的学习」。公开首课页源码使用 `copy.publicFirstLesson`，渲染出的眉题是「公开首课」。

### 3. 顶栏在真实操作者旁边显示假人

知识工作流顶栏（Source Materials、LLM Draft、Knowledge Wiki、Publish、Course）在已登录用户旁边写死 `Prof. Gordon` 和 `Subject Expert`，头像 alt 也是这个名字。没有这个人的会话。

文件：`components/AppShell.tsx`。

修复：顶栏改显示当前会话用户的姓名和角色。`/api/navigation` 本来就要识别调用者（管理域名上的 operator，或产品会话里的用户），现在把 `shellViewerFromUser` 的结果放进响应的 `viewer`。姓名用 `nickname` 去掉空白；角色用用户对象上的 `role`（`student` / `teacher` / `operator`），不再换成 Subject Expert。姓名为空就不渲染这块，也不用假人垫底。展示组件是 `components/ShellViewer.tsx`。

测试文件：`tests/unit/chrome-copy-fixes.test.ts`  
测试名：`the shell shows the signed-in user and has no dead notification button`  
断言：`AppShell.tsx` 源码不含 `Prof. Gordon` 或 `Subject Expert`；夹具用户 `{ nickname: " Ada Operator ", role: "operator" }` 经 `shellViewerFromUser` 再渲染后出现 `Ada Operator` 和 `operator`；空白姓名渲染为空。

### 4. 通知铃点了没反应

`AppShell.tsx` 顶栏有一颗 `aria-label="Notifications"` 的按钮，里面只有图标，没有 `onClick`，也不跳转。

`productStore` 里有 `notifications` 数组，注册、试用、购买会往里写，也有 `setNotificationRead`。壳能调到的列表接口不是这份数据：`app/api/my-learning/notifications/route.ts` 固定返回空数组，注释写明 ML-FR-019 不开放收件箱；`app/api/my-learning/notifications/read/route.ts` 返回 404。没有一条壳可以打开的、按当前用户过滤的通知列表。

因此不新做通知区，直接去掉这颗死按钮。侧栏里创建课程、展开、删除等按钮都保留，并且都有 `onClick`。

测试与第 3 条同一个测试名。断言：源码里没有 `aria-label="Notifications"`；每一个 `<button` 开头标签都带 `onClick`；夹具用户的顶栏渲染结果里没有无处理函数的通知按钮（渲染结果里也没有 `<button`）。

## 已在其他分支修复，不是本分支的改动

### 注册：验证信先发出，成功后再写入待验证账号

用户注册时，如果信还没发出去，账号或验证令牌却已经落库，接下来的登录、重发会把「这个地址已经在流程中」和「这个地址不存在」分成两种响应。上游 `8377829` 是先写入再发送。

`origin/cursor/register-legal-transition-e93d`（`8382cfe1cce94066756b17c9cc9f761c24f445bc`，PR #25）在 `services/emailRegistration.ts` 里先发信，成功后再 `commitPendingUserWithToken`。发信失败则不提交用户。这是修复，不是一条故意失败的锁。

`git ls-tree` 能看到这些测试：

- `tests/unit/register-legal-transition.test.ts`
  - `failed verification mail does not commit the user`
  - `missing mail configuration returns 503 before the existence check and commits nothing`
  - `discard register keeps one pending user and the original password until verify`
  - `resend send failure stays accepted and keeps the unused token hash`
  - `a verification link is not stored for an account that became active before the commit`
  - `resend of an unknown email matches the pending resend shape`
  - `verification disabled register still opens a session`
- `tests/unit/email-binding-legal-transition.test.ts`
  - `a rejected binding mail stores no link and does not start the cooldown`
  - `a rejected binding mail keeps the previously delivered link usable`
  - `the commit re-checks uniqueness and stores nothing when the email was taken meanwhile`
- `tests/unit/password-reset-legal-transition.test.ts`
  - `rejected reset mail answers like an unknown address and keeps the live link`
  - `a rejected send does not start the cooldown and an accepted send replaces the link`
  - `managed environment answers 200 for known and unknown addresses when the send is rejected`
  - `managed environment without delivery returns 503 before any account lookup`
  - `managed environment without a public origin returns 503 for every address`
  - `a foreign Origin header is rejected for known and unknown addresses alike`
- `tests/io/login.test.ts` 的 `registerPending` 前置条件（约第 83–91 行）：注册必须 200、`verificationRequired` 为 true、不发会话 cookie、用户状态是 `pending`、待验证登录是 401 且不开会话。调用它的测试包括 `AUTH-01 negative: login does not 403 only for a pending address` 和 `AUTH-01 edge: resend-verification does not 429 only for a pending address`。
- `tests/e2e/register-legal-transition.spec.ts`
  - `sign-up lands on check-email and a repeat does not enter the app`
  - `sign-up shows the delivery error and sign-in does not open an account`

本分支没有改这些文件。

## 只锁、预期在上游失败

这些测试在对应的 origin 分支上。本分支没有把它们带过来，也没有修它们指向的产品行为。分支上的注释写明预期失败，直到产品改对。本会话没有在那些工作区里重跑它们。

### Portal：`origin/cursor/portal-bug-locks-e93d`（`b9426b1`）

相对上游多了测试，以及把首页时长格式抽成 `formatHomeCourseDuration`。这个函数仍是 `Math.floor(minutes / 60)` 小时加余数分钟，45 分钟还是 `0h 45m`。时长测试要的是 `45m`，所以这不是修复。

| 用户看到什么 | 为什么错 | 文件线索 | 测试 |
| --- | --- | --- | --- |
| 本地存储、没有 AWS 凭证时，Portal 首页或课程列表 500，签名封面抛 `CredentialsProviderError` | 签不了名的封面应该退回可显示的地址，页面仍要渲染 | 封面签名；测试通过 `tests/unit/helpers/portal-page-harness.ts` 打开首页和课程页 | `tests/unit/portal-cover-signing-bug.test.ts`：`a cover URL that cannot be signed must return a fallback instead of CredentialsProviderError`；`portal home and courses cover signing must not throw CredentialsProviderError when STORAGE_BACKEND=local and AWS credentials are absent`；`portal home and courses page handlers must not throw CredentialsProviderError when a cover cannot be signed`。浏览器：`tests/e2e/portal-bug-locks-http.spec.ts`：`GET /en-GB/portal and /en-GB/portal/courses must not 500 when STORAGE_BACKEND=local and AWS credentials are absent` |
| 未登录游客打开已发布的 Epicureanism 或公开首课，被 307 到登录 | 需求是游客可以看已发布课程和公开首课 | `app/[locale]/portal/courses/[slug]/page.tsx` 与 `public-lesson/page.tsx` 在无用户时 `redirect` 到 sign-in | `tests/unit/portal-visitor-published-course-bug.test.ts`：`a signed-out visitor can open /en-GB/portal/courses/epicureanism without a 307 to sign-in`；`a signed-out visitor can open /en-GB/portal/courses/epicureanism/public-lesson without a 307 to sign-in`。浏览器：`tests/e2e/portal-bug-locks-http.spec.ts`：`a signed-out visitor can open /en-GB/portal/courses/epicureanism and its public first lesson without a 307 to sign-in` |
| zh-CN 价格页大标题是英文 `Subscription`；课程页方法带是 `Apply what you learn` / `Share your perspective` / `See the bigger picture` | 这些是界面文案，zh-CN 不应硬编码英文 | 价格页 hero、课程页 `.courses-design-method` | `tests/unit/portal-zh-cn-hardcoded-english-bug.test.ts`：`zh-CN pricing heading must not be the English "Subscription"`；`zh-CN courses method band must not contain hardcoded English Apply what you learn / Share your perspective / See the bigger picture`。同名浏览器测试在 `tests/e2e/portal-bug-locks-layout.spec.ts` |
| 390px 下 `/en-GB/portal/courses` 和 `/en-GB/pricing` 出现横向滚动 | `scrollWidth` 大于视口 | 这两条路由的版式 | `tests/e2e/portal-bug-locks-layout.spec.ts`：`at 390px /en-GB/portal/courses document scrollWidth must be <= viewport width`；`at 390px /en-GB/pricing document scrollWidth must be <= viewport width` |
| 390px、未登录，价格页顶栏看不到去注册的入口 | `.portal-header-cta`（Get Started）被收起来，没有别的可见 sign-up 链接 | `components/portal/PortalHeader.tsx` 的 Get Started | `tests/e2e/portal-bug-locks-layout.spec.ts`：`at 390px a signed-out header must still expose a way to reach sign-up` |
| 45 分钟的课显示 `0h 45m` | 不满一小时仍拼出 `0h` | `components/portal/CatalogueCourseCard.tsx`，`lib/courseDuration.ts` 的 `formatHomeCourseDuration` | `tests/unit/portal-course-duration-label-bug.test.ts`：`a 45-minute course must not display 0h 45m` |

### 购买与试用：`origin/cursor/purchase-bug-locks-e93d`（`d841f4f`）

相对上游只有 `tests/unit/purchase-bug-locks/`。没有改产品代码。这些文件不在 `tests/unit/*.test.ts` 这一层，因此 `npm run test:unit` 不会执行它们。

| 用户看到什么 | 为什么错 | 文件线索 | 测试 |
| --- | --- | --- | --- |
| 取消试用的对话框说当前周期内访问权限还在（en-GB `learning.cancelDescription` 一类「until the end of the period」，zh-CN「当前周期内的访问权限不会立即受到影响」） | `cancelSubscription` 对试用是立刻到期、立刻失去课程权限。文案把试用说成期末才结束 | `components/portal/SubscriptionManager.tsx` 在 `cancelTarget.source === "trial"` 时仍用 `copy.cancelDescription`；`messages/en-GB.json` 与 `messages/zh-CN.json` 的 `learning.cancelDescription` | `tests/unit/purchase-bug-locks/trial-cancel-dialog.test.ts`：`BUG: trial cancel dialog says current access remains until the end of the period`。同文件还有 `cancelling a demo trial removes course access immediately`（行为本身是立即收回）和 `BUG: cancelling a course-scoped plan labels it Category`（课程范围的计划被标成 Category） |
| 先有 Epicureanism 试用，再完成 Everything 购买之后，试用订阅行还在 | 更大范围的购买已经拿走试用权益，试用订阅不应继续处于活动 | `services/productStore.ts` 完成 demo 购买的路径 | `tests/unit/purchase-bug-locks/everything-purchase-leaves-course-trial-active.test.ts`：`BUG: fulfilling an Everything purchase leaves the epicureanism trial subscription active` |
| Epicureanism 的 PC 方案确认页写成 1 台电脑加 1 台手机 | 计划 `device` 是 `pc`。用 `device=mobile` 查权益得到 `allowed: false`。文案多报了手机 | 订阅确认权益文案；`epicureanism-pc-6` | `tests/unit/purchase-bug-locks/epicureanism-pc-claims-mobile.test.ts`：`BUG: epicureanism PC trial confirmation says 1 PC and 1 mobile while mobile entitlement is false` |
| 我的学习里，试用结束后的 `no_access_history` 卡片，状态标签和说明是同一句 | 同一句 `outsideAccess` 画了两次 | 我的学习卡片 | `tests/unit/purchase-bug-locks/my-learning-no-access-repeats-sentence.test.ts`：`BUG: My Learning no_access_history repeats the same sentence as the state label and the description` |

## 测试尚未推送

### 认证：`cursor/auth-bug-locks-e93d`

`git ls-tree origin/cursor/auth-bug-locks-e93d` 失败，origin 上没有这个分支。测试尚未推送。

本地工作区 `/tmp/lg-auth-locks` 的 HEAD 仍是 `8377829`。`git ls-tree HEAD` 里没有新增测试。未提交文件 `tests/locks/auth-bug-locks.test.ts` 不在任何已推送提交里，不能当成已推送的锁。

这些是上游 `8377829` 上仍在的认证问题，等那条分支推上去才能按测试名核对：

- check-email 对已存在、待验证、未知地址给出不同的 exists/pending，调用方能判断邮箱是否注册。
- 重发验证信只对待验证地址返回 429。
- 托管环境密码重置在发信失败时返回 503，或把已知地址和未知地址分成不同状态。
- 注册在信发出去之前就把用户和未使用的验证令牌写入。PR #25 那条分支修的是同一件事；这条失败锁如果推上去，应该在 `8377829` 上失败，在 `register-legal-transition` 上才可能通过。

### 内容：`cursor/content-bug-locks-e93d`

`git ls-tree origin/cursor/content-bug-locks-e93d` 失败，origin 上没有这个分支。测试尚未推送。

本地 HEAD 也是 `8377829`。`git ls-tree HEAD` 没有新的测试文件。工作区里有一份未提交的 `components/MarkdownAnswer.tsx` 一行改动，同样不是已推送的锁。

上游上能对上的位置如下。没有已推送的测试名：

| 用户看到什么 | 为什么错 | 上游文件 |
| --- | --- | --- |
| 课时里的展品、练习元数据丢了 | 清洗 HTML 时删掉 `data-instance-content`。旧课时把图片路径和答案放在这个属性上 | `services/lessonContent.ts` 删除该属性；`components/portal/CourseMediaPreview.tsx` 也会 `removeAttribute('data-instance-content')` |
| 课程 markdown 里的图被包进段落，HTML 不合法（figure 在 p 里面） | `components/MarkdownAnswer.tsx` 把图渲染成 `<figure class="course-figure">`，外层 markdown 仍可能把它放进 `<p>` | `components/MarkdownAnswer.tsx` |
| zh-CN 试用弹层出现英文，其中包括拼写错误的 “futhur” | 文案写在组件里，没有走 `messages/zh-CN.json` | `components/portal/LessonContentPlayer.tsx`：`cta: 'Ready for learning futhur'` |
| 课程大纲里每一节的简介都等于这一节的章节标题 | 页面把课时简介设成 `section.title`，不是课时自己的说明 | `app/[locale]/portal/courses/[slug]/page.tsx` 里 `description: section.title` |
| 目录被清空之后，已经发布过的课不能再发布 | 发布时 `setCourseStatus` 调用 `validateCatalogueSelection`。课上仍挂着分类或学科 id，而 `catalogue` 里已经没有对应条目时，会当成非法 | `services/productStore.ts` 的 `setCourseStatus` 与 `validateCatalogueSelection` |

## 不是代码缺陷

首页轮播的 `public/portal/banner2.png` 和 `public/portal/banner3.png` 把英文直接画进图片。换语言不会改图里的字。这是撤回的产品素材，不是要在组件里修的缺陷。

PR #27（`fix: show one portal hero slide at a time`，https://github.com/LibertychaserUS/LearningGuidePortal/pull/27）已于 2026-09-29 关闭。不要重新打开，也不要把那次 hero 改动再做一遍。

## 本分支验证

在 `/tmp/lg-chrome`、Node v22.22.2 上：

- `npx tsc --noEmit` 通过。
- `npx eslint .` 仍是 12 条既有的 `@next/next/no-img-element`（顶栏标志、头像从 `AppShell.tsx` 挪到 `ShellViewer.tsx`，总数没有增加），0 error。
- `npm run test:unit`：238 通过，0 失败。其中包含上面三条新测试。
