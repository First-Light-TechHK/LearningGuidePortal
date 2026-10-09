import { createHmac } from "node:crypto";

function encode(value: unknown) {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

export function signParticipantToken(input: { apiKey: string; apiSecret: string; identity: string; name: string; room: string; ttlSeconds: number; now: Date }) {
  const issuedAt = Math.floor(input.now.getTime() / 1000);
  const header = encode({ alg: "HS256", typ: "JWT" });
  const payload = {
    iss: input.apiKey,
    sub: input.identity,
    name: input.name,
    nbf: issuedAt,
    exp: issuedAt + input.ttlSeconds,
    video: {
      room: input.room,
      roomJoin: true,
      canPublish: true,
      canSubscribe: true,
      canPublishData: true
    }
  };
  const body = encode(payload);
  const signature = createHmac("sha256", input.apiSecret).update(`${header}.${body}`).digest("base64url");
  return { token: `${header}.${body}.${signature}`, expiresAt: new Date((issuedAt + input.ttlSeconds) * 1000).toISOString() };
}

export function signRoomAdminToken(input: { apiKey: string; apiSecret: string; room: string; ttlSeconds: number; now: Date }) {
  const issuedAt = Math.floor(input.now.getTime() / 1000);
  const header = encode({ alg: "HS256", typ: "JWT" });
  const payload = {
    iss: input.apiKey,
    sub: "study-group-tutor",
    nbf: issuedAt,
    exp: issuedAt + input.ttlSeconds,
    video: { room: input.room, roomAdmin: true }
  };
  const body = encode(payload);
  const signature = createHmac("sha256", input.apiSecret).update(`${header}.${body}`).digest("base64url");
  return `${header}.${body}.${signature}`;
}
