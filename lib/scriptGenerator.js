// ============================================================
// ScriptGenerator (台本生成エンジン)
// ------------------------------------------------------------
// 設計方針(事実性の担保が最優先):
//   自由生成LLMは使わず、取得済みの構造化ファクト(FactBundle)を
//   「テンプレート + 言い回しバリエーション」に流し込むだけの
//   決定的な合成にしている。LLMが台本全文を自由生成すると
//   存在しない店名・誤った気温を語るリスクがあるため採用しない。
//
//   将来LLMベースの生成に差し替える場合も、この ScriptGenerator と
//   同じ interface (nextSegment(facts) -> Segment) を実装し、
//   「facts に無い固有名詞は使用禁止」という制約をプロンプトで
//   強制する形にすれば安全に置き換えられる。
//
//   ネタ枯渇時は filler セグメント(特定の店名・数値を含まない
//   一般的なラジオ的つなぎ話)にフォールバックし、番組を途切れさせない。
// ============================================================

// ラジオらしいテンポの良い言い回し。掛け合いを畳みかけるため、相槌は短めに。
const CONNECTORS_IN = ['さあ、', '続いては、', 'お次は、', 'さてさて、', 'いきましょう、', 'はい、'];
const AIZUCHI = ['おおー', 'いいねいいね', 'へぇー！', 'なるほど', 'それは気になる', 'うんうん', 'ほう！'];
const REACT_SHORT = ['ですね！', 'いいですね', 'たしかに', 'わかる〜', 'ですよね'];
const PROGRAM_NAME = 'ひるラジ';

function pick(arr, rng) {
  return arr[Math.floor(rng() * arr.length)];
}

function defaultRng() {
  return Math.random;
}

export class ScriptGenerator {
  /**
   * @param {{mainName?: string, subName?: string, rng?: () => number}} [opts]
   */
  constructor(opts = {}) {
    this.mainName = opts.mainName ?? 'ひかり';
    this.subName = opts.subName ?? 'そら';
    this.rng = opts.rng ?? defaultRng();
    this._usedPlaces = new Set();
    this._usedTrivia = new Set();
    this._weatherDone = false;
    this._openingDone = false;
    this._fillerIdx = 0;
    this._segCounter = 0;
  }

  _id() {
    this._segCounter += 1;
    return `seg-${this._segCounter}`;
  }

  /**
   * facts に基づき、次に流すべきセグメントを1つ決定的に生成する。
   * 呼び出し側(パイプライン)はこれをバッファが空くたびに呼ぶ。
   * @param {import('./types.js').FactBundle} facts
   * @returns {import('./types.js').Segment}
   */
  nextSegment(facts) {
    if (!this._openingDone) {
      this._openingDone = true;
      return this._buildOpening(facts);
    }
    if (!this._weatherDone) {
      this._weatherDone = true;
      return facts.weather ? this._buildWeather(facts.weather) : this._buildWeatherUnavailable();
    }

    const lunch = this._pickPlace(facts, 'lunch');
    if (lunch) return this._buildPlace(lunch, '今日のお昼ごはん候補');

    const cafe = this._pickPlace(facts, 'cafe');
    if (cafe) return this._buildPlace(cafe, '休憩にぴったりなカフェ');

    const trivia = this._pickTrivia(facts);
    if (trivia) return this._buildTrivia(trivia);

    const culture = this._pickPlace(facts, 'culture');
    if (culture) return this._buildPlace(culture, 'ちょっと寄り道できる文化スポット');

    // ここまでで実データのネタが尽きた -> つなぎ(filler)で途切れさせない
    return this._buildFiller();
  }

  _pickPlace(facts, category) {
    const candidate = (facts.places || [])
      .filter((p) => p.category === category && !this._usedPlaces.has(p.name))
      .sort((a, b) => a.distanceM - b.distanceM)[0];
    if (candidate) this._usedPlaces.add(candidate.name);
    return candidate ?? null;
  }

  _pickTrivia(facts) {
    const candidate = (facts.trivia || []).find((t) => !this._usedTrivia.has(t.title));
    if (candidate) this._usedTrivia.add(candidate.title);
    return candidate ?? null;
  }

  _buildOpening(facts) {
    const locNote =
      facts.location.status === 'denied' || facts.location.status === 'unavailable'
        ? 'あなたの街のすぐそばから'
        : '今いる場所のまわりから';
    return {
      id: this._id(),
      topic: 'opening',
      factGrounded: true,
      lines: [
        { speaker: 'main', text: `はい始まりました、お昼のラジオ「${PROGRAM_NAME}」！ お相手はわたし、${this.mainName}と…` },
        { speaker: 'sub', text: `アシスタントの${this.subName}です！ どうもー。` },
        { speaker: 'main', text: `この番組は、${locNote}、街のグルメに歴史に小ネタをテンポよくお届けしていきます。` },
        { speaker: 'sub', text: 'お昼ごはんのお供に、ぜひ気軽に聴いてってくださいね。' },
        { speaker: 'main', text: 'さあ、さっそくいきましょう！' },
      ],
    };
  }

  _buildWeather(w) {
    return {
      id: this._id(),
      topic: 'weather',
      factGrounded: true,
      lines: [
        { speaker: 'main', text: `${pick(CONNECTORS_IN, this.rng)}まずは空模様のチェックです！` },
        { speaker: 'sub', text: '待ってました、お天気コーナー！' },
        { speaker: 'main', text: `ただいまの気温、およそ${Math.round(w.tempC)}度。空模様は「${w.description}」！` },
        { speaker: 'sub', text: w.description.includes('雨') ? 'うわ、傘マスト案件じゃないですか。' : 'お、これはお散歩日和ですねえ。' },
        { speaker: 'main', text: `データは${w.source}提供でお届けしました。` },
      ],
    };
  }

  _buildWeatherUnavailable() {
    return {
      id: this._id(),
      topic: 'weather',
      factGrounded: true,
      lines: [
        { speaker: 'main', text: `${pick(CONNECTORS_IN, this.rng)}お天気コーナー…といきたいんですが、` },
        { speaker: 'sub', text: 'お、なんかトラブルの気配。' },
        { speaker: 'main', text: '今日はデータが取れませんでした！ 適当は言えないので、ここは潔く。' },
        { speaker: 'sub', text: 'ということで、みなさん窓の外をチラッとどうぞ！' },
      ],
    };
  }

  _buildPlace(place, label) {
    const distText = place.distanceM < 1000 ? `およそ${place.distanceM}メートル` : `${(place.distanceM / 1000).toFixed(1)}キロほど`;
    const cuisineLine = place.cuisine ? `ジャンルはなんと${place.cuisine}系！` : 'ジャンルはデータに無し、行ってからのお楽しみ！';
    const topic = place.category === 'lunch' ? 'lunch' : place.category === 'cafe' ? 'cafe' : 'culture';
    const cornerName =
      place.category === 'lunch' ? '街のランチ' : place.category === 'cafe' ? '街のカフェ' : '街の寄り道';
    return {
      id: this._id(),
      topic,
      factGrounded: true,
      lines: [
        { speaker: 'main', text: `${pick(CONNECTORS_IN, this.rng)}${cornerName}コーナー！ ${label}、いっちゃいましょう。` },
        { speaker: 'sub', text: 'お、どこどこ？' },
        { speaker: 'main', text: `その名も「${place.name}」！ ここから${distText}のところにありますよ。` },
        { speaker: 'sub', text: `${pick(AIZUCHI, this.rng)}！ ${cuisineLine}` },
        { speaker: 'main', text: `情報は${place.source}から。営業時間だけ現地で確認してもらえれば、バッチリです！` },
      ],
    };
  }

  _buildTrivia(t) {
    return {
      id: this._id(),
      topic: 'trivia',
      factGrounded: true,
      lines: [
        { speaker: 'main', text: 'さあお待ちかね、ご近所のちょっといい話コーナー！' },
        { speaker: 'sub', text: 'これ好きなんですよ、今日は何ですか？' },
        { speaker: 'main', text: `題して「${t.title}」。${t.extract}` },
        { speaker: 'sub', text: `${pick(AIZUCHI, this.rng)}！ それは知らなかった〜。` },
        { speaker: 'main', text: `ネタ元は${t.source}でした！` },
      ],
    };
  }

  _buildFiller() {
    const fillers = [
      [
        { speaker: 'main', text: 'さーて、このへんのネタは一旦ぜんぶ出しちゃいましたね！' },
        { speaker: 'sub', text: '早い早い（笑）。ちょっと歩けばまた新しいの拾えますよ。' },
        { speaker: 'main', text: 'ですね。水分補給しつつ、のんびりいきましょう！' },
      ],
      [
        { speaker: 'sub', text: 'ところでリスナーのみなさん、お昼は何食べました？' },
        { speaker: 'main', text: 'いいねその話題！ 歩きながらの人も、休憩中の人もいるでしょうねえ。' },
        { speaker: 'sub', text: `どっちにしても、${pick(REACT_SHORT, this.rng)} ゆるっといきましょ。` },
      ],
      [
        { speaker: 'main', text: 'ちょっとBGMに身をまかせる時間、いいですよね。' },
        { speaker: 'sub', text: '移動したらまた街の情報、拾ってきますからね！' },
        { speaker: 'main', text: '動いたぶんだけ番組も変わります。お楽しみに！' },
      ],
    ];
    const lines = fillers[this._fillerIdx % fillers.length];
    this._fillerIdx += 1;
    return { id: this._id(), topic: 'filler', factGrounded: false, lines };
  }
}
