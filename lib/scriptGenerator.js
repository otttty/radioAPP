// ============================================================
// ScriptGenerator (台本生成エンジン)
// ------------------------------------------------------------
// 設計方針(事実性の担保が最優先):
//   自由生成LLMは使わず、取得済みの構造化ファクト(FactBundle)を
//   「テンプレート + 言い回しバリエーション」に流し込むだけの
//   決定的な合成にしている。LLMが台本全文を自由生成すると
//   存在しない店名・誤った気温を語るリスクがあるため採用しない。
//
//   演出方針:
//    - 番組は「お昼」固定ではなく、再生時の現実時間に合わせて挨拶・時報を変える。
//    - 冒頭でどの土地(市区町村名)の番組かに軽く触れる。
//    - 各トピックの入りの文言は毎回ランダムに変え、単調さを避ける。
//    - 2人はどちらもテンションを高め、テンポよく畳みかける掛け合いにする。
//    - 徒歩の所要時間・天気の注意点など、聴いて役に立つ情報を必ず添える。
//
//   ネタ枯渇時は filler セグメント(特定の店名・数値を含まない
//   一般的なラジオ的つなぎ話)にフォールバックし、番組を途切れさせない。
// ============================================================

const PROGRAM_NAME = 'まちかどラジオ';

// 2人ともテンション高めの相槌
const AIZUCHI = ['おおー！', 'いいですね！', 'へえー！', 'なるほど！', '気になる〜！', 'うわ、最高！', 'それはいい！'];

function pick(arr, rng) {
  return arr[Math.floor(rng() * arr.length)];
}

function defaultRng() {
  return Math.random;
}

/** 現実の時刻から挨拶を決める */
function greetingFor(hour) {
  if (hour >= 5 && hour < 10) return 'おはようございます';
  if (hour >= 10 && hour < 18) return 'こんにちは';
  return 'こんばんは';
}

/** 距離(m)から徒歩のおおよその所要分(80m/分)。最低1分 */
function walkMinutes(distanceM) {
  return Math.max(1, Math.round(distanceM / 80));
}

/** 気温・天気からお出かけの実用アドバイスを返す(有益な情報として必ず添える) */
function weatherAdvice(tempC, description) {
  if (description.includes('雨') || description.includes('雷')) return '折りたたみ傘、持っておくと安心ですよ！';
  if (tempC >= 30) return 'かなり暑いです、水分補給と休憩はこまめにいきましょう！';
  if (tempC >= 25) return '汗ばむ陽気です、水分補給をお忘れなく！';
  if (tempC <= 5) return 'しっかり冷え込みます、あたたかくしてお出かけを！';
  if (tempC <= 12) return '少し肌寒いので、一枚羽織ると安心です。';
  return 'お出かけにはちょうどいい陽気ですよ！';
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
    if (lunch) return this._buildPlace(lunch);

    const cafe = this._pickPlace(facts, 'cafe');
    if (cafe) return this._buildPlace(cafe);

    const trivia = this._pickTrivia(facts);
    if (trivia) return this._buildTrivia(trivia);

    const culture = this._pickPlace(facts, 'culture');
    if (culture) return this._buildPlace(culture);

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
    const hour = new Date().getHours();
    const greet = greetingFor(hour);
    const area = facts.location.areaName || null;
    return {
      id: this._id(),
      topic: 'opening',
      factGrounded: true,
      lines: [
        { speaker: 'main', text: `${greet}！ 「${PROGRAM_NAME}」、始まりました！ お相手はわたし、${this.mainName}と…` },
        { speaker: 'sub', text: `アシスタントの${this.subName}です！ さあ、いきますよー！` },
        {
          speaker: 'main',
          text: area
            ? `この番組は、${area}のまわりの話題を、テンポよくお届けしていきます！`
            : 'この番組は、あなたの街のまわりの話題を、テンポよくお届けしていきます！',
        },
        { speaker: 'sub', text: `${area ? `${area}の` : ''}おいしいお店に、街の歴史に…役立つ情報、盛りだくさんですよ！` },
        { speaker: 'main', text: `ただいまの時刻は、およそ${hour}時。それでは、さっそくまいりましょう！` },
      ],
    };
  }

  _buildWeather(w) {
    const intro = pick([
      'まずは、気になる空模様からチェックです！',
      'ここで、お天気の時間です！',
      'さっそくですが、今の天気、見てみましょう！',
      'おでかけ前に、空の様子をチェックです！',
    ], this.rng);
    const subReact = w.description.includes('雨')
      ? pick(['うわ、雨ですか〜！', 'これは傘の出番ですね！'], this.rng)
      : pick(['お、いい感じ！', '過ごしやすそう！', '外に出たくなりますね！'], this.rng);
    return {
      id: this._id(),
      topic: 'weather',
      factGrounded: true,
      lines: [
        { speaker: 'main', text: intro },
        { speaker: 'sub', text: '待ってました、お天気！' },
        { speaker: 'main', text: `ただいまの気温はおよそ${Math.round(w.tempC)}度、空模様は「${w.description}」です。` },
        { speaker: 'sub', text: subReact },
        { speaker: 'main', text: `${weatherAdvice(w.tempC, w.description)} データは${w.source}提供でした。` },
      ],
    };
  }

  _buildWeatherUnavailable() {
    return {
      id: this._id(),
      topic: 'weather',
      factGrounded: true,
      lines: [
        { speaker: 'main', text: pick([
          'お天気コーナー…といきたいんですが、',
          '続いてお天気…と思ったんですが、',
        ], this.rng) },
        { speaker: 'sub', text: 'お、なんかトラブルの気配！？' },
        { speaker: 'main', text: '今日はデータが取れませんでした！ 適当は言えないので、ここは潔く。' },
        { speaker: 'sub', text: 'ということで、みなさん窓の外をチラッとどうぞ！' },
      ],
    };
  }

  _buildPlace(place) {
    const distText = place.distanceM < 1000 ? `およそ${place.distanceM}メートル` : `${(place.distanceM / 1000).toFixed(1)}キロほど`;
    const mins = walkMinutes(place.distanceM);
    const cuisineLine = place.cuisine ? `ジャンルは${place.cuisine}系だそうですよ！` : 'どんなお店かは、行ってからのお楽しみです！';

    const INTROS = {
      lunch: [
        'お腹の虫が鳴く前に、ランチ情報です！',
        'ここでグルメの時間！おすすめランチ、いきましょう！',
        'ごはん選びに迷ってる方へ、朗報です！',
        '近くのランチスポット、見つけましたよ！',
      ],
      cafe: [
        'ひと休みしたい方へ、カフェ情報です！',
        'ここでカフェタイムのご提案！',
        'コーヒーが恋しい時間、おすすめのお店です！',
        '近くの休憩スポット、見つけました！',
      ],
      culture: [
        'ちょっと寄り道、文化スポットのご案内です！',
        'ここで、街の見どころ情報！',
        '知的なひととき、いかがですか？',
        '近くの文化スポット、ご紹介します！',
      ],
    };
    const TIPS = {
      lunch: 'お昼どきは混みやすいので、時間をずらすのもおすすめですよ。',
      cafe: '作業や読書のお供にも、ちょうどよさそうですね。',
      culture: '気分転換にぴったり、足をのばす価値ありです！',
    };
    const topic = place.category;
    return {
      id: this._id(),
      topic,
      factGrounded: true,
      lines: [
        { speaker: 'main', text: pick(INTROS[topic] ?? INTROS.lunch, this.rng) },
        { speaker: 'sub', text: pick(['お、どこどこ！？', '待ってました！', 'いいですね、教えて！', '気になる〜！'], this.rng) },
        { speaker: 'main', text: `「${place.name}」！ ここから${distText}、徒歩でおよそ${mins}分ですよ。` },
        { speaker: 'sub', text: `${pick(AIZUCHI, this.rng)} ${cuisineLine}` },
        { speaker: 'main', text: TIPS[topic] ?? TIPS.lunch },
      ],
    };
  }

  _buildTrivia(t) {
    const intro = pick([
      'ここで、街のちょっといい話！',
      '知ってると誰かに話したくなる小ネタです！',
      'この街の歴史、のぞいてみましょう！',
      'ご近所の豆知識、いってみましょう！',
    ], this.rng);
    return {
      id: this._id(),
      topic: 'trivia',
      factGrounded: true,
      lines: [
        { speaker: 'main', text: intro },
        { speaker: 'sub', text: pick(['待ってました、これ好きなんです！', 'おっ、気になります！', 'いいですね、聞かせて！'], this.rng) },
        { speaker: 'main', text: t.extract },
        { speaker: 'sub', text: `${pick(AIZUCHI, this.rng)} それは知らなかった〜！` },
        { speaker: 'main', text: `いや〜、街って面白いですね！ ネタ元は${t.source}でした。` },
      ],
    };
  }

  _buildFiller() {
    const fillers = [
      [
        { speaker: 'main', text: 'さーて、このあたりのネタは一旦ぜんぶ出しちゃいましたね！' },
        { speaker: 'sub', text: '早い早い(笑)。ちょっと歩けば、また新しいの拾えますよ！' },
        { speaker: 'main', text: 'ですね。水分補給しつつ、いきましょう！' },
      ],
      [
        { speaker: 'sub', text: 'ところでリスナーのみなさん、今なにしてます？' },
        { speaker: 'main', text: 'いいね、その振り！ 歩いてる人も、休憩中の人もいるでしょうねえ。' },
        { speaker: 'sub', text: 'どんな時間でも、ゆるっとお付き合いくださいね！' },
      ],
      [
        { speaker: 'main', text: 'ちょっとBGMに身をまかせる時間、いいですよね。' },
        { speaker: 'sub', text: '移動したら、また街の情報、どんどん拾ってきますよ！' },
        { speaker: 'main', text: '動いたぶんだけ番組も変わります。お楽しみに！' },
      ],
    ];
    const lines = pick(fillers, this.rng);
    this._fillerIdx += 1;
    return { id: this._id(), topic: 'filler', factGrounded: false, lines };
  }
}
