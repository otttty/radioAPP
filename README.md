# お昼のラジオ (Next.js版)

現在地周辺の天気・ランチ・カフェ・文化施設・豆知識を集め、2人のパーソナリティの
掛け合い台本にしてTTSで途切れず流し続けるWebアプリです。もとは静的HTML+ESモジュール
のMVPでしたが、GitHub経由でVercelに公開できるようNext.js (App Router) に移植しました。

## 特徴

- 天気=Open-Meteo、スポット=OpenStreetMap(Overpass)、豆知識=Wikipedia は
  すべてAPIキー不要・無料。
- 音声は2種類から選択可能:
  - ブラウザ内蔵(Web Speech API) — キー不要・無料だが機械的な音質
  - OpenAI TTS(gpt-4o-mini-tts) — 自然な音質。要OpenAI APIキー、従量課金。
    キーは画面で都度入力し、サーバー側の `/api/tts` (Next.jsのRoute Handler)を
    経由してOpenAIへ転送するだけで、保存・ログ出力はしません。
- 位置情報は「開始」ボタン押下時に許可確認 → OSキャッシュがあれば即座に取得。
- 台本は自由生成LLMを使わず、取得した事実データをテンプレートに流し込む決定的な
  合成のみで作っています(存在しない店名・誤った気温を語らせないため)。

## ローカルで動かす

```bash
npm install
npm run dev
# http://localhost:3000 を開く
```

Geolocation APIはセキュアコンテキスト(https、または localhost)でしか安定動作しません。
`npm run dev` は localhost で動くのでそのまま問題なく試せます。

台本生成だけをネットワーク無しで確認したい場合:

```bash
npm test
```

## 構成

```
app/
  layout.js          ルートレイアウト(メタデータ、globals.cssの読み込み)
  page.js            LunchRadioAppをssr:falseで読み込むエントリ
  globals.css         見た目(旧 styles.css を移植)
  api/tts/route.js    OpenAI TTSへのサーバーサイドプロキシ(APIキーを同一オリジン内だけで転送)
components/
  LunchRadioApp.js    UI本体(旧 index.html + src/app.js を1つのクライアントコンポーネントに統合)
lib/
  types.js             型定義(JSDoc)
  locationManager.js   位置情報取得・許可管理・移動検知
  cache.js             位置格子×カテゴリのTTLキャッシュ
  weatherProvider.js   天気(Open-Meteo)
  placesProvider.js    スポット(Overpass/OSM)
  triviaProvider.js    豆知識(Wikipedia geosearch)
  geocodeFallback.js   位置情報不可時の地名→座標フォールバック
  scriptGenerator.js   事実データ→台本セグメントのテンプレート生成
  ttsEngine.js          Web Speech APIラッパー
  openaiTtsEngine.js    OpenAI TTS(/api/tts経由)ラッパー
  audioPipeline.js      セグメントキュー・先読み生成・BGMダッキング・再生ループ
test/sample-script.mjs  台本生成のサンプル実行(Node上でDOM無しに確認可能)
```

各Providerは `getXxx(lat, lon) -> Promise<Fact[]>` という同じ形の関数として
切り出してあるので、実装を丸ごと差し替え可能です。

## GitHubへのアップロード

```bash
cd lunch-radio-next
git init
git add .
git commit -m "Initial commit: lunch radio Next.js app"
git branch -M main
git remote add origin git@github.com:<your-account>/<your-repo>.git
git push -u origin main
```

## Vercelでの公開

1. https://vercel.com で「Add New... > Project」から、上記でPushしたGitHubリポジトリを選択。
2. Framework Preset は自動で `Next.js` が検出されます。ビルドコマンド・出力先はデフォルトのままでOKです。
3. 環境変数の設定は不要です(OpenAIのAPIキーはユーザーがブラウザ側で都度入力する方式のため、
   Vercel側にシークレットを登録する必要はありません)。
4. Deployを押すと数分で `https://<project>.vercel.app` が発行されます。

Geolocation・マイク等のブラウザAPIはVercelの発行するhttps URLで問題なく動作します。
