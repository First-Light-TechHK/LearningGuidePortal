import assert from "node:assert/strict";
import { mock, test } from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import nodemailer from "nodemailer";

// sendHelpdeskUpdateEmail is what the runtime wires to the service's email
// hook (modules/helpdesk/runtime.ts): it must reach the ticket's contact
// address with the subject and text exactly as composed, as plain text only.
test("sendHelpdeskUpdateEmail sends the subject and text unchanged to the contact address, plain text only", async () => {
  const env = { ...process.env };
  const sent: Array<Record<string, unknown>> = [];
  const create = mock.method(nodemailer, "createTransport", () => ({
    sendMail: async (message: Record<string, unknown>) => { sent.push(message); return { accepted: [message.to], rejected: [], messageId: "<id@test>" }; }
  }));
  const info = mock.method(console, "info", () => undefined);
  try {
    Object.assign(process.env, { SMTP_HOST: "smtp.example.test", SMTP_PORT: "465", SMTP_USER: "support@example.test", SMTP_PASS: "local-test", SMTP_FROM: "support@example.test" });
    const { sendHelpdeskUpdateEmail } = await import("../../services/emailService");
    const text = "Support replied to LG-261028-0001:\n\n<script>alert(1)</script> & more\n\nhttps://www.ilovelearningguide.com/support/enquiries/abc";
    await sendHelpdeskUpdateEmail({ to: "contact@example.test", subject: "Re: LG-261028-0001 Upgrade did not apply", text });
    assert.equal(sent.length, 1);
    assert.equal(sent[0].to, "contact@example.test");
    assert.equal(sent[0].from, "support@example.test");
    assert.equal(sent[0].subject, "Re: LG-261028-0001 Upgrade did not apply");
    assert.equal(sent[0].text, text);
    assert.equal(sent[0].html, undefined, "no HTML part, so learner text can never become markup");
    assert.equal((sent[0].headers as Record<string, string>)["Auto-Submitted"], "auto-generated");
    // The log names only the recipient's domain, never the address.
    assert.ok(!info.mock.calls.some((call) => String(call.arguments[0]).includes("contact@example.test")));
  } finally {
    create.mock.restore();
    info.mock.restore();
    process.env = env;
  }
});

test("sendHelpdeskUpdateEmail fails closed when SMTP is not configured", async () => {
  const env = { ...process.env };
  const create = mock.method(nodemailer, "createTransport", () => { throw new Error("must not be called"); });
  const info = mock.method(console, "info", () => undefined);
  try {
    delete process.env.SMTP_HOST;
    delete process.env.SMTP_PASS;
    const { sendHelpdeskUpdateEmail, EmailDeliveryError } = await import("../../services/emailService");
    await assert.rejects(sendHelpdeskUpdateEmail({ to: "contact@example.test", subject: "s", text: "t" }), EmailDeliveryError);
    assert.equal(create.mock.callCount(), 0);
  } finally {
    create.mock.restore();
    info.mock.restore();
    process.env = env;
  }
});

test("the runtime service emails the ticket's contact address on an agent reply and projects the student for the agent", async () => {
  const env = { ...process.env };
  const cwd = process.cwd();
  const directory = await mkdtemp(path.join(tmpdir(), "lg-helpdesk-email-"));
  const sent: Array<Record<string, unknown>> = [];
  const create = mock.method(nodemailer, "createTransport", () => ({
    sendMail: async (message: Record<string, unknown>) => { sent.push(message); return { accepted: [message.to], rejected: [] }; }
  }));
  const info = mock.method(console, "info", () => undefined);
  try {
    process.chdir(directory);
    Object.assign(process.env, {
      APP_ENV: "DEV", STORAGE_BACKEND: "local", SESSION_SECRET: "test-session-secret-with-at-least-32-characters", NEXT_PUBLIC_APP_URL: "https://portal.example.test",
      SMTP_HOST: "smtp.example.test", SMTP_PORT: "465", SMTP_USER: "support@example.test", SMTP_PASS: "local-test", SMTP_FROM: "support@example.test"
    });
    delete process.env.DATABASE_URL;
    const store = await import("../../services/productStore");
    const user = await store.registerUser({ email: "account@example.test", password: "password1", nickname: "Lin Learner" });
    const { helpdeskService } = await import("../../modules/helpdesk/runtime");
    const service = helpdeskService();
    const learner = { id: user.id, email: "account@example.test", name: "Lin Learner" };
    const { ticket } = await service.createTicket(learner, { category: "payments_subscriptions", subject: "Upgrade did not apply", body: "Still on Basic.", locale: "en-GB", files: [], contactEmail: "contact@example.test" }, randomUUID());
    await service.postAgentMessage(ticket.id, { body: "Please sign out & in <again>.", internal: false, agent: { id: "emp-1", name: "Amy Agent" }, expectedSequence: 1 }, randomUUID());
    // The runtime sends in the background so a slow SMTP never delays the agent.
    for (let tries = 0; sent.length === 0 && tries < 50; tries += 1) await new Promise((resolve) => setTimeout(resolve, 10));
    assert.equal(sent.length, 1);
    assert.equal(sent[0].to, "contact@example.test", "the contact email, not the account email");
    assert.equal(sent[0].subject, `[${ticket.number}] Support replied to your enquiry`);
    assert.ok(String(sent[0].text).includes("Please sign out & in <again>."));
    assert.ok(String(sent[0].text).includes(`https://portal.example.test/en-GB/account/my-learning/support/${ticket.id}`));
    const detail = await service.getAgentTicket(ticket.id);
    assert.equal(detail.student?.id, user.id, "the right panel projects the Portal user");
  } finally {
    process.chdir(cwd);
    create.mock.restore();
    info.mock.restore();
    process.env = env;
    if (path.dirname(directory) === tmpdir()) await rm(directory, { recursive: true, force: true });
  }
});
