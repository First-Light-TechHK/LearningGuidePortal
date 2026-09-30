import assert from "node:assert/strict";
import { test } from "node:test";
import { createServer, type AddressInfo } from "node:net";
import { sendVerificationEmail, sendPasswordResetEmail, sendEmailBindingEmail } from "../../services/emailService";

test("the installed mail transport delivers activation, reset and binding messages to a local SMTP sink", async () => {
  const received: { recipient: string; body: string }[] = [];
  const server = createServer(socket => {
    let pending = "", recipient = "", body = "", data = false;
    socket.write("220 test.local ESMTP\r\n");
    socket.on("data", bytes => {
      pending += bytes.toString();
      let end: number;
      while ((end = pending.indexOf("\r\n")) >= 0) {
        const line = pending.slice(0, end); pending = pending.slice(end + 2);
        if (data) {
          if (line !== ".") { body += line + "\r\n"; continue; }
          received.push({ recipient, body }); data = false;
          socket.write("250 accepted\r\n");
        } else if (/^EHLO/.test(line)) socket.write("250-test.local\r\n250 AUTH PLAIN\r\n");
        else if (/^AUTH PLAIN/.test(line)) socket.write("235 authenticated\r\n");
        else if (/^MAIL FROM:/.test(line)) socket.write("250 OK\r\n");
        else if (/^RCPT TO:/.test(line)) { recipient = line; socket.write("250 OK\r\n"); }
        else if (line === "DATA") { data = true; body = ""; socket.write("354 send body\r\n"); }
        else if (line === "QUIT") socket.end("221 bye\r\n");
        else socket.write("500 unexpected command\r\n");
      }
    });
  });
  const variables = ["SMTP_HOST", "SMTP_PORT", "SMTP_SECURE", "SMTP_USER", "SMTP_PASS", "SMTP_FROM"];
  const original = Object.fromEntries(variables.map(name => [name, process.env[name]]));
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  try {
    Object.assign(process.env, { SMTP_HOST: "127.0.0.1", SMTP_PORT: String((server.address() as AddressInfo).port),
      SMTP_SECURE: "0", SMTP_USER: "local-test", SMTP_PASS: "local-test", SMTP_FROM: "sender@example.test" });
    const input = { to: "learner@example.test", url: "https://uat.example.test/confirm?token=synthetic", locale: "en-GB" as const };
    await sendVerificationEmail(input);
    await sendPasswordResetEmail(input);
    await sendEmailBindingEmail(input);
    assert.equal(received.length, 3);
    for (const message of received) {
      assert.equal(message.recipient, "RCPT TO:<learner@example.test>");
      assert.match(message.body, /From: sender@example.test/);
      assert.match(message.body, /Content-Type: multipart\/alternative/);
      assert.match(message.body, /uat\.example\.test\/confirm/);
    }
    assert.match(received[0].body, /Subject: Verify your Learning Guide account/);
    assert.match(received[1].body, /Subject: Reset your Learning Guide password/);
    assert.match(received[2].body, /Subject: Verify and bind your email/);
  } finally {
    for (const [name, value] of Object.entries(original)) {
      if (value === undefined) delete process.env[name]; else process.env[name] = value;
    }
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
});
