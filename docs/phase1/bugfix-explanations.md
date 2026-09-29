# 已在 fork main 上的行为修正

对照的是 fork `origin/main` `4be6edfdcaf6380e927bc0db98cc1d7ffe7fac1b` 与 upstream main `83778295398d37bd3de17d4a6566c0554e45f7cc`（短 SHA `8377829`，`feat(portal): align learning pages with figma`）。

upstream 在 `8377829` 之后没有新提交，这些修正不与上游后续的缺陷修复重叠。

本文只写用户能看到、或命令会提交的状态。不逐条复述合并提交。每条下面四行：原来错在哪、现在的规则、代码落点、锁住它的测试。

商业分类的值域始终是 `Chinese Humanities`、`European Humanities`、`Science`，或空字符串 `""`。空不是欧洲人文。

## 1. 分类与购买用同一个字段

### 归属是一个门户分类或空

原来：同一门课的面包屑、筛选、卡片、我的学习、推荐和定价可以各读各的字段。遗留 `category`、目录名称、学科名称都能把课从 `categoryId` 上挪走。读入时缺分类还会被写成欧洲人文。

现在：`courseCategoryMembership` 的结果只有上述三个门户 id 或 `""`。先看 `categoryId`（或其目录父 id）是否正好是这三个名字，或 slug `science` / `european-humanities` / `chinese-humanities`；对上了，冲突的遗留字段和目录名称都不改标签。`categoryId` 为空才看学科的目录父 id 或 slug。两个 id 都空，才接受正好是这三个名字的遗留 `category`。学科名、目录名不参与。`commitCourseCategory` 把这个结果写回 `course.category`，空则删掉该字段，展示和购买读同一份。

代码：`lib/courseDetailPresentation.ts` 的 `courseCategoryMembership`、`courseCategoryDisplay`；`services/productStore.ts` 的 `commitCourseCategory`（`createCourseForOperator`、保存草稿、`setCourseStatus` 都会调用）。

测试：`tests/unit/course-category-display.test.ts`、`tests/unit/course-category-surfaces.test.ts`、`tests/unit/shown-command-state.test.ts`。

### 不透明目录 id 不抹掉已有商业分类

原来：`categoryId` 是 `category_academic` 这类目录内部 id 时，归属被当成没有分类，或被目录上的名字（例如 Science）改掉。课上已经写着的 `European Humanities` / `Science` 不再决定购买范围。

现在：`categoryId` 有值但自身和对得上的父 id 都不是三个门户 id 或那三个 slug 时，保留正好等于这三个名字之一的遗留 `category`。学科不参与这一步。父 id 若能对上门户分类，父 id 胜出，遗留字段不改结果。

代码：`courseCategoryMembership` 里 `categoryId` 分支：`portalIdFromCatalogueKey` 失败后用 `exactPortalId(course.category)`。

测试：`tests/unit/course-category-display.test.ts`（不透明 id 仍是欧洲人文；父 id 为 `science` 时归属是 Science）。

### 发布必须有归属

原来：没有商业分类的课仍可能被发布，缺省还会被补成欧洲人文。发布并不要求「展示用的分类」和「能卖的分类」是同一个非空值。

现在：发布前先 `commitCourseCategory`，再 `assertCourseCanPublish`。归属为空则抛 `code: "invalid"`，不写入分类，也不补欧洲人文。课上必须已有至少一节非空课时。

代码：`lib/courseDetailPresentation.ts` 的 `assertCourseCanPublish`；`services/productStore.ts` 的 `setCourseStatus`。

测试：`tests/unit/course-category-display.test.ts`（空归属拒绝发布，对象不被改写）。

### 学习成果只来自本课

原来：课程页对每一门课渲染 `messages` 里 `courseDetailDesign.outcomes` 的六条生物学句子。Epicureanism 也会出现 “Model real biological systems mathematically” / “用数学建模真实的生物系统”。后面传入的学科或分类目录行也能把别的课的成果画出来。

现在：`courseOutcomes` / `courseLearningOutcomes` 只取这门课自己存的 `outcomes`：非空字符串、去掉首尾空白、按首次出现去重。没有这份数组就是 `[]`，整段不渲染。消息文件和目录行都不是回退来源。某门课自己存了同样的句子，显示的是那一份存储。

代码：`lib/courseDetailPresentation.ts` 的 `courseOutcomes`、`courseLearningOutcomes`；`components/portal/CourseLearningOutcomes.tsx`。

测试：`tests/unit/chrome-copy-fixes.test.ts`、`tests/unit/course-category-display.test.ts`、`tests/unit/shown-command-state.test.ts`。

### 空分类不展示也不卖

原来：中国人文、科学没有已发布课程时，目录筛选和定价页仍把它们当成可订阅的分类。`createQuote("chinese-humanities-pc-6")` 或 `science-pc-6` 会生成报价；事先写进库里的报价也能下单。

现在：分类方案只有在至少一门 `status === "published"` 的课，其 `courseCategoryMembership` 等于该分类时才存在。否则 `categorySubscribeOffer` 为 `null`，筛选芯片不出现该分类，定价页没有 Subscribe。`createQuote` 与演示/Stripe 下单抛出 “This category has no published course.”，已写入的非法报价也不能变成订单。欧洲人文在种子课仍发布时可以购买，`european-humanities-pc-6` 的金额是方案上的 6900（美元分）。

代码：`lib/offer.ts` 的 `categoryHasPublishedCourse`、`categoryPurchaseAllowed`、`categorySubscribeOffer`；`lib/courseDetailPresentation.ts` 的 `catalogueFilterState`；`services/productStore.ts` 的 `assertCategoryPurchase`（`createQuote`、`createPendingDemoOrder`、`createPendingStripeOrder`、`grantPurchaseAccess`）。

测试：`tests/unit/offer-pending-logic.test.ts`、`tests/unit/shown-command-state.test.ts`。

## 2. 报价

报价是一次购买控件真正提交的命令。字段是 `scope`（`course` | `category` | `everything`）、`planId`、方案金额 `amountMinor`、币种、是否试用 `trial`、本次应付 `dueNowMinor`、期限 6 或 12。金额只来自服务端方案，不来自浏览器。

### 侧栏提交的是分类方案

原来：课程页侧栏的价格和链接可以指向这门课自己的课程方案，或带上 `courseId`，和页面上写的分类不是同一次购买。

现在：侧栏是该课所属分类的 6 个月、非手机、可用的分类方案。Epicureanism 的侧栏是 `european-humanities-pc-6`，`scope` 为 `category`，`amountMinor` 与 `dueNowMinor` 都是 6900，`trial` 为 false。链接是 `/{locale}/pricing?planId=european-humanities-pc-6`，不含 `courseId`，也不含 `epicureanism-pc-6`。该分类没有已发布课时，侧栏没有这条报价。

代码：`lib/offer.ts` 的 `courseSidebarOffer`、`courseSidebarHref`。课程页在 `app/[locale]/portal/courses/[slug]/page.tsx` 调用它们。

测试：`tests/unit/offer-pending-logic.test.ts`。

### 定价页上的课程方案是课程方案

原来：带 `courseId` 的定价页会把分类方案的金额（6900）当成这门课的课程方案。

现在：`pricingCourseOffer` 只取该 `courseId` 的 6 个月、非手机、可用课程方案。Epicureanism 是 `epicureanism-pc-6`，`scope` 为 `course`，`amountMinor` 与 `dueNowMinor` 都是 4900，`trial` 为 false。分类订阅仍按上一节的空分类规则逐个给出，互不替换。

代码：`lib/offer.ts` 的 `pricingCourseOffer`、`pricingPageModel`。

测试：`tests/unit/offer-pending-logic.test.ts`。

### 试用的本次应付是 0

原来：试用确认把本次应付写成 0 的同时，把方案金额也写成 0，或沿用分类方案的 6900。试用和购买变成同一条报价。

现在：`trialConfirmationOffer` 仍是被试用的那条方案。课程试用的 `planId` 是 `epicureanism-pc-6`，`amountMinor` 保持 4900，`dueNowMinor` 是 0，`trial` 为 true。试用不是 0 元方案，只是这一次不收费。

代码：`lib/offer.ts` 的 `offerFromPlan`（`trial` 为真时 `dueNowMinor` 为 0）、`trialConfirmationOffer`。

测试：`tests/unit/offer-pending-logic.test.ts`。

## 3. 注册、查邮箱、先发信再落库

先发信、发送被接受之后才写入链接。注册、重发、重置、绑定四条转移、公开输出和测试名在 `docs/phase1/email-state-machine.md`。这里只记用户能看到的两处，以及那四条命令共同的写入顺序。

### 公开查邮箱只有 `{ ok: true }`

原来：`POST /api/auth/check-email` 对格式合法的地址返回 `{ ok: true, data: getEmailAuthState(email) }`。`data.exists` / `data.pending` 把未知、待验证、已激活分成三种，调用方可以判断这个地址有没有账号。

现在：格式合法时，未知、待验证、已激活的成功响应都是同一个 `{ ok: true }`，正文没有 `exists` 或 `pending`。过长是 400 `EMAIL_TOO_LONG`，格式不合法是 400 `EMAIL_INVALID`，请求体读失败是 400 `EMAIL_CHECK_FAILED`。这个接口不再查账号。

代码：`app/api/auth/check-email/route.ts` 的 `POST`。

测试：`tests/locks/auth-bug-locks.test.ts`。

### 页面只在已提交且未使用的链接上说已发送

原来：打开查邮箱页就会说「已发送激活链接」，包括未知地址、验证已关闭、以及链接已经用过的地址。这句话和库里有没有待验证账号无关。

现在：`checkEmailView` 只有在「仍要求邮箱验证」并且 `hasCommittedPendingActivation` 找到该地址的 pending 用户、以及一条未使用且未过期的验证链接时，`claimsActivationSent` 才为 true，文案用 `auth.checkEmailDescription`。其余情况用 `auth.checkEmailIdle`，不出现 “sent an activation link” 或「已向您的邮箱发送激活链接」。验证关闭时，注册继续进入应用，这一页也不声称发过信。

代码：`lib/pendingCheckEmail.ts` 的 `checkEmailView`；`services/checkEmailPage.ts` 的 `checkEmailPageModel`；`services/productStore.ts` 的 `hasCommittedPendingActivation`。

测试：`tests/unit/offer-pending-logic.test.ts`。

### 注册、重发、重置、绑定：先发信再落库

原来：注册在信被拒绝时已经写入 pending 用户和未使用的验证令牌。重发或重置在发送失败时会换掉仍有效的链接，或只对待验证地址返回 429 / 503，从而和未知地址区分开。

现在：发送被接受之后才写入或替换链接；发送被拒绝则不提交用户、不替换旧链接、不开始冷却。公开响应不按地址是否存在而不同。具体状态和输出见 `docs/phase1/email-state-machine.md` 第 5 节。

代码：`services/emailRegistration.ts` 的 `registerEmailAccount`（接受后 `commitPendingUserWithToken`）；`services/emailResend.ts` 的 `resendVerificationEmail`（接受后 `replaceLiveVerificationToken`）；`services/passwordResetService.ts` 的 `deliverPasswordReset`；`services/emailBindingService.ts` 的 `requestEmailBinding`。

测试：`tests/locks/auth-bug-locks.test.ts`、`tests/unit/register-legal-transition.test.ts`、`tests/unit/password-reset-legal-transition.test.ts`、`tests/unit/email-binding-legal-transition.test.ts`。浏览器路径在 `tests/e2e/register-legal-transition.spec.ts`。

## 4. 课程内容

### `data-instance-content` 留下来

原来：`sanitiseRichHtml` 在清洗后删掉 `data-instance-content`。旧课时把展品路径和答案放在这个属性上，清洗之后展品和练习元数据都没了。

现在：带 `data-instance-type` 1–6 的 `span.instance-node`，在内容长度不超过 10000、且不含 `<` `>`、`javascript:` 和 `on…=` 时，保留 `data-instance-content`。不满足的删掉该属性。预览在同一条件下写回这个属性。

代码：`services/lessonContent.ts` 的 `sanitiseRichHtml`、`safeInstanceContent`；`components/portal/CourseMediaPreview.tsx` 读取并在安全时 `setAttribute('data-instance-content', …)`。

测试：`tests/unit/content-bug-locks.test.ts`。

### figure 不进 p

原来：课程 markdown 的图片渲染成 `<figure class="course-figure">`，外层段落仍把它包在 `<p>` 里。

现在：段落组件发现子节点是这张图时，不再输出 `<p>`，图作为同级节点渲染。结果里没有 `<p>…<figure>…</figure>…</p>`。

代码：`components/MarkdownAnswer.tsx` 的 `markdownComponents.p` 与 `img`。

测试：`tests/unit/content-bug-locks.test.ts`。

### zh-CN 试看文案

原来：试看上限弹层把英文写在组件里。zh-CN 标题是 `Enjoying the course so far?`，按钮是 `Ready for learning futhur`。

现在：`TrialLimitModal` 使用 `lessonMessages(locale)`。zh-CN 标题是「到目前为止，这门课还合你的意吗？」，按钮是「准备继续学习」。这两句都含汉字，且不再出现上述英文。

代码：`components/portal/LessonContentPlayer.tsx` 的 `TrialLimitModal`；`messages/lesson-authoring-zh-CN.json` 的 `heroTitle`、`cta`。

测试：`tests/unit/content-bug-locks.test.ts`。

### 课时说明不是章节标题

原来：大纲里每一节的 `description` 都写成 `section.title`。同一章下每节课的说明都是同一句章节标题。

现在：`courseLessonCardDescription` 使用课时标题。标题去掉空白后非空、且不等于章节标题时，说明就是这个标题；否则说明是 `""`。两节不同的课不会得到同一句章节标题。

代码：`lib/courseDetailPresentation.ts` 的 `courseLessonCardDescription`。课程页在 `app/[locale]/portal/courses/[slug]/page.tsx` 把它放进大纲项的 `description`。

测试：`tests/unit/content-bug-locks.test.ts`。

### 空目录仍可按 `european-humanities` 发布

原来：发布调用 `validateCatalogueSelection`。教学目录被清空后，课上仍挂着 `categoryId: "european-humanities"` 也会被当成非法，已发布过的课不能再发布。

现在：`european-humanities` 这个 slug 本身就是欧洲人文，不依赖目录里还有一行。`setCourseStatus` 把当前课当作「分类 id 未改」传给校验，空目录不再拒绝这个已保存的 id。发布结果仍是 `published`，`categoryId` 仍是 `european-humanities`，归属是 `European Humanities`。

代码：`courseCategoryMembership` 的 slug 表；`services/productStore.ts` 的 `setCourseStatus`、`validateCatalogueSelection`（未改的 `categoryId` / `subjectId` 不再要求目录行仍在）。

测试：`tests/unit/content-bug-locks.test.ts`。

## 5. Portal

### 时长

原来：首页卡片把分钟数写成 `Math.floor(minutes / 60)` 小时加余数分钟。45 分钟显示 `0h 45m`。

现在：`formatHomeCourseDuration` 在小时为 0 时只输出分钟和该语言的分钟后缀。en-GB 的后缀是 `h` / `m`，45 分钟是 `45m`。满小时且没有余数时不写 `0m`。

代码：`lib/courseDuration.ts` 的 `formatHomeCourseDuration`。`components/portal/CatalogueCourseCard.tsx` 用它画首页时长。

测试：`tests/unit/portal-course-duration-label-bug.test.ts`。

### 封面签名失败不 500

原来：`signCourseMediaUrl` 在本地存储、没有 AWS 凭证时抛出 `CredentialsProviderError`。首页和课程列表因此 500。

现在：签名抛错时返回原来的地址，页面继续渲染。协议、主机或路径不在约定课程媒体范围内的地址也不签名，原样返回。

代码：`services/persistence/s3.ts` 的 `signCourseMediaUrl`。

测试：`tests/unit/portal-cover-signing-bug.test.ts`、`tests/e2e/portal-bug-locks-http.spec.ts`。

### 游客可开已发布课和公开首课

原来：未登录打开 `/en-GB/portal/courses/epicureanism` 或其公开首课，307 到登录页。

现在：课程页不因没有会话而跳转。已发布课的页面状态是 `available`，游客的权益是未开通。公开首课在课程已发布且该课是公开课时直接渲染；课程不存在、未发布或没有公开课是 404，不是去登录。

代码：`app/[locale]/portal/courses/[slug]/page.tsx`（`getCoursePage(slug, user?.id)`，无用户也可建页）；`app/[locale]/portal/courses/[slug]/public-lesson/page.tsx`（未发布或缺公开课则 `notFound`）。

测试：`tests/unit/portal-visitor-published-course-bug.test.ts`、`tests/e2e/portal-bug-locks-http.spec.ts`。

### zh-CN 定价标题与方法条

原来：zh-CN 定价页大标题是英文 `Subscription`。课程列表的方法条是写死的 `Apply what you learn` / `Share your perspective` / `See the bigger picture`。

现在：定价页 `<h1>` 使用 `pricingDesign.heading`。zh-CN 是「选择适合您的学习方案」。方法条使用 `portal.methodSteps`。zh-CN 是「把学到的用起来」「说出你的看法」「看见更大的图景」。

代码：`app/[locale]/pricing/page.tsx`；`app/[locale]/portal/courses/page.tsx`；`messages/zh-CN.json` 的 `pricingDesign.heading`、`portal.methodSteps`。

测试：`tests/unit/portal-zh-cn-hardcoded-english-bug.test.ts`、`tests/e2e/portal-bug-locks-layout.spec.ts`。

### 我的学习 / 公开首课

原来：zh-CN 顶栏链到我的学习的文字是 `My Learning`。公开首课眉题是 `Public First Lesson`（样式还会把它画成全大写英文）。

现在：`portal.myLearning` 在 zh-CN 是「我的学习」，`portal.publicFirstLesson` 是「公开首课」。en-GB 仍是 `My Learning` 和 `Public First Lesson`。

代码：`messages/zh-CN.json` 的这两个键。顶栏和公开首课页使用 `copy.myLearning`、`copy.publicFirstLesson`。

测试：`tests/unit/chrome-copy-fixes.test.ts`。

### 会话用户

原来：知识工作流顶栏在已登录用户旁边写死 `Prof. Gordon` 和 `Subject Expert`。没有这个人的会话。

现在：`/api/navigation` 把 `shellViewerFromUser` 放进 `viewer`。姓名是 `nickname` 去掉空白，角色是用户上的 `role`（`student` / `teacher` / `operator`）。姓名为空则这块不渲染，也不用假人垫底。

代码：`lib/shellViewer.ts` 的 `shellViewerFromUser`；`components/ShellViewer.tsx`；`components/AppShell.tsx`；`app/api/navigation/route.ts`。

测试：`tests/unit/chrome-copy-fixes.test.ts`。

### 去掉铃铛

原来：顶栏有一颗 `aria-label="Notifications"` 的按钮，没有 `onClick`，也没有可打开的、按当前用户过滤的通知列表。学习通知接口固定返回空数组。

现在：这颗按钮不在顶栏里。壳上留下的按钮都有点击处理。

代码：`components/AppShell.tsx`。

测试：`tests/unit/chrome-copy-fixes.test.ts`（与上一节同一条）。

## 6. 试用与购买文案、范围

### 取消文案

原来：取消对话框对试用也说当前周期结束前访问还在。en-GB 是 “Your current access remains available until the end of this period.”，zh-CN 是访问权限不会立即受到影响。`cancelSubscription` 对试用却是立刻把权益标成结束。

现在：试用取消说明是立即结束。en-GB：`Cancelling ends this trial immediately and removes course access.` zh-CN：「取消后试用立即结束，课程访问权限会马上收回。」付费订阅仍用到期日那句，不是这句试用说明。命令本身：试用变为 `trial_canceled`，对应权益 `expired`，`checkEntitlement` 的 `allowed` 为 false。

代码：`components/portal/SubscriptionManager.tsx`（`source === "trial"` 时用 `copy.cancelDescription`）；`messages/en-GB.json`、`messages/zh-CN.json` 的 `learning.cancelDescription`；`services/productStore.ts` 的 `cancelSubscription`。

测试：`tests/unit/purchase-bug-locks/trial-cancel-dialog.test.ts`。

### Course 标签

原来：取消对话框把 `scope === "course"` 的方案标成 `Category`。课程方案和分类方案在确认取消时是同一个词。

现在：`everything` 显示 `Everything`，`course` 显示 `Course`，其余显示 `Category`。Epicureanism · PC · 6 months 这类课程方案的标签是 `Course`。

代码：`components/portal/SubscriptionManager.tsx` 取消对话框里 `.cancel-plan-name` 的范围词。

测试：`tests/unit/purchase-bug-locks/trial-cancel-dialog.test.ts`。

### 一台电脑

原来：PC 方案的确认和定价文案写成 1 台电脑加 1 台手机。同一方案用 `device=mobile` 查权益得到 `allowed: false`，文案多报了手机。

现在：确认页按方案的 `device` 取一句。`pc` 是 en-GB `1 PC`、zh-CN「1 台电脑」；`mobile` 才是 “Mobile only” / 「仅手机」。`GET /api/entitlements/check?courseId=epicureanism&device=mobile` 对 `epicureanism-pc-6` 返回 `allowed: false`，`device` 仍是 `pc`。定价页 `pricingDesign.devices` 是 “Study on 1 PC” / 「支持 1 台电脑」，规则正文里也不出现 1 台电脑加 1 台手机。

代码：`components/portal/SubscriptionConfirmation.tsx`（`plan.device === "pc" ? copy.pcDevice : copy.mobileDevice`）；`app/api/entitlements/check/route.ts` 的 `GET`；`messages/en-GB.json`、`messages/zh-CN.json` 的 `pricingDesign.devices` 与 `portal.subscriptionConfirmation.pcDevice`。

测试：`tests/unit/purchase-bug-locks/epicureanism-pc-claims-mobile.test.ts`、`tests/unit/shown-command-state.test.ts`。

### Everything 结束它覆盖的试用

原来：先开通 Epicureanism 试用，再完成 Everything 购买之后，试用权益仍是 `active`。`GET /api/subscription` 仍把 `epicureanism-pc-6` 显示为有效试用。

现在：购买完成时，`expireCoveredTrials` 把该用户身上、被这个方案覆盖的 `active` 试用标成 `expired`（同一 `planId`，或试用方案与新方案覆盖同一门已发布课）。重叠的 active 权益改为 `expired`，不删除旧行。订阅列表里不再有一条仍有效的 Epicureanism 试用。

代码：`services/productStore.ts` 的 `expireCoveredTrials`、`expireOverlappingActiveEntitlements`，由 `fulfilDemoPurchase` 与 `grantPurchaseAccess` 调用。`app/api/subscription/route.ts` 的 `GET` 返回 `getLearningOverview` 里的订阅。

测试：`tests/unit/purchase-bug-locks/everything-purchase-leaves-course-trial-active.test.ts`。

### `no_access_history` 不重复同一句

原来：试用结束后的我的学习卡片，状态标签和说明都是 `outsideAccess` 那一句。

现在：`no_access_history` 的状态标签仍是 `overviewDesign.outsideAccess`（en-GB：`Your saved course is not in the current access range.`）。说明是另一句 `overviewDesign.historyWithoutAccess`（en-GB：`This course stays in your history. Choose a plan to study it again.`）。两段文字不相等。

代码：`app/[locale]/account/my-learning/page.tsx` 的 `stateLabel` 与 `.overview-course-description`。

测试：`tests/unit/purchase-bug-locks/my-learning-no-access-repeats-sentence.test.ts`。

## 7. 支付不变量

### 0 元发票不转付费

原来：`convertStripeTrial` 只要找到未过期的试用，就把试用标成 `expired`，并写入 `source: "purchase"` 的订单和权益。`amountMinor` 为 0 也这样做，试用窗口被换成付费期限。

现在：`amountMinor <= 0` 时 `convertStripeTrial` 返回 `null`，试用的 `state`、`validTo` 和 `source` 都不变，也不新增购买订阅。`applyVerifiedStripeEvent` 对 `source === "trial"`、`billingReason === "subscription_create"` 且 `amountMinor === 0` 的 `invoice.paid` 同样不把试用改成购买；权益来源仍是 `trial`，`validTo` 仍落在试用窗口内。

代码：`services/productStore.ts` 的 `convertStripeTrial`、`applyVerifiedStripeEvent`。

测试：`tests/unit/pay-invariants.test.ts`。

### 退款挡住再次授权

原来：订单已退款、权益已是 `revoked` 之后，后到的 `invoice.paid` 仍会把订阅和权益写成有效购买。

现在：`refundBlocksInvoiceGrant` 为真时，`applyVerifiedStripeEvent` 的发票分支和随后的订阅状态更新都不恢复访问。判定是：同一 `stripeSubscriptionId` 上有 `refunded` 订单，或该订阅匹配到的权益全部为 `revoked`。`checkEntitlement` 仍是 `allowed: false`，购买权益保持 `revoked`。

代码：`services/productStore.ts` 的 `refundBlocksInvoiceGrant`、`applyVerifiedStripeEvent`；退款写入在 `refundOrder`。

测试：`tests/unit/pay-invariants.test.ts`、`tests/unit/refund-then-invoice.test.ts`。

### 宽限锚在 `validTo`

原来：`markStripeSubscriptionGrace` 把宽限结束写成「现在加 3 天」，并覆盖 `validTo`。一条还有数月的付费期限被收成三天。

现在：进入宽限前的 `validTo` 加上 3 天（`TRIAL_DAYS`）同时成为 `graceEndsAt` 和新的 `validTo`。状态是 `grace`。已经是 `grace` 时再调用一次，两个时间戳不变。未付款发票事件用 `periodStart`，没有 `periodStart` 时用当时的 `validTo`，同样加 3 天；同一失败再投递一次不再把窗口往后延。付费期限不会被收成「现在加 3 天」。

代码：`services/productStore.ts` 的 `markStripeSubscriptionGrace`；`applyVerifiedStripeEvent` 里 `status === "open"` 的宽限分支。

测试：`tests/unit/pay-invariants.test.ts`。

### 期末取消不被 `invoice.paid` 清掉

原来：`applyStripePaidInvoice` 在收到已付发票时把 `cancelAtPeriodEnd` 写成 false，并把状态写成 `active`。用户已经选择期末取消之后，下一张发票又把它恢复成自动续费。

现在：本地 `cancelAtPeriodEnd` 为真时，已付发票把状态写成 `cancel_at_period_end`，标志保持 true。`applyVerifiedStripeEvent` 处理发票时只在事件自己带了 `cancelAtPeriodEnd: true` 时把标志设为真，不用事件里的 false 把它清掉。此后 `resumeSubscription` 对购买订阅拒绝恢复。当前周期内 `checkEntitlement` 仍允许访问。

代码：`services/productStore.ts` 的 `applyStripePaidInvoice`、`applyVerifiedStripeEvent`。

测试：`tests/unit/pay-invariants.test.ts`。
