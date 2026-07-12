# まちかどラジオ — 引き継ぎ資料 (HANDOFF)

最終更新: 2026-07-12

## 1. 概要

現在地の周辺スポット(Google Places)を題材に、**1人のDJ「ボブ」がリスナーからの
お便り(ラジオメール)を読み上げる**形式のローカルラジオ Web アプリ。音声合成(TTS)と
LLM 台本生成で、途切れずに番組を流し続ける。

- 元は静的 HTML+ESモジュールの MVP(`/Users/so/Documents/Claude/radio/outputs/lunch-radio`)。
- それを **Next.js (App Router)** に移植したのが本リポジトリ `lunch-radio-next`。

## 2. リポジトリ / デプロイ

- ローカル: `/Users/so/Documents/Claude/radio/lunch-radio-next`
- GitHub: `origin` → https://github.com/otttty/radioAPP.git (ブランチ `main`)
- Vercel: 上記リポジトリに接続。**`main` への push で自動再デプロイ**。
- 開発フロー: 変更 → ローカル検証(ビルド/実データ) → `main` に commit & push(＝公開)。
- ローカル起動: `npm install` → `npm run dev`(要 Node.js。マシンには v24.18.0 を公式pkgで導入済み)。
  台本生成だけの確認は `npm test`(ネットワーク/LLM不要、テンプレート経路)。

## 3. アーキテクチャ

ブラウザ(クライアント)から、課金/秘匿が絡む外部APIは**すべて同一オリジンの
`/api/*` プロキシ経由**で呼ぶ(キーをクライアントに出さないため)。

```
app/
  layout.js            メタデータ / globals.css
  page.js              LunchRadioApp を ssr:false で読み込む
  api/
    config/route.js    どの既定キーがサーバーに設定済みか真偽値だけ返す(キーは返さない)
    tts/route.js        OpenAI TTS プロキシ(既定キー: OPENAI_API_KEY)
    elevenlabs/route.js ElevenLabs TTS プロキシ(既定キー: ELEVENLABS_API_KEY)
    script/route.js     OpenAI Chat(台本LLM)プロキシ(既定キー: OPENAI_API_KEY)
    places/route.js     Google Places (New) searchNearby プロキシ(既定キー: GOOGLE_PLACES_API_KEY)
components/
  LunchRadioApp.js     UI本体(位置取得・データ収集・パイプライン起動・字幕表示)
lib/
  locationManager.js   Geolocation ラップ(許可・100m格子丸め・移動検知)
  reverseGeocode.js    逆ジオコーディング(BigDataCloud, キー不要)→市区町村名
  geocodeFallback.js   地名手入力→座標(Open-Meteo Geocoding)
  googlePlacesProvider.js  /api/places を呼び、レビュー付き高評価スポットを穴場順に返す
  scriptGenerator.js   トピック選定(決定的)+ LLM台本生成(失敗時テンプレ)
  openaiTtsEngine.js   OpenAI TTS エンジン(Web Audio再生・先読み)
  elevenLabsTtsEngine.js ElevenLabs TTS エンジン(同上・同時実行制限つき)
  ttsEngine.js         ブラウザ内蔵(Web Speech API)エンジン
  audioPipeline.js     セグメントキュー・先読み生成・BGM・途切れない再生ループ
  types.js             JSDoc 型定義
middleware.js          Basic認証ゲート(SITE_PASSWORD)。サイト全体+/api/*を保護
test/sample-script.mjs テンプレート台本の確認用
```

データフロー: 位置取得 → `getRatedPlaces`(Google Places) → `ScriptGenerator`
(選定+LLM) → `AudioPipeline`(TTS+連続再生) → 字幕更新。

## 4. 番組フォーマット(現行仕様)

- **1人ホスト「ボブ」**(明るく気さくなDJ。タメ口とですます調を自然に混ぜる)。
  口癖(ファンキー/ってわけ! 等)は**控えめ**(1トピックに多くて1回)。
- **お便り形式**: 各スポットを「いまその場所にいるリスナーからのメール」として紹介。
  - お便り本文は**Google のレビュー内容に基づく**(送り主の体験談として語る。出典は言わない)。
  - お便りは**テキスト想定**なので、ボブは読み上げの途中で相槌を打たない(読み終えてからコメント)。
  - 文体はですます調ベース+時々タメ口。ラジオネームは毎回オリジナル(使用済みは重複禁止)。
- **トピックはGoogle Placesのスポットのみ**(天気・Wikipedia豆知識・OSMは番組本編から**除外済み**)。
- **飲食店以外も対象**(公園/名所/寺社/図書館/商業施設など、レビューが付いていれば対象)。
- **穴場優先**: 評価4.0未満は除外。高評価かつ有名すぎない(クチコミが多すぎない)スポットを上位に。
- 参照範囲は**半径500m**(徒歩圏)。
- **冒頭の位置取得中はボブのフリートーク(warmup)**でつなぎ、位置確定後にスポット紹介へ移行。
- 音声は既定 **OpenAI TTS**(ボブ=onyx。speed 1.35・抑揚大きめ・「！」で語尾上げ、一辺倒回避)。
  読み上げは漢字誤読対策で **speech(かな表記)** を LLM に併産させて読む。

## 5. 設計上の主な決定

- **秘匿情報はサーバー側のみ**: APIキーはクライアントに出さず `/api/*` 経由。
  `.env.local`(gitignore済み)に置き、本番は Vercel の環境変数に同名で登録する。
- **既定キーで"連携済み"**: `/api/config` が真偽値だけ返し、キー未入力でも開始できる。
  各 `/api/*` は「リクエストのキー || サーバー環境変数」で解決。
- **アクセスゲート**: `middleware.js` の Basic 認証(`SITE_PASSWORD`)。公開URLで既定キーが
  誰でも使える=課金悪用を防ぐため。ユーザー名は任意、パスワードのみ照合。未設定ならゲート無効。
- **事実性の担保**: LLM は台本の言い回しだけを担当。店名・数値・地名・レビュー要点は
  取得済みデータのみを使い、創作禁止・出典言及禁止をプロンプトで強制。破綻時はテンプレにフォールバック。
- **途切れさせない**: `AudioPipeline` がセグメントを先読み生成し、TTS音声も行単位で先読み。
  ネタ切れ時は filler(フリートーク)でつなぐ。
- **読み上げ品質**: 三点リーダー(…)は停止の原因になるため句読点に置換。文末に終端記号を補完。
  ElevenLabs は無料枠の同時実行制限対策で並列数を2に制限+429リトライ。
- **穴場スコア**: `googlePlacesProvider.gemScore` が「高評価 × クチコミ多すぎない × 穴場ワード」で並べ替え。

## 6. 環境変数(要 Vercel 登録)

| 変数名 | 用途 |
|---|---|
| `ELEVENLABS_API_KEY` | ElevenLabs音声の既定キー |
| `OPENAI_API_KEY` | 台本LLM + OpenAI TTS の既定キー |
| `GOOGLE_PLACES_API_KEY` | スポット取得の既定キー |
| `SITE_PASSWORD` | アクセス制限の合言葉(現行 `machikado2026`。要変更推奨) |

ローカルは `.env.local` に設定済み。**本番は Vercel > Settings > Environment Variables に
同名で登録し、Redeploy**して初めて反映される。

## 7. 直近の重要トピック / 既知の注意

- **ElevenLabs 無料枠が枯渇**(quota_exceeded, 月10,000文字)。現状は既定を **OpenAI TTS** に
  切替済み。ElevenLabs を使うには有料プラン化 or 月次リセット待ち(UIのドロップダウンで切替可能)。
- **Google Places 全滅バグは修正済み**(commit `605f79c`)。`includedTypes` に未対応の
  `place_of_worship` が混入し全リクエストが 400 になっていた。削除済みで正常化。
- **APIキーがチャットに平文で共有された**。漏えい前提で、各サービスでのローテーション(再発行)を推奨。
- **公開URL + 既定キー**は、URLと合言葉を知る人が所有者の課金を使える。各サービスで**予算上限**設定を推奨。

## 8. 未完了 / 次にやること

1. **【最優先】Vercel 環境変数の登録**: 上記4変数を Vercel に登録し Redeploy。これが未了だと
   本番はキー未連携で動かない(ゲートも無効)。ダッシュボードの Settings が見つからない場合は
   直リンク `https://vercel.com/otttty/radioapp/settings/environment-variables` か Vercel CLI(`vercel env add`)。
   → **登録済みか要確認。** 本番URLでお便りが流れれば成功。
2. **本番での実聴確認**: 合言葉 `machikado2026` で認証 → キー未入力で開始 → 近隣スポットの
   お便りが OpenAI TTS の声で流れるか。
3. **合言葉の変更**: `SITE_PASSWORD` を任意の値へ(`.env.local` と Vercel 両方)→ Redeploy。
4. **セキュリティ**: 各APIキーのローテーション + 予算上限設定。
5. **UIの整理(任意)**: ジャンル選択チェックボックス(天気/ランチ/カフェ/文化/豆知識)は、
   現行の「Google Placesのみ・全カテゴリ対象」仕様では**実質機能していない可能性**がある
   (`buildFacts` はジャンルで場所を絞っていない)。UIから外すか、意味を持たせるか要判断。
   天気・豆知識も本編から除外済みなので、対応するトグルは不要。
6. **ElevenLabs 復帰(任意)**: 有料化 or 枠回復後、ドロップダウンで ElevenLabs に戻す。
   日本語向けVoice ID を Voice Library で選び、UI の Voice ID 欄に入れるとアクセント改善。

## 9. 主要コミット履歴(抜粋)

- `605f79c` Google Places の place_of_worship 未対応タイプを削除(全滅バグ修正)
- `7b77740` トピックをGoogle Placesのみに限定・非飲食も対象・声を速く抑揚強く
- `bd36728` 参照半径500m・ボブのトーン抑制・豆知識を最後寄り・位置取得中フリートーク
- `3e68ad8` お便り深掘り・穴場優先・天気圧縮
- (以前) お便り形式化 / ペルソナ導入 / ElevenLabs追加 / 既定キー(サーバー)化 / Basic認証ゲート / 漢字誤読対策 / LLM台本化 / Google Places評価導入 / Next.js移植
