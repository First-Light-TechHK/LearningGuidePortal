# Native i18n

UI/static text 放在 `en-GB.json` 和 `zh-CN.json`，路由使用 `/[locale]/...`。Course title/body、字幕、source material 和 AI Tutor knowledge 不放在 UI message 文件中；它们按 Course/Section/Lesson、locale 和版本保存。

## 语言规则

页面只显示一种语言，就是地址栏里的语言（`/[locale]/...`）。

- 界面文案只放这里，`tests/unit/i18n-guard.test.ts` 检查两份语言包一致、中文里没有未翻译的英文词。
- 日期用 `Intl` 并传页面语言。
- 服务端不写给页面看的句子：接口返回错误码，页面用语言包翻译。要在站内稍后显示的通知，写入时存两种语言（`copies`），读取时按页面语言取。
- `user.locale` 是用户选的语言，只给页面之外的地方用（邮件、AI Tutor 的回答语言）。页头切换语言和设置页都会更新它。
- 课程标题和正文是数据，目前只有一种语言（见上）。

浏览器里的整页检查是 `tests/e2e/locale-purity.ts`，浏览器语言设成相反的语言，读渲染结果。
