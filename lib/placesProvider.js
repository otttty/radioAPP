// ============================================================
// PlacesProvider
// 実装: OpenStreetMap Overpass API (APIキー不要・無料)。
// ランチ/カフェ/文化施設(美術館・ギャラリー)を半径800m以内で検索。
// 事実性: OSM上に存在するタグ付きデータのみを使用し、存在しない店名を
// 生成させない(台本生成側はこの配列以外の店名を語らない設計)。
// ============================================================
import { globalCache } from './cache.js';

const PLACES_TTL_MS = 24 * 60 * 60 * 1000; // 店はそう頻繁に変わらないので24hキャッシュ
const RADIUS_M = 1200; // トピックを拾う範囲を広めに
const OVERPASS_ENDPOINT = 'https://overpass-api.de/api/interpreter';

function distanceMeters(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

function buildQuery(lat, lon) {
  return `
    [out:json][timeout:15];
    (
      node["amenity"~"^(restaurant|fast_food|cafe)$"](around:${RADIUS_M},${lat},${lon});
      node["tourism"~"^(museum|gallery)$"](around:${RADIUS_M},${lat},${lon});
    );
    out center 20;
  `;
}

/**
 * @param {number} lat
 * @param {number} lon
 * @returns {Promise<import('./types.js').PlaceFact[]>}
 */
export async function getNearbyPlaces(lat, lon) {
  const cached = globalCache.get(lat, lon, 'places');
  if (cached) return cached;

  try {
    const res = await fetch(OVERPASS_ENDPOINT, {
      method: 'POST',
      body: 'data=' + encodeURIComponent(buildQuery(lat, lon)),
    });
    if (!res.ok) throw new Error(`overpass http ${res.status}`);
    const data = await res.json();

    /** @type {import('./types.js').PlaceFact[]} */
    const facts = (data.elements || [])
      .filter((el) => el.tags && el.tags.name) // 名称不明の要素は不確実情報として除外
      .map((el) => {
        const amenity = el.tags.amenity;
        const tourism = el.tags.tourism;
        let category = 'culture';
        if (amenity === 'cafe') category = 'cafe';
        else if (amenity === 'restaurant' || amenity === 'fast_food') category = 'lunch';
        return {
          name: el.tags.name,
          category,
          distanceM: Math.round(distanceMeters(lat, lon, el.lat, el.lon)),
          cuisine: el.tags.cuisine,
          source: 'OpenStreetMap',
        };
      })
      .sort((a, b) => a.distanceM - b.distanceM)
      .slice(0, 12);

    globalCache.set(lat, lon, 'places', facts, PLACES_TTL_MS);
    return facts;
  } catch (e) {
    console.warn('[placesProvider] failed:', e);
    return []; // 失敗時は空。台本生成側は「近くのお店情報は今回取得できませんでした」と扱う
  }
}
