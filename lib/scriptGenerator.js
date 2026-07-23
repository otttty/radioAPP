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

// 時間帯ごとの「番組の文脈」。お便りの中身(何をしに来たか)と、つなぎトークの
// 話題を、聴いている“いま”に合わせるための定義。
const TIME_SLOTS = [
  {
    id: 'earlyMorning', from: 5, to: 8, label: '早朝',
    mail: 'モーニング、朝いちの空気、開店したてのお店、散歩やジョギングの途中、通勤前のひと息',
    talk: '朝のはじまり、目覚めの一杯、今日これからの予定、早起きした人へのねぎらい',
  },
  {
    id: 'morning', from: 8, to: 11, label: '朝',
    mail: 'モーニングセット、コーヒーとパン、朝のカフェ、出勤やおでかけ前の腹ごしらえ、朝の光が気持ちいい場所',
    talk: '朝の過ごし方、モーニング文化、今日の予定、通勤通学の風景',
  },
  {
    id: 'lunch', from: 11, to: 14, label: '昼(ランチタイム)',
    mail: 'ランチ、定食やランチセット、行列、お昼休みにサッと入れるお店、ランチ後の散歩',
    talk: 'お昼ごはん何にする、ランチの悩み、午後へのエネルギー補給',
  },
  {
    id: 'afternoon', from: 14, to: 17, label: '午後',
    mail: 'コーヒーブレイク、甘いもの、おやつ、ひと休み、買い物や散策の途中、のんびり読書',
    talk: '午後のだれる時間、おやつ休憩、ひと息つくこと、夕方までのラストスパート',
  },
  {
    id: 'evening', from: 17, to: 20, label: '夕方〜夜のはじまり',
    mail: 'ディナー、仕事帰りの一杯、夕暮れの景色、晩ごはん、家族や友達との待ち合わせ',
    talk: '今日おつかれさま、夕暮れどき、これからの晩ごはん、一日の締めくくり',
  },
  {
    id: 'night', from: 20, to: 23, label: '夜',
    mail: '夜ごはんの締め、落ち着いた夜の店、夜景や静かな景色、しっとりした時間、ちょっと一杯',
    talk: '夜のまったり時間、一日の振り返り、明日への充電、夜更かしの相棒',
  },
  {
    id: 'lateNight', from: 23, to: 5, label: '深夜',
    mail: '深夜でもやっているお店、静まりかえった街、夜遅くのひとり時間、締めの一杯や一皿',
    talk: '深夜のテンション、眠れない夜、静かな街の空気、夜更かし仲間への語りかけ',
  },
];

/** 現在時刻の時間帯定義を返す(23時〜5時の日跨ぎに対応) */
function timeSlotFor(hour) {
  return (
    TIME_SLOTS.find((s) => (s.from < s.to ? hour >= s.from && hour < s.to : hour >= s.from || hour < s.to)) ??
    TIME_SLOTS[2]
  );
}

/** 月から季節と、季節ならではの話題のヒントを返す */
function seasonFor(month) {
  if (month >= 3 && month <= 5) return { label: '春', hint: '桜や新緑、あたたかくなってきた陽気、外に出たくなる季節' };
  if (month >= 6 && month <= 8) return { label: '夏', hint: '暑さ、冷たいもの、緑の濃さ、夕立や夕涼み' };
  if (month >= 9 && month <= 11) return { label: '秋', hint: '紅葉、涼しくなる空気、食欲の秋、日が短くなること' };
  return { label: '冬', hint: '寒さ、あたたかいもの、澄んだ空気、日の短さ' };
}

/** 気温から、体感に沿った話題のヒントを返す(取得できない場合はnull) */
function tempHintFor(tempC) {
  if (typeof tempC !== 'number') return null;
  const t = Math.round(tempC);
  if (t >= 30) return `気温は約${t}度でかなり暑い。涼しい場所・冷たいもの・水分補給が自然に話題になる`;
  if (t >= 25) return `気温は約${t}度で夏らしい暑さ。冷たい飲み物や日陰、涼める場所が嬉しい`;
  if (t >= 18) return `気温は約${t}度で過ごしやすい陽気。外を歩くのが気持ちいい`;
  if (t >= 10) return `気温は約${t}度で少しひんやり。上着がほしいくらいで、あたたかい飲み物が嬉しい`;
  if (t >= 3) return `気温は約${t}度で寒い。あたたかい食べ物・飲み物、暖かい店内が恋しい`;
  return `気温は約${t}度でかなり冷え込んでいる。とにかく暖まれる場所・熱いものが嬉しい`;
}

/**
 * いまの放送の文脈(時間帯・平日/休日・季節・気温)をまとめる。
 * お便りの中身と、つなぎトークの話題づくりの両方で使う。
 * @param {import('./types.js').FactBundle} [facts]
 */
function programContext(facts) {
  const now = new Date();
  const hour = now.getHours();
  const day = now.getDay(); // 0=日曜
  const isWeekend = day === 0 || day === 6;
  const slot = timeSlotFor(hour);
  const season = seasonFor(now.getMonth() + 1);
  const tempHint = tempHintFor(facts?.weather?.tempC);
  return {
    hour,
    slot,
    isWeekend,
    dayLabel: ['日', '月', '火', '水', '木', '金', '土'][day] + '曜日',
    season,
    tempHint,
    // 平日/休日で「何をしに来ているか」の現実味を変える
    lifeHint: isWeekend
      ? '休日なので、おでかけ・レジャー・散策・趣味の時間・家族や友達との外出といった過ごし方が自然。時間にゆとりがある前提で書く。'
      : '平日なので、仕事や学校の合間・休憩・行き帰りに立ち寄る、といった過ごし方が自然。サッと寄れる/気分転換になる、といった現実的な事情がにじむとよい。',
  };
}

/**
 * いまの時間帯・曜日に「合う」スポットのカテゴリ集合。
 * トピック選定でこのカテゴリを少し優遇する(限定はしない=他も普通に出る)。
 */
function preferredCategoriesFor(ctx) {
  const set = new Set();
  switch (ctx.slot.id) {
    case 'earlyMorning':
    case 'morning':
      set.add('cafe'); set.add('lunch'); set.add('park'); // モーニング・朝さんぽ
      break;
    case 'lunch':
      set.add('lunch'); // ランチタイム
      break;
    case 'afternoon':
      set.add('cafe'); set.add('shop'); // コーヒーブレイク・買い物
      break;
    case 'evening':
    case 'night':
      set.add('lunch'); // ディナー・一杯
      break;
    case 'lateNight':
      set.add('lunch'); set.add('cafe'); // 夜食・深夜営業
      break;
  }
  if (ctx.isWeekend) {
    set.add('park'); set.add('culture'); set.add('shop'); // 休日はレジャー多め
  }
  return set;
}

// ラジオネームのプール(20個)。毎回ここからランダムに選ぶ(セッション内で
// 重複なし。出し切ったらリセット)。LLMにもこの名前をそのまま使わせる。
const RADIO_NAMES = [
  '回転寿司で酔うタイプ',
  '坂道でいつも息切れ',
  '地図アプリに逆らう男',
  'コーヒー3杯目のジャズ好き',
  '財布を家に忘れた常連',
  '深夜のプリン強盗（未遂）',
  '定食屋で優柔不断',
  '傘を置き忘れる名人',
  '餃子は飲み物',
  '昼寝の天才',
  'レシート集めがち',
  '隣の駅まで歩く派',
  'メニュー全部気になる係',
  '窓側の席しか勝たん',
  'スープまで完飲党',
  '路地裏コンパス',
  'いつも小銭が足りない',
  '食後のデザート別腹担当',
  '散歩のつもりが遠足',
  '推しは商店街',
];

const CATEGORY_LABEL = {
  lunch: 'ランチ・飲食店',
  cafe: 'カフェ',
  park: '公園・自然スポット',
  culture: '文化施設・名所',
  shop: 'お店・商業施設',
  spot: 'スポット',
};

// 飲食店以外(公園・名所など)も扱うため、カテゴリごとに「お便りで触れる観点」を変える
const CATEGORY_ANGLE = {
  lunch: '何を食べたか・味・雰囲気・接客',
  cafe: '何を飲んだ/食べたか・居心地・雰囲気',
  park: 'どんな景色や過ごし方ができるか・雰囲気・季節感',
  culture: '見どころ・展示や建物の魅力・体験した印象',
  shop: '品ぞろえ・お店の雰囲気・見つけた掘り出し物',
  spot: 'どんな場所か・見どころ・過ごし方',
};

export class ScriptGenerator {
  /**
   * @param {{mainName?: string, rng?: () => number}} [opts]
   */
  constructor(opts = {}) {
    this.mainName = opts.mainName ?? 'ボブ';
    this.rng = opts.rng ?? defaultRng();
    this._usedPlaces = new Set();
    this._openingDone = false;
    this._fillerIdx = 0;
    this._segCounter = 0;
    this._contentCount = 0; // オープニングの後に流したスポットの本数
    this._lastCategory = null; // 直前のスポットのカテゴリ(同ジャンル連続を避ける)
    this._llm = null; // { apiKey, model }
    this._recent = []; // 直近の発話(言い回しの重複回避のためLLMに渡す)
    this._usedRadioNames = []; // 使用済みラジオネーム(重複紹介を避けるための記録)
    this._usedNamePool = new Set(); // RADIO_NAMES のうちこのセッションで使用済みのもの
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
    // 位置取得中(warmup)に作ったセグメントは印を付ける。
    const warmup = !!facts.warmup;
    // transient = 実データに基づかない「つなぎ」系(位置取得中/お便り待ち)。
    // パイプラインはこれを見て先読みを1つで止め、フリートークを連続で溜め込まない
    // (=スポットが手に入り次第すぐ本編へ戻れる)。
    const transient = warmup || plan.kind === 'filler' || plan.kind === 'awaiting';

    // オープニングはLLMを待たず、決まった(テンプレの)台本を即生成する。
    // これで「番組を開始」直後の待ち時間が最小になり、この挨拶を読み上げている
    // 間に、裏でスポットのお便り(LLM生成)やトピック取得を進められる。
    if (plan.kind === 'opening') {
      const seg = this._buildOpening(facts);
      this._remember(seg.lines);
      seg.warmup = warmup;
      seg.transient = transient;
      return seg;
    }

    if (this._llm) {
      try {
        const lines = await this._generateWithLLM(plan, facts);
        if (Array.isArray(lines) && lines.length >= 2) {
          this._remember(lines);
          // place はUI側の地図表示(お便りのスポット位置)に使う
          return {
            id: this._id(),
            topic: plan.topic,
            factGrounded: plan.factGrounded,
            lines,
            warmup,
            transient,
            place: plan.place ?? null,
          };
        }
      } catch (e) {
        console.warn('[scriptGenerator] LLM生成に失敗、テンプレートで継続:', e);
      }
    }

    const seg = this._templateSegment(plan, facts);
    this._remember(seg.lines);
    seg.warmup = warmup;
    seg.transient = transient;
    seg.place = plan.place ?? null;
    return seg;
  }

  // --- ネタ選定(決定的) ---------------------------------------------------

  /** 次に扱うトピックと、その素材(お店/豆知識)を1つ決める */
  _planSegment(facts) {
    if (!this._openingDone) {
      this._openingDone = true;
      return { kind: 'opening', topic: 'opening', factGrounded: true };
    }

    // リスナー(ユーザー)が投稿したお便りが届いていれば最優先で読む。
    // 位置情報の取得を待たずに読めるので warmup より前に判定する。
    const userMail = facts.takeUserMail?.();
    if (userMail) {
      return { kind: 'userMail', topic: 'mail', factGrounded: true, userMail };
    }

    // 位置情報の取得中(warmup)は、周辺データがまだ無いのでボブのフリートークで
    // つなぐ。位置が確定するまでお店の紹介には進まない。
    if (facts.warmup) {
      return { kind: 'filler', topic: 'filler', factGrounded: false };
    }

    // トピックはGoogle Placesのスポット(レビュー付き)のみ。近い/穴場度の高い順に
    // 未紹介のスポットを1つ選ぶ。
    const place = this._pickPlace(facts);
    if (place) {
      this._contentCount += 1;
      return { kind: 'place', topic: place.category, factGrounded: true, place };
    }
    // スポットが1件も取れない/出し切った場合は、汎用のフリートークではなく
    // 「お便り待ち(募集中)」の台本にする。
    return { kind: 'awaiting', topic: 'filler', factGrounded: false };
  }

  // 次に紹介するスポットを1つ選ぶ。固定順ではなくスコア+乱数で選ぶことで、
  // 同じ場所で聴いても毎回違う順番・組み合わせになる。あわせて
  // (1) 直前と同じカテゴリ(飲食店連続など)をできるだけ避け、
  // (2) いまの時間帯・曜日に合うカテゴリ(昼→ランチ、午後→カフェ、休日→公園/名所等)を優遇する。
  _pickPlace(facts) {
    const unused = (facts.places || []).filter((p) => !this._usedPlaces.has(p.name));
    if (unused.length === 0) return null;
    const ctx = programContext(facts);
    const preferred = preferredCategoriesFor(ctx);
    const scored = unused.map((p, i) => {
      let s = -i * 0.2; // 元の並び(穴場度順)をごくゆるく尊重
      if (p.category !== this._lastCategory) s += 2.2; // 同カテゴリの連続を避ける
      if (preferred.has(p.category)) s += 1.2; // 時間帯・曜日に合うカテゴリを優遇
      s += this.rng() * 6; // 強めのランダム性: プール全体(40件)から広く選ばれる
      return { p, s };
    });
    scored.sort((a, b) => b.s - a.s);
    const candidate = scored[0].p;
    this._usedPlaces.add(candidate.name);
    this._lastCategory = candidate.category;
    return candidate;
  }

  /**
   * 評価とクチコミ数から、スポットの「立ち位置」を一言で表す。
   * ボブの締めコメントを毎回変える手がかりにする(穴場/超人気/ふつう)。
   * @param {import('./types.js').PlaceFact} p
   */
  _placeStanding(p) {
    const rating = typeof p.rating === 'number' ? p.rating : null;
    const n = p.userRatingCount ?? 0;
    if (rating == null) {
      return '評価データは少なめ。穴場かどうかは断定せず、お便りに出てきた中身そのものに触れて締める。';
    }
    if (n >= 3000) {
      return `みんな大好きな超人気スポット(クチコミ約${n}件・星${rating.toFixed(1)})。「もう有名だよね」「行列の定番」的に、その人気ぶり・定番感に触れて締めるとよい。`;
    }
    if (rating >= 4.3 && n <= 500) {
      return `知る人ぞ知る穴場・隠れた名所(星${rating.toFixed(1)}と高評価なのにクチコミ約${n}件と控えめ)。「あまり知られてないけど最高」という特別感・お得感を出して締めるとよい。`;
    }
    if (rating >= 4.0) {
      return `評判のいい良店(星${rating.toFixed(1)}・クチコミ約${n}件)。人気/穴場と決めつけず、お便りの具体的な中身に触れて自然に勧めて締める。`;
    }
    return `評価は星${rating.toFixed(1)}(クチコミ約${n}件)とほどほど。星の数は無理に持ち上げず、お便りに出てきた良かった点・雰囲気に寄り添って締める。`;
  }

  /**
   * その回の「締め(最後のmain)」のスタイルを1つだけランダムに選び、具体指示にする。
   * 毎回この方針を1つに固定することで、星/件数/徒歩を機械的に並べる単調な締めを断つ。
   * @param {import('./types.js').PlaceFact} p
   */
  _closingDirective(p) {
    const rating = typeof p.rating === 'number' ? p.rating : null;
    const n = p.userRatingCount ?? 0;
    const hour = new Date().getHours();
    const isGem = rating != null && rating >= 4.3 && n <= 500;
    const isPopular = n >= 3000;

    // 締めの主役は「お便りの中身への反応=誉める/共感する」。これを厚めに用意して
    // ほとんどの回でここから選ぶ。数値(星・件数・徒歩)の列挙は全パターンで禁止。
    const content = [
      'お便りに出てきた“いちばんおいしそう/魅力的な一点”を名指しで取り上げ、「うわ、それ絶対うまいやつ」「いいなあ、オレも今すぐ食べたい」と本気でうらやましがって誉める。',
      '送り主の感じたことに共感して、「わかるわあ、そういう空気の店って落ち着くんだよね」「その気持ち、めっちゃわかる」と寄り添って締める。',
      'お便りの描写から情景を想像して、「話聞いてるだけで行きたくなったよ」「なんかいいなあ、その感じ」としみじみ味わって締める。',
      '送り主のセンスや発見を「それは通だねえ」「よく見つけたね、えらい」と持ち上げつつ、軽く笑いも混ぜて締める。',
      'お便りの中の具体的な一言やエピソードに乗っかって、「たしかに!」「そこ大事だよね」と相づち気味に反応して締める。',
      'お便りを読んで自分もそこに行った気になり、「これはリスナーにも味わってほしいなあ」と、体験の良さそのものを推して締める。',
    ];
    // 味変え用(たまに)。中身への反応をベースにしつつ、下の要素を“1つだけ”そっと足す。
    const flavor = [
      'そのうえで最後に、リスナー全体へ「これ好きな人、絶対いるでしょ。ぜひ寄ってみて」と軽く呼びかけて締める。',
      `そのうえで、いま約${hour}時という時間帯・シーンに軽く絡めて「この時間にちょうどいいね」的にさらっと誘って締める。`,
      'そのうえで、ごく短く余韻を残す一言(「うん、いい店だ」など)でスッと締める。',
    ];
    if (isGem) flavor.push('そのうえで「知る人ぞ知る穴場って感じだね」と、あまり知られてない特別感を雰囲気で一言添えて締める(件数などの数字は言わない)。');
    if (isPopular) flavor.push('そのうえで「まあ、みんな知ってる定番だもんね」と、人気・定番ぶりを雰囲気で一言添えて締める(星などの数字は言わない)。');

    // 数字入りの締め(数回に1回・約30%)。中身への反応を主役にしつつ、
    // 実データの数値を“1つだけ”自然に織り込む(徒歩分 or クチコミ件数/星)。
    const mins = walkMinutes(p.distanceM);
    const statChoices = [`徒歩でだいたい${mins}分くらい、というアクセスの良さ`];
    if (rating != null && n > 0) {
      statChoices.push(`クチコミが約${n}件ついている、という反響の大きさ`);
      statChoices.push(`星${rating.toFixed(1)}という評価の高さ`);
    }
    const useStat = this.rng() < 0.3;

    let chosen;
    if (useStat) {
      const stat = pick(statChoices, this.rng);
      chosen =
        `${pick(content, this.rng)} そのうえで、締めのどこかに「${stat}」を“1つだけ”さりげなく織り込む` +
        '(例:「歩いてすぐだから寄ってみて」「クチコミもかなりの数ついてる人気店なんだよね」など、会話の流れで自然に)。数字は多くても1種類だけ。羅列はしない。';
    } else if (this.rng() < 0.75) {
      chosen = pick(content, this.rng);
    } else {
      chosen = `${pick(content, this.rng)}${pick(flavor, this.rng)}`;
    }

    const numberRule = useStat
      ? ' 数値は上で指定した1種類だけOK。それ以外の数値(星・件数・徒歩を全部並べる等)は入れない。'
      : ' ★この回は数値を入れない。「星◯、クチコミ◯件、徒歩◯分」のような数字は1つも出さず、お便りの中身への反応で締める。';

    return (
      '【今回の締め方(この方針で締める)】' +
      chosen +
      ' 締めは2〜4文かけてしっかり語ること。お便りに出てきた具体的なディテール(頼んだ料理・見た景色・起きた出来事など)を最低1つ、そのまま名指しで拾い、それについての自分の感想・リアクションを一言以上述べる。ひとことで流す薄い締め(「いいですね、ぜひ」だけ等)はNG。' +
      numberRule +
      '「〇〇さん、ありがとう」は付けても付けなくてもよいが、直近の回と同じ言い回し・同じ型にはしない。'
    );
  }

  /** その回で、お便りの途中に短い相槌を入れるかどうかをランダムに指示する。 */
  _reactionDirective() {
    if (this.rng() < 0.6) {
      return '【今回の相槌】お便り本文(sub)の区切りに、直前の内容へ反応する短い相槌の main を1回だけ入れる(例:「あ〜、それいいなあ」「へえ、うまそう」)。連続では入れない。毎回ちがう言葉で。';
    }
    return '【今回の相槌】今回は途中の相槌は入れず、最後まで一気に読んでから締める。';
  }

  // --- LLM生成 -------------------------------------------------------------

  _remember(lines) {
    for (const l of lines) this._recent.push(l.text);
    if (this._recent.length > 20) this._recent = this._recent.slice(-20);
  }

  _systemPrompt() {
    return [
      `あなたは日本のノリノリなラジオ番組「${PROGRAM_NAME}」の放送作家です。1人のパーソナリティがリスナーからのお便り(ラジオメール)を紹介しながら進める番組の台本を書きます。`,
      '',
      '【パーソナリティ: ボブ】(speaker="main") ※番組のホストは1人だけ',
      '- 明るく気さくで、テンポよく話す音楽好きのDJ。ノリはいいが、うるさすぎない大人の余裕もある。一人称は「オレ」。',
      '- 口調は「タメ口」と「ですます調」を自然に混ぜる。フランクな地の文の中に、ていねいな一言がふっと混じる感じ(例:「お、これいいね。ぜひ行ってみてください」)。堅苦しくならず、でも品よく。',
      '- 決め台詞・口癖(「ファンキー」「グルーヴィー」「〜ってわけ!」「〜じゃんか」「イエーイ」「ウォウウォウ」「ファンキーな仲間たち」など)は"封印はしないが控えめに"。1トピックにつき多くて1回程度。毎回は使わず、無い回もあってよい。多用して寒くならないように。',
      '- リスナーへの呼びかけは「みんな」「そこのあなた」など自然に。テンションで押し切らず、内容の面白さで聴かせる。',
      '',
      '【お便り(ラジオメール)】(speaker="sub" = お便り本文。これもボブが声に出して読み上げる)',
      '- この番組は、リスナーから届いたお便りをボブが読み上げて進める形式。sub の行は「お便り本文」で、ボブがそれを朗読している想定。別人ではない。',
      '- お便りの送り主は「いままさにその場所(お店・スポット)にいて、その場から」メールを送っている設定。一人称・現在進行形の実況として、臨場感たっぷりに書く。目の前の光景・音・匂い・味・空気感・いま起きていること(例:「まさに今、焼きたてが運ばれてきました」「窓の外は夕暮れで」)を、その瞬間を中継しているように描写して、聴いている人がその場にいる気分になるようにする。',
      '- お便りの文体は「ですます調」を基本にする。ときどきタメ口や砕けた一言、感嘆(例:「うわ、これマジで最高です!」「わー、すごい」)が混じるのはOK。堅すぎず、親しみと熱のある感じ。「ボブさん」への呼びかけを入れてよい。',
      '- ★重要(お便りは1人の人間が書いた1通):素材の「利用者の声」は複数人のレビューだが、それをそのまま継ぎはぎしてはいけない。あくまで参考メモとして受け取り、「その日に実際に訪れた1人の人物」の一貫した体験談・一筆の手紙に溶かし込む。視点・語り口・来店理由・好みを最後まで同じ人物でそろえる。複数レビューの断片を箇条書き的に並べたり、矛盾する体験(1人なのに何回も来ている/別々の料理を全部食べた等)を詰め込まない。使うのは素材の中の「その人が体験しそうな範囲」だけでよく、全部盛り込む必要はない。',
      '- お便りの内容は深掘りして詳しく、でも自然に。具体的なディテール(何を頼んだ・どんな味や雰囲気だった・どこが良かった・どんな人におすすめ 等)を、1人の実体験として無理なくつなぐ。一般論で終わらせない。',
      '- 本文は2〜3ブロックに分け、それぞれ別の sub 行にする(段落の区切り)。ブロック間も同じ人物の話の流れとして自然につながるようにする。',
      '- ボブは楽しそうに読む。お便りの区切り(sub と sub の間)で、短い相槌・感嘆・手短な返答を main の1行として挟んでよい(例:「あ〜、それいいですね〜」「へえ、最高じゃん」「うわ、それは気になる」「わかるわかる」「いいね、グルーヴィー」)。※1通につき1〜2回まで。連続で(sub を挟まず main を2回続けて)は入れない。毎回同じ言葉は使わず、その直前のお便りの中身に合った短い反応にする。挟みすぎて読み上げが細切れにならないよう、あくまで軽く。導入(1)と締め(5)の main にも、感嘆詞やノリのいい一言を自然に効かせて、全体を楽しい雰囲気にする。',
      '- 送り主のラジオネームは、素材で「今回のラジオネーム」として指定された名前を一字一句そのまま使う(変えない・ひねり直さない)。指定が無い場合のみオリジナルで面白い名前を考える。',
      '',
      '【1トピックの構成】(お便りの回)',
      '1. main: 導入。話題をチラ見せし、「ラジオネーム『〇〇』さんからのお便り!」と送り主を紹介して「読んでみるぜ」的に振る。',
      '2. sub: お便り本文(前半。状況や第一印象を詳しく)。',
      '3. sub: お便り本文(中盤。具体的なディテールを深掘り)。',
      '4. sub: お便り本文(後半。おすすめポイントや締め)。※内容が短ければ2ブロックでもよい。',
      '5. main: 読み終わったボブの締めコメント。締めの主役は「そのお便りの中身への感情の乗った反応」= 送り主が語った料理・景色・エピソードを名指しで受けて、うらやましがる・本気で誉める・共感する・行きたくなる・軽く笑う、のいずれか。2〜4文かけてしっかり語り、お便りの具体的なディテールを最低1つ引用して、それへの自分の感想をちゃんと述べる(薄い一言で流さない)。「〇〇さん、ありがとう!」は添えても添えなくてもよい。',
      '   数値(星◯・クチコミ◯件・徒歩◯分)は毎回律儀に並べない。基本は数字ゼロで中身の反応で締め、各回に付く『今回の締め方』の指示で許可された回だけ、指定された数値を“1種類だけ”自然に織り込む。数字の羅列は禁止。',
      '   ★毎回まったく違う締めにする。前回と同じ語り出し・同じ型・同じ長さにしない。何より「レビュー内容を誉める流れ・共感する流れ」を毎回ちがう切り口で入れること。各回に付く『今回の締め方』の指示に必ず従う。',
      '- 2〜4の sub(お便り本文)の合間には、前述の短い相槌・感嘆を1〜2回まで入れてよい(ただし sub を挟まず main を連続はしない)。それ以外はボブは黙って読む。main がしっかり入るのは導入(1)と締め(5)。',
      '- 素材に「お便りは使わない」とある場合は、全行 main のボブひとりのトークにする。',
      '- 素材が「リスナーから“いま実際に届いた”お便りの回」の場合は、上の1〜5の構成ではなく素材に書かれた作り方に従う。お便り本文は創作せず、渡された文章をそのまま読み上げ、その内容に具体的に答えることを最優先にする。',
      '',
      '【マンネリ禁止】',
      '- 同じジャンルのトピックでも、同じ言い回し・同じ構成・同じ相槌を使わない。導入・相槌・締めを毎回変える。ラジオネームも毎回まったく違う系統の名前にする。',
      '',
      '【厳守事項】',
      '- 素材に書かれた事実(店名・数値・地名・豆知識・レビューの内容)だけを使う。素材に無い固有名詞・数値・エピソードを創作しない。お便りの体験談も素材のレビュー・概要の範囲で書く。',
      '- そのトピックならではの固有の情報・魅力を必ずお便りに含める(どのお店にも当てはまる一般論だけで終わらせない)。素材にレビューや概要があれば、その雰囲気・評判・体験を送り主自身の言葉として織り込む。',
      '- 参照元はいちいち言わない。「レビューによると」「データでは」などの出典言及は禁止。送り主自身の体験・ボブ自身の知識として自然に語る。',
      '- 話し言葉で。お便り本文(sub)はやや長め・詳しめでよいが、ボブの相槌(main)は短く。全体で8〜10行程度。各行は必ず main か sub。',
      '- 音声合成で読み上げる前提。読み間違いや不自然さを避けるため、記号(「&」「*」「#」など)や過度な「！」の連打は使わない。「最&高」ではなく「最高」と書く。長音は「〜」ではなく通常の伸ばし方(例:「だよー」)で書く。',
      '- 「…」(三点リーダー)は読み上げが不自然に止まる原因になるため使わない。間を演出したい場合は「、」か文の区切りで表現する。各セリフは必ず「。」「！」「？」のいずれかで終える(言いさしで終わらせない)。',
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
      '出力は次のJSONのみ: {"radioName":"送り主のラジオネーム(お便りを使わない回はnull)","lines":[{"speaker":"main"|"sub","text":"...","speech":"..."}]}',
    ].join('\n');
  }

  /**
   * programContext を、LLMに渡す「いまの空気感」ブロックに整形する。
   * お便りのシチュエーションとつなぎトークの話題を“いま”に合わせるための素材。
   */
  _contextBlock(ctx) {
    const lines = [
      '【いまの空気感(お便り・トークはこの“いま”に合わせる)】',
      `- 時間帯: ${ctx.slot.label}。お便りのシチュエーション例: ${ctx.slot.mail}`,
      `- トーク話題の例: ${ctx.slot.talk}`,
      `- ${ctx.lifeHint}`,
      `- 季節: ${ctx.season.label}(${ctx.season.hint})`,
    ];
    if (ctx.tempHint) lines.push(`- ${ctx.tempHint}`);
    lines.push(
      '- 上記はあくまで例。毎回同じ言い回しにせず、自然に1〜2要素だけ織り込む。実際の季節・天気・気温と矛盾する描写(夏なのに紅葉、晴れなのに雨宿り等)は絶対にしない。'
    );
    return lines.join('\n');
  }

  /** planと事実から、LLMへ渡す「素材」説明文を作る */
  _briefFor(plan, facts) {
    const ctx = programContext(facts);
    const hour = ctx.hour;
    const area = facts.location?.areaName || null;
    const header =
      `現在時刻: 約${hour}時(${greetingFor(hour)})・${ctx.dayLabel}(${ctx.isWeekend ? '休日' : '平日'})・${ctx.season.label}。` +
      `舞台: ${area ?? '不明(具体的な地名は出さず「この街」と呼ぶ)'}。\n` +
      this._contextBlock(ctx);

    if (plan.kind === 'opening') {
      return `${header}\nこれは番組のオープニング(お便りは使わない。全行ボブひとりのトーク)。挨拶し、今日は${area ?? 'この街'}のまわりのお店や公園、名所などのスポットを、そこを訪れたリスナーからのお便りと一緒に届けていくことを、わくわくする感じで紹介する。時報として今が約${hour}時であることに軽く触れてよい。上の「いまの空気感」に合った、この時間帯・季節ならではの一言を必ず入れる。`;
    }
    // リスナーが実際に投稿してきたお便りの回。素材は「投稿された本文」そのもの。
    if (plan.kind === 'userMail') {
      const m = plan.userMail;
      const name = m.radioName || this._nextRadioName();
      return [
        header,
        'リスナーから“いま実際に届いた”お便りの回。下のお便り本文を、ボブが番組で読み上げて、その内容にきちんと答える。',
        `- ラジオネーム: 「${name}」(この名前をそのまま使う)`,
        '- お便り本文(★これは実際に送られてきた文章。内容を勝手に作り替えない。要点は省略せず読み上げる):',
        `  「${m.body}」`,
        '',
        '【この回の作り方】',
        '1. main: 「お便りが届いてます!ラジオネーム『' + name + '』さんから」と紹介して読み上げに入る。',
        '2. sub: お便り本文を読み上げる(長ければ2〜3ブロックに分けてよいが、内容は変えない。誤字は自然に直して読んでよい)。',
        '3. main: ★ここが最重要。お便りの中身に“ちゃんと答える”。質問されていれば答える、感想や報告なら受け止めて共感し、具体的に反応する。一般論でごまかさず、書かれている固有の内容に触れること。3〜5文かけてしっかり返す。',
        '- 送り主はいまこの番組を聴いているリスナー本人。「聴いてくれてありがとう」的な距離感で、あたたかく返す。',
        '- 事実を知らないことを聞かれたら、知ったかぶりせず正直に「オレも詳しくないんだけど」と前置きして、感想や視点を返す。周辺スポットの創作(存在しない店名など)は禁止。',
        '- 上の「いまの空気感」も踏まえて、時間帯や季節に合った一言を自然に添えてよい。',
      ].join('\n');
    }
    if (plan.kind === 'place') {
      const p = plan.place;
      const mins = walkMinutes(p.distanceM);
      const kind = CATEGORY_LABEL[p.category] ?? 'スポット';
      const angle = CATEGORY_ANGLE[p.category] ?? CATEGORY_ANGLE.spot;
      const lines = [
        header,
        `スポットの回。この素材から「いまこの場所(${kind})にいるリスナーからのお便り」を1通作り、ボブが紹介する。飲食店とは限らず、公園・名所・建物などもある。名前や数値の創作は禁止:`,
        `- 名前: ${p.name}`,
        `- 種類: ${kind}`,
        `- 今回のラジオネーム: 「${this._nextRadioName()}」(このラジオネームを一字一句そのまま使う)`,
      ];
      if (p.cuisine) lines.push(`- ジャンル/分類: ${p.cuisine}`);
      if (p.summary) lines.push(`- 概要: ${p.summary}`);

      // お便りを「1人の体験」に寄せるため、複数レビューから“軸”を1件だけ選ぶ。
      // 残りは雰囲気の裏取り程度(無理に盛り込まない)として渡す。
      const reviews = (p.reviews || []).filter(Boolean);
      if (reviews.length) {
        const axisIdx = Math.floor(this.rng() * reviews.length);
        lines.push('- この人の体験の“軸”(★お便りはこの1件をベースに、1人が書いた1通の体験談として書く。ここに無い固有の出来事は創作しない):');
        lines.push(`  ・${reviews[axisIdx]}`);
        const others = reviews.filter((_, i) => i !== axisIdx);
        if (others.length) {
          lines.push('- 参考(このお店の雰囲気の裏取り程度。全部は使わない。軸の体験と矛盾する話や、1人では不自然な話は入れない):');
          for (const r of others) lines.push(`  ・${r}`);
        }
      }

      lines.push(
        `お便りには、この場所ならではの具体的な魅力・体験(${angle}など)を、上の“軸”を土台に、1人の実体験としてふくらませて書く。飲食店でなければ「何を食べた」ではなく、その場所に合った体験を書く。`
      );
      lines.push(
        '★送り主の設定(なぜ・何をしにいまこの場所へ来たか)は、冒頭の「いまの空気感」に合わせること。時間帯のシチュエーション例と平日/休日の過ごし方を踏まえ、この場所の種類と自然に噛み合う理由にする(例: 平日昼なら仕事の合間のランチ、休日午後なら散策がてら、朝ならモーニング等)。季節や気温の体感も一言にじませる。'
      );

      // 数値(星・クチコミ数・距離)は“主素材ではない参考データ”として最後に小さく置く。
      // ふだんは口に出さず、締めの選択肢の一部(下の指示)でだけ、たまに使う。
      const standing = this._placeStanding(p);
      const ref = [];
      if (typeof p.rating === 'number') ref.push(`星${p.rating.toFixed(1)}・クチコミ約${p.userRatingCount ?? 0}件`);
      ref.push(`徒歩約${mins}分(約${p.distanceM}m)`);
      lines.push(
        `- 参考データ(★番組では基本しゃべらない。特に締めで「星◯、クチコミ◯件、徒歩◯分」と数字を並べるのは禁止。下の締め指示で許可された時だけ、1つだけ雰囲気で使う): ${ref.join(' / ')}`
      );
      lines.push(`- 立ち位置の感触(締めで触れてよい回のみ使う): ${standing}`);

      // その回だけの具体的な指示(相槌の有無・締め方)を注入して、毎回はっきり変える。
      lines.push(this._reactionDirective());
      lines.push(this._closingDirective(p));
      return lines.join('\n');
    }
    // お便り待ち(スポットが取れない/出し切った)
    if (plan.kind === 'awaiting') {
      return `${header}\nいまこの街の周辺スポットのお便りネタが手元に無い状態(近くに紹介できる場所が見つからない、または今ある分を読み切った)。次のお便りが届くまでの「お便り待ち」のトーク(全行ボブひとりのトーク、お便りは読まない)。「近くのお店・公園・名所からのお便り、大募集中!」という感じで、お便りを明るく待っている旨を伝える。あわせて、冒頭の「いまの空気感」のトーク話題の例・季節・気温から1つ選んで、この時間らしい雑談をひとこと混ぜる。「少し歩いてみると新しいネタが届くかも」とリスナーに促してもよい。特定の店名・数値・地名は出さない。マンネリ回避のため毎回言い回しを変える。3〜4行程度。`;
    }
    // filler / warmup(位置情報の取得中)
    if (facts.warmup) {
      return `${header}\nこれは番組の冒頭、リスナーの現在地を確認している「間つなぎ」のフリートーク(お便りは使わない。全行ボブひとりのトーク)。場所が分かり次第、近くのスポットのお便りに入る予定。今は場所を確かめている最中なので、その待ち時間を、冒頭の「いまの空気感」(時間帯のトーク話題・平日/休日の過ごし方・季節・気温)に合った軽い雑談で楽しくつなぐ。特定の店名・数値・地名は出さない。3〜4行程度。`;
    }
    return `${header}\n特定の店名や数値を出さない、ゆるいつなぎのフリートーク(お便りは使わない。全行ボブひとりのトーク)。冒頭の「いまの空気感」のトーク話題の例・季節・気温から話題を選び、この時間らしい雑談としてリスナーに語りかける。`;
  }

  async _generateWithLLM(plan, facts) {
    const brief = this._briefFor(plan, facts);
    const avoid = this._recent.slice(-8);
    // ラジオネームは素材内で毎回指定する(プールからランダム選択)ため、
    // 使用済みリストは送らない。
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
    if (data.finishReason === 'length') {
      // max_tokens に達して途中で切れている。JSONも壊れているため原因を明示する。
      throw new Error('LLM応答がmax_tokensで切り詰められました(finish_reason=length)');
    }
    const parsed = JSON.parse(data.content);
    if (typeof parsed.radioName === 'string' && parsed.radioName.trim()) {
      this._usedRadioNames.push(parsed.radioName.trim());
      if (this._usedRadioNames.length > 40) this._usedRadioNames = this._usedRadioNames.slice(-40);
    }
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
      case 'place':
        return this._buildPlace(plan.place);
      case 'userMail':
        return this._buildUserMail(plan.userMail);
      case 'awaiting':
        return this._buildAwaiting();
      default:
        return this._buildFiller();
    }
  }

  /**
   * RADIO_NAMES からランダムに1つ選ぶ。セッション内では重複させず、
   * 20個を出し切ったらリセットしてまた全体から選ぶ。
   */
  _nextRadioName() {
    let unused = RADIO_NAMES.filter((n) => !this._usedNamePool.has(n));
    if (unused.length === 0) {
      this._usedNamePool.clear();
      unused = RADIO_NAMES.slice();
    }
    const name = unused[Math.floor(this.rng() * unused.length)];
    this._usedNamePool.add(name);
    this._usedRadioNames.push(name);
    return name;
  }

  _buildOpening(facts) {
    const hour = new Date().getHours();
    const greet = greetingFor(hour);
    const area = facts.location.areaName || null;
    const where = area ? `${area}のまわり` : 'あなたの街のまわり';
    // 起動を速くするための固定台本だが、毎回まったく同じにならないよう
    // 数パターンから選ぶ(挨拶・つかみ・締めを少しずつ変える)。
    const opener = pick(
      [
        `${greet}!「${PROGRAM_NAME}」の時間がやってまいりました。お相手はオレ、${this.mainName}です。`,
        `はい${greet}ー!「${PROGRAM_NAME}」、始まりますよー。DJのオレ、${this.mainName}がお届けします。`,
        `${greet}。ラジオのお時間です、「${PROGRAM_NAME}」。パーソナリティはオレ、${this.mainName}!`,
      ],
      this.rng
    );
    const pitch = pick(
      [
        `この番組はね、${where}のお店や公園、名所を、そこを訪れたリスナーのお便りと一緒に紹介していく番組です。`,
        `${where}の、ちょっといいスポットを、実際に行った人のお便りでめぐっていきますよ。`,
        `きょうも${where}から届くお便りを頼りに、街の素敵な場所をゆるっと旅していきましょう。`,
      ],
      this.rng
    );
    const bridge = pick(
      [
        `時刻はちょうど${hour}時くらい。さあ、さっそくいってみましょう!`,
        `いま${hour}時ごろですかね。それじゃ、最初のお便り、いってみましょう!`,
        `${hour}時台、いい時間です。さて、どんなお便りが届いてるかな。`,
      ],
      this.rng
    );
    return {
      id: this._id(),
      topic: 'opening',
      factGrounded: true,
      lines: [
        { speaker: 'main', text: opener },
        { speaker: 'main', text: pitch },
        { speaker: 'main', text: bridge },
      ],
    };
  }

  _buildPlace(place) {
    const hasRating = typeof place.rating === 'number';
    const n = place.userRatingCount ?? 0;
    const name = this._nextRadioName();
    const mailFirst = `ボブさん、こんにちは。いま「${place.name}」に来ています。`;
    const mailSecond = place.summary
      ? `${place.summary} 評判どおりで、来てよかったです。`
      : (place.cuisine ? `${place.cuisine}で、雰囲気もよくて居心地がいいです。` : '雰囲気もよくて、来てよかったです。');
    const mailThird = place.reviews && place.reviews.length
      ? `${place.reviews[0]} これはまた来たくなりますね。`
      : 'また絶対に来ようと思います。';
    // 締めは「レビュー内容への反応・共感・誉め」を主役にし、数値(星/件数/徒歩)は並べない。
    // 毎回ちがう反応になるよう複数から選ぶ。立ち位置がはっきりした回だけ雰囲気で一言添える。
    const closings = [
      `${name}さん、ありがとう!いやー、「${place.name}」、話を聞いてるだけでこっちまで行きたくなっちゃいましたよ。現地の空気がそのまま届くお便りでした。`,
      `うわー、いいなあ。${name}さん、最高のお便りありがとう!「${place.name}」のその楽しそうな感じ、文面からあふれてました。オレも今すぐ寄りたいくらいです。`,
      `${name}さん、ありがとう。「${place.name}」でのその時間、なんか目に浮かびましたよ。こういういい場所に出会えるの、ほんと羨ましいなあ。`,
      `なるほどねえ、「${place.name}」かあ。${name}さんのワクワクがしっかり伝わってきました。読んでるこっちまで嬉しくなるお便り、ありがとう!`,
      `${name}さん、ありがとう!その感じ、めっちゃわかります。「${place.name}」みたいな場所でのんびりする時間って、何にも代えがたいんですよねえ。`,
      `はー、いい話だ。「${place.name}」、じわっと来ました。${name}さん、素敵なお便りありがとうございました。`,
    ];
    if (hasRating && n >= 3000) {
      closings.push(`${name}さん、ありがとう!「${place.name}」、もうみんな知ってる定番だけど、こうして生の声を聞くとやっぱりいいものはいいですねえ。`);
    }
    if (hasRating && place.rating >= 4.3 && n <= 500) {
      closings.push(`${name}さん、ありがとう!「${place.name}」、これは知る人ぞ知る穴場だなあ。いい場所教えてくれて感謝です。`);
    }
    // 数回に1回は、数値(徒歩分 or クチコミ件数)をさりげなく織り込む締めも候補に。
    const mins = walkMinutes(place.distanceM);
    const statClosings = [
      `${name}さん、ありがとう!「${place.name}」のその感じ、すごく伝わってきました。ここ、歩いてだいたい${mins}分くらいだから、気になった人はふらっと寄ってみて。`,
    ];
    if (hasRating && n > 0) {
      statClosings.push(`${name}さん、ありがとう!いやー行きたくなるお便りだ。「${place.name}」、クチコミも約${n}件ついてる評判の場所なんですよね。納得です。`);
    }
    // 30%くらいで数値入りの締めを使う
    const pool = this.rng() < 0.3 ? statClosings : closings;
    const closing = pick(pool, this.rng);
    return {
      id: this._id(),
      topic: place.category,
      factGrounded: true,
      lines: [
        { speaker: 'main', text: `さて、お便りいきましょう。ラジオネーム「${name}」さんから。読んでみますね。` },
        { speaker: 'sub', text: mailFirst },
        { speaker: 'sub', text: mailSecond },
        { speaker: 'sub', text: mailThird },
        { speaker: 'main', text: closing },
      ],
    };
  }

  /**
   * リスナー投稿のお便りをそのまま読み上げる台本(LLM不使用時のフォールバック)。
   * 中身に踏み込んだ返答はLLMが担当するので、ここは受け止めて感謝する形にとどめる。
   */
  _buildUserMail(mail) {
    const name = mail.radioName || this._nextRadioName();
    return {
      id: this._id(),
      topic: 'mail',
      factGrounded: true,
      lines: [
        { speaker: 'main', text: `お、お便りが届いてます!ラジオネーム「${name}」さんから。さっそく読んでみますね。` },
        { speaker: 'sub', text: mail.body },
        { speaker: 'main', text: `${name}さん、お便りありがとう!聴きながら送ってくれたんですね、うれしいなあ。しっかり受け取りました。またいつでも送ってください。` },
      ],
    };
  }

  /** お便り待ち(スポットが取れない/出し切った)ときの台本。募集中の旨を伝える。 */
  _buildAwaiting() {
    const variants = [
      [
        { speaker: 'main', text: 'さて、いまこのあたりのお便りネタ、ちょうど手が空いちゃいました。' },
        { speaker: 'main', text: 'というわけで、ただいま新しいお便りを大募集中です。近くのお店や公園、名所からのメール、待ってますよ。' },
        { speaker: 'main', text: 'ちょっと歩けば、また新しいネタが届くはず。BGMでも聴きながら、ゆるっと待っててくださいね。' },
      ],
      [
        { speaker: 'main', text: 'おっと、いまお便りが一段落。次のメールが届くまで、ちょっとひと息つきましょう。' },
        { speaker: 'main', text: 'いまいる場所のまわりから、「ここ良かったよ」ってお便り、いつでも大歓迎です。募集中!' },
        { speaker: 'main', text: '少し場所を変えると、また新しい街の話題が入ってくるかも。楽しみに待っててください。' },
      ],
    ];
    const lines = pick(variants, this.rng);
    return { id: this._id(), topic: 'filler', factGrounded: false, lines };
  }

  _buildFiller() {
    const fillers = [
      [
        { speaker: 'main', text: 'さて、このあたりのネタは一旦ぜんぶ出しちゃいましたね。' },
        { speaker: 'main', text: 'ちょっと歩けば、また新しいお便りネタが拾えるはず。水分補給しつつ、ゆるっといきましょう。' },
      ],
      [
        { speaker: 'main', text: 'ところでみんな、今なにしてます？' },
        { speaker: 'main', text: '歩いてる人も、休憩中の人も、どんな時間でもゆるっと付き合ってくださいね。' },
      ],
      [
        { speaker: 'main', text: 'ちょっとBGMに身をまかせる時間、こういうのもいいですよね。' },
        { speaker: 'main', text: '場所が変わったら、また新しい街の話題を拾ってきます。お楽しみに。' },
      ],
      [
        { speaker: 'main', text: 'いやー、こうしてマイクの前で喋ってると、あっという間に時間が過ぎますね。' },
        { speaker: 'main', text: 'さて、この街のいいお店、ちょっと探してみましょうか。' },
      ],
    ];
    const lines = pick(fillers, this.rng);
    this._fillerIdx += 1;
    return { id: this._id(), topic: 'filler', factGrounded: false, lines };
  }
}
