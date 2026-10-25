import assert from "node:assert/strict";
import { mock, test } from "node:test";
import { createServer, type AddressInfo } from "node:net";
import nodemailer from "nodemailer";

test("managed environments try SES before SMTP so VPC SMTP hangs do not block mail", async () => {
  const env = { ...process.env };
  const sesCalls: unknown[] = [];
  const originalSend = (await import("@aws-sdk/client-sesv2")).SESv2Client.prototype.send;
  try {
    Object.assign(process.env, {
      APP_ENV: "SIT",
      SMTP_HOST: "127.0.0.1",
      SMTP_PORT: "9",
      SMTP_USER: "smtp@test.invalid",
      SMTP_PASS: "smtp-pass",
      SMTP_FROM: "Learning Guide <learningguide@163.com>",
      SES_FROM_EMAIL: "learningguide@163.com",
      EMAIL_TRANSPORT: ""
    });
    (await import("@aws-sdk/client-sesv2")).SESv2Client.prototype.send = async function send(command: unknown) {
      sesCalls.push(command);
      return {};
    } as typeof originalSend;
    const { sendVerificationEmail } = await import("../../services/emailService");
    await sendVerificationEmail({ to: "learner@example.test", url: "https://sit.example.test/verify?token=x", locale: "en-GB" });
    assert.equal(sesCalls.length, 1);
  } finally {
    (await import("@aws-sdk/client-sesv2")).SESv2Client.prototype.send = originalSend;
    process.env = env;
  }
});

test("Microsoft mailboxes prefer SES before SMTP on DEV", async () => {
  const env = { ...process.env };
  const sesCalls: unknown[] = [];
  let smtpCalls = 0;
  const originalSend = (await import("@aws-sdk/client-sesv2")).SESv2Client.prototype.send;
  const create = mock.method(nodemailer, "createTransport", () => {
    smtpCalls += 1;
    return { sendMail: async () => undefined };
  });
  try {
    Object.assign(process.env, {
      APP_ENV: "DEV",
      EMAIL_TRANSPORT: "",
      SMTP_HOST: "smtp.test",
      SMTP_USER: "smtp@test.invalid",
      SMTP_PASS: "pass",
      SES_FROM_EMAIL: "learningguide@163.com"
    });
    (await import("@aws-sdk/client-sesv2")).SESv2Client.prototype.send = async function send(command: unknown) {
      sesCalls.push(command);
      return {};
    } as typeof originalSend;
    const { sendVerificationEmail } = await import("../../services/emailService");
    await sendVerificationEmail({ to: "yongthelaoma@outlook.com", url: "https://www.example.test/verify?token=x" });
    assert.equal(sesCalls.length, 1);
    assert.equal(smtpCalls, 0);
  } finally {
    create.mock.restore();
    (await import("@aws-sdk/client-sesv2")).SESv2Client.prototype.send = originalSend;
    process.env = env;
  }
});

test("DEV falls back to SES when SMTP is configured but rejects the send", async () => {
  const env = { ...process.env };
  const sesCalls: unknown[] = [];
  const originalSend = (await import("@aws-sdk/client-sesv2")).SESv2Client.prototype.send;
  const create = mock.method(nodemailer, "createTransport", () => ({
    sendMail: async () => { throw Object.assign(new Error("Invalid login"), { code: "EAUTH", responseCode: 535 }); }
  }));
  try {
    Object.assign(process.env, {
      APP_ENV: "DEV",
      SMTP_HOST: "smtp.test",
      SMTP_PORT: "465",
      SMTP_USER: "smtp@test.invalid",
      SMTP_PASS: "bad",
      SMTP_FROM: "Learning Guide <learningguide@163.com>",
      SES_FROM_EMAIL: "learningguide@163.com",
      EMAIL_TRANSPORT: ""
    });
    (await import("@aws-sdk/client-sesv2")).SESv2Client.prototype.send = async function send(command: unknown) {
      sesCalls.push(command);
      return {};
    } as typeof originalSend;
    const { sendPasswordResetEmail } = await import("../../services/emailService");
    await sendPasswordResetEmail({ to: "learner@example.test", url: "https://www.example.test/reset?token=x", locale: "en-GB" });
    assert.equal(sesCalls.length, 1);
  } finally {
    create.mock.restore();
    (await import("@aws-sdk/client-sesv2")).SESv2Client.prototype.send = originalSend;
    process.env = env;
  }
});

test("EMAIL_TRANSPORT=ses skips SMTP even when it is configured", async () => {
  const env = { ...process.env };
  const sesCalls: unknown[] = [];
  let smtpCalls = 0;
  const originalSend = (await import("@aws-sdk/client-sesv2")).SESv2Client.prototype.send;
  const create = mock.method(nodemailer, "createTransport", () => {
    smtpCalls += 1;
    return { sendMail: async () => undefined };
  });
  try {
    Object.assign(process.env, {
      APP_ENV: "DEV",
      EMAIL_TRANSPORT: "ses",
      SMTP_HOST: "smtp.test",
      SMTP_USER: "smtp@test.invalid",
      SMTP_PASS: "pass",
      SES_FROM_EMAIL: "learningguide@163.com"
    });
    (await import("@aws-sdk/client-sesv2")).SESv2Client.prototype.send = async function send(command: unknown) {
      sesCalls.push(command);
      return {};
    } as typeof originalSend;
    const { sendVerificationEmail } = await import("../../services/emailService");
    await sendVerificationEmail({ to: "learner@example.test", url: "https://dev.example.test/verify?token=x" });
    assert.equal(smtpCalls, 0);
    assert.equal(sesCalls.length, 1);
  } finally {
    create.mock.restore();
    (await import("@aws-sdk/client-sesv2")).SESv2Client.prototype.send = originalSend;
    process.env = env;
  }
});

test("SMTP still delivers when it is the working path", async () => {
  const received: string[] = [];
  const server = createServer((socket) => {
    let pending = "", data = false;
    socket.write("220 test.local ESMTP\r\n");
    socket.on("data", (bytes) => {
      pending += bytes.toString();
      let end: number;
      while ((end = pending.indexOf("\r\n")) >= 0) {
        const line = pending.slice(0, end); pending = pending.slice(end + 2);
        if (data) {
          if (line !== ".") continue;
          data = false;
          received.push("ok");
          socket.write("250 accepted\r\n");
        } else if (/^EHLO/.test(line)) socket.write("250-test.local\r\n250 AUTH PLAIN\r\n");
        else if (/^AUTH PLAIN/.test(line)) socket.write("235 authenticated\r\n");
        else if (/^MAIL FROM:/.test(line) || /^RCPT TO:/.test(line)) socket.write("250 OK\r\n");
        else if (line === "DATA") { data = true; socket.write("354 send body\r\n"); }
        else if (line === "QUIT") socket.end("221 bye\r\n");
        else socket.write("500 unexpected\r\n");
      }
    });
  });
  const env = { ...process.env };
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    Object.assign(process.env, {
      APP_ENV: "DEV",
      EMAIL_TRANSPORT: "smtp",
      SMTP_HOST: "127.0.0.1",
      SMTP_PORT: String((server.address() as AddressInfo).port),
      SMTP_SECURE: "0",
      SMTP_USER: "local-test",
      SMTP_PASS: "local-test",
      SMTP_FROM: "sender@example.test",
      SES_FROM_EMAIL: ""
    });
    delete process.env.SES_FROM_EMAIL;
    const { sendVerificationEmail } = await import("../../services/emailService");
    await sendVerificationEmail({ to: "learner@example.test", url: "https://dev.example.test/verify?token=x" });
    assert.equal(received.length, 1);
  } finally {
    process.env = env;
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});
