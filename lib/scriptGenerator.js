// ============================================================
// ScriptGenerator (台本生成エンジン)
// ------------------------------------------------------------
// 生成方針:
//   台本は毎回 LLM(OpenAI Chat Completions)に自然な掛け合いを書かせる。
//   ただし「取得済みの事実(店名・数値・豆知識・地名)だけを使い、固有名詞や
//   数値を創作しない/出典には触れない」という制約をプロンプトで厳格に課し、
//   存在しない店・誤った気温を語らせない(事実性はここで担保する)。
//
//   ネタの選定(どのお店/豆知識を、どの順で出すか)は決定的なロジックで行い、
//   選んだ事実だけを LLM に渡す。LLM は「言い回し・導入・相槌」を毎回変えて
//   自然で気の利いた会話にする役割に限定する。
//
//   LLM が使えない(APIキー未設定・失敗)場合は、従来のテンプレート合成に
//   フォールバックして番組を止めない。
//
//   演出方針:
//    - 番組は再生時の現実時間に合わせて挨拶・時報を変える。
//    - 冒頭でどの土地(市区町村名)の番組かに触れる。
//    - お店中心の構成(4本に1本だけ豆知識)。
//    - そら はテンションやや高めで、毎回被らない気の利いたコメントをする。
//    - 徒歩の所要時間・天気の注意点など、聴いて役に立つ情報を織り込む。
// ============================================================

const PROGRAM_NAME = 'まちかどラジオ';
const SCRIPT_ENDPOINT = '/api/script';

// テンプレート・フォールバック用の言い回し
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

const CATEGORY_LABEL = { lunch: 'ランチ・飲食店', cafe: 'カフェ', culture: '文化スポット' };

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
    this.mainName = opts.mainName ?? 'ボブ';
    this.subName = opts.subName ?? 'ジェシー';
    this.rng = opts.rng ?? defaultRng();
    this._usedPlaces = new Set();
    this._usedTrivia = new Set();
    this._weatherDone = false;
    this._openingDone = false;
    this._fillerIdx = 0;
    this._segCounter = 0;
    this._contentCount = 0; // オープニング/天気の後に流したコンテンツ本数
    this._llm = null; // { apiKey, model }
    this._recent = []; // 直近の発話(言い回しの重複回避のためLLMに渡す)
  }

  /**
   * LLM台本生成を有効化する。ユーザー入力キーが無くても、サーバー側に既定キーが
   * あれば(serverDefault=true)有効化する。どちらも無ければテンプレート合成になる。
   */
  // 既定モデルは gpt-4.1-mini(gpt-4o-mini より日本語の読み・かな変換の精度が高い)
  configureLLM(apiKey, { serverDefault = false, model = 'gpt-4.1-mini' } = {}) {
    this._llm = apiKey || serverDefault ? { apiKey: apiKey || '', model } : null;
  }

  _id() {
    this._segCounter += 1;
    return `seg-${this._segCounter}`;
  }

  /**
   * 次に流すセグメントを1つ生成する(LLM優先・失敗時テンプレート)。
   * @param {import('./types.js').FactBundle} facts
   * @returns {Promise<import('./types.js').Segment>}
   */
  async nextSegment(facts) {
    const plan = this._planSegment(facts);

    if (this._llm) {
      try {
        const lines = await this._generateWithLLM(plan, facts);
        if (Array.isArray(lines) && lines.length >= 2) {
          this._remember(lines);
          return { id: this._id(), topic: plan.topic, factGrounded: plan.factGrounded, lines };
        }
      } catch (e) {
        console.warn('[scriptGenerator] LLM生成に失敗、テンプレートで継続:', e);
      }
    }

    const seg = this._templateSegment(plan, facts);
    this._remember(seg.lines);
    return seg;
  }

  // --- ネタ選定(決定的) ---------------------------------------------------

  /** 次に扱うトピックと、その素材(お店/豆知識)を1つ決める */
  _planSegment(facts) {
    if (!this._openingDone) {
      this._openingDone = true;
      return { kind: 'opening', topic: 'opening', factGrounded: true };
    }
    if (!this._weatherDone) {
      this._weatherDone = true;
      return facts.weather
        ? { kind: 'weather', topic: 'weather', factGrounded: true, weather: facts.weather }
        : { kind: 'weather-na', topic: 'weather', factGrounded: true };
    }

    // お店中心の構成: 4本に1本だけ豆知識、残りはお店を優先
    this._contentCount += 1;
    const triviaSlot = this._contentCount % 4 === 0;
    const nextPlace = () =>
      this._pickPlace(facts, 'lunch') || this._pickPlace(facts, 'cafe') || this._pickPlace(facts, 'culture');

    if (triviaSlot) {
      const trivia = this._pickTrivia(facts);
      if (trivia) return { kind: 'trivia', topic: 'trivia', factGrounded: true, trivia };
      const place = nextPlace();
      if (place) return { kind: 'place', topic: place.category, factGrounded: true, place };
    } else {
      const place = nextPlace();
      if (place) return { kind: 'place', topic: place.category, factGrounded: true, place };
      const trivia = this._pickTrivia(facts);
      if (trivia) return { kind: 'trivia', topic: 'trivia', factGrounded: true, trivia };
    }
    return { kind: 'filler', topic: 'filler', factGrounded: false };
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

  // --- LLM生成 -------------------------------------------------------------

  _remember(lines) {
    for (const l of lines) this._recent.push(l.text);
    if (this._recent.length > 20) this._recent = this._recent.slice(-20);
  }

  _systemPrompt() {
    return [
      `あなたは日本のノリノリなラジオ番組「${PROGRAM_NAME}」の放送作家です。2人組パーソナリティの、超ハイテンションで自然な掛け合い台本を書きます。`,
      '',
      '【パーソナリティ1: ボブ】(speaker="main")',
      '- 常にテンションMAX。深夜でも朝イチのテンションで喋る。ファンキーで自由奔放、話が突然音楽やソウルフルな方向に脱線する。理屈より勢いとグルーヴ。',
      '- 一人称は「オレ」。語尾に「〜ってわけ!」「〜じゃんか!」など。興奮すると「イエーイ!」「ウォウウォウ!」「ファンキー!」等の合いの手。気に入った話題に「それ、グルーヴィーだねぇ〜」。',
      '- 大事なことは2回繰り返す(例:「マジで、マジでヤバいって!」)。リスナーを「ファンキーな仲間たち」と呼ぶ。ジェシーの話を勢いよく拾ってテンションを上乗せする。',
      '',
      '【パーソナリティ2: ジェシー】(speaker="sub")',
      '- 超ハイテンションの陽キャ。人懐っこく、ポジティブの塊。どんな話題も明るい方向へ。リアクションが大げさで笑い声が大きい。',
      '- 一人称は「ジェシー」(自分の名前で呼ぶ)。語尾に「〜っしょ!」「〜だよね〜!」など。驚くと「エッッ、ウソでしょ!?」「ヤバみが深い!」。何にでも「最&高!」「アゲアゲじゃん!」とテンション高く返す。',
      '- 話し始めに「ねぇねぇねぇ!」と3回繰り返すのが口グセ。よく笑い「あはははは!」を挟む。ボブの脱線を笑いながら拾い本筋に戻す進行役。リスナーを「みんな〜!」と呼ぶ。',
      '',
      '【掛け合いルール】',
      '- 2人とも常にノリノリ。テンポは速く、間延びさせない。相手の発言には必ずリアクションしてから自分の話をする。ボケとツッコミの役割を交互に入れ替える。',
      '- マンネリ禁止: 同じジャンルでも同じ言い回し・同じ構成を使わない。導入パターンを毎回変える(質問から/エピソードから/クイズ形式/いきなり結論から 等)。口グセは使ってよいが同じ流れで多用しない。',
      '- 構成は「掛け合いの導入 → そのトピック固有ネタの深掘り → リスナーへの一言で締め」。締めの言い回しも毎回変える。',
      '',
      '【厳守事項】',
      '- 素材に書かれた事実(店名・数値・地名・豆知識・レビューの内容)だけを使う。素材に無い固有名詞・数値・エピソードを創作しない。',
      '- そのトピックならではの固有の情報・魅力を必ず会話に含める(どのお店にも当てはまる一般論だけで終わらせない)。素材にレビューや概要があれば、利用者の声・評判・雰囲気を会話に自然に織り込む。',
      '- 参照元はいちいち言わない。「レビューによると」「データでは」などの出典言及は禁止。自分たちが見聞きした話のように自然に語る。',
      '- 話し言葉で、1行は短めに。全体で5〜7ターン程度。ナレーションではなく2人の会話にする。各行は必ず main か sub。',
      '- 音声合成で読み上げる前提。読み間違いや不自然さを避けるため、記号(「&」「*」「#」など)や過度な「！」の連打は使わない。「最&高」ではなく「最高」と書く。長音は「〜」ではなく通常の伸ばし方(例:「だよー」)で書く。',
      '',
      '【読み上げ用表記 speech(重要)】',
      '- 各行に "text"(字幕用の通常表記)に加えて "speech"(読み上げ用表記)を必ず付ける。',
      '- speech は text と同じ内容を、漢字をすべてひらがな・カタカナに開いた全文にする。固有名詞・難読語も文脈に合った正しい読みで開く(例:「一蘭」→「いちらん」、「道玄坂」→「どうげんざか」)。',
      '- 読みは声に出したときに正しい日本語になっているか必ず確認する。字面のローマ字的な読みではなく、熟語として正しい読みを使う。よく間違えやすい例: 「早速」→「さっそく」(×はやそく)、「今朝」→「けさ」(×いまあさ)、「今日」→「きょう」、「明日」→「あした」、「一人」→「ひとり」、「大人気」→「だいにんき」、「行って」→「いって」。',
      '- 地名・歴史上の人名は正式な読みを使う(例:「大手町」→「おおてまち」、「平将門」→「たいらのまさかど」、「藤原道長」→「ふじわらのみちなが」)。素材に「読みのヒント」があれば必ずそれに従う。',
      '- カタカナ語・外来語はカタカナのまま残す(例:「ファンキー」「グルーヴィー」「ラーメン」はひらがなにしない)。',
      '- 数字は読み方どおりにかなで書く(例:「星4.9」→「ほしよんてんきゅう」、「徒歩5分」→「とほごふん」)。桁の多い数は概数に丸めてよい(例:「15611件」→「いちまんごせんけんいじょう」)。',
      '- 英字の固有名詞はカタカナ読みにする(例:「GYUMON」→「ギュウモン」)。読みが不明な場合はローマ字読みで自然にカタカナ化する。',
      '- 句読点や「！」「？」は speech にも残す(抑揚の手がかりになる)。',
      '',
      '出力は次のJSONのみ: {"lines":[{"speaker":"main"|"sub","text":"...","speech":"..."}]}',
    ].join('\n');
  }

  /** planと事実から、LLMへ渡す「素材」説明文を作る */
  _briefFor(plan, facts) {
    const hour = new Date().getHours();
    const area = facts.location?.areaName || null;
    const header = `現在時刻: 約${hour}時(${greetingFor(hour)})。舞台: ${area ?? '不明(具体的な地名は出さず「この街」と呼ぶ)'}。`;

    if (plan.kind === 'opening') {
      return `${header}\nこれは番組のオープニング。挨拶し、今日は${area ?? 'この街'}のまわりのグルメや小ネタをテンポよく届けることを、わくわくする感じで紹介する。時報として今が約${hour}時であることに軽く触れてよい。`;
    }
    if (plan.kind === 'weather') {
      const w = plan.weather;
      return `${header}\n天気の話題。気温は約${Math.round(w.tempC)}度、空模様は「${w.description}」。お出かけの実用アドバイスとして「${weatherAdvice(w.tempC, w.description)}」の要点を自然に会話へ織り込む。数値はこの気温だけを使う。`;
    }
    if (plan.kind === 'weather-na') {
      return `${header}\n天気データが今回は取得できなかった。気温などの数値は一切言わず、正直かつ軽妙に「今日は取れなかった、窓の外を見てみて」といった趣旨を会話にする。`;
    }
    if (plan.kind === 'place') {
      const p = plan.place;
      const mins = walkMinutes(p.distanceM);
      const rating =
        typeof p.rating === 'number'
          ? `評価は星${p.rating.toFixed(1)}(クチコミ約${p.userRatingCount ?? 0}件)`
          : '評価情報はなし';
      const cuisine = p.cuisine ? `ジャンルは${p.cuisine}` : 'ジャンル情報はなし';
      const lines = [
        header,
        'お店・スポットの紹介。次の事実だけを使う(店名や数値の創作は禁止):',
        `- 名前: ${p.name}`,
        `- 種類: ${CATEGORY_LABEL[p.category] ?? p.category}`,
        `- 現在地からの距離: 約${p.distanceM}m(徒歩約${mins}分)`,
        `- ${rating}`,
        `- ${cuisine}`,
      ];
      if (p.summary) lines.push(`- お店の概要: ${p.summary}`);
      if (p.reviews && p.reviews.length) {
        lines.push('- 利用者の声(この雰囲気やエピソードを、自分たちが知っている風に会話へ織り込む。出典は明かさない):');
        for (const r of p.reviews) lines.push(`  ・${r}`);
      }
      lines.push(
        'このお店ならではの魅力・利用者の声を必ず会話に含める。導入 → 固有ネタの深掘り(雰囲気や評判) → 訪問のひとことアドバイスで締め、の流れで。'
      );
      return lines.join('\n');
    }
    if (plan.kind === 'trivia') {
      const readingHint = plan.trivia.reading
        ? `\n読みのヒント: 「${plan.trivia.title}」は「${plan.trivia.reading}」と読む(speechではこの読みを使うこと)。ただしこれはタイトル(場所・施設名)の読みであり、文中の人名には適用しない。人名は人名として正しい読みで書く(例:「平将門」という人名は「たいらのまさかど」)。`
        : '';
      return `${header}\nご近所の豆知識コーナー。次の事実を、意味を変えず・情報を足さずに、興味を引くように自然に紹介する。堅くならず会話で噛み砕く。\n事実:「${plan.trivia.extract}」${readingHint}`;
    }
    // filler
    return `${header}\n特定の店名や数値を出さない、ゆるいつなぎのフリートーク。今の時間帯に合った軽い話題で、リスナーに語りかける。`;
  }

  async _generateWithLLM(plan, facts) {
    const brief = this._briefFor(plan, facts);
    const avoid = this._recent.slice(-8);
    const userContent =
      `【今回の素材】\n${brief}` +
      (avoid.length ? `\n\n【直近で使った表現(なるべく被らせない)】\n${avoid.join(' / ')}` : '');

    const res = await fetch(SCRIPT_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        apiKey: this._llm.apiKey,
        model: this._llm.model,
        temperature: 0.9,
        messages: [
          { role: 'system', content: this._systemPrompt() },
          { role: 'user', content: userContent },
        ],
      }),
    });
    if (!res.ok) {
      const detail = await res.json().catch(() => ({}));
      throw new Error(`script ${res.status}: ${detail?.error ?? ''}`);
    }
    const data = await res.json();
    const parsed = JSON.parse(data.content);
    const lines = (parsed.lines || [])
      .filter((l) => l && (l.speaker === 'main' || l.speaker === 'sub') && typeof l.text === 'string' && l.text.trim())
      .map((l) => ({
        speaker: l.speaker,
        text: l.text.trim(),
        // 読み上げ用のかな表記。LLMが出し忘れた行は text をそのまま読む
        speech: typeof l.speech === 'string' && l.speech.trim() ? l.speech.trim() : undefined,
      }));
    return lines;
  }

  // --- テンプレート・フォールバック ---------------------------------------

  _templateSegment(plan, facts) {
    switch (plan.kind) {
      case 'opening':
        return this._buildOpening(facts);
      case 'weather':
        return this._buildWeather(plan.weather);
      case 'weather-na':
        return this._buildWeatherUnavailable();
      case 'place':
        return this._buildPlace(plan.place);
      case 'trivia':
        return this._buildTrivia(plan.trivia);
      default:
        return this._buildFiller();
    }
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
        { speaker: 'sub', text: `${area ? `${area}の` : ''}おいしいお店に、街の小ネタに…役立つ情報、盛りだくさんですよ！` },
        { speaker: 'main', text: `ただいまの時刻は、およそ${hour}時。それでは、さっそくまいりましょう！` },
      ],
    };
  }

  _buildWeather(w) {
    const subReact = w.description.includes('雨')
      ? pick(['うわ、雨ですか〜！', 'これは傘の出番ですね！'], this.rng)
      : pick(['お、いい感じ！', '過ごしやすそう！', '外に出たくなりますね！'], this.rng);
    return {
      id: this._id(),
      topic: 'weather',
      factGrounded: true,
      lines: [
        { speaker: 'main', text: 'さっそくですが、今の天気、見てみましょう！' },
        { speaker: 'sub', text: '待ってました、お天気！' },
        { speaker: 'main', text: `ただいまの気温はおよそ${Math.round(w.tempC)}度、空模様は「${w.description}」です。` },
        { speaker: 'sub', text: subReact },
        { speaker: 'main', text: weatherAdvice(w.tempC, w.description) },
      ],
    };
  }

  _buildWeatherUnavailable() {
    return {
      id: this._id(),
      topic: 'weather',
      factGrounded: true,
      lines: [
        { speaker: 'main', text: '続いてお天気…と思ったんですが、' },
        { speaker: 'sub', text: 'お、なんかトラブルの気配！？' },
        { speaker: 'main', text: '今日はデータが取れませんでした！ 適当は言えないので、ここは潔く。' },
        { speaker: 'sub', text: 'ということで、みなさん窓の外をチラッとどうぞ！' },
      ],
    };
  }

  _buildPlace(place) {
    const distText = place.distanceM < 1000 ? `およそ${place.distanceM}メートル` : `${(place.distanceM / 1000).toFixed(1)}キロほど`;
    const mins = walkMinutes(place.distanceM);
    const hasRating = typeof place.rating === 'number';
    const cuisineLine = place.cuisine ? `ジャンルは${place.cuisine}だそうですよ！` : 'どんなお店かは、行ってからのお楽しみです！';
    const ratingReact = hasRating
      ? `星${place.rating.toFixed(1)}！ クチコミ${place.userRatingCount ?? 0}件の人気店って、これは間違いなさそう！`
      : `${pick(AIZUCHI, this.rng)} ${cuisineLine}`;
    const INTROS = {
      lunch: ['ここでグルメの時間！評判のいいお店、いきましょう！', '近くで評判のランチスポット、見つけましたよ！'],
      cafe: ['ひと休みしたい方へ、評判のカフェ情報です！', '近くで評判の休憩スポット、見つけました！'],
      culture: ['ちょっと寄り道、人気の文化スポットのご案内です！', '近くの評判スポット、ご紹介します！'],
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
        { speaker: 'sub', text: ratingReact },
        { speaker: 'main', text: TIPS[topic] ?? TIPS.lunch },
      ],
    };
  }

  _buildTrivia(t) {
    return {
      id: this._id(),
      topic: 'trivia',
      factGrounded: true,
      lines: [
        { speaker: 'main', text: pick(['ここで、街のちょっといい話！', 'ご近所の豆知識、いってみましょう！'], this.rng) },
        { speaker: 'sub', text: pick(['待ってました、これ好きなんです！', 'おっ、気になります！'], this.rng) },
        { speaker: 'main', text: t.extract },
        { speaker: 'sub', text: `${pick(AIZUCHI, this.rng)} それは知らなかった〜！` },
        { speaker: 'main', text: 'いや〜、街って面白いですね！' },
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
