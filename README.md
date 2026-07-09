# まちかどラジオ (Next.js版)

現在地周辺の天気・グルメ・カフェ・文化施設・豆知識を集め、2人のパーソナリティの
掛け合い台本にして、時間帯に合わせてTTSで途切れず流し続けるWebアプリです。もとは
静的HTML+ESモジュールのMVPでしたが、GitHub経由でVercelに公開できるようNext.js
(App Router) に移植しました。

## 特徴

- 天気=Open-Meteo、スポット=OpenStreetMap(Overpass)、豆知識=Wikipedia は
  すべてAPIキー不要・無料。
- 音声は3種類から選択可能(既定はElevenLabs):
  - ElevenLabs(eleven_turbo_v2_5) — 自然な音質。要ElevenLabs APIキー、従量課金。
    メイン/アシスタントに別々のVoice IDを割り当て(UIで上書き可)。キーは画面で都度入力し、
    サーバー側の `/api/elevenlabs` 経由でElevenLabsへ転送するだけで保存・ログ出力はしません。
  - OpenAI TTS(gpt-4o-mini-tts) — 自然な音質。要OpenAI APIキー、従量課金。`/api/tts` 経由。
  - ブラウザ内蔵(Web Speech API) — キー不要・無料だが機械的な音質。
  ※台本生成用のOpenAIキーは音声プロバイダから独立した任意欄で入力します(音声=ElevenLabs、
    台本=OpenAI のように別々に使えます。音声にOpenAI TTSを選んだ場合はそのキーを自動流用)。
- お店の紹介は2段階:
  - 既定 = OpenStreetMap(評価なし・キー不要)
  - Google Places APIキーを入力すると、高評価店を評価順に紹介(星・クチコミ数を言及)。
    キーは画面で都度入力し、サーバー側の `/api/places` 経由でGoogleへ渡すだけで
    保存しません(位置情報がGoogleへ送られます。Google Cloudの課金アカウントが必要)。
- 挨拶・時報は再生時の現実時刻に追従し、番組冒頭でその土地の市区町村名に触れます。
- 位置情報は「開始」ボタン押下時に許可確認 → OSキャッシュがあれば即座に取得。
- 台本は毎回 LLM(OpenAI Chat Completions、TTS用のOpenAIキーを流用)に自然な掛け合いを
  書かせます。ただし「取得済みの事実(店名・数値・豆知識・地名)だけを使い、固有名詞や数値を
  創作しない/出典に触れない」制約を `/api/script` 経由のプロンプトで厳格に課し、存在しない店・
  誤った気温を語らせません。ネタの選定(どのお店/豆知識をどの順で出すか)は決定的なロジックで
  行い、LLMは言い回し・導入・相槌の自然さと多様性を担う役割に限定しています。
  LLMキーが無い/失敗した場合はテンプレート合成にフォールバックして番組を止めません。

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
