// ============================================================
// WeatherProvider
// 実装: Open-Meteo (APIキー不要・無料) を利用。
// 抽象interfaceは getCurrentWeather(lat, lon) -> WeatherFact|null のみで、
// 将来 気象庁API/他社天気APIに差し替えても呼び出し側は変更不要。
// ============================================================
import { globalCache } from './cache.js';

const WEATHER_TTL_MS = 15 * 60 * 1000; // 天気は15分キャッシュ(数値が変わりうるため短め)

// Open-Meteo weathercode -> 日本語の短い概況。事実性のため、コード表に無い値は
// 「不明」として扱い、AIが勝手な天気を語らないようにする。
const WEATHER_CODE_JA = {
  0: '快晴', 1: 'ほぼ晴れ', 2: '一部くもり', 3: 'くもり',
  45: '霧', 48: '霧氷を伴う霧',
  51: '小雨(霧雨)', 53: '霧雨', 55: '強めの霧雨',
  61: '弱い雨', 63: '雨', 65: '強い雨',
  71: '弱い雪', 73: '雪', 75: '強い雪',
  80: 'にわか雨', 81: 'にわか雨(やや強め)', 82: '激しいにわか雨',
  95: '雷雨',
};

/**
 * @param {number} lat
 * @param {number} lon
 * @returns {Promise<import('./types.js').WeatherFact|null>}
 */
export async function getCurrentWeather(lat, lon) {
  const cached = globalCache.get(lat, lon, 'weather');
  if (cached) return cached;

  try {
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current_weather=true&timezone=auto`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`weather http ${res.status}`);
    const data = await res.json();
    const cw = data.current_weather;
    if (!cw) throw new Error('no current_weather field');

    /** @type {import('./types.js').WeatherFact} */
    const fact = {
      tempC: cw.temperature,
      weatherCode: cw.weathercode,
      description: WEATHER_CODE_JA[cw.weathercode] ?? '不明(未分類の天候)',
      asOf: cw.time,
      source: 'Open-Meteo',
    };
    globalCache.set(lat, lon, 'weather', fact, WEATHER_TTL_MS);
    return fact;
  } catch (e) {
    console.warn('[weatherProvider] failed:', e);
    return null; // 失敗時はnull。台本生成側は「天気は取得できず」と正直に扱う
  }
}
