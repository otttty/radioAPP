// ============================================================
// geocodeFallback
// 役割: 位置情報が「拒否/失敗/取得不可」の場合のフォールバック。
// ユーザーが地名を手入力したらおおよその座標に変換する。
// これも取得後は100m格子に丸めて扱う。
//
// 実装: Open-Meteo Geocoding API (APIキー不要)。
// Nominatimは利用ポリシー上レート制限が厳しく応答が遅くなりやすいため、
// 天気取得と同じOpen-Meteoエコシステムの高速なジオコーディングに変更した。
// さらに AbortController で5秒のタイムアウトを設け、「反応が返ってこない」
// 体感を防いでいる。
// ============================================================

const GEOCODE_TIMEOUT_MS = 5000;

export async function geocodePlaceName(query) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), GEOCODE_TIMEOUT_MS);
  try {
    const url = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(query)}&count=1&language=ja&format=json`;
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) throw new Error(`geocode http ${res.status}`);
    const data = await res.json();
    const hit = data?.results?.[0];
    if (!hit) return null;
    const lat = Math.round(hit.latitude * 1000) / 1000;
    const lon = Math.round(hit.longitude * 1000) / 1000;
    return { lat, lon, accuracy: 2000, timestamp: Date.now(), status: 'approx' };
  } catch (e) {
    console.warn('[geocodeFallback] failed or timed out:', e);
    return null;
  } finally {
    clearTimeout(timer);
  }
}
