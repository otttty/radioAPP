// ============================================================
// ElevenLabsTTSEngine
// ------------------------------------------------------------
// 役割: ElevenLabs の音声合成を /api/elevenlabs プロキシ経由で使い、
// 自然な人の声で読み上げる。BrowserTTSEngine / OpenAITTSEngine と同じ
// interface (ready/speakLine/cancelAll/pause/resume/attachAudioGraph/prefetch)
// を実装しているため、AudioPipeline側はどのエンジンでも同じコードで動く。
//
// - main(メインMC)と sub(アシスタント)で別のvoiceIdを割り当て、聞き分けやすくする。
// - 次に話す行の音声を先読み(prefetch)しておき、掛け合いの合間の無音を無くす。
// - APIキーはコードに埋め込まず、UIで入力したものをメモリ上に保持するだけ。
//   /api/elevenlabs 経由でElevenLabsへ渡すだけで保存はしない。
// ============================================================

const ENDPOINT = '/api/elevenlabs';

// ElevenLabsの標準プリメイド音声(無料プランでもAPIで使える既定ID)。
// ライブラリ追加が必要な音声(例: Rachel)は無料プランのAPIで402になるため、
// アカウント標準搭載の premade 音声から選んでいる。UIで上書き可能。
// main=ボブ → Charlie(Deep, Confident, Energetic/ファンキーな低音),
// sub=ジェシー → Liam(Energetic, Social Media Creator/ハイテンションな男性)。
export const DEFAULT_MAIN_VOICE = 'IKne3meq5aSn9XLyUdCD';
export const DEFAULT_SUB_VOICE = 'TX3LPaxmHKxFdv7VOQHJ';

// 発話用にテキストを整える(字幕には元の装飾テキストを残し、音声だけをクリーンにする)。
// ElevenLabsが誤読・語尾崩れを起こしやすいトークンを、意味を変えずに正規化する。
export function sanitizeForSpeech(text) {
  let t = String(text)
    .replace(/[＆&]/g, '') // 「最&高」→「最高」(記号を読み上げさせない)
    .replace(/[〜～]/g, 'ー') // 波ダッシュ→長音符(語尾の伸ばしを自然に)
    .replace(/[*#^_`|\\<>~]/g, '') // 読み上げに不要なASCII記号を除去
    .replace(/!/g, '！') // 半角→全角で日本語のプロソディを安定させる
    .replace(/\?/g, '？')
    .replace(/([！？])\1+/g, '$1') // 「！！！」→「！」
    // 三点リーダーは長い停止・発話停止の原因になるため句読点に置換する
    // (文中「ボブと…今日は」→読点、文末「〜と…」→句点で自然に区切る)
    .replace(/[…‥]+|\.{2,}/g, '、')
    .replace(/、+\s*$/g, '。')
    .replace(/、{2,}/g, '、')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
  // 文末が句読点で終わらないと末尾の音が切り捨てられやすい(既知の挙動)ため、
  // 終端記号が無ければ句点を補う
  if (t && !/[。！？」』]$/.test(t)) t += '。';
  return t;
}

export class ElevenLabsTTSEngine {
  /**
   * @param {{apiKey: string, modelId?: string, mainVoiceId?: string, subVoiceId?: string}} opts
   */
  constructor(opts) {
    this.apiKey = opts.apiKey;
    this.modelId = opts.modelId ?? 'eleven_multilingual_v2';
    this.voices = {
      main: opts.mainVoiceId || DEFAULT_MAIN_VOICE,
      sub: opts.subVoiceId || DEFAULT_SUB_VOICE,
    };
    this._audioCtx = null;
    this._destination = null;
    this._currentSource = null;
    this._cache = new Map(); // 同一テキストの再取得を避ける簡易セッションキャッシュ
    this._inflight = new Map(); // 取得中Promiseを共有し、プリフェッチと本再生の二重取得を防ぐ
    // ElevenLabsの無料/下位プランは同時リクエスト数に上限があり、超えると429になる。
    // プリフェッチで一気に投げると途切れるため、同時実行数を絞る簡易セマフォを持つ。
    this._maxConcurrent = 2;
    this._active = 0;
    this._waiters = [];
  }

  _acquire() {
    if (this._active < this._maxConcurrent) {
      this._active += 1;
      return Promise.resolve();
    }
    return new Promise((resolve) => this._waiters.push(resolve)).then(() => {
      this._active += 1;
    });
  }

  _release() {
    this._active -= 1;
    const next = this._waiters.shift();
    if (next) next();
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
    if (this._inflight.has(cacheKey)) return this._inflight.get(cacheKey);

    // 送信は整形後テキスト。字幕(onLine)には元テキストが使われるので装飾は保たれる。
    const spokenText = sanitizeForSpeech(text);
    const doFetch = () =>
      fetch(ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          apiKey: this.apiKey,
          voiceId: this.voices[speaker] ?? this.voices.main,
          modelId: this.modelId,
          text: spokenText,
        }),
      });

    const p = (async () => {
      await this._acquire();
      try {
        let res = await doFetch();
        // 同時実行上限(429)は少し待って1回だけ再試行する
        if (res.status === 429) {
          await new Promise((r) => setTimeout(r, 700));
          res = await doFetch();
        }
        if (!res.ok) {
          const detail = await res.text().catch(() => '');
          throw new Error(`ElevenLabs ${res.status}: ${detail.slice(0, 200)}`);
        }
        const buf = await res.arrayBuffer();
        this._cache.set(cacheKey, buf);
        return buf;
      } finally {
        this._release();
      }
    })();

    this._inflight.set(cacheKey, p);
    p.finally(() => this._inflight.delete(cacheKey)).catch(() => {});
    return p;
  }

  /**
   * 次に話す予定のセリフの音声を先に取得してキャッシュしておく。
   * @param {import('./types.js').ScriptLine[]} lines
   */
  prefetch(lines) {
    for (const line of lines || []) {
      // 漢字誤読対策: 読み上げ用かな表記(speech)があればそれを優先して読む
      this._fetchAudio(line.speech ?? line.text, line.speaker).catch(() => {});
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
          // ここではブロックしない(キーが無ければ /api/elevenlabs 側でエラーになる)。
          if (!this._audioCtx || !this._destination) throw new Error('audio graph 未接続');

          const arrayBuffer = await this._fetchAudio(line.speech ?? line.text, line.speaker);
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
          console.warn('[ElevenLabsTTSEngine] speak failed, skipping line:', e);
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

  // Web Audio の BufferSource は途中一時停止ができないため、pause/resume は
  // 「次の行から止める/再開する」形になる(現在再生中の1行は最後まで再生される)。
  pause() {}
  resume() {}
}
