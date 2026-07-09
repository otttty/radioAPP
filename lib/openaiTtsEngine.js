// ============================================================
// OpenAITTSEngine
// ------------------------------------------------------------
// 役割: OpenAIの音声合成API(gpt-4o-mini-tts)を使い、
// ブラウザ内蔵TTSより人の声に近い自然な読み上げを行う。
// BrowserTTSEngine と同じ interface (ready/speakLine/cancelAll/pause/resume/
// attachAudioGraph) を実装しているため、AudioPipeline側は
// どちらのエンジンでも同じコードで動く(差し替え可能な設計)。
//
// 音質のポイント:
//  - gpt-4o-mini-tts は `instructions` パラメータで話し方(トーン・間の取り方)を
//    自然文で指示できるため、「明るく親しみやすい昼のラジオ」という演出を
//    プロンプトではなく音声モデル自身の発話スタイルとして反映させている。
//  - メイン/アシスタントで別の声(voice)を割り当て、聞き分けやすくしている。
//
// キーの扱い:
//  - APIキーはコードに埋め込まず、UIでユーザーが入力したものをメモリ上に
//    保持するだけ(ページを閉じれば消える。永続化はしない)。
//  - このアプリは公開デプロイ(Vercel)されるため、ブラウザから直接OpenAIへは
//    呼び出さず、同一オリジンの /api/tts 経由でサーバー側からOpenAIを呼び出す。
//    キーはリクエストのたびに転送されるだけでサーバーにも保存しない。
// ============================================================

const ENDPOINT = '/api/tts';

export class OpenAITTSEngine {
  /**
   * @param {{apiKey: string, model?: string}} opts
   */
  constructor(opts) {
    this.apiKey = opts.apiKey;
    this.model = opts.model ?? 'gpt-4o-mini-tts';
    this.speed = opts.speed ?? 1.18; // ラジオらしくテンポよく、はっきり速め
    this.voices = { main: 'shimmer', sub: 'onyx' };
    this.instructions = {
      main:
        'お昼のラジオ番組のメインDJとして話してください。明るくテンポよく、リスナーに語りかけるように。' +
        '生放送のような軽快さと勢いを持たせ、間延びさせず小気味よいテンポで、抑揚をしっかりつけて話してください。',
      sub:
        'ラジオ番組の元気なアシスタント兼ツッコミ役として話してください。テンションは高め、' +
        'ノリよく弾んだ声で、驚きや共感を大きめのリアクションで表現してください。' +
        '主役の話にリズムよく食いつき、明るくキレのある、勢いのある話し方で盛り上げてください。',
    };
    this._audioCtx = null;
    this._destination = null;
    this._currentSource = null;
    this._cache = new Map(); // 同一テキストの再取得を避ける簡易セッションキャッシュ
    this._inflight = new Map(); // 取得中のPromiseを共有し、プリフェッチと本再生の二重取得を防ぐ
  }

  async ready() {
    // 事前準備は不要(APIキーが未設定なら呼び出し時にエラーになる)
  }

  /** AudioPipelineから、BGMと同じAudioContext/出力先を受け取る */
  attachAudioGraph(audioCtx, destinationNode) {
    this._audioCtx = audioCtx;
    this._destination = destinationNode;
  }

  _fetchAudio(text, speaker) {
    const cacheKey = `${speaker}:${text}`;
    if (this._cache.has(cacheKey)) return Promise.resolve(this._cache.get(cacheKey));
    // 既に取得中(プリフェッチ含む)なら同じPromiseを返し、二重にAPIを叩かない
    if (this._inflight.has(cacheKey)) return this._inflight.get(cacheKey);

    const p = (async () => {
      const res = await fetch(ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          apiKey: this.apiKey,
          model: this.model,
          voice: this.voices[speaker] ?? this.voices.main,
          input: text,
          instructions: this.instructions[speaker] ?? this.instructions.main,
          speed: this.speed,
        }),
      });
      if (!res.ok) {
        const detail = await res.text().catch(() => '');
        throw new Error(`OpenAI TTS ${res.status}: ${detail.slice(0, 200)}`);
      }
      const buf = await res.arrayBuffer();
      this._cache.set(cacheKey, buf);
      return buf;
    })();

    this._inflight.set(cacheKey, p);
    p.finally(() => this._inflight.delete(cacheKey)).catch(() => {});
    return p;
  }

  /**
   * 次に話す予定のセリフの音声を先に取得してキャッシュしておく。
   * これにより再生時のAPI往復待ちが消え、掛け合いのテンポが詰まる。
   * 失敗しても無視(本再生時に再取得を試みる)。
   * @param {import('./types.js').ScriptLine[]} lines
   */
  prefetch(lines) {
    for (const line of lines || []) {
      this._fetchAudio(line.text, line.speaker).catch(() => {});
    }
  }

  /**
   * @param {import('./types.js').ScriptLine} line
   * @param {{volume?: number}} [opts]
   */
  speakLine(line, opts = {}) {
    return new Promise((resolve) => {
      (async () => {
        try {
          // apiKeyが空でも、サーバー側の既定キー(環境変数)で読み上げられる場合があるため
          // ここではブロックしない(キーが無ければ /api/tts 側でエラーになる)。
          if (!this._audioCtx || !this._destination) throw new Error('audio graph 未接続');

          const arrayBuffer = await this._fetchAudio(line.text, line.speaker);
          const audioBuffer = await this._audioCtx.decodeAudioData(arrayBuffer.slice(0));

          const lineGain = this._audioCtx.createGain();
          lineGain.gain.value = opts.volume ?? 1;
          const source = this._audioCtx.createBufferSource();
          source.buffer = audioBuffer;
          source.connect(lineGain);
          lineGain.connect(this._destination);

          this._currentSource = source;
          source.onended = () => {
            this._currentSource = null;
            resolve();
          };
          source.start();
        } catch (e) {
          console.warn('[OpenAITTSEngine] speak failed, skipping line:', e);
          resolve(); // 失敗しても番組を止めない(そのセリフだけ飛ばす)
        }
      })();
    });
  }

  cancelAll() {
    if (this._currentSource) {
      try {
        this._currentSource.stop();
      } catch {
        /* すでに停止済みなら無視 */
      }
      this._currentSource = null;
    }
  }

  // Web Audio の BufferSource は途中一時停止ができないため、
  // pause/resume は「次の行から止める/再開する」形になる
  // (現在再生中の1行は最後まで再生される)。AudioPipeline側の
  // isPlayingフラグ判定と組み合わせてこれを実現している。
  pause() {}
  resume() {}
}
