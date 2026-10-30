import nodemailer from "nodemailer";

function smtpConfigured() {
  return Boolean(process.env.SMTP_HOST?.trim() && process.env.SMTP_USER?.trim() && process.env.SMTP_PASS?.trim());
}

function fromAddress() {
  return process.env.SMTP_FROM?.trim() || process.env.SMTP_USER?.trim() || "";
}

export function emailDeliveryConfigured() {
  return smtpConfigured();
}

function logMail(event: string, detail: Record<string, unknown>) {
  console.info(JSON.stringify({ type: "mail", event, ...detail }));
}

async function sendViaSmtp(input: { to: string; subject: string; text: string; html: string }) {
  const from = fromAddress();
  if (!from) throw new Error("SMTP_FROM or SMTP_USER is not configured.");
  const port = Number(process.env.SMTP_PORT || "465");
  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port,
    secure: process.env.SMTP_SECURE?.trim() !== "0" && port === 465,
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS
    },
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 20_000,
    tls: { minVersion: "TLSv1.2" }
  });
  try {
    const info = await transporter.sendMail({
      from,
      to: input.to,
      subject: input.subject,
      text: input.text,
      // Plain text only: a single-link HTML body from a free mailbox is a
      // classic spam signature and Outlook rejects it outright.
      replyTo: from,
      headers: {
        "Auto-Submitted": "auto-generated",
        "X-Auto-Response-Suppress": "All"
      }
    }) || {};
    const accepted = Array.isArray(info.accepted) ? info.accepted.length : 0;
    const rejected = Array.isArray(info.rejected) ? info.rejected.length : 0;
    logMail("smtp_sent", {
      toDomain: input.to.split("@")[1] || "",
      accepted,
      rejected,
      messageId: info.messageId,
      response: typeof info.response === "string" ? info.response.slice(0, 160) : undefined
    });
    if (accepted === 0 && rejected > 0) throw new Error("SMTP rejected every recipient.");
  } catch (error) {
    logMail("smtp_failed", {
      toDomain: input.to.split("@")[1] || "",
      code: error instanceof Error ? (error as { code?: string }).code || error.name : "Error",
      message: error instanceof Error ? error.message.slice(0, 160) : "unknown"
    });
    throw new EmailDeliveryError();
  }
}

export class EmailDeliveryError extends Error {
  constructor(message = "Verification email could not be sent. Use a mailbox that this environment is allowed to mail.") {
    super(message);
    this.name = "EmailDeliveryError";
  }
}

async function sendEmail(input: { to: string; subject: string; text: string; html: string }) {
  // 163 SMTP is the only delivery path. SES stays out of the app because the
  // account is still in the sandbox and cannot reach learner mailboxes.
  if (!smtpConfigured()) {
    logMail("smtp_not_configured", {
      smtpHostSet: Boolean(process.env.SMTP_HOST?.trim()),
      smtpUserSet: Boolean(process.env.SMTP_USER?.trim()),
      smtpPassSet: Boolean(process.env.SMTP_PASS?.trim())
    });
    throw new EmailDeliveryError("Email delivery is not configured.");
  }
  return sendViaSmtp(input);
}

export function sendVerificationEmail(input: { to: string; url: string; locale?: "en-GB" | "zh-CN" }) {
  const chinese = input.locale === "zh-CN";
  return sendEmail({
    to: input.to,
    subject: chinese ? "Learning Guide 账号确认" : "Learning Guide account confirmation",
    text: chinese
      ? `您好：\n\n有人使用这个邮箱注册了 Learning Guide 账号。请打开下面的链接完成确认：\n\n${input.url}\n\n链接 24 小时内有效。如果这不是您本人的操作，可以忽略此邮件，账号不会被激活。\n\nLearning Guide`
      : `Hello,\n\nSomeone used this address to create a Learning Guide account. Open the link below to confirm it:\n\n${input.url}\n\nThe link expires in 24 hours. If this was not you, ignore this message and the account will stay inactive.\n\nLearning Guide`,
    html: chinese ? `<p>请点击下面的链接激活您的 Learning Guide 账号：</p><p><a href="${input.url}">激活账号</a></p><p>此链接将在 24 小时后失效。</p>` : `<p>Verify your Learning Guide account by opening this link:</p><p><a href="${input.url}">Verify email address</a></p><p>This link expires in 24 hours.</p>`
  });
}

export function sendEmailBindingEmail(input: { to: string; url: string; locale: "en-GB" | "zh-CN" }) {
  const chinese = input.locale === "zh-CN";
  const title = chinese ? "验证并绑定您的邮箱" : "Verify and bind your email";
  const description = chinese ? "请确认将此邮箱绑定到您的 Learning Guide 微信账号。链接 24 小时内有效。" : "Confirm this email for your Learning Guide WeChat account. This link expires in 24 hours.";
  const url = input.url.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
  return sendEmail({ to: input.to, subject: title, text: `${description}\n\n${input.url}`, html: `<p>${description}</p><p><a href="${url}">${title}</a></p>` });
}

/** Study Group mail. A Live Session reminder carries the session's page as a button plus the plain URL (for clients that drop the button). */
export function sendStudyGroupReminderEmail(input: { to: string; subject: string; text: string; link?: string | null; locale?: "en-GB" | "zh-CN" }) {
  const safe = input.text.replace(/&/g, "&amp;").replace(/</g, "&lt;");
  if (!input.link) return sendEmail({ to: input.to, subject: input.subject, text: input.text, html: `<p>${safe}</p>` });
  const chinese = input.locale === "zh-CN";
  const label = chinese ? "进入直播课" : "Enter Live Session";
  const htmlUrl = input.link.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
  return sendEmail({
    to: input.to,
    subject: input.subject,
    text: `${input.text}\n\n${label}: ${input.link}`,
    html: `<p>${safe}</p><p><a href="${htmlUrl}">${label}</a></p><p>${chinese ? "或打开这个链接：" : "Or open this link: "}${htmlUrl}</p>`
  });
}

/** Helpdesk updates to the ticket's contact email (agent reply, "is it solved?"). Plain text; the HTML part is escaped text. */
export function sendHelpdeskUpdateEmail(input: { to: string; subject: string; text: string }) {
  const safe = input.text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/\n/g, "<br>");
  return sendEmail({ to: input.to, subject: input.subject, text: input.text, html: `<p>${safe}</p>` });
}

export function sendPasswordResetEmail(input: { to: string; url: string; locale?: "en-GB" | "zh-CN" }) {
  const chinese = input.locale === "zh-CN";
  const htmlUrl = input.url.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
  return sendEmail({
    to: input.to,
    subject: chinese ? "Learning Guide 密码重置" : "Learning Guide password reset",
    text: chinese
      ? `您好：\n\n有人请求重置这个 Learning Guide 账号的密码。请打开下面的链接设置新密码：\n\n${input.url}\n\n链接一小时内有效，只能使用一次。如果这不是您本人的操作，可以忽略此邮件，原密码保持不变。\n\nLearning Guide`
      : `Hello,\n\nSomeone asked to reset the password for this Learning Guide account. Open the link below to choose a new password:\n\n${input.url}\n\nThe link expires in one hour and can be used once. If this was not you, ignore this message and the current password stays unchanged.\n\nLearning Guide`,
    html: chinese ? `<p>请点击链接重置密码：</p><p><a href="${htmlUrl}">重置密码</a></p><p>链接将在一小时后失效，只能使用一次。</p>` : `<p><a href="${htmlUrl}">Reset password</a></p><p>This link expires in one hour and can only be used once.</p>`
  });
}
