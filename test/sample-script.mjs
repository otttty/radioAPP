// 台本生成の単体確認用スクリプト(Node上でDOM無しに実行可能)
// 実行: npm test (= node test/sample-script.mjs)
// 注: LLMキーは未設定なので、ここではテンプレート・フォールボック経路を確認する。
import { ScriptGenerator } from '../lib/scriptGenerator.js';

const facts = {
  location: { lat: 35.658, lon: 139.701, accuracy: 20, timestamp: Date.now(), status: 'precise' },
  weather: { tempC: 27.4, description: 'ほぼ晴れ', weatherCode: 1, asOf: '2026-07-06T12:00', source: 'Open-Meteo' },
  places: [
    { name: '定食屋 ひまわり', category: 'lunch', distanceM: 180, cuisine: '和食', source: 'OpenStreetMap' },
    { name: 'カフェ・ド・パルク', category: 'cafe', distanceM: 240, cuisine: undefined, source: 'OpenStreetMap' },
    { name: '区立現代美術館', category: 'culture', distanceM: 520, source: 'OpenStreetMap' },
  ],
  trivia: [
    { title: '代々木公園', extract: '代々木公園は東京都渋谷区にある都立公園で、かつてワシントンハイツと呼ばれる米軍住宅地であった。', source: 'Wikipedia: 代々木公園' },
  ],
};

const gen = new ScriptGenerator({ rng: (() => { let s = 42; return () => (s = (s * 9301 + 49297) % 233280) / 233280; })() });

for (let i = 0; i < 7; i++) {
  const seg = await gen.nextSegment(facts);
  console.log(`\n--- [${i + 1}] topic=${seg.topic} factGrounded=${seg.factGrounded} ---`);
  for (const line of seg.lines) {
    const name = line.speaker === 'main' ? 'ひかり' : 'そら';
    console.log(`${name}: ${line.text}`);
  }
}
