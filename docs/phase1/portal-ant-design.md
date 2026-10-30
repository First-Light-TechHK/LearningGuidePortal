# Portal 接入 Ant Design

实施日期：2026-10-28。当前本地分支 `feat/backoffice-ant-design`。用户确认上一轮四阶段建议后实施；本次改动尚未提交、推送或部署。

## 已迁移的范围

| 区域 | 实现 | 保留的行为 |
| --- | --- | --- |
| 主题与基础按钮 | `components/portal/ui/PortalProvider.tsx`、`PortalButton.tsx` | Portal 独立品牌主题、原始文案和导航语义 |
| 登录 / 注册 / 邮箱入口 | `AuthForm`、`AuthEntryForm`：AntD Input、Button | 原生 required/minLength/maxLength、双语校验、用户同意、重复提交锁、OAuth 与 returnTo |
| 密码重置 | 两个 `PasswordReset*Form`：Input、Button | 冷却、密码确认、失败重试、成功状态与原接口 |
| Contact | `app/[locale]/contact/ContactForm.tsx`：Input、TextArea、Button | FormData、原生校验、请求幂等键、失败保留输入、成功清空 |
| 购买 / 试用 | `PurchasePanel`：共享 Button | 服务端套餐资格、原报价 API、401 登录返回；各自加载状态、同步互斥锁与历史恢复 |
| 订阅选择 / 升级 | `PricingPlans`、`SubscriptionSelection` | 期限与分类 aria-pressed、不可购选项、卡片选中颜色、服务器价格和升级报价 |
| 确认与课程模式弹窗 | `SubscriptionConfirmation`、`CourseLearningModeDialog` 的主操作按钮 | 原生 dialog、原设计资产、同意门槛、Escape、焦点约束与业务请求 |
| 账户菜单 | `AccountMenu`：Dropdown | Next 链接、身份展示、退出 API；键盘打开/Escape/焦点恢复；新增双语菜单标签 |

选择器使用 AntD Button 保留既有 group/aria-pressed 交互。Everything 卡片中的全部分类是同时展示的状态，不能机械改成互斥 Radio；已购分类和不可购状态仍由服务端数据决定。

普通导航 Link / AuthNavigationLink、OAuth 链接、设计中的 checkbox/radio、CookieConsent、视频/阅读/Assessment/Exhibit 等专用控件保留原实现。本轮没有把整个 Portal 重做为默认 Ant Design 页面，也没有覆盖全部 My Learning 表单；Account 路由接入主题用于共享账户菜单。

## 样式如何合并

1. `portal`、`subscription`、`contact`、`account` 各自的 layout 使用 `AntdRegistry hashPriority="high"` 提供 SSR 样式；根 layout 不引入 AntD Provider/reset。布局和路径保持不变。
2. PortalProvider 仅配置组件主题，不包裹 AntD App 的排版容器；避免其默认链接/文字样式影响既有页头、正文和页脚。组件可独立使用，已有 Portal 上下文时不重复创建主题。
3. 使用现有 `lg-ant` 前缀，继续适配后台接入时添加的原生输入框选择器排除规则。Portal 的 `inherit:false` 主题与 BackofficeProvider 独立。
4. 品牌色 `#155dfc`、正文 `#15233a`、边框 `#d0d5dd`、Inter 和基础圆角/按钮字重由主题配置。中文两字自动加空格关闭；加载图标不加入按钮可访问名称；响应 reduced motion。
5. 新操作按钮使用 `portal-control-button`，不叠加旧 `.portal-button`。旧类继续用于尚未迁移的原生链接/控件。`app/portal-design.css` 中新的限定选择器保留登录、套餐卡片、订阅确认和 Contact 的既有尺寸、颜色、移动端排列。
6. 菜单弹层挂载在默认 body，但外观通过 `portal-account-dropdown` 限定；避免重置全站 a/button，亦避免被页头 overflow 截断。原生订阅弹窗继续使用浏览器 top layer。
7. 联系信息卡片允许长邮箱换行，网格和标签允许收缩；覆盖 320px 等窄屏。

## 迁移中的兼容细节

- 所有表单提交按钮显式设置 `htmlType="submit"`；其他操作默认 button。Enter 提交与现有同步 ref 锁一起验证，不以 loading 动画替代并发保护。
- AntD rc-input 的 onChange 可能返回克隆的事件目标。登录/注册字段通过真实 `onInput` 清除 DOM customValidity，避免输入已修正仍无法提交。
- AntD 输入组件保存内部状态，原生 form.reset 不能独立清除 TextArea 的显示状态。Contact 成功后重置表单并更新输入组件 key；只重挂输入字段，保留提交按钮与提示区域。
- 联系表单旧测试在 resize 后等待重排完成，再检查无溢出；持续溢出仍使测试失败。
- 购买与试用共享提交锁，各自显示 pendingAction；失败释放锁，浏览器历史缓存恢复后释放过期的 pending 状态。
- API、服务、数据库、Stripe、Subscription/Entitlement 决策没有变更，不需要数据库迁移。

## 本地验证结果

- `NEXT_DIST_DIR=.next-backoffice-check npm run build` 通过，复用已忽略的隔离构建目录，不占用运行中的开发服务输出。
- `npm run typecheck` 通过；本轮变更的源码/新测试 ESLint 无错误。AccountMenu 保留的两处原生头像 img 有既有性能提示，未添加规则屏蔽。
- **11 项页面回归通过**：账户菜单 SSR、认证重复提交、双语密码校验、Contact 幂等/重试/清空、订阅卡片布局、五类订阅状态、订阅确认、课程模式弹窗、购买资格、新 Portal 控件、后台控件隔离。
- **30 项服务/API 回归通过**：auth-navigation、subscription-selection、subscription-purchase-eligibility、subscription-confirmation-display/route、entitlement-and-auth、sit-password-reset、Contact 真实 Handler、subscription-management。
- 新 Portal 浏览器检查覆盖两种语言以及 320/390/768/1440px，检查 pending/失败重试/购买互斥、密码不一致与成功、菜单键盘打开/Escape/焦点、横向溢出及浏览器错误。
- `scripts/verify-portal-ant-design.mjs` 使用生产包和临时本地数据，真实验证 SSR 样式、邮箱/密码 Enter 登录和 returnTo、期限/分类切换、服务端 quote、确认勾选门槛、Escape 关闭、Contact API/字段清空、桌面/移动菜单、退出后访问拦截；两种语言全部通过，无 hydration 或未捕获错误。
- `scripts/verify-backoffice-ant-design.mjs` 再次通过：后台权限/订单/支付/CMS/课程和移动导航正常；Portal 首页 390/1440px 中英文无溢出，标题字体/颜色/几何与迁移前基线一致。
- 截图与记录：`test-results/portal-ant-design/`、`test-results/portal-ant-design-live/receipt.json`、`test-results/backoffice-ant-design-live/receipt.json`（均为本地忽略产物）。测试使用虚构账户/独立临时数据，没有真实支付、邮件或云部署。

运行新页面测试：

```sh
node --import tsx --require ./scripts/register-tsconfig-paths.cjs --test tests/unit/portal-ant-design-page.test.ts
```

运行真实生产包检查：

```sh
NEXT_DIST_DIR=.next-backoffice-check npm run build
node --import tsx --require ./scripts/register-tsconfig-paths.cjs scripts/verify-portal-ant-design.mjs
```

使用 Node 22。新测试及生产脚本在 macOS 优先使用已安装 Chrome，其他环境使用 Playwright Chromium。现有页面测试默认依赖 Playwright Chromium；本机本轮通过临时 preload 使用系统 Chrome 运行，未修改项目的全局浏览器配置。生产脚本默认使用 3043 端口，通过 PORTAL_CHECK_PORT 覆盖，完成后清理临时服务和数据。

## 仍待验收

本地截图用于回归，尚未逐页对照 DESIGN.md 指定的 Figma 节点/版本完成视觉验收。未部署目标环境；真实 Google/WeChat、密码重置邮件投递、Stripe 支付与 Webhook 仍按 release-runbook 验收。本地构建/测试通过不表示上述发布门槛已完成。

## 顶部入口悬停反馈（2026-10-28）

`app/portal-design.css` 为共享 PortalHeader 的语言切换、Sign In 和 Get Started 增加 160ms 悬停过渡：语言入口浅蓝背景/蓝字，登录入口浅蓝高亮，注册入口深蓝背景、轻阴影和 1px 上移。规则限定为精细鼠标指针；键盘有 focus-visible 轮廓，reduced-motion 关闭过渡和位移。链接、尺寸和页面布局保持。中英文 Portal/Subscription 页面在本机浏览器检查悬停、焦点、链接与 390px 无溢出；截图见 `test-results/portal-header-hover/`。Figma/目标环境验收仍沿用上文门槛。

本次悬停补充的生产构建通过；浏览器四组页面检查无未捕获错误。
