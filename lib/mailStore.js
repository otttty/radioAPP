// ============================================================
// mailStore (サーバー専用)
// ------------------------------------------------------------
// リスナーが投稿したお便りを「位置」で保存・取得するストア。
// 別のリスナーが同じ場所に来たとき、その土地に届いたお便りを拾えるようにする。
//
// 保存先は2系統:
//  - Upstash Redis / Vercel KV: 環境変数(KV_REST_API_URL, KV_REST_API_TOKEN)が
//    あればRESTで使う。追加パッケージ不要(fetchのみ)。本番はこちら。
//  - メモリ: 環境変数が無い場合のフォールバック。ローカル開発用で、
//    サーバーレスではインスタンス間で共有されない(=本番では実質使えない)。
//
// プライバシー: 座標は約1km格子に丸めたセルキーと、100m格子に丸めた座標だけを
// 保存する。投稿者の正確な位置は保存しない。
// ============================================================

const CELL_DEG = 0.009; // 約1kmのセル。読み出しは3x3セル=約3km四方を見る
const MAX_PER_CELL = 200; // 1セルに保持する最大件数(古いものから落ちる)
const HIDDEN_KEY = 'mail:hidden'; // 通報で非表示になったIDの集合
const REPORT_THRESHOLD = 2; // この件数の通報で自動的に非表示

const kvUrl = () => process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL || '';
const kvToken = () => process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN || '';
export const isPersistent = () => !!(kvUrl() && kvToken());

/** Upstash REST のパイプラインで複数コマンドをまとめて実行する */
async function redis(commands) {
  const res = await fetch(`${kvUrl()}/pipeline`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${kvToken()}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(commands),
  });
  if (!res.ok) throw new Error(`kv ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const out = await res.json();
  return out.map((r) => r.result);
}

// --- メモリ版フォールバック(ローカル開発用) ---
const mem = {
  cells: new Map(), // cellKey -> string[](新しい順)
  hidden: new Set(),
  reports: new Map(), // id -> count
  rate: new Map(), // ip -> { count, resetAt }
};

/** 緯度経度 → 約1km格子のセルキー */
function cellKey(lat, lon) {
  return `${Math.round(lat / CELL_DEG)}_${Math.round(lon / CELL_DEG)}`;
}

/** 中心セルと周囲8セル(=3x3)のキー */
function neighborCells(lat, lon) {
  const y = Math.round(lat / CELL_DEG);
  const x = Math.round(lon / CELL_DEG);
  const keys = [];
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) keys.push(`${y + dy}_${x + dx}`);
  }
  return keys;
}

/** 2点間の距離(m) */
export function distanceMeters(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/** 100m格子に丸める(正確な位置を保存しないため) */
const round100m = (v) => Math.round(v * 1000) / 1000;

/**
 * お便りを保存する。
 * @param {{body: string, radioName: string|null, lat: number, lon: number, areaName?: string|null}} input
 * @returns {Promise<{id: string}>}
 */
export async function saveMail({ body, radioName, lat, lon, areaName = null }) {
  const id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const record = {
    id,
    body,
    radioName: radioName || null,
    lat: round100m(lat),
    lon: round100m(lon),
    areaName,
    createdAt: Date.now(),
  };
  const key = `mail:cell:${cellKey(lat, lon)}`;
  const value = JSON.stringify(record);

  if (isPersistent()) {
    await redis([
      ['LPUSH', key, value],
      ['LTRIM', key, 0, MAX_PER_CELL - 1],
    ]);
  } else {
    const list = mem.cells.get(key) ?? [];
    list.unshift(value);
    mem.cells.set(key, list.slice(0, MAX_PER_CELL));
  }
  return { id };
}

/**
 * 指定位置の近くに届いているお便りを新しい順に返す。
 * @param {number} lat
 * @param {number} lon
 * @param {{radiusM?: number, limit?: number}} [opts]
 */
export async function listNearbyMails(lat, lon, { radiusM = 800, limit = 20 } = {}) {
  const keys = neighborCells(lat, lon);
  let raw = [];
  let hidden = new Set();

  if (isPersistent()) {
    const results = await redis([
      ...keys.map((k) => ['LRANGE', `mail:cell:${k}`, 0, MAX_PER_CELL - 1]),
      ['SMEMBERS', HIDDEN_KEY],
    ]);
    raw = results.slice(0, keys.length).flatMap((r) => r || []);
    hidden = new Set(results[keys.length] || []);
  } else {
    raw = keys.flatMap((k) => mem.cells.get(`mail:cell:${k}`) ?? []);
    hidden = mem.hidden;
  }

  return raw
    .map((s) => {
      try {
        return JSON.parse(s);
      } catch {
        return null;
      }
    })
    .filter((m) => m && !hidden.has(m.id))
    .filter((m) => distanceMeters(lat, lon, m.lat, m.lon) <= radiusM)
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, limit);
}

/** 通報。しきい値に達したら自動的に非表示にする */
export async function reportMail(id) {
  if (isPersistent()) {
    const [count] = await redis([['INCR', `mail:report:${id}`]]);
    if (Number(count) >= REPORT_THRESHOLD) await redis([['SADD', HIDDEN_KEY, id]]);
    return { count: Number(count) };
  }
  const count = (mem.reports.get(id) ?? 0) + 1;
  mem.reports.set(id, count);
  if (count >= REPORT_THRESHOLD) mem.hidden.add(id);
  return { count };
}

/**
 * 簡易レート制限。同一IPからの連投を防ぐ。
 * @returns {Promise<boolean>} true なら許可
 */
export async function allowPost(ip, { max = 5, windowSec = 600 } = {}) {
  const key = `mail:rate:${ip}`;
  if (isPersistent()) {
    const [count] = await redis([['INCR', key]]);
    if (Number(count) === 1) await redis([['EXPIRE', key, windowSec]]);
    return Number(count) <= max;
  }
  const now = Date.now();
  const entry = mem.rate.get(key);
  if (!entry || now > entry.resetAt) {
    mem.rate.set(key, { count: 1, resetAt: now + windowSec * 1000 });
    return true;
  }
  entry.count += 1;
  return entry.count <= max;
}
