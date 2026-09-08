# Learning Guide 如何使用 AWS SES 发信

线上发信走 **163 SMTP**（`smtp.163.com:465`），发件人是 `learningguide@163.com`。AWS SES 只是备用；只要设置了 `SMTP_HOST`、`SMTP_USER`、`SMTP_PASS`，应用会优先用 SMTP。不要把 163 授权码写进 Git。

当前环境：

| 项 | 值 |
|---|---|
| AWS 区域 | `ap-southeast-1`（新加坡） |
| 发件地址 | `learningguide@163.com` |
| 身份状态 | 已验证（`VerifiedForSendingStatus=true`） |
| App Runner 服务 | `learning-guide-portal-v2` |
| 站点 | `https://www.ilovelearningguide.com` |
| 应用变量 | `SES_FROM_EMAIL=learningguide@163.com`，`AWS_REGION=ap-southeast-1` |
| 发送方式 | 应用内 `@aws-sdk/client-sesv2` 的 `SendEmail`，由实例角色调用 SES API |

163 的授权码、POP3/IMAP/SMTP **不要**写进 App Runner。应用发信不需要它们。

## 邮件在产品里什么时候发出

代码在 `services/emailService.ts`。

- 注册激活：`sendVerificationEmail`。仅当 `EMAIL_VERIFICATION_REQUIRED` 不是 `0` 时，注册接口才会发信。
- 重发激活：`/api/auth/resend-verification`。
- 密码重置：`sendPasswordResetEmail`。仅生产环境（`APP_ENV` 为 PPE/PROD 或 PROD）且邮箱投递已配置时发送。

当前线上 `EMAIL_VERIFICATION_REQUIRED=0`，所以网站**还不会**自动发激活邮件。发件身份已经可用，但要等下面两件事都就绪后再打开验证：

1. SES 生产发送权限批准（现在仍是沙箱）。
2. 把 `EMAIL_VERIFICATION_REQUIRED` 设为 `1` 并重新部署。

## 沙箱和生产的区别

当前账号 `ProductionAccessEnabled=false`，仍在 SES 沙箱：

- 每天最多约 200 封，每秒 1 封。
- **只能发给已经在 SES 里验证过的收件地址**。
- 发给未验证的新用户会失败。

因此现在不适合对真实注册用户打开邮箱验证。生产权限申请已提交，批准前不要把验证开关打开。

批准后可以发给任意收件人，发件人仍必须是已验证的 `learningguide@163.com`。

## 控制台里看什么

1. 打开 [SES 控制台](https://ap-southeast-1.console.aws.amazon.com/ses/home?region=ap-southeast-1)。区域必须是 **Asia Pacific (Singapore)**。
2. **Verified identities** 里应有 `learningguide@163.com`，状态为 **Verified**。
3. **Account dashboard** 里看 Sending status 和 Production access。沙箱期间不要用未验证地址做注册测试。

命令行：

```bash
aws sesv2 get-email-identity \
  --region ap-southeast-1 \
  --email-identity learningguide@163.com

aws sesv2 get-account --region ap-southeast-1
```

`VerificationStatus` 应为 `SUCCESS`。`ProductionAccessEnabled` 为 `true` 后才可对公众发信。

## 沙箱里怎么试发一封

先把测试收件人也做成 SES 已验证身份（和发件人同一区域）：

```bash
aws ses verify-email-identity \
  --region ap-southeast-1 \
  --email-address you@example.com
```

打开该邮箱，点击 Amazon 验证链接。然后用已验证的发件人发一封测试信：

```bash
aws sesv2 send-email \
  --region ap-southeast-1 \
  --from-email-address learningguide@163.com \
  --destination ToAddresses=you@example.com \
  --content 'Simple={Subject={Data=Learning Guide SES test,Charset=utf-8},Body={Text={Data=SES send works.,Charset=utf-8}}}'
```

收件箱或垃圾箱应能看到这封信。发件人显示为 `learningguide@163.com`。

## 打开网站注册验证（生产权限批准之后）

在 App Runner 服务 `learning-guide-portal-v2` 中确认这些变量，然后更新服务：

| 变量 | 值 |
|---|---|
| `SES_FROM_EMAIL` | `learningguide@163.com` |
| `AWS_REGION` | `ap-southeast-1` |
| `EMAIL_VERIFICATION_REQUIRED` | `1` |
| `NEXT_PUBLIC_APP_URL` | `https://www.ilovelearningguide.com` |

`NEXT_PUBLIC_APP_URL` 会写进邮件里的激活链接，必须是用户能打开的 HTTPS 地址。

实例角色 `aitutor-apprunner-instance` 需要 `ses:SendEmail` 和 `ses:SendRawEmail`。这些权限已经加在内联策略 `aitutor-runtime-access` 里。不要把 SES 密钥放到前端。

冒烟检查：

1. 用一个新邮箱注册。
2. 收到主题为 “Verify your Learning Guide account” 或 “激活您的 Learning Guide 账号” 的邮件。
3. 未点击链接前不能登录。
4. 链接只能成功使用一次；重发后旧链接失效。

## 发件身份掉了怎么处理

身份变回 `PENDING` 或删掉后，应用调用 SES 会失败，注册会返回邮箱投递失败。

1. 在 `ap-southeast-1` 重新创建或验证 `learningguide@163.com`。
2. 打开该 163 邮箱（含垃圾箱），点击 **Amazon SES** 验证邮件里的链接。只读邮件、不点链接不会通过。
3. 再跑上面的 `get-email-identity`，确认为 `SUCCESS`。

不要在别的区域验证。应用固定使用 `ap-southeast-1`。

## 不要做的事

- 不要把 163 授权码配进 `SMTP_*` 环境变量。当前代码不读 SMTP。
- 不要把 `SES_FROM_EMAIL` 改成未验证地址。
- 沙箱未解除前不要把 `EMAIL_VERIFICATION_REQUIRED` 设为 `1`。
- 不要把授权码、AWS 密钥写进 Git。
