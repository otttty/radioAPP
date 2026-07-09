/**
 * 型定義(JSDoc)
 * ------------------------------------------------------------
 * このアプリはJSDocの @typedef で型を明示している。
 * TypeScriptを導入する場合、このファイルの typedef をそのまま
 * interface 宣言に機械的に変換できるように設計してある。
 *
 * 例: LocationFix -> `interface LocationFix { lat: number; ... }`
 */

/**
 * @typedef {Object} LocationFix
 * @property {number} lat - 丸め済み緯度(必要粒度のみ。生の高精度値は保持しない)
 * @property {number} lon - 丸め済み経度
 * @property {number} accuracy - Geolocation由来の精度(m)
 * @property {number} timestamp - 取得時刻(epoch ms)
 * @property {'precise'|'approx'|'denied'|'unavailable'} status - 取得状況
 */

/**
 * @typedef {Object} WeatherFact
 * @property {number} tempC
 * @property {string} description - 日本語の天気概況(例: "晴れ")
 * @property {number} weatherCode - Open-Meteo の weathercode
 * @property {string} asOf - ISO時刻文字列(この値がいつ時点の観測/予報か)
 * @property {string} source - 出典表記
 */

/**
 * @typedef {Object} PlaceFact
 * @property {string} name
 * @property {'lunch'|'cafe'|'culture'} category
 * @property {number} distanceM
 * @property {string} [cuisine]
 * @property {number} [rating] - 星評価(0〜5)。Google Placesなど評価付きソース利用時のみ
 * @property {number} [userRatingCount] - クチコミ件数。同上
 * @property {string} [summary] - お店の概要(editorialSummary)。Google Places利用時のみ
 * @property {string[]} [reviews] - 利用者レビュー本文の抜粋(最大3件)。Google Places利用時のみ
 * @property {string} source
 */

/**
 * @typedef {Object} TriviaFact
 * @property {string} title
 * @property {string} [reading] - タイトルの正しいかな読み(記事冒頭の読み仮名由来。誤読対策のヒント)
 * @property {string} extract - 要約(出典から改変せず短縮のみ)
 * @property {string} source
 */

/**
 * @typedef {Object} FactBundle
 * @property {WeatherFact|null} weather
 * @property {PlaceFact[]} places
 * @property {TriviaFact[]} trivia
 * @property {LocationFix} location
 */

/**
 * @typedef {Object} ScriptLine
 * @property {'main'|'sub'} speaker
 * @property {string} text - 字幕用の通常表記(漢字を含む)
 * @property {string} [speech] - 読み上げ用のかな表記(漢字誤読対策。無ければtextを読む)
 */

/**
 * @typedef {Object} Segment
 * @property {string} id
 * @property {'weather'|'lunch'|'cafe'|'culture'|'trivia'|'filler'|'opening'|'bridge'} topic
 * @property {ScriptLine[]} lines
 * @property {boolean} factGrounded - true なら実データに基づく発話のみで構成
 */

export {};
