import assert from 'node:assert/strict';
import {test, after} from 'node:test';
import {randomUUID} from 'node:crypto';

after(async()=>{if(process.env.NOTIFICATION_QA_DATABASE_URL) {const {getPool}=await import('../../../services/persistence/db'); await getPool().end();}});

test('interaction append is ownership scoped, throttled and independent of product write lock', {skip: !process.env.NOTIFICATION_QA_DATABASE_URL},async()=>{
 process.env.DATABASE_URL=process.env.NOTIFICATION_QA_DATABASE_URL;process.env.DATA_S3_BUCKET='local-test-only';process.env.STORAGE_BACKEND='postgres';
 const {ensureSchema,getPool}=await import('../../../services/persistence/db');
 const {recordInteraction,resetInteractionRateForTests}=await import('../../../services/notifications/interactions');
 await ensureSchema();const pool=getPool();const id=`test-${randomUUID()}`,user={id:`user-${randomUUID()}`,locale:'en-GB'};
 await pool.query("INSERT INTO orm_rows(table_name,id,payload) VALUES ('notifications',$1,$2::jsonb)",[id,JSON.stringify({id,userId:user.id,category:'course',language:'en',templateId:'T'})]);
 const holder=await pool.connect();await holder.query('BEGIN');await holder.query('SELECT pg_advisory_xact_lock(719301,1)');
 try {
  assert.equal(await Promise.race([recordInteraction(user,{event:'notification_item_clicked',notificationId:id}),new Promise((_,reject)=>setTimeout(()=>reject(new Error('blocked by product lock')),3000))]),true);
  await assert.rejects(()=>recordInteraction({id:'wrong-user',locale:'en-GB'},{event:'notification_item_clicked',notificationId:id}));
  resetInteractionRateForTests();
  const results=await Promise.all(Array.from({length:31},()=>recordInteraction(user,{event:'notification_bell_opened'})));
  assert.equal(results.filter(Boolean).length,29);
  const rows=await pool.query('SELECT event,notification_id,template_id FROM notification_interaction_events WHERE user_id=$1',[user.id]);
  assert.equal(rows.rowCount,30);assert.equal(rows.rows.filter(row=>row.notification_id===id && row.template_id==='T').length,1);
 } finally {
  await holder.query('ROLLBACK');holder.release();
  await pool.query('DELETE FROM notification_interaction_events WHERE user_id=$1',[user.id]);
  await pool.query("DELETE FROM orm_rows WHERE table_name='notifications' AND id=$1",[id]);
 }
});

test('indexed session lookup rejects bogus and disabled accounts without product hydration', {skip: !process.env.NOTIFICATION_QA_DATABASE_URL},async()=>{
 process.env.DATABASE_URL=process.env.NOTIFICATION_QA_DATABASE_URL;process.env.DATA_S3_BUCKET='local-test-only';process.env.STORAGE_BACKEND='postgres';
 const {ensureSchema,getPool}=await import('../../../services/persistence/db');
 const {interactionUser}=await import('../../../services/notifications/interactions');
 const {createHash}=await import('node:crypto');
 await ensureSchema();const pool=getPool(),userId=`user-${randomUUID()}`,sessionId=`session-${randomUUID()}`,token=randomUUID(),hash=createHash('sha256').update(token).digest('hex');
 await pool.query("INSERT INTO orm_rows(table_name,id,payload) VALUES ('users',$1,$2::jsonb),('sessions',$3,$4::jsonb)",[userId,JSON.stringify({id:userId,status:'active',email:'synthetic@example.test',emailVerifiedAt:'2026-01-01',locale:'en-GB'}),sessionId,JSON.stringify({id:sessionId,userId,tokenHash:hash,expiresAt:new Date(Date.now()+60000).toISOString()})]);
 try {
  assert.equal((await interactionUser(token))?.id,userId);
  assert.equal(await interactionUser('not-a-session'),null);
  await pool.query("UPDATE orm_rows SET payload=jsonb_set(payload,'{status}', '\"disabled\"') WHERE table_name='users' AND id=$1",[userId]);
  assert.equal(await interactionUser(token),null);
 } finally {
  await pool.query("DELETE FROM orm_rows WHERE (table_name='users' AND id=$1) OR (table_name='sessions' AND id=$2)",[userId,sessionId]);
 }
});
