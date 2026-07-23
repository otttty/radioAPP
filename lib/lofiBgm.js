// ============================================================
// LofiBgm
// ------------------------------------------------------------
// 番組の常時BGMをWeb Audio APIだけで合成するLo-fiエンジン。
// 外部音源ファイルを使わない(ライセンス確認・ホスティング不要の
// 自己完結構成を保つ)。時間帯で2つのムードを切り替える:
//   - day  : 朝〜昼向けの明るく軽いLo-fi(メジャー系・テンポ速め・明るい音)
//   - night: 夜向けの落ち着いたjazzyなLo-fi hip hop(9thコード・遅め・太い低音)
//
// 構成: 「ルックアヘッド・スケジューラ」で16分音符ごとに、コード(ローズ風の
// 柔らかいパッド)とドラム(キック/スネア/ハイハットをノイズと簡易シンセで合成)
// を先読みして鳴らす。全体を暖かいローパス+ゆっくりした揺らぎに通してLo-fiの
// 質感を出す。ダッキング(セリフ中の音量下げ)は呼び出し側のbgmGainで行う。
// ============================================================

// コード進行(周波数[Hz]の配列)。声の邪魔をしないよう中〜低めの音域で voicing。
// 夜: Dm9 - G9 - Cmaj7 - Am7(ジャジーな ii-V-I-vi)
const NIGHT_CHORDS = [
  [146.83, 174.61, 220.0, 261.63], // Dm9  (D3 F3 A3 C4)
  [196.0, 246.94, 349.23, 440.0], // G9   (G3 B3 F4 A4)
  [130.81, 164.81, 196.0, 246.94], // Cmaj7(C3 E3 G3 B3)
  [220.0, 261.63, 329.63, 392.0], // Am7  (A3 C4 E4 G4)
];
// 昼: Cadd9 - G - Am7 - Fmaj7(明るく開けた響き・少し上の音域)
const DAY_CHORDS = [
  [261.63, 329.63, 392.0, 587.33], // Cadd9 (C4 E4 G4 D5)
  [196.0, 246.94, 293.66, 440.0], // G     (G3 B3 D4 A4)
  [220.0, 329.63, 392.0, 493.88], // Am7   (A3 E4 G4 B4)
  [174.61, 220.0, 261.63, 329.63], // Fmaj7 (F3 A3 C4 E4)
];

export class LofiBgm {
  /**
   * @param {AudioContext} ctx
   * @param {AudioNode} destination 出力先(通常はダッキング用の bgmGain)
   * @param {{night?: boolean}} [opts]
   */
  constructor(ctx, destination, { night = false } = {}) {
    this.ctx = ctx;
    this.night = night;
    this.bpm = night ? 74 : 84; // 夜はゆったり、昼は少し軽快に
    this.progression = night ? NIGHT_CHORDS : DAY_CHORDS;

    // 暖かいローパス(Lo-fi感)+ ごくゆっくりした揺らぎ
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = night ? 820 : 1600;
    filter.Q.value = 0.3;
    filter.connect(destination);
    this._filter = filter;

    const lfo = ctx.createOscillator();
    lfo.type = 'sine';
    lfo.frequency.value = 0.05; // 周期約20秒
    const lfoDepth = ctx.createGain();
    lfoDepth.gain.value = night ? 180 : 320;
    lfo.connect(lfoDepth);
    lfoDepth.connect(filter.frequency);
    lfo.start();
    this._lfo = lfo;

    // サブバス(コード/ドラム/ベースを別ゲインでミックス)
    this._chordGain = ctx.createGain();
    this._chordGain.gain.value = night ? 0.5 : 0.45;
    this._chordGain.connect(filter);

    this._drumGain = ctx.createGain();
    this._drumGain.gain.value = night ? 0.85 : 0.7;
    this._drumGain.connect(filter);

    this._bassGain = ctx.createGain();
    this._bassGain.gain.value = night ? 0.5 : 0.42;
    this._bassGain.connect(filter);

    // リード(ピアノ/ローズ)は主フィルタを避け、明るさ(高域)を残す別ラインで出す。
    // これでメロディがモコモコにならず、楽器が増えた感じがちゃんと聞こえる。
    const leadFilter = ctx.createBiquadFilter();
    leadFilter.type = 'lowpass';
    leadFilter.frequency.value = night ? 2400 : 3400;
    leadFilter.Q.value = 0.2;
    leadFilter.connect(destination);
    this._leadGain = ctx.createGain();
    this._leadGain.gain.value = night ? 0.34 : 0.32;
    this._leadGain.connect(leadFilter);
    this._arpIdx = 0;

    this._noise = this._makeNoiseBuffer();

    this._step = 0; // 0..15(16分音符)
    this._bar = 0; // 進行中の小節番号(コード選択用)
    this._nextTime = 0;
    this._timer = null;
  }

  /** 4秒ぶんのホワイトノイズ(ドラム用に使い回す) */
  _makeNoiseBuffer() {
    const ctx = this.ctx;
    const buf = ctx.createBuffer(1, ctx.sampleRate * 1, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    return buf;
  }

  /** 再生開始(ctx.resume 後に呼ぶこと。suspended中に呼ぶと予約が固まる) */
  start() {
    if (this._timer) return;
    this._nextTime = this.ctx.currentTime + 0.15;
    this._step = 0;
    this._bar = 0;
    this._timer = setInterval(() => this._scheduler(), 25);
  }

  stop() {
    if (this._timer) {
      clearInterval(this._timer);
      this._timer = null;
    }
  }

  _scheduler() {
    const sixteenth = 60 / this.bpm / 4;
    // 200ms先まで先読みして予約(setIntervalのジッタに強くする)
    while (this._nextTime < this.ctx.currentTime + 0.25) {
      this._playStep(this._step, this._nextTime, sixteenth);
      this._nextTime += sixteenth;
      this._step += 1;
      if (this._step >= 16) {
        this._step = 0;
        this._bar += 1;
      }
    }
  }

  _playStep(step, time, sixteenth) {
    const bar = sixteenth * 16;
    // 裏拍(奇数16分)を少し後ろへずらしてスウィング(Lo-fiのヨレた感じ)
    const swing = step % 2 === 1 ? sixteenth * 0.18 : 0;
    const jitter = (Math.random() - 0.5) * 0.006; // ごく僅かな人間味
    const t = time + swing + jitter;
    const chord = this.progression[this._bar % this.progression.length];

    // --- コード ---
    if (step === 0) {
      // 夜はほぼ1小節フルで持続、昼は短めのプラックで軽快に
      this._chord(chord, time, this.night ? bar * 0.98 : bar * 0.5);
    }
    if (!this.night && step === 8) {
      this._chord(chord, time, bar * 0.45); // 昼は半拍でもう一度弾く
    }

    // --- ベース(ルート音を1オクターブ下で。キックに寄り添う) ---
    if (step === 0) this._bass(t, chord[0] / 2, sixteenth * 6);
    if (step === (this.night ? 10 : 10)) this._bass(t, chord[0] / 2, sixteenth * 3, 0.7);
    if (this.night && step === 6) this._bass(t, chord[0] / 2, sixteenth * 2, 0.55);

    // --- ピアノ風アルペジオ(コードトーンをぽろぽろ弾くメロディ) ---
    const leadSteps = this.night ? [3, 7, 14] : [2, 6, 11, 14];
    if (leadSteps.includes(step) && Math.random() < (this.night ? 0.6 : 0.7)) {
      const tone = chord[this._arpIdx % chord.length];
      this._arpIdx += 1;
      const octave = Math.random() < 0.2 ? 4 : 2; // たまに1オクターブ上でキラッと
      this._pluck(t, tone * octave, this.night ? 1.3 : 0.9);
    }

    // --- ドラム(ボリューム低めのボンバップ) ---
    const kickSteps = this.night ? [0, 6, 10] : [0, 10];
    const snareSteps = [4, 12];
    if (kickSteps.includes(step)) this._kick(t, this.night ? 0.95 : 0.82);
    if (snareSteps.includes(step)) this._snare(t, this.night ? 0.5 : 0.42);
    // ハイハット: 8分中心+たまにゴースト、14でオープン
    if (step % 2 === 0 || step === 7 || step === 15) {
      const accent = step % 4 === 0;
      const vel = (accent ? 0.12 : 0.06) * (this.night ? 1 : 0.9);
      this._hat(t, vel, step === 14);
    }
  }

  _chord(freqs, time, dur) {
    const ctx = this.ctx;
    freqs.forEach((f, i) => {
      const peak = i === 0 ? 0.5 : 0.3; // ルートを少し前に
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, time);
      g.gain.exponentialRampToValueAtTime(peak, time + 0.08); // 柔らかいアタック
      g.gain.setValueAtTime(peak, time + dur * 0.5);
      g.gain.exponentialRampToValueAtTime(0.0001, time + dur); // ゆるやかなリリース
      g.connect(this._chordGain);
      // ローズ風: sine + わずかにデチューンした triangle でコーラス感
      [['sine', 1], ['triangle', 1.004]].forEach(([type, mult]) => {
        const o = ctx.createOscillator();
        o.type = type;
        o.frequency.value = f * mult;
        o.connect(g);
        o.start(time);
        o.stop(time + dur + 0.05);
      });
    });
  }

  /** ベース: サイン波主体+うっすら倍音。丸くて太い低音 */
  _bass(time, freq, dur, vel = 0.85) {
    const ctx = this.ctx;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, time);
    g.gain.exponentialRampToValueAtTime(vel, time + 0.03);
    g.gain.setValueAtTime(vel, time + Math.max(0.05, dur * 0.55));
    g.gain.exponentialRampToValueAtTime(0.0001, time + dur);
    g.connect(this._bassGain);
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.value = freq;
    o.connect(g);
    o.start(time);
    o.stop(time + dur + 0.05);
    // 倍音を少し足して輪郭を出す
    const o2 = ctx.createOscillator();
    o2.type = 'triangle';
    o2.frequency.value = freq * 2.01;
    const g2 = ctx.createGain();
    g2.gain.value = 0.18;
    o2.connect(g2);
    g2.connect(g);
    o2.start(time);
    o2.stop(time + dur + 0.05);
  }

  /** ピアノ/ローズ風の単音プラック: 基音+倍音2つをピアノらしい減衰で */
  _pluck(time, freq, dur = 1.0) {
    const ctx = this.ctx;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, time);
    g.gain.exponentialRampToValueAtTime(0.5, time + 0.012); // 打鍵のアタック
    g.gain.exponentialRampToValueAtTime(0.0001, time + dur); // 自然な減衰
    g.connect(this._leadGain);
    // 基音 + 2倍音 + 3倍音(少しずつ小さく)でピアノっぽい音色に
    [['sine', 1, 1], ['triangle', 2, 0.3], ['sine', 3, 0.1]].forEach(([type, mult, amt]) => {
      const o = ctx.createOscillator();
      o.type = type;
      o.frequency.value = freq * mult;
      const og = ctx.createGain();
      og.gain.value = amt;
      o.connect(og);
      og.connect(g);
      o.start(time);
      o.stop(time + dur + 0.05);
    });
  }

  _kick(time, vel) {
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = 'sine';
    o.frequency.setValueAtTime(this.night ? 115 : 130, time);
    o.frequency.exponentialRampToValueAtTime(45, time + 0.11);
    g.gain.setValueAtTime(0.0001, time);
    g.gain.exponentialRampToValueAtTime(vel, time + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, time + 0.22);
    o.connect(g);
    g.connect(this._drumGain);
    o.start(time);
    o.stop(time + 0.25);
  }

  _snare(time, vel) {
    const ctx = this.ctx;
    // ノイズ成分(バンドパスで質感を柔らかく)
    const n = ctx.createBufferSource();
    n.buffer = this._noise;
    const nf = ctx.createBiquadFilter();
    nf.type = 'bandpass';
    nf.frequency.value = 1700;
    nf.Q.value = 0.6;
    const ng = ctx.createGain();
    ng.gain.setValueAtTime(vel, time);
    ng.gain.exponentialRampToValueAtTime(0.0001, time + (this.night ? 0.14 : 0.1));
    n.connect(nf);
    nf.connect(ng);
    ng.connect(this._drumGain);
    n.start(time);
    n.stop(time + 0.2);
    // 胴鳴りのトーン
    const o = ctx.createOscillator();
    o.type = 'triangle';
    o.frequency.value = 185;
    const og = ctx.createGain();
    og.gain.setValueAtTime(vel * 0.5, time);
    og.gain.exponentialRampToValueAtTime(0.0001, time + 0.09);
    o.connect(og);
    og.connect(this._drumGain);
    o.start(time);
    o.stop(time + 0.12);
  }

  _hat(time, vel, open) {
    const ctx = this.ctx;
    const n = ctx.createBufferSource();
    n.buffer = this._noise;
    const hf = ctx.createBiquadFilter();
    hf.type = 'highpass';
    hf.frequency.value = 7000;
    const g = ctx.createGain();
    const dur = open ? 0.18 : 0.03;
    g.gain.setValueAtTime(vel, time);
    g.gain.exponentialRampToValueAtTime(0.0001, time + dur);
    n.connect(hf);
    hf.connect(g);
    g.connect(this._drumGain);
    n.start(time);
    n.stop(time + dur + 0.02);
  }
}
