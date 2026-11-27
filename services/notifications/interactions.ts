import { createHash, randomUUID } from 'node:crypto';
import { appendFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { persistenceEnabled } from '../persistence/config';
import { ensureSchema, getPool } from '../persistence/db';
import { getUserBySessionToken, readProductData } from '../productStore';
import type { LearnerAnalyticsEvent } from './types';

type Input = {event: LearnerAnalyticsEvent; notificationId?: string; filter?: 'all'|'unread'};
type User = {id:string; locale:string};
type Item = {id:string;userId:string;withdrawnAt?:string|null;templateId?:string|null;broadcastId?:string|null;category?:string|null;language?:string|null;isTest?:boolean};
const names = new Set(['notification_bell_opened','notification_item_clicked','notification_cta_clicked','notification_center_opened','notification_filter_changed']);
const itemNames = new Set(['notification_item_clicked','notification_cta_clicked']);
const buckets = new Map<string,number[]>();
export function resetInteractionRateForTests() { buckets.clear(); }
export function rateAllowed(userId:string,now=Date.now(),limit=30) {
  const hits=(buckets.get(userId)||[]).filter(at=>at>now-60_000);
  if(hits.length>=limit) {buckets.set(userId,hits);return false;}
  hits.push(now);buckets.delete(userId);buckets.set(userId,hits);
  if(buckets.size>10000) buckets.delete(buckets.keys().next().value!);
  return true;
}
export function validateInteraction(user:User,input:Input,item?:Item) {
  if (!input || typeof input !== 'object' || Object.keys(input).some(key=>!['event','notificationId','filter'].includes(key)) || !names.has(input.event)) throw new Error('invalid');
  if (input.event === 'notification_filter_changed' ? input.filter !== 'all' && input.filter !== 'unread' : input.filter !== undefined) throw new Error('invalid');
  if (input.notificationId !== undefined && (typeof input.notificationId !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(input.notificationId))) throw new Error('invalid');
  if (itemNames.has(input.event) ? (!item || item.id!==input.notificationId || item.userId!==user.id || !!item.withdrawnAt) : input.notificationId !== undefined) throw new Error('invalid');
  return {id:randomUUID(),user_id:user.id,event:input.event,notification_id:item?.id || null,template_id:item?.templateId || null,broadcast_id:item?.broadcastId || null,category:item ? item.category || (item.broadcastId ? 'announcement' : 'subscription') : null,language:item?.language || ((user.locale || 'en-GB').toLowerCase().startsWith('zh') ? 'zh':'en'),channel:'in_app',is_test:Boolean(item?.isTest),filter:input.filter || null};
}
/** Authenticate against indexed session/user projections without hydrating the aggregate. */
export async function interactionUser(token: string) {
  if (!token || token.length > 256) return null;
  if (!persistenceEnabled()) return getUserBySessionToken(token);
  await ensureSchema();
  const hash=createHash('sha256').update(token).digest('hex');
  const rows=await getPool().query("SELECT s.payload AS session, u.payload AS learner FROM orm_rows s JOIN orm_rows u ON u.table_name='users' AND u.id=s.payload->>'userId' WHERE s.table_name='sessions' AND s.payload->>'tokenHash'=$1 LIMIT 2",[hash]);
  if (rows.rowCount !== 1) return null;
  const {session,learner}=rows.rows[0];
  if (typeof session.expiresAt !== 'string' || !(Date.parse(session.expiresAt)>Date.now()) || typeof session.userId !== 'string' || learner.id !== session.userId || learner.status!=='active' || learner.deactivatedAt || !learner.email || !learner.emailVerifiedAt) return null;
  return learner as {id:string;locale:string};
}
export async function recordInteraction(user:User,input:Input) {
  if (!rateAllowed(user.id)) return false;
  if (!persistenceEnabled()) {
    const data=await readProductData();
    const item=input.notificationId ? data.notifications.find(row=>row.id===input.notificationId) : undefined;
    const event=validateInteraction(user,input,item);
    const directory=path.join(process.cwd(),'data','knowledge_system','learning_guide');
    await mkdir(directory,{recursive:true});
    await appendFile(path.join(directory,'notification-interactions.jsonl'),JSON.stringify({...event,occurred_at:new Date().toISOString()})+'\n');
    return true;
  }
  await ensureSchema();
  const client=await getPool().connect();
  try {
    await client.query('BEGIN');
    // Per-user, transaction-scoped lock prevents multiple instances bypassing the limit.
    await client.query('SELECT pg_advisory_xact_lock(719304, hashtext($1))',[user.id]);
    const count=await client.query("SELECT count(*)::int AS n FROM notification_interaction_events WHERE user_id=$1 AND occurred_at > NOW() - interval '1 minute'",[user.id]);
    if (Number(count.rows[0].n)>=30) {await client.query('ROLLBACK');return false;}
    let item:Item|undefined;
    if (input.notificationId) {
      const rows=await client.query("SELECT payload FROM orm_rows WHERE table_name='notifications' AND id=$1 AND payload->>'userId'=$2",[input.notificationId,user.id]);
      item=rows.rows[0]?.payload as Item | undefined;
    }
    const event=validateInteraction(user,input,item);
    await client.query('INSERT INTO notification_interaction_events (id,user_id,event,notification_id,template_id,broadcast_id,category,language,channel,is_test,filter) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)',[event.id,event.user_id,event.event,event.notification_id,event.template_id,event.broadcast_id,event.category,event.language,event.channel,event.is_test,event.filter]);
    await client.query('COMMIT');return true;
  } catch(error) {await client.query('ROLLBACK');throw error;} finally {client.release();}
}


/** The scheduled 180-day retention job prunes the independent event table. */
export async function purgeInteractionEvents(now = new Date()) {
  if (!persistenceEnabled()) return 0;
  await ensureSchema();
  const result=await getPool().query("DELETE FROM notification_interaction_events WHERE occurred_at < $1::timestamptz - interval '180 days'",[now.toISOString()]);
  return result.rowCount || 0;
}
