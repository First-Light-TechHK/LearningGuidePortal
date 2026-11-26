import assert from 'node:assert/strict';
import {test} from 'node:test';
import {validateInteraction, rateAllowed, resetInteractionRateForTests} from '../../services/notifications/interactions';

test('interaction fields are constrained and notification ownership is checked',()=>{
 const user={id:'u1',locale:'en-GB'};
 assert.equal(validateInteraction(user,{event:'notification_cta_clicked',notificationId:'n1'},{id:'n1',userId:'u1',category:'course',templateId:'T',language:'en'}).template_id,'T');
 assert.throws(()=>validateInteraction(user,{event:'notification_cta_clicked',notificationId:'n1'},{id:'n1',userId:'other'}));
 assert.throws(()=>validateInteraction(user,{event:'notification_cta_clicked'},undefined));
 assert.throws(()=>validateInteraction(user,{event:'notification_filter_changed',filter:'all',extra:'private'} as never,undefined));
});
test('rate limits repeated interactions per account and resets after the window',()=>{
 resetInteractionRateForTests();
 for(let i=0;i<30;i++) assert(rateAllowed('u1',1000));
 assert(!rateAllowed('u1',1000));assert(rateAllowed('u2',1000));assert(rateAllowed('u1',61001));
});
