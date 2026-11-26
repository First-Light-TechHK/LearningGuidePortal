import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';

test('SMTP message id is persisted and repeated notification writes deduplicate', async()=>{
 const cwd=process.cwd(), dir=await mkdtemp(path.join(tmpdir(),'lg-receipts-')); process.chdir(dir); process.env.STORAGE_BACKEND='local';
 try {
  const {recordEmailDelivery}=await import('../../services/notifications/emailLog');
  const {readProductData}=await import('../../services/productStore');
  const sent=await recordEmailDelivery({userId:'u1',notificationId:'n1',templateId:null,status:'sent',occurredAt:new Date().toISOString(),providerMessageId:' <smtp-123@example.test> '});
  const duplicate=await recordEmailDelivery({userId:'u1',notificationId:'n1',templateId:null,status:'sent',occurredAt:new Date().toISOString(),providerMessageId:'<other@example.test>'});
  assert.equal(duplicate.logId,sent.logId);
  assert.equal((await readProductData()).notificationLog?.find(x=>x.id===sent.logId)?.providerMessageId,'<smtp-123@example.test>');

 } finally {process.chdir(cwd); await rm(dir,{recursive:true,force:true});}
});
