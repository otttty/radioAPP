// ============================================================
// SimpleCache
// 役割: 「位置格子 x カテゴリ」をキーにしたTTL付きメモリキャッシュ。
// 狙い: 移動していない/近距離での再取得を防ぎ、外部APIコストと
//       レイテンシを抑える。ページを閉じると消える(=不要な永続化をしない)。
// ============================================================

export class SimpleCache {
  constructor() {
    /** @type {Map<string, {value: any, expiresAt: number}>} */
    this._store = new Map();
  }

  key(lat, lon, category) {
    // 既に100m格子に丸め済みの座標を前提とする
    return `${category}:${lat.toFixed(3)}:${lon.toFixed(3)}`;
  }

  get(lat, lon, category) {
    const k = this.key(lat, lon, category);
    const hit = this._store.get(k);
    if (!hit) return null;
    if (Date.now() > hit.expiresAt) {
      this._store.delete(k);
      return null;
    }
    return hit.value;
  }

  set(lat, lon, category, value, ttlMs) {
    const k = this.key(lat, lon, category);
    this._store.set(k, { value, expiresAt: Date.now() + ttlMs });
  }
}

export const globalCache = new SimpleCache();
