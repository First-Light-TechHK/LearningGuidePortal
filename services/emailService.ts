import { SESv2Client, SendEmailCommand } from "@aws-sdk/client-sesv2";
import { awsRegion } from "./persistence/config";

let client: SESv2Client | null = null;

function getClient() {
  if (!client) client = new SESv2Client({ region: awsRegion() });
  return client;
}

export function emailDeliveryConfigured() {
  return Boolean(process.env.SES_FROM_EMAIL?.trim());
}

async function sendEmail(input: { to: string; subject: string; text: string; html: string }) {
  const from = process.env.SES_FROM_EMAIL?.trim();
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

export function sendVerificationEmail(input: { to: string; url: string }) {
  return sendEmail({
    to: input.to,
    subject: "Verify your Learning Guide account",
    text: `Verify your Learning Guide account by opening this link:\n\n${input.url}\n\nThis link expires in 24 hours.`,
    html: `<p>Verify your Learning Guide account by opening this link:</p><p><a href="${input.url}">Verify email address</a></p><p>This link expires in 24 hours.</p>`
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
