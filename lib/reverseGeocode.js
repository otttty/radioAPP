// ============================================================
// reverseGeocode
// 役割: 緯度経度から「市区町村・町名」レベルのざっくりした地名を得る。
// 用途: 番組冒頭で「今日は○○のまわりの話題を…」と土地に触れるため。
//
// 実装: BigDataCloud の reverse-geocode-client (APIキー不要・クライアント利用可)。
// 個人特定につながる番地までは取得せず、市区町村/町名レベルの粗い名称のみ使う
// (このアプリの「座標は100m格子に丸める」方針とも整合する)。
// AbortControllerで3秒のタイムアウトを設け、取得できなければ null を返して
// 呼び出し側が汎用的な言い回しにフォールバックできるようにする。
// ============================================================
import { globalCache } from './cache.js';

const AREA_TTL_MS = 24 * 60 * 60 * 1000;
const TIMEOUT_MS = 3000;

/**
 * @param {number} lat
 * @param {number} lon
 * @returns {Promise<string|null>} 例: "千代田区" / "渋谷区" / "京都市東山区"
 */
export async function reverseGeocodeArea(lat, lon) {
  const cached = globalCache.get(lat, lon, 'area');
  if (cached !== null && cached !== undefined) return cached;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const url = `https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${lat}&longitude=${lon}&localityLanguage=ja`;
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) throw new Error(`reverse geocode http ${res.status}`);
    const data = await res.json();

    // city(市区町村)を最優先。無ければ locality(町名) / principalSubdivision(都道府県)
    const name =
      (data.city && String(data.city).trim()) ||
      (data.locality && String(data.locality).trim()) ||
      (data.principalSubdivision && String(data.principalSubdivision).trim()) ||
      null;

    globalCache.set(lat, lon, 'area', name, AREA_TTL_MS);
    return name;
  } catch (e) {
    console.warn('[reverseGeocode] failed or timed out:', e);
    return null;
  } finally {
    clearTimeout(timer);
  }
}
