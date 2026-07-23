// ============================================================
// /api/mails
// ------------------------------------------------------------
// GET : 指定位置の近くに届いているお便りを返す(他のリスナーの投稿を含む)
// POST: お便りを投稿する。モデレーションとレート制限を通ってから保存する。
//
// 位置は約100m格子に丸めて保存し、正確な座標は残さない(プライバシー)。
// ============================================================

export const runtime = 'nodejs';

import { saveMail, listNearbyMails, allowPost, isPersistent } from '../../../lib/mailStore.js';
import { moderateMail } from '../../../lib/moderation.js';

function clientIp(request) {
  const fwd = request.headers.get('x-forwarded-for') || '';
  return fwd.split(',')[0].trim() || request.headers.get('x-real-ip') || 'unknown';
}

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const lat = Number(searchParams.get('lat'));
  const lon = Number(searchParams.get('lon'));
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    return Response.json({ error: 'lat/lon are required' }, { status: 400 });
  }
  try {
    const mails = await listNearbyMails(lat, lon, { radiusM: 800, limit: 20 });
    return Response.json({ mails, persistent: isPersistent() });
  } catch (e) {
    console.error('[api/mails] list failed:', e);
    return Response.json({ mails: [], persistent: isPersistent(), error: 'list failed' });
  }
}

export async function POST(request) {
  let body;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: 'invalid JSON body' }, { status: 400 });
  }

  const { body: text, radioName, lat, lon, areaName } = body ?? {};
  if (typeof text !== 'string' || !text.trim()) {
    return Response.json({ error: '本文を入力してください' }, { status: 400 });
  }
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    return Response.json({ error: '位置情報が必要です' }, { status: 400 });
  }

  if (!(await allowPost(clientIp(request)))) {
    return Response.json({ error: '投稿が続いています。少し時間をおいてからお試しください' }, { status: 429 });
  }

  const verdict = await moderateMail(text);
  if (!verdict.ok) {
    return Response.json({ error: verdict.reason }, { status: 400 });
  }

  try {
    const { id } = await saveMail({
      body: text.trim().slice(0, 600),
      radioName: typeof radioName === 'string' ? radioName.trim().slice(0, 30) || null : null,
      lat,
      lon,
      areaName: typeof areaName === 'string' ? areaName.slice(0, 40) : null,
    });
    return Response.json({ ok: true, id, persistent: isPersistent() });
  } catch (e) {
    console.error('[api/mails] save failed:', e);
    return Response.json({ error: '保存に失敗しました' }, { status: 500 });
  }
}
