// ============================================================
// TriviaProvider (地域の豆知識)
// 実装: Wikipedia GeoSearch API (APIキー不要・無料)。
// 現在地周辺にある地名・地物のWikipedia記事から要約(extract)を取得する。
// 事実性: 記事の要約を要約者(生成AI)が改変して"それらしい嘘"を作らないよう、
// 取得した extract をそのまま(先頭数文に短縮するのみ)使う。出典(記事名)を必ず併記する。
// ============================================================
import { globalCache } from './cache.js';

const TRIVIA_TTL_MS = 24 * 60 * 60 * 1000;
const WIKI_ENDPOINT = 'https://ja.wikipedia.org/w/api.php';

/**
 * @param {number} lat
 * @param {number} lon
 * @returns {Promise<import('./types.js').TriviaFact[]>}
 */
export async function getNearbyTrivia(lat, lon) {
  const cached = globalCache.get(lat, lon, 'trivia');
  if (cached) return cached;

  try {
    const geoUrl = `${WIKI_ENDPOINT}?action=query&list=geosearch&gscoord=${lat}%7C${lon}&gsradius=2000&gslimit=5&format=json&origin=*`;
    const geoRes = await fetch(geoUrl);
    if (!geoRes.ok) throw new Error(`wiki geosearch http ${geoRes.status}`);
    const geoData = await geoRes.json();
    const pages = geoData.query?.geosearch ?? [];
    if (pages.length === 0) return [];

    const pageIds = pages.map((p) => p.pageid).join('|');
    const extractUrl = `${WIKI_ENDPOINT}?action=query&pageids=${pageIds}&prop=extracts&exintro=1&explaintext=1&format=json&origin=*`;
    const exRes = await fetch(extractUrl);
    if (!exRes.ok) throw new Error(`wiki extracts http ${exRes.status}`);
    const exData = await exRes.json();
    const pageMap = exData.query?.pages ?? {};

    /** @type {import('./types.js').TriviaFact[]} */
    const facts = pages
      .map((p) => {
        const extractRaw = pageMap[p.pageid]?.extract ?? '';
        // 冒頭1〜2文だけに短縮(改変はしない。切り詰めのみ)
        const firstSentences = extractRaw.split(/(?<=。)/).slice(0, 2).join('').trim();
        return {
          title: p.title,
          extract: firstSentences,
          source: `Wikipedia: ${p.title}`,
        };
      })
      .filter((f) => f.extract.length > 0);

    globalCache.set(lat, lon, 'trivia', facts, TRIVIA_TTL_MS);
    return facts;
  } catch (e) {
    console.warn('[triviaProvider] failed:', e);
    return [];
  }
}
