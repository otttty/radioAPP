// ============================================================
// mailStore (サーバー専用)
// ------------------------------------------------------------
// リスナーが投稿したお便りを「位置」で保存・取得するストア。
// 別のリスナーが同じ場所に来たとき、その土地に届いたお便りを拾えるようにする。
//
// 保存先は3系統(上から順に採用):
//  1) REDIS_URL: Redisプロトコル(TCP)。VercelのRedis連携で入る一般的な形式。
//     Node.jsランタイムのRoute Handlerから ioredis で接続する。
//  2) KV_REST_API_URL / UPSTASH_REDIS_REST_URL: UpstashのREST API(fetchのみ)。
//  3) メモリ: 環境変数が無い場合のフォールバック。ローカル開発用で、
//     サーバーレスではインスタンス間で共有されない(=本番では実質使えない)。
//
// プライバシー: 座標は約1km格子に丸めたセルキーと、100m格子に丸めた座標だけを
// 保存する。投稿者の正確な位置は保存しない。
// ============================================================

import Redis from 'ioredis';

const CELL_DEG = 0.009; // 約1kmのセル。読み出しは3x3セル=約3km四方を見る
const MAX_PER_CELL = 200; // 1セルに保持する最大件数(古いものから落ちる)
const HIDDEN_KEY = 'mail:hidden'; // 通報で非表示になったIDの集合
const REPORT_THRESHOLD = 2; // この件数の通報で自動的に非表示

const redisUrl = () => process.env.REDIS_URL || process.env.KV_URL || '';
const restUrl = () => process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL || '';
const restToken = () => process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN || '';

/** 共有ストア(=他のリスナーにも届く保存先)が使えるか */
export const isPersistent = () => !!(redisUrl() || (restUrl() && restToken()));

// --- バックエンド1: Redis (TCP) ---------------------------------------
// サーバーレスでは呼び出しごとにモジュールが再利用されるため、接続は
// globalThis に載せて使い回す(毎回新規接続すると接続数が枯渇する)。
function redisClient() {
  const g = globalThis;
  if (!g.__machikadoRedis) {
    const client = new Redis(redisUrl(), {
      maxRetriesPerRequest: 2,
      connectTimeout: 5000,
      // 接続が切れている間もコマンドを保留し、復帰後に流す
      enableOfflineQueue: true,
    });
    client.on('error', (e) => console.error('[mailStore] redis error:', e.message));
    g.__machikadoRedis = client;
  }
  return g.__machikadoRedis;
}

// --- バックエンド2: Upstash REST --------------------------------------
async function rest(commands) {
  const res = await fetch(`${restUrl()}/pipeline`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${restToken()}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(commands),
  });
  if (!res.ok) throw new Error(`kv ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const out = await res.json();
  return out.map((r) => r.result);
}

// --- バックエンド3: メモリ(ローカル開発用) ---------------------------
const mem = {
  cells: new Map(), // key -> string[](新しい順)
  hidden: new Set(),
  reports: new Map(), // id -> count
  rate: new Map(), // key -> { count, resetAt }
};

// --- 共通の操作(どのバックエンドでも同じ意味になるように包む) --------
const backend = {
  async pushCapped(key, value) {
    if (redisUrl()) {
      const r = redisClient();
      await r.multi().lpush(key, value).ltrim(key, 0, MAX_PER_CELL - 1).exec();
      return;
    }
    if (restUrl()) {
      await rest([
        ['LPUSH', key, value],
        ['LTRIM', key, 0, MAX_PER_CELL - 1],
      ]);
      return;
    }
    const list = mem.cells.get(key) ?? [];
    list.unshift(value);
    mem.cells.set(key, list.slice(0, MAX_PER_CELL));
  },

  /** 複数キーのリストと、非表示IDの集合をまとめて取得する */
  async readLists(keys) {
    if (redisUrl()) {
      const r = redisClient();
      const pipe = r.pipeline();
      for (const k of keys) pipe.lrange(k, 0, MAX_PER_CELL - 1);
      pipe.smembers(HIDDEN_KEY);
      const res = await pipe.exec(); // [[err, value], ...]
      const values = res.map(([, v]) => v);
      return { lists: values.slice(0, keys.length), hidden: new Set(values[keys.length] || []) };
    }
    if (restUrl()) {
      const res = await rest([...keys.map((k) => ['LRANGE', k, 0, MAX_PER_CELL - 1]), ['SMEMBERS', HIDDEN_KEY]]);
      return { lists: res.slice(0, keys.length), hidden: new Set(res[keys.length] || []) };
    }
    return { lists: keys.map((k) => mem.cells.get(k) ?? []), hidden: mem.hidden };
  },

  async incrReport(id) {
    const key = `mail:report:${id}`;
    if (redisUrl()) {
      const r = redisClient();
      const count = await r.incr(key);
      if (count >= REPORT_THRESHOLD) await r.sadd(HIDDEN_KEY, id);
      return count;
    }
    if (restUrl()) {
      const [count] = await rest([['INCR', key]]);
      if (Number(count) >= REPORT_THRESHOLD) await rest([['SADD', HIDDEN_KEY, id]]);
      return Number(count);
    }
    const count = (mem.reports.get(id) ?? 0) + 1;
    mem.reports.set(id, count);
    if (count >= REPORT_THRESHOLD) mem.hidden.add(id);
    return count;
  },

  async incrWithTtl(key, ttlSec) {
    if (redisUrl()) {
      const r = redisClient();
      const count = await r.incr(key);
      if (count === 1) await r.expire(key, ttlSec);
      return count;
    }
    if (restUrl()) {
      const [count] = await rest([['INCR', key]]);
      if (Number(count) === 1) await rest([['EXPIRE', key, ttlSec]]);
      return Number(count);
    }
    const now = Date.now();
    const entry = mem.rate.get(key);
    if (!entry || now > entry.resetAt) {
      mem.rate.set(key, { count: 1, resetAt: now + ttlSec * 1000 });
      return 1;
    }
    entry.count += 1;
    return entry.count;
  },
};

/** 緯度経度 → 約1km格子のセルキー */
function cellKey(lat, lon) {
  return `mail:cell:${Math.round(lat / CELL_DEG)}_${Math.round(lon / CELL_DEG)}`;
}

/** 中心セルと周囲8セル(=3x3)のキー */
function neighborCells(lat, lon) {
  const y = Math.round(lat / CELL_DEG);
  const x = Math.round(lon / CELL_DEG);
  const keys = [];
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) keys.push(`mail:cell:${y + dy}_${x + dx}`);
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
  await backend.pushCapped(cellKey(lat, lon), JSON.stringify(record));
  return { id };
}

/**
 * 指定位置の近くに届いているお便りを新しい順に返す。
 * @param {number} lat
 * @param {number} lon
 * @param {{radiusM?: number, limit?: number}} [opts]
 */
export async function listNearbyMails(lat, lon, { radiusM = 800, limit = 20 } = {}) {
  const { lists, hidden } = await backend.readLists(neighborCells(lat, lon));
  return lists
    .flatMap((l) => l || [])
    .map((s) => {
      try {
        return typeof s === 'string' ? JSON.parse(s) : s;
      } catch {
        return null;
      }
    })
    .filter((m) => m && m.id && !hidden.has(m.id))
    .filter((m) => distanceMeters(lat, lon, m.lat, m.lon) <= radiusM)
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, limit);
}

/** 通報。しきい値に達したら自動的に非表示にする */
export async function reportMail(id) {
  return { count: await backend.incrReport(id) };
}

/**
 * 簡易レート制限。同一IPからの連投を防ぐ。
 * @returns {Promise<boolean>} true なら許可
 */
export async function allowPost(ip, { max = 5, windowSec = 600 } = {}) {
  const count = await backend.incrWithTtl(`mail:rate:${ip}`, windowSec);
  return count <= max;
}
