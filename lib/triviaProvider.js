// ============================================================
// TriviaProvider (地域の豆知識)
// 実装: Wikipedia GeoSearch API (APIキー不要・無料)。
// 現在地周辺にある地名・地物のWikipedia記事から要約(extract)を取得する。
// 事実性: 記事の要約を要約者(生成AI)が改変して"それらしい嘘"を作らないよう、
// 取得した extract をそのまま(先頭数文に短縮するのみ)使う。出典(記事名)を必ず併記する。
//
// トピック選別: 「面白い豆知識」だけを残すため、歴史・食・名所・文化に関する
// 記事を優先し、単なる会社概要/オフィスビルの説明などは弾く。判定はWikipedia
// 記事の要約テキストに含まれるキーワードで行う(記事本文の改変はしない)。
// ============================================================
import { globalCache } from './cache.js';

const TRIVIA_TTL_MS = 24 * 60 * 60 * 1000;
const WIKI_ENDPOINT = 'https://ja.wikipedia.org/w/api.php';

// 面白いご当地ネタ寄りの記事に加点するキーワード。
// 神社仏閣・歴史に偏りがちなので、食・グルメ系を重め、寺社は軽めに重み付けする。
const FOOD_MARKERS = ['名物', '老舗', '名店', 'グルメ', '料理', '発祥', '商店街', '食堂', '専門店', '銘菓', '名産', '市場']; // ×3
const LANDMARK_MARKERS = ['名所', '庭園', '公園', '橋', '坂', '天然記念物', '舞台となった', '銅像', '眺望', '桜の名所']; // ×2
const HISTORY_MARKERS = ['江戸', '明治', '大正', '昭和', '創建', '創業', '由来', '起源', 'ゆかり', '史跡', '旧跡', '伝説', '逸話', '宿場', '関所', '街道', '遺跡', '古墳', '記念']; // ×1
const RELIGIOUS_MARKERS = ['神社', '神宮', '寺', '寺院', '城', '城跡', '祭', '祭り']; // ×1(かつ数を制限)

const MAX_RELIGIOUS = 2; // 純粋な寺社ネタは最大2件までに抑える(偏り防止)

// 会社概要・オフィスビルなど「豆知識として面白くない」記事に減点するキーワード
const NEGATIVE_MARKERS = [
  '株式会社', '有限会社', '合同会社', '本社を置く', '本社所在地', '企業である',
  'を運営する', 'を展開する', 'メーカー', 'ホールディングス', '上場', '証券取引所',
  '子会社', 'グループの中核', 'オフィスビル', '超高層ビル', '複合ビル', '事業所',
  '営業所', '支店', '工場である', 'サービスである', 'ブランドである',
];

function countMarkers(text, markers) {
  let n = 0;
  for (const m of markers) {
    if (text.includes(m)) n += 1;
  }
  return n;
}

// 固有名詞の直後にかっこ書きで付く「読み仮名(ふりがな)」を除去する。
// 例: 「将門塚(しょうもんづか、まさかどづか)は…」→「将門塚は…」
// 音声で読み方を復唱してしまうのを防ぐのが目的。中身がひらがな/カタカナ・
// 区切り記号だけのかっこのみを対象にし、年号や英字などの意味あるかっこは残す。
const KANA_PAREN = /[（(][぀-ヿー・､、,\s]+[）)]/g;

function stripReadings(text) {
  return text.replace(KANA_PAREN, '').replace(/\s{2,}/g, ' ').trim();
}

/**
 * @param {number} lat
 * @param {number} lon
 * @returns {Promise<import('./types.js').TriviaFact[]>}
 */
export async function getNearbyTrivia(lat, lon) {
  const cached = globalCache.get(lat, lon, 'trivia');
  if (cached) return cached;

  try {
    // 選別で弾く分を見込んで多めに候補を集める(半径も少し広げる)
    const geoUrl = `${WIKI_ENDPOINT}?action=query&list=geosearch&gscoord=${lat}%7C${lon}&gsradius=3000&gslimit=20&format=json&origin=*`;
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

    /** @type {(import('./types.js').TriviaFact & {_score: number, _religiousOnly: boolean})[]} */
    const scored = pages
      .map((p) => {
        const extractRaw = pageMap[p.pageid]?.extract ?? '';
        // 冒頭1〜2文だけに短縮(改変はしない。切り詰め+読み仮名の除去のみ)
        const firstSentences = extractRaw.split(/(?<=。)/).slice(0, 2).join('').trim();
        const food = countMarkers(extractRaw, FOOD_MARKERS);
        const landmark = countMarkers(extractRaw, LANDMARK_MARKERS);
        const history = countMarkers(extractRaw, HISTORY_MARKERS);
        const religious = countMarkers(extractRaw, RELIGIOUS_MARKERS);
        const neg = countMarkers(extractRaw, NEGATIVE_MARKERS);
        return {
          title: p.title,
          extract: stripReadings(firstSentences),
          source: `Wikipedia: ${p.title}`,
          // 食を主役に(×3)、名所×2、歴史×1、寺社×1、会社概要は強く減点(×2)
          _score: food * 3 + landmark * 2 + history + religious - neg * 2,
          // 食・名所要素が無く寺社ワードだけ=「純粋な寺社ネタ」。件数を制限する対象。
          _religiousOnly: religious > 0 && food === 0 && landmark === 0,
        };
      })
      .filter((f) => f.extract.length > 0)
      .filter((f) => f._score > 0)
      .sort((a, b) => b._score - a._score);

    // 寺社ネタの偏りを抑えつつ、上位から最大6件を選ぶ
    /** @type {import('./types.js').TriviaFact[]} */
    const facts = [];
    let religiousCount = 0;
    for (const f of scored) {
      if (f._religiousOnly) {
        if (religiousCount >= MAX_RELIGIOUS) continue;
        religiousCount += 1;
      }
      const { _score, _religiousOnly, ...rest } = f;
      facts.push(rest);
      if (facts.length >= 6) break;
    }

    globalCache.set(lat, lon, 'trivia', facts, TRIVIA_TTL_MS);
    return facts;
  } catch (e) {
    console.warn('[triviaProvider] failed:', e);
    return [];
  }
}
