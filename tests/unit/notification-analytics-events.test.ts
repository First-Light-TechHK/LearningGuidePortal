import assert from 'node:assert/strict';
import {test} from 'node:test';
import {appendNotificationLogInData,setNotificationReadInData,sendBroadcastInData} from '../../services/notifications/core';

test('delivery and read transition analytics reuse existing notification logs',()=>{
 const user={id:'u1',email:'u@example.test',emailVerifiedAt:'2026-01-01',status:'active',locale:'en-GB'};
 const data={users:[user],notifications:[],notificationLog:[],notificationTemplates:[],subscriptions:[],notificationBroadcasts:[{id:'b1',titleEn:'Hello',bodyEn:'World',audience:'all',status:'draft',createdBy:'operator',createdAt:new Date().toISOString(),sentAt:null,withdrawnAt:null,withdrawnBy:null}]} as never;
 assert.equal(sendBroadcastInData(data,'b1','operator').recipients,1);
 const rows=(data as any).notificationLog, notification=(data as any).notifications[0];
 assert.equal(rows[0].analyticsEvent,'message_created');assert.equal(rows[0].broadcastId,'b1');
 setNotificationReadInData(data,'u1',notification.id,true,'2026-01-01T00:00:00Z');
 const count=rows.length;
 setNotificationReadInData(data,'u1',notification.id,true,'2026-01-02T00:00:00Z');
 assert.equal(rows.length,count); assert.equal(notification.readAt,'2026-01-01T00:00:00Z');
 setNotificationReadInData(data,'u1',notification.id,false);
 assert.equal(rows[0].analyticsEvent,'notification_marked_unread');assert.equal(rows[1].analyticsEvent,'notification_marked_read');
 for (const [status,event] of [['sent','email_sent'],['failed','email_failed'],['delivered','email_delivered']] as const) {
  const row=appendNotificationLogInData(data,{notificationId:notification.id,userId:'u1',templateId:'T',channel:'email',status,failureReason:status==='failed'?'provider_error':null,occurredAt:new Date().toISOString(),isTest:false});
  assert.equal(row.analyticsEvent,event);
 }
});
