// ============================================================
// BrowserTTSEngine
// 実装: Web Speech API (SpeechSynthesis)。ブラウザ内蔵のため
// APIキー不要・往復レイテンシがほぼゼロ(継続再生と相性が良い)。
// 音質は端末のOS音声に依存し機械的になりがち。
// より人の声に近い音質が必要な場合は openaiTtsEngine.js の
// OpenAITTSEngine を使う(同じ interface: ready/speakLine/cancelAll)。
// ============================================================

export class BrowserTTSEngine {
  constructor() {
    /** @type {SpeechSynthesisVoice[]} */
    this._voices = [];
    this._voicesReady = this._loadVoices();
  }

  _loadVoices() {
    return new Promise((resolve) => {
      const synth = window.speechSynthesis;
      const populate = () => {
        const voices = synth.getVoices();
        if (voices.length > 0) {
          this._voices = voices;
          resolve();
        }
      };
      populate();
      if (this._voices.length === 0) {
        synth.onvoiceschanged = () => {
          populate();
        };
        // 一部ブラウザは onvoiceschanged が発火しないため保険のタイムアウトも用意
        setTimeout(populate, 800);
      }
    });
  }

  async ready() {
    await this._voicesReady;
  }

  // AudioPipeline から呼ばれるが、このエンジンはWeb Audioグラフを使わないため no-op
  attachAudioGraph() {}

  /** 日本語音声を優先しつつ、2人分の声設定(voice/pitch/rate)を決める */
  _voiceProfile(speaker) {
    const jaVoices = this._voices.filter((v) => v.lang && v.lang.startsWith('ja'));
    const pool = jaVoices.length > 0 ? jaVoices : this._voices;
    if (speaker === 'main') {
      return { voice: pool[0] ?? null, pitch: 1.05, rate: 1.08 };
    }
    // 2つ目の声がなければ同じ声のまま pitch/rate を変えて聞き分けやすくする
    return { voice: pool[1] ?? pool[0] ?? null, pitch: 0.85, rate: 1.03 };
  }

  /**
   * 1行を読み上げ、読み終わったら resolve する。
   * @param {import('./types.js').ScriptLine} line
   * @param {{volume?: number}} [opts]
   * @returns {Promise<void>}
   */
  speakLine(line, opts = {}) {
    return new Promise((resolve) => {
      const utter = new SpeechSynthesisUtterance(line.text);
      const profile = this._voiceProfile(line.speaker);
      if (profile.voice) utter.voice = profile.voice;
      utter.pitch = profile.pitch;
      utter.rate = profile.rate;
      utter.volume = opts.volume ?? 1;
      utter.lang = profile.voice?.lang ?? 'ja-JP';
      utter.onend = () => resolve();
      utter.onerror = () => resolve(); // 読み上げ失敗時も番組を止めない
      this._current = utter;
      window.speechSynthesis.speak(utter);
    });
  }

  cancelAll() {
    window.speechSynthesis.cancel();
  }

  pause() {
    window.speechSynthesis.pause();
  }

  resume() {
    window.speechSynthesis.resume();
  }
}

// 後方互換のためのエイリアス
export { BrowserTTSEngine as TTSEngine };
