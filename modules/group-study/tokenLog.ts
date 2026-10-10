import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

export type TokenLogRecord = {
  userId: string;
  role: "host" | "member";
  sessionId: string;
  state: "token_issued";
  at: string;
};

export function encryptTokenLogLine(record: TokenLogRecord, key: Buffer) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(record), "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, ciphertext]).toString("base64url");
}

export function decryptTokenLogLine(line: string, key: Buffer): TokenLogRecord {
  const bytes = Buffer.from(line, "base64url");
  const iv = bytes.subarray(0, 12);
  const tag = bytes.subarray(12, 28);
  const ciphertext = bytes.subarray(28);
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  return JSON.parse(Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8")) as TokenLogRecord;
}
