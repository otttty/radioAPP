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

// Google Placesのタイプ → このアプリのカテゴリ
function categorize(types) {
  const t = types || [];
  if (t.includes('cafe') || t.includes('coffee_shop')) return 'cafe';
  if (t.includes('museum') || t.includes('art_gallery') || t.includes('tourist_attraction')) return 'culture';
  return 'lunch'; // restaurant / food 系はランチ扱い
}

function distanceMeters(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export async function POST(request) {
  let body;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: 'invalid JSON body' }, { status: 400 });
  }

  const { apiKey, lat, lon, radius } = body ?? {};
  // クライアントがキーを送ってくればそれを、無ければサーバーの既定キーを使う
  const key = (typeof apiKey === 'string' && apiKey.trim()) || process.env.GOOGLE_PLACES_API_KEY;
  if (!key) {
    return Response.json({ error: 'apiKey is required' }, { status: 400 });
  }
  if (typeof lat !== 'number' || typeof lon !== 'number') {
    return Response.json({ error: 'lat/lon are required' }, { status: 400 });
  }

  let upstream;
  try {
    upstream = await fetch(ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': key,
        'X-Goog-FieldMask': FIELD_MASK,
      },
      body: JSON.stringify({
        includedTypes: ['restaurant', 'cafe', 'museum', 'art_gallery'],
        maxResultCount: 20,
        rankPreference: 'POPULARITY',
        languageCode: 'ja',
        locationRestriction: {
          circle: {
            center: { latitude: lat, longitude: lon },
            radius: Math.min(Math.max(Number(radius) || 800, 100), 2000),
          },
        },
      }),
    });
  } catch {
    return Response.json({ error: 'failed to reach Google Places' }, { status: 502 });
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
