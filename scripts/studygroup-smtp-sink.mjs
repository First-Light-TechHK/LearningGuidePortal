// Local SMTP sink for the Study Group QA regression E2E. The Next dev server
// sends its mail here (SMTP_HOST/SMTP_PORT in playwright.studygroup.config.ts)
// and the spec reads what was sent back over HTTP:
//   - SMTP on 127.0.0.1:2525: plain text, AUTH PLAIN accepted, every message kept
//   - GET http://127.0.0.1:8789/messages -> [{ to: string[], raw: string }]
//   - GET http://127.0.0.1:8789/health
// No STARTTLS is offered, so nodemailer stays on the plain connection.
import { createServer as createHttpServer } from "node:http";
import { createServer as createTcpServer } from "node:net";

const HOST = "127.0.0.1";
const SMTP_PORT = Number(process.env.STUDYGROUP_SMTP_SINK_PORT || 2525);
const HTTP_PORT = Number(process.env.STUDYGROUP_SMTP_SINK_HTTP_PORT || 8789);
const messages = [];

createTcpServer((socket) => {
  let buffer = "";
  let inData = false;
  let recipients = [];
  let awaitingCredentials = false;
  socket.setEncoding("utf8");
  socket.write("220 studygroup-smtp-sink ESMTP\r\n");
  socket.on("data", (chunk) => {
    buffer += chunk;
    for (;;) {
      if (inData) {
        const end = buffer.indexOf("\r\n.\r\n");
        if (end < 0) return;
        messages.push({ to: recipients, raw: buffer.slice(0, end) });
        console.log(`studygroup-smtp-sink: message to=${recipients.join(",")}`);
        buffer = buffer.slice(end + 5);
        inData = false;
        recipients = [];
        socket.write("250 OK queued\r\n");
        continue;
      }
      const lineEnd = buffer.indexOf("\r\n");
      if (lineEnd < 0) return;
      const line = buffer.slice(0, lineEnd);
      buffer = buffer.slice(lineEnd + 2);
      const verb = line.split(" ")[0].toUpperCase();
      if (awaitingCredentials) {
        // The base64 credentials that follow a bare "AUTH PLAIN".
        awaitingCredentials = false;
        socket.write("235 Authentication successful\r\n");
      } else if (verb === "EHLO") socket.write("250-studygroup-smtp-sink\r\n250 AUTH PLAIN\r\n");
      else if (verb === "AUTH" && /^AUTH PLAIN\s*$/i.test(line)) {
        awaitingCredentials = true;
        socket.write("334 \r\n");
      } else if (verb === "AUTH") socket.write("235 Authentication successful\r\n");
      else if (verb === "RCPT") {
        const address = /<([^>]*)>/.exec(line)?.[1] || "";
        recipients.push(address.toLowerCase());
        socket.write("250 OK\r\n");
      } else if (verb === "DATA") {
        inData = true;
        socket.write("354 End data with <CR><LF>.<CR><LF>\r\n");
      } else if (verb === "QUIT") {
        socket.end("221 Bye\r\n");
        return;
      } else socket.write("250 OK\r\n");
    }
  });
  socket.on("error", () => undefined);
}).listen(SMTP_PORT, HOST, () => {
  console.log(`studygroup-smtp-sink: SMTP on ${HOST}:${SMTP_PORT}`);
});

createHttpServer((request, response) => {
  const url = new URL(request.url || "/", `http://${HOST}`);
  if (url.pathname === "/health") {
    response.writeHead(200, { "content-type": "text/plain" });
    response.end("ok");
    return;
  }
  if (url.pathname === "/messages") {
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify(messages));
    return;
  }
  response.writeHead(404);
  response.end();
}).listen(HTTP_PORT, HOST, () => {
  console.log(`studygroup-smtp-sink: messages on http://${HOST}:${HTTP_PORT}/messages`);
});
