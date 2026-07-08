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

const CONNECTORS_IN = ['さてさて、', 'ところで、', 'それでは、', 'んー、', 'そうそう、'];
const AIZUCHI = ['なるほどー', 'へぇ、そうなんですね', 'いいですね、それ', 'おお、気になります', 'ふむふむ'];

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
        ? 'いつもの場所からお届けする、ゆる〜いお昼のラジオです'
        : '今いる場所のまわりの情報をお届けする、あなただけのお昼のラジオです';
    return {
      id: this._id(),
      topic: 'opening',
      factGrounded: true,
      lines: [
        { speaker: 'main', text: `こんにちは、${this.mainName}です。` },
        { speaker: 'sub', text: `アシスタントの${this.subName}です。` },
        { speaker: 'main', text: `${locNote}。今日はどんな話題が飛び出すか、私も${this.subName}さんも楽しみにしてます。` },
        { speaker: 'sub', text: '肩の力を抜いて、ながら聴きしてくださいね。' },
      ],
    };
  }

  _buildWeather(w) {
    return {
      id: this._id(),
      topic: 'weather',
      factGrounded: true,
      lines: [
        { speaker: 'main', text: `${pick(CONNECTORS_IN, this.rng)}今の空模様、気になりませんか？` },
        { speaker: 'sub', text: `${pick(AIZUCHI, this.rng)}、気になります！` },
        { speaker: 'main', text: `今の気温はだいたい${Math.round(w.tempC)}度、天気は「${w.description}」だそうです。` },
        { speaker: 'sub', text: w.description.includes('雨') ? '傘、持って出た方がよさそうですね。' : '外を少し歩くのにも良さそうな感じですね。' },
        { speaker: 'main', text: `ちなみにこの情報は${w.source}のデータなので、細かい体感とはズレることもあるかもです。` },
      ],
    };
  }

  _buildWeatherUnavailable() {
    return {
      id: this._id(),
      topic: 'weather',
      factGrounded: true,
      lines: [
        { speaker: 'main', text: `${pick(CONNECTORS_IN, this.rng)}天気の情報を取りに行ったんですが…` },
        { speaker: 'sub', text: 'あれ、どうでした？' },
        { speaker: 'main', text: '今回はうまく取得できませんでした。適当なことは言えないので、ここは正直に「わからない」にしておきますね。' },
        { speaker: 'sub', text: '窓の外、ちらっと見てみるのもいいかもです。' },
      ],
    };
  }

  _buildPlace(place, label) {
    const distText = place.distanceM < 1000 ? `およそ${place.distanceM}メートル` : `${(place.distanceM / 1000).toFixed(1)}キロほど`;
    const cuisineLine = place.cuisine ? `ジャンルは${place.cuisine}系みたいですよ。` : 'ジャンルまではデータに載ってなかったんですが。';
    const topic = place.category === 'lunch' ? 'lunch' : place.category === 'cafe' ? 'cafe' : 'culture';
    return {
      id: this._id(),
      topic,
      factGrounded: true,
      lines: [
        { speaker: 'sub', text: `${label}、見つかりましたか？` },
        { speaker: 'main', text: `はい、「${place.name}」というところが、現在地から${distText}のところにあるみたいです。` },
        { speaker: 'sub', text: `${pick(AIZUCHI, this.rng)}。${cuisineLine}` },
        { speaker: 'main', text: `地図データ(${place.source})に載っている情報なので、営業時間なんかは念のため現地で確認してもらえると確実です。` },
      ],
    };
  }

  _buildTrivia(t) {
    return {
      id: this._id(),
      topic: 'trivia',
      factGrounded: true,
      lines: [
        { speaker: 'main', text: `${pick(CONNECTORS_IN, this.rng)}このあたりの豆知識、ひとつ挟んでもいいですか？` },
        { speaker: 'sub', text: 'もちろんです、聞きたいです。' },
        { speaker: 'main', text: `「${t.title}」について、${t.extract}` },
        { speaker: 'sub', text: `${pick(AIZUCHI, this.rng)}、知らなかったです。出典は${t.source}なんですね。` },
      ],
    };
  }

  _buildFiller() {
    const fillers = [
      [
        { speaker: 'sub', text: '今日のところは、近くのネタは一通りお届けしちゃいましたね。' },
        { speaker: 'main', text: 'ですね。少し歩くと、また新しいスポットが見つかるかもしれません。' },
        { speaker: 'sub', text: '水分補給、たまに思い出してくださいね。' },
      ],
      [
        { speaker: 'main', text: 'ちょっと一息、お昼のこの時間、どんな風に過ごしてますか？' },
        { speaker: 'sub', text: '歩きながら聴いてる人も、休憩中の人もいそうですね。' },
        { speaker: 'main', text: 'どちらにしても、無理せずゆったりいきましょう。' },
      ],
      [
        { speaker: 'sub', text: '移動したら、また新しい周辺情報を拾ってきますね。' },
        { speaker: 'main', text: 'はい、動いたぶんだけ番組も表情を変えていくので、お楽しみに。' },
      ],
    ];
    const lines = fillers[this._fillerIdx % fillers.length];
    this._fillerIdx += 1;
    return { id: this._id(), topic: 'filler', factGrounded: false, lines };
  }
}
