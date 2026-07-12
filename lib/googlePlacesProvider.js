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
const RADIUS_M = 500; // 参照する位置情報の範囲(半径500m・すぐ近くに絞る)
const MIN_REVIEWS = 15; // これ未満は判断材料に乏しいので除外
const MIN_RATING = 4.0; // これ未満(低評価)は紹介しない

// レビュー/概要に含まれると「穴場・隠れた名店」らしさが高い語
const GEM_KEYWORDS = [
  '穴場', '隠れ家', '隠れた', '知る人ぞ知る', 'こぢんまり', '静か', '落ち着',
  'ひっそり', '地元', '常連', 'あまり知られ', '見つけ', '通が', '穴場的',
];

/**
 * 「穴場度」スコア。高評価を前提に、有名すぎない(観光地・大型店でない)店を優先する。
 * 評価は高いほど良いが、クチコミが極端に多い=誰もが知る有名店は穴場ではないので減点。
 * @param {import('./types.js').PlaceFact} p
 */
function gemScore(p) {
  const n = p.userRatingCount ?? 0;
  let s = p.rating * 10; // 評価を主軸に
  const text = (p.reviews || []).join(' ') + ' ' + (p.summary || '');
  if (GEM_KEYWORDS.some((k) => text.includes(k))) s += 6; // 穴場ワードで加点
  // 有名すぎる(観光地・チェーン大型店)は穴場感が薄いので段階的に減点
  if (n > 20000) s -= 9;
  else if (n > 8000) s -= 6;
  else if (n > 3000) s -= 3;
  // 信頼できるが有名すぎない「ちょうどいい」件数に加点
  if (n >= 40 && n <= 1500) s += 4;
  return s;
}

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
    // 一定のクチコミ数があり、かつ低評価でない店だけを対象にする
    .filter(
      (p) => typeof p.rating === 'number' && p.rating >= MIN_RATING && (p.userRatingCount ?? 0) >= MIN_REVIEWS
    )
    // 穴場度の高い順(高評価・有名すぎない店を優先)
    .sort((a, b) => gemScore(b) - gemScore(a))
    .slice(0, 12);

  globalCache.set(lat, lon, 'places-rated', facts, PLACES_TTL_MS);
  return facts;
}
