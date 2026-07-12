// ============================================================
// AudioPipeline
// ------------------------------------------------------------
// 役割: 「セグメント生成」と「再生」を分離しつつパイプライン化し、
//       途切れない(ギャップレス)再生を実現する司令塔。
//
// 途切れさせないための設計:
//  1) セグメントキューを持ち、再生中に常に複数トピック分を先読み生成する
//     (BUFFER_SIZE を維持するよう非同期で補充)。1トピックずつ生成→再生を
//     繰り返すと生成の合間に間延びしやすいため、まとまった数を先に用意しておく。
//  2) TTSはブラウザ内蔵(Web Speech API)なので生成レイテンシがほぼゼロ。
//     ここが外部の高品質TTS/LLMに差し替わると往復遅延が乗るため、
//     BUFFER_SIZEを増やす/生成を早める調整ポイントとして残してある。
//  3) 素材(店・トリビア)が尽きた場合は ScriptGenerator が filler
//     セグメントを返す設計なので、パイプライン側は「ネタ切れで止まる」
//     ことがない。
//  4) BGMはWeb Audio APIで独立して鳴らし続け、セリフの合間だけ
//     gainを下げる(ダッキング)ことで「間」を演出しつつ無音時間を作らない。
//  5) セリフ間・トピック間の「間」は一律にせず、セリフの長さ(短い相槌か
//     長い説明か)とトピックの切れ目かどうかで長さを変え、自然な会話の
//     テンポに近づけている。
// ============================================================

const BUFFER_SIZE = 4; // 先読みしておくセグメント(トピック)数
const MIN_LINE_GAP_MS = 40; // 短い相槌の後の間(掛け合いは畳みかける)
const MAX_LINE_GAP_MS = 180; // 長めのセリフの後の間
const TOPIC_GAP_MS = 350; // トピックが変わるときの一呼吸

/**
 * セリフの長さに応じた「ごく短い間」を計算する。
 * ラジオの2人の掛け合いは間を空けず畳みかけるテンポにしたいので、
 * 全体に短めに設定し、長いセリフの後だけわずかに余韻を残す。
 */
function naturalGapMs(line) {
  const len = line.text.length;
  return Math.min(MAX_LINE_GAP_MS, MIN_LINE_GAP_MS + Math.min(len, 40) * 3.5);
}

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

  // --- BGM: Web Audio APIでチルなアンビエントコードパッドを常時再生 ---
  // (以前は220Hz付近の2音ドローンで単調な「ポーン」という音だったため、
  //  Cmaj7の和音 + ゆっくり動くフィルターに差し替え、動きのある柔らかい
  //  BGMらしい響きにしている。外部音源ファイルを使わないのは、ライセンス済み
  //  音源のホスティング・著作権確認が不要な自己完結構成を保つため)
  _ensureAudioGraph() {
    if (this._audioCtx) return;
    const Ctx = window.AudioContext || window.webkitAudioContext;
    const ctx = new Ctx();
    this._audioCtx = ctx;

    const master = ctx.createGain();
    master.gain.value = 1;
    master.connect(ctx.destination);
    this._masterGain = master;

    const bgmGain = ctx.createGain();
    bgmGain.gain.value = 0.035; // 控えめな音量(セリフの邪魔をしない、BGMとして小さめ)
    bgmGain.connect(master);
    this._bgmGain = bgmGain;

    // ゆっくり呼吸するように動かすローパスフィルタ(単調な定常音にしないための揺らぎ)
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 700;
    filter.Q.value = 0.4;
    filter.connect(bgmGain);

    const filterLfo = ctx.createOscillator();
    filterLfo.type = 'sine';
    filterLfo.frequency.value = 0.06; // 周期約17秒の非常にゆっくりした揺れ
    const filterLfoDepth = ctx.createGain();
    filterLfoDepth.gain.value = 250;
    filterLfo.connect(filterLfoDepth);
    filterLfoDepth.connect(filter.frequency);
    filterLfo.start();

    // Cmaj7の和音をtriangle波+わずかなデチューンのペアで鳴らし、コーラスのかかった
    // 柔らかいパッド音にする(ルート音を少し前に出してチルな雰囲気に)
    const chordHz = [130.81, 164.81, 196.0, 246.94]; // C3, E3, G3, B3
    chordHz.forEach((freq, i) => {
      const noteGain = ctx.createGain();
      noteGain.gain.value = i === 0 ? 1 : 0.55;
      noteGain.connect(filter);
      [freq, freq * 1.003].forEach((f) => {
        const osc = ctx.createOscillator();
        osc.type = 'triangle';
        osc.frequency.value = f;
        osc.connect(noteGain);
        osc.start();
      });
    });
  }

  _duck(down) {
    if (!this._bgmGain) return;
    const target = down ? 0.01 : 0.035;
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
        const segment = await this.scriptGenerator.nextSegment(facts); // LLM生成のため非同期
        this.queue.push(segment);
        // 位置取得中のフリートークは1つ先までに留める(位置確定後すぐ本編へ移るため)
        if (segment.warmup) break;
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
      // 最初の1本(オープニング)は軽量ファクト(位置情報のみ)で生成する。
      const liteFacts = await this.getLiteFacts();
      this.queue.push(await this.scriptGenerator.nextSegment(liteFacts));
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

      // このトピックの全セリフと、次トピックの分まで音声を先読み取得しておく。
      // OpenAI TTSはセリフごとにAPI往復があるため、これをやらないと掛け合いの
      // 合間に待ち時間(無音)が入ってテンポが崩れる。
      this.ttsEngine.prefetch?.(segment.lines);
      if (this.queue[0]) this.ttsEngine.prefetch?.(this.queue[0].lines);

      for (let i = 0; i < segment.lines.length; i++) {
        const line = segment.lines[i];
        if (!this.isPlaying || this._skipRequested) break;
        this.onLine(line, segment);
        this._duck(true);
        await this.ttsEngine.speakLine(line, { volume: this.volume });
        this._duck(false);
        if (!this.isPlaying || this._skipRequested) break;
        // トピックの最後のセリフの後だけ長めの「間」を置き、話題の切れ目を感じさせる
        const isLastLineOfTopic = i === segment.lines.length - 1;
        const gap = isLastLineOfTopic ? TOPIC_GAP_MS : naturalGapMs(line);
        await new Promise((r) => setTimeout(r, gap));
      }
      this._skipRequested = false;
    }
    this._loopRunning = false;
  }
}
