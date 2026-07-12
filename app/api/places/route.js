// ============================================================
// /api/places
// 役割: Google Places API (New) の Nearby Search へのサーバーサイドプロキシ。
// ブラウザからGoogleへ直接キー付きリクエストを送らずに済むようにする
// (公開デプロイ時にキーがネットワークタブへ露出するのを避けるため)。
// キーはリクエストごとに転送するだけで、サーバー側に保存・ログ出力はしない。
//
// 高評価のお店を拾うのが狙いなので、rating(星)と userRatingCount(クチコミ数)を
// 取得し、一定のクチコミ数がある店を評価順に並べて返す。
// ============================================================

export const runtime = 'nodejs';

import { cleanApiKey } from '../../../lib/apiKey.js';

const ENDPOINT = 'https://places.googleapis.com/v1/places:searchNearby';
// reviews / editorialSummary は上位SKU(課金が高め)だが、
// 台本で「利用者の声・お店の雰囲気」を語らせるために取得する。
const FIELD_MASK = [
  'places.displayName',
  'places.rating',
  'places.userRatingCount',
  'places.location',
  'places.types',
  'places.primaryTypeDisplayName',
  'places.editorialSummary',
  'places.reviews',
].join(',');

// レビュー本文を短く整える(1件あたり最大160字、最大3件)
function pickReviews(reviews) {
  return (reviews || [])
    .map((r) => (r?.text?.text || '').replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .slice(0, 3)
    .map((t) => (t.length > 160 ? `${t.slice(0, 160)}…` : t));
}

// 飲食店に限らず、公園・建物・名所などレビューが付くスポットを幅広く対象にする。
const INCLUDED_TYPES = [
  // 食
  'restaurant', 'cafe', 'bakery', 'bar', 'meal_takeaway',
  // 公園・自然
  'park', 'national_park', 'garden',
  // 文化・名所・建物
  // ※ place_of_worship は searchNearby の includedTypes では未対応(400になる)。
  //   礼拝所は church / hindu_temple / mosque / synagogue でカバーする。
  'museum', 'art_gallery', 'tourist_attraction', 'historical_landmark', 'monument',
  'church', 'hindu_temple', 'mosque', 'synagogue',
  'library', 'zoo', 'aquarium', 'amusement_park', 'stadium',
  // 商業施設・その他の建物
  'shopping_mall', 'book_store', 'department_store',
];

// Google Placesのタイプ → このアプリの表示カテゴリ
function categorize(types) {
  const t = types || [];
  const has = (...xs) => xs.some((x) => t.includes(x));
  if (has('park', 'national_park', 'garden')) return 'park';
  if (has('cafe', 'coffee_shop')) return 'cafe';
  if (has('museum', 'art_gallery', 'tourist_attraction', 'historical_landmark', 'monument',
    'place_of_worship', 'church', 'hindu_temple', 'mosque', 'synagogue', 'library',
    'zoo', 'aquarium', 'amusement_park', 'stadium')) return 'culture';
  if (has('restaurant', 'bakery', 'bar', 'meal_takeaway', 'food')) return 'lunch';
  if (has('shopping_mall', 'book_store', 'department_store')) return 'shop';
  return 'spot';
}

function distanceMeters(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

// Google Places への外向きリクエスト。タイムアウト(AbortController)付きで、
// 一時的なネットワーク失敗は1回だけリトライする。Vercelのサーバーレス関数では
// 稀に外向きfetchがハング/瞬断するため、ここで粘って安定させる。
async function fetchGooglePlaces(key, requestBody, { timeoutMs = 9000, retries = 1 } = {}) {
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await fetch(ENDPOINT, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Goog-Api-Key': key,
          'X-Goog-FieldMask': FIELD_MASK,
        },
        body: requestBody,
        signal: controller.signal,
      });
    } catch (e) {
      lastErr = e;
      // タイムアウト(abort)や瞬断は1回だけ間を置いて再試行する
      if (attempt < retries) await new Promise((r) => setTimeout(r, 400));
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastErr;
}

export async function POST(request) {
  let body;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: 'invalid JSON body' }, { status: 400 });
  }

  const { apiKey, lat, lon, radius } = body ?? {};
  // クライアントがキーを送ってくればそれを、無ければサーバーの既定キーを使う。
  // 不可視文字(改行・U+2028等)が混じるとヘッダに載せられずfetchが例外を投げるため洗う。
  const key = cleanApiKey(apiKey) || cleanApiKey(process.env.GOOGLE_PLACES_API_KEY);
  if (!key) {
    return Response.json({ error: 'apiKey is required' }, { status: 400 });
  }
  if (typeof lat !== 'number' || typeof lon !== 'number') {
    return Response.json({ error: 'lat/lon are required' }, { status: 400 });
  }

  const requestBody = JSON.stringify({
    includedTypes: INCLUDED_TYPES,
    maxResultCount: 20,
    rankPreference: 'POPULARITY',
    languageCode: 'ja',
    locationRestriction: {
      circle: {
        center: { latitude: lat, longitude: lon },
        radius: Math.min(Math.max(Number(radius) || 800, 100), 2000),
      },
    },
  });

  let upstream;
  try {
    upstream = await fetchGooglePlaces(key, requestBody);
  } catch (e) {
    // 外向きfetchが例外(タイムアウト/DNS/TLS等)。真因が分かるよう実際の
    // エラーメッセージを返す(握りつぶさない)。サーバーログにも残す。
    const reason = e?.name === 'AbortError' ? 'timeout (>9s)' : String(e?.message || e);
    console.error('[api/places] upstream fetch failed:', reason);
    return Response.json({ error: `failed to reach Google Places: ${reason}` }, { status: 502 });
  }

  if (!upstream.ok) {
    const detail = await upstream.text().catch(() => '');
    return Response.json(
      { error: detail?.slice(0, 300) || 'Google Places request failed' },
      { status: upstream.status || 502 }
    );
  }

  if (!upstream.ok) {
    const detail = await upstream.text().catch(() => '');
    return Response.json(
      { error: detail?.slice(0, 300) || 'Google Places request failed' },
      { status: upstream.status || 502 }
    );
  }

  const data = await upstream.json().catch(() => ({}));
  const places = (data.places || [])
    .map((p) => ({
      name: p.displayName?.text || '',
      category: categorize(p.types),
      distanceM: p.location
        ? Math.round(distanceMeters(lat, lon, p.location.latitude, p.location.longitude))
        : null,
      cuisine: p.primaryTypeDisplayName?.text,
      rating: typeof p.rating === 'number' ? p.rating : undefined,
      userRatingCount: typeof p.userRatingCount === 'number' ? p.userRatingCount : undefined,
      summary: p.editorialSummary?.text || undefined,
      reviews: pickReviews(p.reviews),
      source: 'Google Maps',
    }))
    .filter((p) => p.name && p.distanceM != null);

  return Response.json({ places });
}
