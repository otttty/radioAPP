// ============================================================
// AudioPipeline
// ------------------------------------------------------------
// 役割: 「セグメント生成」と「再生」を分離しつつパイプライン化し、
//       途切れない(ギャップレス)再生を実現する司令塔。
//
// 途切れさせないための設計:
//  1) セグメントキューを持ち、再生中に常に次のセグメントを先読み生成する
//     (BUFFER_SIZE=2 を維持するよう非同期で補充)。
//  2) TTSはブラウザ内蔵(Web Speech API)なので生成レイテンシがほぼゼロ。
//     そのため「1セグメント分バッファがあれば十分」という薄いバッファで足りる。
//     ここが外部の高品質TTS/LLMに差し替わると往復遅延が乗るため、
//     BUFFER_SIZEを増やす/生成を早める調整ポイントとして残してある。
//  3) 素材(店・トリビア)が尽きた場合は ScriptGenerator が filler
//     セグメントを返す設計なので、パイプライン側は「ネタ切れで止まる」
//     ことがない。
//  4) BGMはWeb Audio APIで独立して鳴らし続け、セリフの合間だけ
//     gainを下げる(ダッキング)ことで「間」を演出しつつ無音時間を作らない。
// ============================================================

const BUFFER_SIZE = 2; // 先読みしておくセグメント数
const LINE_GAP_MS = 350; // セリフとセリフの間の「間」

export class AudioPipeline {
  /**
   * @param {{
   *   ttsEngine: import('./ttsEngine.js').TTSEngine,
   *   scriptGenerator: import('./scriptGenerator.js').ScriptGenerator,
   *   getFacts: () => Promise<import('./types.js').FactBundle>,
   *   getLiteFacts?: () => Promise<import('./types.js').FactBundle>,
   *   onTopicChange?: (segment: import('./types.js').Segment) => void,
   *   onLine?: (line: import('./types.js').ScriptLine, segment: import('./types.js').Segment) => void,
   * }} deps
   */
  constructor(deps) {
    this.ttsEngine = deps.ttsEngine;
    this.scriptGenerator = deps.scriptGenerator;
    this.getFacts = deps.getFacts;
    // getLiteFacts: 天気/スポット/豆知識のAPI呼び出しを待たず、位置情報だけで
    // 即座に組み立てられるFactBundle。オープニングは位置以外を参照しないため、
    // これを使うことで「開始ボタンを押してから声が出るまで」の体感待ち時間を
    // ほぼゼロにできる(重い取得はその間に裏で進む)。
    this.getLiteFacts = deps.getLiteFacts ?? deps.getFacts;
    this.onTopicChange = deps.onTopicChange ?? (() => {});
    this.onLine = deps.onLine ?? (() => {});

    /** @type {import('./types.js').Segment[]} */
    this.queue = [];
    this.isPlaying = false;
    this.volume = 0.9;
    this._skipRequested = false;
    this._generating = false;
    this._loopRunning = false;

    this._audioCtx = null;
    this._bgmGain = null;
  }

  // --- BGM: Web Audio APIで簡易アンビエントパッドを常時再生 ---
  _ensureAudioGraph() {
    if (this._audioCtx) return;
    const Ctx = window.AudioContext || window.webkitAudioContext;
    this._audioCtx = new Ctx();

    const master = this._audioCtx.createGain();
    master.gain.value = 1;
    master.connect(this._audioCtx.destination);

    const bgmGain = this._audioCtx.createGain();
    bgmGain.gain.value = 0.05; // 控えめな音量(セリフの邪魔をしない)
    bgmGain.connect(master);
    this._bgmGain = bgmGain;
    this._masterGain = master;

    // 2つのオシレーターをわずかにデチューンして柔らかいパッド音に
    const filter = this._audioCtx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 800;
    filter.connect(bgmGain);

    [220, 220.6].forEach((freq) => {
      const osc = this._audioCtx.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = freq;
      osc.connect(filter);
      osc.start();
    });
  }

  _duck(down) {
    if (!this._bgmGain) return;
    const target = down ? 0.015 : 0.05;
    this._bgmGain.gain.linearRampToValueAtTime(target, this._audioCtx.currentTime + 0.2);
  }

  setVolume(v) {
    this.volume = Math.max(0, Math.min(1, v));
    if (this._masterGain) this._masterGain.gain.value = this.volume;
  }

  /** バッファが空いていれば非同期で補充する(呼びっぱなしでOK。多重実行は防止) */
  async _fillBuffer() {
    if (this._generating) return;
    this._generating = true;
    try {
      while (this.queue.length < BUFFER_SIZE) {
        const facts = await this.getFacts(); // 常に最新の(移動を反映した)ファクトを使う
        const segment = this.scriptGenerator.nextSegment(facts);
        this.queue.push(segment);
      }
    } finally {
      this._generating = false;
    }
  }

  async start() {
    this._ensureAudioGraph();
    if (this._audioCtx.state === 'suspended') await this._audioCtx.resume();
    // TTSエンジンがWeb Audioグラフを使う実装(例: OpenAITTSEngine)の場合、
    // BGMと同じAudioContext/出力先(masterGain)を渡して合成音声を鳴らせるようにする。
    // ブラウザ内蔵TTS(BrowserTTSEngine)はこれを使わないので no-op になる。
    this.ttsEngine.attachAudioGraph?.(this._audioCtx, this._masterGain);
    await this.ttsEngine.ready();
    this.isPlaying = true;

    if (this.queue.length === 0) {
      // 最初の1本(オープニング)は軽量ファクトで即座に生成し、体感待ち時間をなくす。
      const liteFacts = await this.getLiteFacts();
      this.queue.push(this.scriptGenerator.nextSegment(liteFacts));
    }
    if (!this._loopRunning) this._playLoop();
    this._fillBuffer(); // 天気/スポット/豆知識の取得はここから裏で進める(待たない)
  }

  pause() {
    this.isPlaying = false;
    this.ttsEngine.pause();
  }

  async resumePlayback() {
    if (this._audioCtx?.state === 'suspended') await this._audioCtx.resume();
    this.isPlaying = true;
    this.ttsEngine.resume();
    if (!this._loopRunning) this._playLoop();
  }

  /** 今のトピックを打ち切って次のセグメントへ */
  skip() {
    this._skipRequested = true;
    this.ttsEngine.cancelAll();
  }

  async _playLoop() {
    this._loopRunning = true;
    while (this.isPlaying) {
      if (this.queue.length === 0) {
        // 本来は先読みで防げるはずだが、万一の枯渇時は少し待って再チェック
        await this._fillBuffer();
        if (this.queue.length === 0) {
          await new Promise((r) => setTimeout(r, 500));
          continue;
        }
      }
      const segment = this.queue.shift();
      this.onTopicChange(segment);
      this._fillBuffer(); // 再生と並行して次の分を先読み生成(非同期・待たない)

      for (const line of segment.lines) {
        if (!this.isPlaying || this._skipRequested) break;
        this.onLine(line, segment);
        this._duck(true);
        await this.ttsEngine.speakLine(line, { volume: this.volume });
        this._duck(false);
        if (!this.isPlaying || this._skipRequested) break;
        await new Promise((r) => setTimeout(r, LINE_GAP_MS));
      }
      this._skipRequested = false;
    }
    this._loopRunning = false;
  }
}
