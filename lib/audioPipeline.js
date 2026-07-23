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

import { LofiBgm } from './lofiBgm.js';

const BUFFER_SIZE = 4; // 先読みしておくセグメント(トピック)数
const MIN_LINE_GAP_MS = 40; // 短い相槌の後の間(掛け合いは畳みかける)
const MAX_LINE_GAP_MS = 180; // 長めのセリフの後の間
const TOPIC_GAP_MS = 350; // トピックが変わるときの一呼吸
const BGM_LEVEL = 0.05; // BGMの基本音量(セリフの邪魔をしない小さめ)
const BGM_DUCK_LEVEL = 0.016; // セリフ中に下げる音量(ビートはうっすら残す)

/**
 * セリフの長さに応じた「ごく短い間」を計算する。
 * ラジオの2人の掛け合いは間を空けず畳みかけるテンポにしたいので、
 * 全体に短めに設定し、長いセリフの後だけわずかに余韻を残す。
 */
function naturalGapMs(line) {
  const len = line.text.length;
  return Math.min(MAX_LINE_GAP_MS, MIN_LINE_GAP_MS + Math.min(len, 40) * 3.5);
}

/**
 * セグメントのセリフを「読み上げ単位」にまとめる。
 * 連続する sub(お便り本文)は1つの単位に結合し、1回のTTS合成で読む。
 * TTSはリクエストごとに読み方(トーン・テンポ)が揺れるため、お便りを
 * 行ごとに合成すると1通の途中で読み方が変わってしまう。1通をまとめて
 * 合成することで、読み始めの調子のまま最後まで読み切らせる。
 * @param {import('./types.js').ScriptLine[]} lines
 * @returns {{speaker: string, text: string, speech: string, lines: import('./types.js').ScriptLine[]}[]}
 */
function buildSpeechUnits(lines) {
  const units = [];
  for (const line of lines || []) {
    const last = units[units.length - 1];
    if (line.speaker === 'sub' && last && last.speaker === 'sub') {
      last.lines.push(line);
      last.text += '\n' + line.text;
      last.speech += '\n' + (line.speech ?? line.text);
    } else {
      units.push({
        speaker: line.speaker,
        lines: [line],
        text: line.text,
        speech: line.speech ?? line.text,
      });
    }
  }
  return units;
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

  // --- BGM: Web Audio APIでLo-fiのビート+コードを常時再生 ---
  // 時間帯でムードを切り替える(LofiBgm): 朝〜昼は明るく軽いLo-fi、夜は落ち着いた
  // jazzyなLo-fi hip hop。外部音源ファイルを使わないのは、ライセンス済み音源の
  // ホスティング・著作権確認が不要な自己完結構成を保つため。
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
    bgmGain.gain.value = BGM_LEVEL; // 控えめな音量(セリフの邪魔をしない)
    bgmGain.connect(master);
    this._bgmGain = bgmGain;

    // 時間帯でBGMのムードを決める(18時〜翌5時を夜)
    const hour = new Date().getHours();
    const night = hour < 5 || hour >= 18;
    this._bgm = new LofiBgm(ctx, bgmGain, { night });
    // 再生開始は start() 内(ctx.resume 後)で行う。suspended中に開始すると
    // スケジューラが固まった時刻へ大量に予約してしまうため。
  }

  _duck(down) {
    if (!this._bgmGain) return;
    const target = down ? BGM_DUCK_LEVEL : BGM_LEVEL;
    this._bgmGain.gain.linearRampToValueAtTime(target, this._audioCtx.currentTime + 0.2);
  }

  setVolume(v) {
    this.volume = Math.max(0, Math.min(1, v));
    if (this._masterGain) this._masterGain.gain.value = this.volume;
  }

  /** セグメントの読み上げ単位(連続subを結合)を返す。同一セグメントでは同じ配列を再利用する */
  _unitsFor(segment) {
    if (!segment._units) segment._units = buildSpeechUnits(segment.lines);
    return segment._units;
  }

  /**
   * 割り込みで1本生成し、キューの先頭に差し込む。
   * リスナーが投稿したお便りを、先読み済みのトピックより先に読ませるために使う
   * (再生中のトピックは中断せず、その次に流れる)。
   */
  async insertPrioritySegment() {
    const facts = await this.getFacts();
    const segment = await this.scriptGenerator.nextSegment(facts);
    this.queue.unshift(segment);
    this.ttsEngine.prefetch?.(this._unitsFor(segment));
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
        // つなぎ系(位置取得中/お便り待ち)のセグメントは1つ先までに留める。
        // これで先読みバッファにフリートークが連続で溜まらず、スポットが手に入り
        // 次第すぐ本編(お便り)へ戻れる。
        if (segment.transient) break;
      }
    } finally {
      this._generating = false;
    }
  }

  async start() {
    this._ensureAudioGraph();
    if (this._audioCtx.state === 'suspended') await this._audioCtx.resume();
    this._bgm?.start(); // Lo-fi BGMを開始(ctx.resume 後に始める)
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
      // ※お便り(連続sub)は1単位に結合して合成するため、先読みも同じ単位で行う
      //   (キャッシュキーが一致し、二重取得しない)。
      const units = this._unitsFor(segment);
      this.ttsEngine.prefetch?.(units);
      if (this.queue[0]) this.ttsEngine.prefetch?.(this._unitsFor(this.queue[0]));

      for (let i = 0; i < units.length; i++) {
        const unit = units[i];
        if (!this.isPlaying || this._skipRequested) break;
        // 字幕は元の行単位で出す(お便りは段落ごとに表示)
        for (const line of unit.lines) this.onLine(line, segment);
        this._duck(true);
        await this.ttsEngine.speakLine(unit, { volume: this.volume });
        this._duck(false);
        if (!this.isPlaying || this._skipRequested) break;
        // トピックの最後のセリフの後だけ長めの「間」を置き、話題の切れ目を感じさせる
        const isLastUnitOfTopic = i === units.length - 1;
        const gap = isLastUnitOfTopic ? TOPIC_GAP_MS : naturalGapMs(unit);
        await new Promise((r) => setTimeout(r, gap));
      }
      this._skipRequested = false;
    }
    this._loopRunning = false;
  }
}
