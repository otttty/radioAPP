// ============================================================
// /api/mails/report
// ------------------------------------------------------------
// 不適切なお便りの通報。一定数の通報が集まったものは自動的に非表示になり、
// 以後 /api/mails の一覧に出てこなくなる(=他のリスナーにも読まれない)。
// ============================================================

export const runtime = 'nodejs';

import { reportMail } from '../../../../lib/mailStore.js';

export async function POST(request) {
  let body;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: 'invalid JSON body' }, { status: 400 });
  }
  const { id } = body ?? {};
  if (typeof id !== 'string' || !id) {
    return Response.json({ error: 'id is required' }, { status: 400 });
  }
  try {
    const { count } = await reportMail(id);
    return Response.json({ ok: true, count });
  } catch (e) {
    console.error('[api/mails/report] failed:', e);
    return Response.json({ error: '通報に失敗しました' }, { status: 500 });
  }
}
