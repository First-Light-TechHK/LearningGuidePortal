import { createHash } from 'node:crypto';
import { persistenceEnabled } from '@/services/persistence/config';
import { requestOriginMatches } from '@/services/adminHost';
import { interactionUser, rateAllowed, recordInteraction } from '@/services/notifications/interactions';
import type { LearnerAnalyticsEvent } from '@/services/notifications/types';
export const dynamic = 'force-dynamic';
const allowed = new Set<LearnerAnalyticsEvent>(['notification_bell_opened','notification_item_clicked','notification_cta_clicked','notification_center_opened','notification_filter_changed']);
export async function POST(request: Request) {
  if (!requestOriginMatches(request)) return new Response(null,{status:403});
  const cookie=(request.headers.get('cookie') || '').split(';').map(part=>part.trim()).find(part=>part.startsWith('learning_guide_session='))?.slice('learning_guide_session='.length);
  if (!cookie) return new Response(null,{status:401});
  // Bound repeated requests before the existing session lookup hydrates product data.
  if (!persistenceEnabled() && !rateAllowed('local-analytics-global',Date.now(),300)) return new Response(null,{status:429});
  if (!rateAllowed('session:'+createHash('sha256').update(cookie).digest('hex'))) return new Response(null,{status:429});
  let user;
  try { user=await interactionUser(cookie); } catch { return new Response(null,{status:503}); }
  if (!user) return new Response(null,{status:401});
  try {
    const reader=request.body?.getReader();
    if (!reader) return new Response(null,{status:400});
    let size=0; const chunks:Uint8Array[]=[];
    for (;;) { const part=await reader.read(); if (part.done) break; size+=part.value.length; if (size>2048) { await reader.cancel(); return new Response(null,{status:413}); } chunks.push(part.value); }
    const bytes=new Uint8Array(size); let offset=0; for (const chunk of chunks) {bytes.set(chunk,offset);offset+=chunk.length;}
    const body=JSON.parse(new TextDecoder().decode(bytes));
    if (!body || typeof body !== 'object' || !allowed.has(body.event) || (body.notificationId !== undefined && (typeof body.notificationId !== 'string' || body.notificationId.length > 128))) return new Response(null,{status:400});
    const accepted=await recordInteraction(user,body);
    if (!accepted) return new Response(null,{status:429});
    return new Response(null,{status:204,headers:{'Cache-Control':'no-store'}});
  } catch (error) { return new Response(null,{status:error instanceof SyntaxError || error instanceof Error && error.message === 'invalid' ? 400 : 503}); }
}
