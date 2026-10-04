import type { WeChatProfile } from "@/contracts/wechat";
import { query } from "@/services/persistence/db";

export async function insertWechatTicket(input: { hash: string; env: "DEV" | "SIT" | "UAT"; nonce: string; profile: WeChatProfile }) {
  await query("DELETE FROM wechat_login_tickets WHERE expires_at <= NOW()");
  await query("INSERT INTO wechat_login_tickets (ticket_hash, target_env, nonce, profile, expires_at) VALUES ($1, $2, $3, $4::jsonb, NOW() + INTERVAL '2 minutes')", [input.hash, input.env, input.nonce, JSON.stringify(input.profile)]);
}

export async function consumeWechatTicket(hash: string, env: "DEV" | "SIT" | "UAT") {
  const result = await query<{ nonce: string; profile: WeChatProfile }>("DELETE FROM wechat_login_tickets WHERE ticket_hash = $1 AND target_env = $2 AND expires_at > NOW() RETURNING nonce, profile", [hash, env]);
  return result.rows[0] || null;
}
