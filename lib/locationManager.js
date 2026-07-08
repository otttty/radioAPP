// ============================================================
// LocationManager
// 役割: Geolocation API のラップ。許可状態管理・粒度の丸め・
//       「意味のある移動」だけを検知して上位に通知する。
// 方針:
//  - 生の高精度座標は「今の周辺情報を引くため」だけに使い、
//    外部APIへ渡す/状態として保持する値は小数点3桁(約100m格子)に丸める。
//  - watchPositionは使うが、更新通知は間引く
//    (最小移動距離 MIN_MOVE_M か 最小経過時間 MIN_INTERVAL_MS を満たした時のみ)。
// ============================================================

const MIN_MOVE_M = 300; // これ未満の移動では周辺情報を再取得しない
const MIN_INTERVAL_MS = 10 * 60 * 1000; // 最短でも10分は間隔を空ける

/** 2点間の距離(m) ハバーサイン公式 */
function distanceMeters(a, b) {
  const R = 6371000;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/** 用途に足りる粒度に丸める(約100m格子)。外部送信・保存はこの値のみ */
function roundToGrid(lat, lon) {
  return { lat: Math.round(lat * 1000) / 1000, lon: Math.round(lon * 1000) / 1000 };
}

export class LocationManager {
  constructor() {
    /** @type {import('./types.js').LocationFix|null} */
    this.lastFix = null;
    this._watchId = null;
    this._onUpdate = null;
    this.permissionState = 'unknown'; // 'granted' | 'denied' | 'prompt' | 'unavailable'
  }

  /** 現在の許可状態を確認(可能なら Permissions API で事前確認してからUIに表示) */
  async checkPermission() {
    if (!('geolocation' in navigator)) {
      this.permissionState = 'unavailable';
      return this.permissionState;
    }
    if (navigator.permissions && navigator.permissions.query) {
      try {
        const status = await navigator.permissions.query({ name: 'geolocation' });
        this.permissionState = status.state; // granted/denied/prompt
        return this.permissionState;
      } catch {
        // Permissions API 非対応環境。実際に要求してみるまで不明のまま。
        this.permissionState = 'prompt';
        return this.permissionState;
      }
    }
    this.permissionState = 'prompt';
    return this.permissionState;
  }

  /**
   * ユーザー操作(ボタン押下)をトリガーに明示的に許可を求め、初回位置を取得する。
   * 拒否・失敗時は理由を含めたフォールバック用のfixを返す。
   */
  requestOnce() {
    return new Promise((resolve) => {
      if (!('geolocation' in navigator)) {
        this.permissionState = 'unavailable';
        resolve({ lat: 0, lon: 0, accuracy: Infinity, timestamp: Date.now(), status: 'unavailable' });
        return;
      }
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          this.permissionState = 'granted';
          const g = roundToGrid(pos.coords.latitude, pos.coords.longitude);
          const fix = {
            lat: g.lat,
            lon: g.lon,
            accuracy: pos.coords.accuracy,
            timestamp: Date.now(),
            status: pos.coords.accuracy > 2000 ? 'approx' : 'precise',
          };
          this.lastFix = fix;
          resolve(fix);
        },
        (err) => {
          this.permissionState = err.code === 1 ? 'denied' : 'unavailable';
          resolve({ lat: 0, lon: 0, accuracy: Infinity, timestamp: Date.now(), status: this.permissionState === 'denied' ? 'denied' : 'unavailable' });
        },
        // 体感速度優先: enableHighAccuracy=false でGPS測位を待たせず、
        // maximumAge を長めにしてOSがキャッシュ済みの位置があれば即座に使う。
        // このアプリは100m格子までしか使わないため、多少古いキャッシュでも実用上問題ない。
        { enableHighAccuracy: false, timeout: 6000, maximumAge: 10 * 60 * 1000 }
      );
    });
  }

  /**
   * 移動を継続監視。「意味のある移動」の時だけ onUpdate を呼ぶことで
   * 周辺情報の無駄な再取得(コスト・レイテンシ)を避ける。
   */
  watch(onUpdate) {
    this._onUpdate = onUpdate;
    if (!('geolocation' in navigator)) return;
    this._watchId = navigator.geolocation.watchPosition(
      (pos) => {
        const g = roundToGrid(pos.coords.latitude, pos.coords.longitude);
        const candidate = {
          lat: g.lat,
          lon: g.lon,
          accuracy: pos.coords.accuracy,
          timestamp: Date.now(),
          status: pos.coords.accuracy > 2000 ? 'approx' : 'precise',
        };
        const moved = this.lastFix ? distanceMeters(this.lastFix, candidate) : Infinity;
        const elapsed = this.lastFix ? candidate.timestamp - this.lastFix.timestamp : Infinity;
        if (moved >= MIN_MOVE_M || elapsed >= MIN_INTERVAL_MS) {
          this.lastFix = candidate;
          this._onUpdate && this._onUpdate(candidate, { movedM: moved });
        }
      },
      () => {
        /* 監視中の失敗は無視して直近のfixを使い続ける(通知は不要) */
      },
      { enableHighAccuracy: false, maximumAge: 60000, timeout: 15000 }
    );
  }

  stop() {
    if (this._watchId != null && 'geolocation' in navigator) {
      navigator.geolocation.clearWatch(this._watchId);
      this._watchId = null;
    }
  }
}
