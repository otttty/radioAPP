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
  let s = (p.rating ?? 0) * 10; // 評価を主軸に(評価が無い店は0扱い=末尾寄りに)
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
  // 空配列はキャッシュに焼き付けない(キー未設定や一時失敗で一度[]になると
  // 6時間ずっとトピックが出なくなるため)。中身があるときだけキャッシュを使う。
  if (cached && cached.length) return cached;

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
  const raw = data.places || [];

  // 方針: 「レビュー本文が付いているスポットは片っ端から」全部トピックにする。
  // 評価やクチコミ数では足切りしない(ネタ切れで番組を止めないため)。
  // ただし並び順は穴場度(高評価・有名すぎない)の高い順にして、良いネタから出す。
  const facts = selectPlaces(raw);

  // 中身があるときだけキャッシュ(空はキャッシュしない=次回すぐ再取得できる)
  if (facts.length) globalCache.set(lat, lon, 'places-rated', facts, PLACES_TTL_MS);
  return facts;
}

/**
 * 生のPlaces配列から、レビュー本文が付いたスポットを穴場度順に返す。
 * 評価・クチコミ数での足切りはしない(レビューさえあれば採用)。
 * @param {any[]} raw
 * @returns {import('./types.js').PlaceFact[]}
 */
function selectPlaces(raw) {
  return raw
    // お便りはレビュー内容に基づいて作るため、レビュー本文があることだけを条件にする
    .filter((p) => Array.isArray(p.reviews) && p.reviews.length > 0)
    // 穴場度の高い順(高評価・有名すぎないスポットを優先。低評価店も末尾に残す)
    .sort((a, b) => gemScore(b) - gemScore(a))
    .slice(0, 20);
}
