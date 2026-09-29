# 用户路径树与可访问性树

上游 `main`：`83778295398d37bd3de17d4a6566c0554e45f7cc`（`feat(portal): align learning pages with figma`）。

学员站用 `http://127.0.0.1:3031`，后台用 `http://localhost:3031`。环境是 `APP_ENV=DEV`、`STORAGE_BACKEND=local`、`PAYMENT_MODE=demo`、`LOCAL_SOCIAL_LOGIN=1`、`EMAIL_VERIFICATION_REQUIRED=0`、`ADMIN_HOSTS=localhost`。视口 1440×900。下面只写实际点过或打开过的路径。

第一次打开 `http://127.0.0.1:3031/` 时，首页 `GET /en-GB/portal` 返回 500。服务端是 `CredentialsProviderError: Could not load credentials from any providers`，出在首页给课程封面签名。签名失败的是数据迁移带进来的 Quintus Horatius Flaccus，封面指向私有 S3。这一下把首页这条路径堵住了。随后只在本机数据里把这门课标成 `archived`，好让其余页面能渲染。这个改动没有进 git，也不是产品修复。归档之后，学员目录里不再出现这门课；后台课程列表里它以 Archived 出现。

## 这两棵树各自抓住什么

路径树记的是允许的移动和死路：人想做什么、点了哪个控件、落到哪个 URL、文案和下一步是否打架。它不说明一个按钮有没有可访问名称，也不说明两个标题在画面上是否叠在一起。

可访问性树更适合检查结构、名称和阅读顺序。重叠、颜色，以及文字是不是写在照片里面，仍然要看截图。它不能代替路径树：树里有一个链接，并不说明顺着它走下去会不会被登录墙、空列表或另一套价格拦住。

## 用户路径树

- 游客打开 `/`
  - 想进网站。地址栏输入根路径。
  - 落到 `http://127.0.0.1:3031/en-GB/portal`。
  - 第一次被首页 500 挡住，见上文。归档 Horace 之后，同一地址返回 200。
  - 标题是 “Learn with curiosity. Grow with confidence.”
  - 热门课两张卡：Epicureanism，`2 lessons · 0h 45m`；Stoicism，`2 lessons · 0h 38m`。
  - 页眉：Courses、Study Groups、Pricing、语言（看见的字是 EN）、Sign in、Get Started。
  - 首屏还有 Cookie 条：Use essential cookies only、Allow optional cookies。
  - Explore more
    - 想从首页继续看课。点 Explore more。
    - 落到 `/en-GB/portal/courses`。
  - 语言
    - 想换成简体中文。点语言链接。
    - 落到 `/zh-CN/portal`。主标题变成「怀着好奇学习，带着自信成长。」课程名仍是 Epicureanism、Stoicism。
    - 再点 Switch to English (UK)，回到 `/en-GB/portal`。
  - Courses
    - 想浏览目录。点页眉 Courses，或首页 View All Courses。
    - 落到 `/en-GB/portal/courses`。标题 “Explore all courses”。下面同一句又出现一次。
    - 两门课都有 View course。Start preview 链到第一门课的公开课。
    - 分类 Chinese Humanities
      - 想只看中国人文。点分类里的 Chinese Humanities。
      - 落到 `/en-GB/portal/courses?category=Chinese%20Humanities`。
      - 文案是 “No published courses are available yet.”
    - 分类 Science
      - 同样落到空目录：“No published courses are available yet.”
    - Start preview
      - 想不登录就试看。点 Start preview。
      - 落到 `/en-GB/portal/sign-in?returnTo=%2Fen-GB%2Fportal%2Fcourses%2Fepicureanism%2Fpublic-lesson`。
      - 公开课没有打开。这是已知的公开课登录墙，目录上的 “Start preview” 也走进去了。
    - View course
      - 想看 Epicureanism 的介绍。点第一张卡的 View course。
      - 落到 `/en-GB/portal/sign-in?returnTo=%2Fen-GB%2Fportal%2Fcourses%2Fepicureanism`。
      - 课程详情对游客同样先要登录。
  - 直接打开公开课
    - 想绕过目录试听。打开 `/en-GB/portal/courses/epicureanism/public-lesson`，以及 Stoicism 的同一路径。
    - 两处都落到登录页，`returnTo` 指回公开课。
  - Pricing
    - 想看价钱并订阅。点页眉 Pricing。
    - 落到 `/en-GB/pricing`。标题是 Subscription，副题是 “Choose the plan that suits your interests”。
    - Everything 是 $99 USD，列出 Epicureanism 和 Stoicism，按钮 Subscribe。
    - Category 默认是 Chinese Humanities，$39 USD / category。课程列表标题在，列表是空的，Subscribe 仍在。
    - 再点分类卡上的 European Humanities（按下状态变为 true）。列表变成 Epicureanism、Stoicism。
    - 这一页没有 “Start three-day trial”。
    - Subscribe（未登录）
      - 想订阅 Everything。点第一张卡的 Subscribe。
      - 落到 `/en-GB/portal/sign-in?returnTo=%2Fen-GB%2Fpricing%3FplanId%3Deverything-pc-6`。
      - 没有自动进入付款。登录后会不会接着订，这次没有继续走完。
  - 带课程的价格页（仍未登录）
    - 打开 `/en-GB/pricing?courseId=epicureanism`。
    - 除了上面的两张卡，还有 Epicureanism · PC · 6 months $49.00 USD、12 months $79.00 USD，以及 Start three-day trial。
  - Study Groups
    - 想找小组。点页眉 Study Groups。
    - 落到 `/en-GB/portal/study-groups`。
    - 页面写 “Study Groups are being prepared”，创建、邀请和讨论都还没有控件。这是一条明确停住的路。
  - Contact
    - 想联系人。打开 `/en-GB/contact`。
    - 标题 Get in Touch。有姓名、邮箱、电话、主题、留言和隐私勾选。这次没有提交。
  - 登录入口
    - 想登录。打开 `/en-GB/portal/sign-in`。
    - 标题 Sign in。说明是：先输入邮箱，再去登录或激活账号。
    - 控件是 Email、Continue with email、Google、WeChat、Need an account? Create one。
    - 新邮箱 `ava@ux-review.test`
      - 点 Continue with email。
      - 落到 `/en-GB/portal/sign-up?email=ava%40ux-review.test&returnTo=%2Fen-GB%2Faccount%2Fmy-learning`。
    - 已有邮箱
      - 点 Continue with email。
      - 落到 `/en-GB/portal/sign-in?step=password&email=ava%40ux-review.test&returnTo=%2Fen-GB%2Faccount%2Fmy-learning`。
      - 这里才出现密码、Remember password、Forgot your password?、Sign in。
  - 注册
    - 想建账号。在上一页填写 Name `Ava`、Email、Password，点 Create account。
    - 这套 `EMAIL_VERIFICATION_REQUIRED=0` 下，账号变成 active。没有停在 check-email。
    - 之后从密码步骤点 Sign in，落到 `/en-GB/account/my-learning`，标题 “Welcome back, Ava”。
    - 没有造出 pending 用户。邮箱检查接口对 Ava 返回 `pending: false`。
  - check-email
    - 注册按钮没有把人带到这里。直接打开 `/en-GB/portal/check-email?email=ava@ux-review.test`。
    - 页面仍写已经把激活链接发到邮箱，要在 24 小时内打开才能登录。
    - 和实际注册路径相反：Ava 没有收到这封信，也能登录。
    - 下面的链接是 Already have an account? Sign in，以及 Resend activation email。
  - Forgot your password?
    - 从密码步骤点 Forgot your password?。
    - 落到 `/en-GB/portal/forgot-password?email=ava%40ux-review.test&returnTo=%2Fen-GB%2Faccount%2Fmy-learning`。
    - 点 Send reset email 之后仍停在这张表单，没有看到已发送或失败说明。
  - Google（本地演示）
    - 在登录页点 Google。
    - 落到 `/en-GB/account/my-learning`，显示 “Welcome back, google.local”，没有有效订阅。
  - Get Started
    - 页眉按钮走向注册，不直接进课。

- 已登录学生 Ava
  - 我的学习 `/en-GB/account/my-learning`
    - 登录后的第一屏。试用之前写着没有有效订阅，也还没有进入过试看。
    - 侧栏：Overview、My Subscription、Notification Center、Personal settings、Help Center / FAQ，以及 Contact support。
    - 侧栏标题字是 MY LEARNING。
  - Personal settings
    - 点 Personal settings。
    - 落到 `/en-GB/account/my-learning/settings`，标题 Personal settings。
    - 看见头像上传、Name、Email（写着邮箱是主账号）、Country、兴趣、年龄。这次没有保存。
  - 课程详情 `/en-GB/portal/courses/epicureanism`
    - 登录后能打开。面包屑：Home、Courses、European Humanities、Course Info。
    - 统计是 2 Lessons、0.75 Hours。首页同一门课写的是 `0h 45m`（25 分钟加 20 分钟）。
    - What you'll learn 列出的是：用数学给真实生物系统建模、用欧拉法模拟非线性动力、学一门编程语言、正负反馈、跨学科动力、未来医生和研究者需要的能力。
    - 正文和课名仍是伊壁鸠鲁、快乐与死亡。学习目标和课程不是一件事。
    - 试用前：第 1 课 “Pleasure and the Good Life” 有 Preview。第 2 课 “Why Death Is Nothing to Us” 在页面上是标题，没有可点的 Preview。
    - 侧栏写 INCLUDED WITH A CATEGORY PLAN，价格是 `$69 / 6 months`，链接 View all benefits。
    - 这和带 `courseId` 的价格页不是同一个价：那边是这门课自己的 6 个月 $49。
  - Preview
    - 试用前点第 1 课 Preview。
    - 落到 `/en-GB/portal/courses/epicureanism/public-lesson?lessonId=pleasure-and-the-good-life`。
    - 眉题 PUBLIC FIRST LESSON，标题 Pleasure and the Good Life，25 minutes，正文可以读。
  - 三天试用
    - 打开 `/en-GB/pricing?courseId=epicureanism`，点 Start three-day trial。
    - 确认对话框里勾选同意后点 Continue。
    - 落到 `/en-GB/portal/payment/checkout?orderId=...`。
    - 眉题 LOCAL PAYMENT TEST。计划是 Epicureanism · PC · 6 months。金额是 “USD 0.00 (trial activation)”。状态 Payment pending。按钮是 Complete payment、Simulate failure、Cancel。
    - 点 Complete payment。
    - 我的订阅页列出 Epicureanism · PC · 6 months、Trial、Valid until: 02/10/2026、Cancel。同一页又写 “You have no successful subscription payments yet.”
    - 回到 `/en-GB/account/my-learning`：Current access · Epicureanism，这门课是 In progress。
    - 试用完成后再打开公开课，页底有 Mark lesson complete、Continue learning、Open course。
  - 登录后的语言
    - 在价格页切到中文时，地址变成 `/zh-CN/pricing?courseId=epicureanism`。
    - 说明是「选择适合您的学习方案」，主标题仍是 Subscription。分类说明里仍有 All categories、Particular category、Course list in this category、Better Value。课程名和英文简介还在。

- 运营，主机是 localhost
  - 在 localhost 打开 `/en-GB/portal`
    - 想看学员首页。被转到 `/en-GB/backoffice/sign-in`。
    - 后台主机不提供学员站。
  - 在 127.0.0.1 打开 `/en-GB/backoffice/courses`
    - 落到 404 Not Found。学员主机不提供后台。
  - 后台登录 `/en-GB/backoffice/sign-in`
    - 标题 Learning Guide Backoffice Portal。说明是用已验证的 course-author 或 operator 账号登录。
    - 默认是 Email、Password、Sign in，以及 First-time operator setup。
  - 错误邮箱
    - 点 First-time operator setup，填 `stranger@ux-review.test`，点 Create operator account。
    - 接口 403，`OPERATOR_REQUIRED`。页面仍停在登录表单。
    - 可见句子是 “Course Manager/Operator access is required for this area.”
  - 指定运营邮箱
    - 用 `operator@ux-review.test` 创建或登录。
    - 落到 `/en-GB/backoffice/courses`。
    - 标题 Course Management。计数曾显示 Total 3、Published 2、Archived 1、Lessons 4。
    - 列表里有 Archived 的 Quintus Horatius Flaccus（这次为了绕开首页 500 在本机归档的），以及 Published 的 Stoicism、Epicureanism。
    - 行上的控件是 Edit course、Preview、Course ownership，已发布课还有 Archive、Unpublish，归档课是 Restore draft。
    - 导航还有 Portal content、Order Management、Payment Management、AI settings。这次没有再往下点。

## 可访问性树

原始 JSON 在 `/opt/cursor/artifacts/a11y/`，不进 git。采集用的是 Chromium 无障碍树（`Accessibility.getFullAXTree`），视口 1440×900。下面的标题和控件按树里的顺序。没有发现完全没有名字的 button 或 link。

### 学员首页 en-GB

文件：`learner-home-en-GB.json`。URL：`/en-GB/portal`。这是归档 Horace 之后、Cookie 条还在时的树。

标题：

1. Learn with curiosity. Grow with confidence.
2. Popular courses
3. Epicureanism
3. Stoicism
2. A Lifelong Home For Thinking. Not just knowledge, the habit of thought, and a wider view of the world.
3. Thinking, Not Just Learning
3. Guided, Not Alone
3. Depth Over Speed
3. A Wider World, Not A Narrower Path
2. Quickly Guide
3. AI Tutor
3. Group Study
3. Study With Us
2. Learning Guide

按钮和链接：Learning Guide，Courses，Study Groups，Pricing，切换到简体中文，Sign in，Get Started，Explore more，Banner 1，Banner 2，Banner 3，View course: Epicureanism，View course: Stoicism，View All Courses，Chinese Humanities，European Humanities，Science，Help Center / FAQ，Contact us，Cookie settings，Privacy Policy，Terms of Service，Cookie Settings，Use essential cookies only，Allow optional cookies。

问题：语言控件看见的字是 EN，可访问名称是中文「切换到简体中文」。指南一节的标题在树里是 “Quickly Guide”。轮播按钮只有 Banner 1/2/3，照片里如果还有字，这棵树读不到。

### 课程目录 en-GB

文件：`courses-en-GB.json`。URL：`/en-GB/portal/courses`。

标题：h1 和 h2 都是 Explore all courses；然后是 Epicureanism、Stoicism；再是 “Learn with structure, guidance and room to think.”；页脚 Learning Guide、Courses、Support、Legal。

按钮和链接：页眉六个入口，Start preview，All Courses，Chinese Humanities，European Humanities，Science，两个都叫 View course 的链接，页脚再来一组分类和帮助、联系、Cookie、隐私、条款。

问题：Explore all courses 作为标题出现两次。两个 View course 名称相同，树本身分不出是哪一门课；课名在相邻的 h3 里。

### 登录 en-GB

文件：`sign-in-en-GB.json`。URL：`/en-GB/portal/sign-in`。这是先填邮箱的那一步。

标题只有 Sign in。

按钮和链接：页眉，Need an account? Create one，文本框 Email，Continue with email，Google，WeChat，Back to Learning Guide Portal。

密码步骤另存为 `sign-in-password-en-GB.json`。多出来的控件是文本框 “Password Show password”、按钮 Show password、勾选 Remember password、链接 Forgot your password?、按钮 Sign in。密码框的可访问名称把 “Show password” 算了进去，因为显示密码的按钮放在标签里面。

### 注册 en-GB

文件：`sign-up-en-GB.json`。URL：`/en-GB/portal/sign-up?email=ava@ux-review.test&returnTo=/en-GB/account/my-learning`。

标题只有 Create your account。

按钮和链接：Already have an account? Sign in，文本框 Name、Email、“Password Show password”，Show password，Create account，Google，WeChat。

问题和登录密码步骤一样：密码框名称里夹着 Show password。

### 价格 en-GB

文件：`pricing-en-GB.json`。URL：`/en-GB/pricing`。

标题：Subscription，Everything，Category，Important information，Changing plans，Device access，Renewal pricing，然后是页脚四组。

按钮和链接：6 Months，Better Value 1 Year，中国/欧洲/科学三枚（Everything 卡），Subscribe，再三枚分类（Category 卡），Subscribe，页脚链接。

问题：Everything 卡上的三枚分类按钮在树里全是 pressed。Category 卡上只有当前分类是 pressed。年付按钮的名称是 “Better Value 1 Year”，Better Value 和年限粘在同一个按钮上。这棵树里没有试用按钮；试用按钮只在带 `courseId` 的价格页出现，那一页没有单独再存一棵树。

### 课程页 Epicureanism

文件：`course-epicureanism-en-GB.json`。URL：`/en-GB/portal/courses/epicureanism`。这是 Ava 已登录、试用之前。

标题：Epicureanism，Overview，What you'll learn，Course Curriculum，Lesson1 Pleasure and the Good Life，Lesson2 Why Death Is Nothing to Us，This course provides，INCLUDED WITH A CATEGORY PLAN，然后页脚。

按钮和链接：页眉（此时是 My Learning、Notifications、Ava account menu），面包屑 Home、Courses、European Humanities，Pleasure and the Good Life，Preview，View all benefits，页脚。

问题：第 2 课只有标题，没有链接或按钮。树能看出第 1 课可预览、第 2 课不能点。它看不出 “What you'll learn” 的句子是不是这门课的内容，那是路径里读到的正文。

### 我的学习

文件：`my-learning-en-GB.json`。URL：`/en-GB/account/my-learning`。试用之前。

标题：Welcome back, Ava，Your learning，然后页脚。

按钮和链接：页眉，Ava account menu，Overview，My Subscription，Notification Center，Personal settings，Help Center / FAQ，Contact support，View courses，页脚分类和帮助。

没有未命名控件。侧栏的 MY LEARNING 是文字，不是这些链接的名称。

### 后台课程

文件：`backoffice-courses-en-GB.json`。URL：`http://localhost:3031/en-GB/backoffice/courses`。列表加载完成之后。

标题只有 h1 Course Management。

按钮和链接：Menu，LG Learning Guide，zh-CN，Sign out，Course Management，Portal content，Order Management，Payment Management，AI settings，Create，Course Management，Catalogue，然后三组 Edit course、Preview、Course ownership，归档课多 Restore draft，已发布课多 Archive 和 Unpublish，最后是 Previous page、Next page。

问题：Edit course、Preview、Archive、Unpublish 各出现多次，名称里没有课程名。课程名在旁边的文字里，不在控件名里。语言控件的名称是 zh-CN。

### 登录 zh-CN

文件：`sign-in-zh-CN.json`。URL：`/zh-CN/portal/sign-in`。

标题：登录。

按钮和链接：Learning Guide，课程，学习小组，价格，Switch to English (UK)，登录，开始学习，还没有账号？创建账号，文本框 邮箱，使用邮箱继续，Google，微信，返回 Learning Guide Portal。这次采集时 Cookie 条也在：Cookie 设置，仅使用必要 Cookie，允许可选 Cookie。

英文名称出现在中文页上：Learning Guide、Google、返回 Learning Guide Portal 里的产品名。微信是中文，Google 不是。

### 价格 zh-CN

文件：`pricing-zh-CN.json`。URL：`/zh-CN/pricing`。

标题：Subscription，全部课程，分类课程，重要信息，更改方案，设备访问，续订价格，Learning Guide，课程，支持，法律条款。

按钮和链接：6 个月，Better Value 1 年，中国人文，欧洲人文，科学，订阅，分类再来一组，然后页脚。Cookie 条也在。

英文名称：主标题 Subscription，按钮里的 Better Value，页脚品牌 Learning Guide。页面正文里还有 All categories、Particular category、Course list in this category，以及 Epicureanism、Stoicism 和英文课程简介。中文目录页 `/zh-CN/portal/courses` 底部三句仍是 Apply what you learn、Share your perspective、See the bigger picture。这些是已知的硬编码英文，记在这里是因为树和页面文字里真的读到了。

可访问性树比截图更适合抓结构、名称和阅读顺序，例如密码框名称被 Show password 污染、Everything 上三枚分类同时为 pressed、目录标题重复、后台三个 Edit course 分不开。重叠、颜色，以及英雄图或课程封面里的字，仍然要看截图。它不代替路径树：登录链接在树里名称完整，并不能说出未登录的 View course 会落到登录页，也不能说出 $69 和 $49 是不是同一笔钱。

## 发现

已知、这次也再次走到、不另立一条：

- 首页第一次 500，原因是 Horace 封面无法签名。
- 未登录打开公开课会进登录页。目录的 Start preview 和课程卡的 View course 也进登录页，课程详情对游客同样如此。
- 首页卡片时长是 `0h 45m`、`0h 38m`。
- 中文页上留下英文：价格主标题 Subscription、Better Value、All categories、课程名和英文简介、目录底部三句英文、品牌 Learning Guide。
- 英雄图里的字没有用这棵树判断。

这次走进去才看到的：

1. Epicureanism 的 What you'll learn 写的是生物系统建模、欧拉法、编程语言和未来医生。课名、简介和第一课正文是伊壁鸠鲁论快乐。目标和课不是同一门。
2. 课程页侧栏是分类方案 `$69 / 6 months`。从这门课打开的价格页，6 个月课程方案是 $49.00，试用结账写的是 Epicureanism · PC · 6 months、USD 0.00。同一门课旁边两套价。
3. 价格页默认的 Chinese Humanities 分类没有列出任何课，Subscribe 仍可点。目录里筛中国人文或科学，会说还没有已发布课程。只有改选 European Humanities，列表里才出现 Epicureanism 和 Stoicism。
4. 直接打开 check-email 会说激活信已经发出、24 小时内要点开才能登录。在 `EMAIL_VERIFICATION_REQUIRED=0` 下注册的 Ava 是 active，登录不经过这页。这条路上造不出 pending 用户。
5. 忘记密码提交之后仍停在原表单，没有看到已发送或失败说明。
6. 试用完成后，我的学习显示 Current access · Epicureanism；订阅页同时写还没有成功的付款，并列出一条 Trial，有效期到 02/10/2026。
7. localhost 上的学员首页会被转到后台登录；127.0.0.1 上的后台课程地址是 404。非指定邮箱创建运营账号时停在原表单，句子是 “Course Manager/Operator access is required for this area.”
