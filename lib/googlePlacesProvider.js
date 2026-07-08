// ============================================================
// GooglePlacesProvider
// 実装: Google Places API (New) を /api/places プロキシ経由で呼び、
// 現在地周辺の「クチコミ数が一定以上ある高評価店」を評価順に取得する。
// APIキーはユーザーが画面で入力したものを都度サーバーへ渡すだけ(保存しない)。
//
// OSM版(placesProvider.js)と同じ PlaceFact[] 形を返すため、呼び出し側は
// どちらのソースでも同じコードで扱える。取得失敗時は空配列を返し、
// 呼び出し側がOSMへフォールバックできるようにする。
// ============================================================
import { globalCache } from './cache.js';

const PLACES_TTL_MS = 6 * 60 * 60 * 1000; // 評価は動くので6h(OSMより短め)
const RADIUS_M = 800;
const MIN_REVIEWS = 15; // これ未満のクチコミ数は「高評価」の判断材料に乏しいので除外

/**
 * @param {number} lat
 * @param {number} lon
 * @param {string} apiKey
 * @returns {Promise<import('./types.js').PlaceFact[]>}
 */
export async function getRatedPlaces(lat, lon, apiKey) {
  const cached = globalCache.get(lat, lon, 'places-rated');
  if (cached) return cached;

  const res = await fetch('/api/places', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ apiKey, lat, lon, radius: RADIUS_M }),
  });
  if (!res.ok) {
    const detail = await res.json().catch(() => ({}));
    throw new Error(`google places ${res.status}: ${detail?.error ?? ''}`);
  }
  const data = await res.json();

  /** @type {import('./types.js').PlaceFact[]} */
  const facts = (data.places || [])
    // 評価が付いていて、かつクチコミがある程度ある店だけを「高評価候補」とする
    .filter((p) => typeof p.rating === 'number' && (p.userRatingCount ?? 0) >= MIN_REVIEWS)
    // 評価の高さを主、クチコミ数の多さを従にして並べる(僅差なら件数が多い方を上に)
    .sort((a, b) => b.rating - a.rating || (b.userRatingCount ?? 0) - (a.userRatingCount ?? 0))
    .slice(0, 12);

  globalCache.set(lat, lon, 'places-rated', facts, PLACES_TTL_MS);
  return facts;
}
