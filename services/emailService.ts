import { SESv2Client, SendEmailCommand } from "@aws-sdk/client-sesv2";
import nodemailer from "nodemailer";
import { awsRegion } from "./persistence/config";

let client: SESv2Client | null = null;

function getClient() {
  if (!client) client = new SESv2Client({ region: awsRegion() });
  return client;
}

function smtpConfigured() {
  return Boolean(process.env.SMTP_HOST?.trim() && process.env.SMTP_USER?.trim() && process.env.SMTP_PASS?.trim());
}

function fromAddress() {
  return process.env.SMTP_FROM?.trim() || process.env.SES_FROM_EMAIL?.trim() || process.env.SMTP_USER?.trim() || "";
}

export function emailDeliveryConfigured() {
  return smtpConfigured() || Boolean(process.env.SES_FROM_EMAIL?.trim());
}

async function sendViaSmtp(input: { to: string; subject: string; text: string; html: string }) {
  const from = fromAddress();
  if (!from) throw new Error("SMTP_FROM or SES_FROM_EMAIL is not configured.");
  const port = Number(process.env.SMTP_PORT || "465");
  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port,
    secure: process.env.SMTP_SECURE?.trim() !== "0" && port === 465,
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS
    }
  });
  await transporter.sendMail({
    from,
    to: input.to,
    subject: input.subject,
    text: input.text,
    html: input.html
  });
}

async function sendViaSes(input: { to: string; subject: string; text: string; html: string }) {
  const from = fromAddress();
  if (!from) throw new Error("SES_FROM_EMAIL is not configured.");
  await getClient().send(new SendEmailCommand({
    FromEmailAddress: from,
    Destination: { ToAddresses: [input.to] },
    Content: {
      Simple: {
        Subject: { Data: input.subject, Charset: "UTF-8" },
        Body: {
          Text: { Data: input.text, Charset: "UTF-8" },
          Html: { Data: input.html, Charset: "UTF-8" }
        }
      }
    }
  }));
}

async function sendEmail(input: { to: string; subject: string; text: string; html: string }) {
  if (smtpConfigured()) return sendViaSmtp(input);
  return sendViaSes(input);
}

export function sendVerificationEmail(input: { to: string; url: string; locale?: "en-GB" | "zh-CN" }) {
  const chinese = input.locale === "zh-CN";
  return sendEmail({
    to: input.to,
    subject: chinese ? "激活您的 Learning Guide 账号" : "Verify your Learning Guide account",
    text: chinese ? `请打开以下链接激活您的 Learning Guide 账号：\n\n${input.url}\n\n此链接将在 24 小时后失效。` : `Verify your Learning Guide account by opening this link:\n\n${input.url}\n\nThis link expires in 24 hours.`,
    html: chinese ? `<p>请点击下面的链接激活您的 Learning Guide 账号：</p><p><a href="${input.url}">激活账号</a></p><p>此链接将在 24 小时后失效。</p>` : `<p>Verify your Learning Guide account by opening this link:</p><p><a href="${input.url}">Verify email address</a></p><p>This link expires in 24 hours.</p>`
  });
}

export function sendPasswordResetEmail(input: { to: string; url: string }) {
  return sendEmail({
    to: input.to,
    subject: "Reset your Learning Guide password",
    text: `Reset your Learning Guide password by opening this link:\n\n${input.url}\n\nThis link expires in one hour.`,
    html: `<p>Reset your Learning Guide password by opening this link:</p><p><a href="${input.url}">Reset password</a></p><p>This link expires in one hour.</p>`
  });
}
