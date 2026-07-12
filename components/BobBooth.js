// ============================================================
// BobBooth
// ------------------------------------------------------------
// DJボブがラジオブースで喋っているシーンのSVGイラスト(バナー)。
// 参考イメージ(アメリカのFM局のDJ)に構図を寄せている:
//   LAキャップ + 大型ヘッドホン + 「GOOD VIBES」Tシャツのボブが、
//   ブームマイク(局名フラッグ「99.7 THE WAVE」)に向かって手ぶりつきで
//   トーク。背景に「Good Music / Good Times」のネオン、Today's Playlistの
//   ホワイトボード、ミキサー卓、マグカップ、ON AIRサイン。
// アプリのネオンブルー基調に合わせた深夜スタジオ。
// live=true(再生中)で ON AIRランプ・音波・音符・波形が動く。
// 外部画像を使わずインラインSVGで完結(ベクター表現の範囲でリアル寄せ)。
// ============================================================

export default function BobBooth({ live }) {
  return (
    <div className={`booth${live ? ' live' : ''}`}>
      <svg
        viewBox="0 0 480 280"
        role="img"
        aria-label="LAキャップとヘッドホンのDJボブが、ブームマイクに向かって手ぶりを交えて話している深夜のラジオブースのイラスト"
      >
        <defs>
          <linearGradient id="wallG" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#111a2e" />
            <stop offset="100%" stopColor="#0a0f1c" />
          </linearGradient>
          <linearGradient id="winG" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#12325a" />
            <stop offset="100%" stopColor="#0a1730" />
          </linearGradient>
          <linearGradient id="skinG" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#f2c8a2" />
            <stop offset="55%" stopColor="#dca471" />
            <stop offset="100%" stopColor="#b17e54" />
          </linearGradient>
          <linearGradient id="capG" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#243b6b" />
            <stop offset="100%" stopColor="#152647" />
          </linearGradient>
          <linearGradient id="teeG" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#243356" />
            <stop offset="100%" stopColor="#141d33" />
          </linearGradient>
          <radialGradient id="sunsetG" cx="50%" cy="40%" r="65%">
            <stop offset="0%" stopColor="#ffd27a" />
            <stop offset="45%" stopColor="#ff9a52" />
            <stop offset="100%" stopColor="#e0567a" />
          </radialGradient>
          <linearGradient id="deskG" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#1a2338" />
            <stop offset="100%" stopColor="#0a0e18" />
          </linearGradient>
          <linearGradient id="micG" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="#3a465f" />
            <stop offset="45%" stopColor="#1a2338" />
            <stop offset="100%" stopColor="#0d1424" />
          </linearGradient>
          <filter id="glow" x="-60%" y="-60%" width="220%" height="220%">
            <feGaussianBlur stdDeviation="2.4" result="b" />
            <feMerge>
              <feMergeNode in="b" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        {/* ===== 背景の壁 ===== */}
        <rect x="0" y="0" width="480" height="238" fill="url(#wallG)" />
        {/* レンガの目地(うっすら) */}
        <g opacity="0.12">
          <line x1="0" y1="70" x2="480" y2="70" stroke="#1c2740" strokeWidth="1" />
          <line x1="0" y1="120" x2="480" y2="120" stroke="#1c2740" strokeWidth="1" />
          <line x1="0" y1="170" x2="480" y2="170" stroke="#1c2740" strokeWidth="1" />
        </g>

        {/* 窓(夜景) */}
        <rect x="10" y="118" width="70" height="90" rx="3" fill="url(#winG)" stroke="#1c2740" strokeWidth="3" />
        <line x1="45" y1="118" x2="45" y2="208" stroke="#1c2740" strokeWidth="2" />
        <line x1="10" y1="163" x2="80" y2="163" stroke="#1c2740" strokeWidth="2" />
        <g fill="#0f2038">
          <rect x="14" y="150" width="12" height="54" />
          <rect x="28" y="138" width="10" height="66" />
          <rect x="50" y="146" width="11" height="58" />
          <rect x="64" y="134" width="12" height="70" />
        </g>
        <g fill="#ffd98a" opacity="0.75">
          <rect x="17" y="156" width="2" height="2" /><rect x="21" y="162" width="2" height="2" />
          <rect x="31" y="146" width="2" height="2" /><rect x="34" y="158" width="2" height="2" />
          <rect x="53" y="152" width="2" height="2" /><rect x="67" y="142" width="2" height="2" />
          <rect x="70" y="160" width="2" height="2" />
        </g>

        {/* ===== ネオンサイン「GOOD MUSIC / GOOD TIMES」+ ヤシ ===== */}
        <g filter="url(#glow)">
          <text x="98" y="40" fontFamily="Brush Script MT, cursive" fontSize="22" fontStyle="italic" fontWeight="700" fill="#39c7ff">Good Music</text>
          <text x="104" y="68" fontFamily="Brush Script MT, cursive" fontSize="22" fontStyle="italic" fontWeight="700" fill="#ff5e8a">Good Times</text>
          <g stroke="#ffb454" strokeWidth="2.5" fill="none" strokeLinecap="round">
            <path d="M214 68 q-3 -16 2 -31" />
            <path d="M216 37 q-11 -3 -19 3" />
            <path d="M216 37 q-8 -9 -17 -10" />
            <path d="M216 37 q-2 -13 -7 -20" />
            <path d="M216 37 q4 -13 12 -18" />
            <path d="M216 37 q10 -6 19 -4" />
          </g>
        </g>

        {/* ===== Today's Playlist ホワイトボード ===== */}
        <rect x="326" y="20" width="146" height="98" rx="4" fill="#f3f0e8" stroke="#20304f" strokeWidth="3" />
        <text x="334" y="38" fontFamily="Comic Sans MS, cursive" fontSize="12" fontWeight="700" fill="#26374f">Today&apos;s Playlist</text>
        <line x1="334" y1="43" x2="452" y2="43" stroke="#2a70c8" strokeWidth="1.5" />
        <g fontFamily="Comic Sans MS, cursive" fontSize="9.5" fill="#33465f">
          <text x="336" y="57">- The Beatles</text>
          <text x="336" y="69">- Bruno Mars</text>
          <text x="336" y="81">- Jack Johnson</text>
          <text x="336" y="93">- John Mayer</text>
          <text x="336" y="105">- Stevie Wonder</text>
        </g>
        <text x="392" y="114" fontFamily="Comic Sans MS, cursive" fontSize="8.5" fill="#d0567a">Keep it fun!</text>

        {/* ===== 棚: レコード + 観葉植物 + ボブルヘッド ===== */}
        <rect x="8" y="196" width="66" height="42" fill="#101a2e" />
        <g>
          <rect x="12" y="200" width="3" height="30" fill="#26456f" />
          <rect x="16" y="200" width="3" height="30" fill="#7a3550" />
          <rect x="20" y="200" width="3" height="30" fill="#2f6f6a" />
          <rect x="24" y="200" width="3" height="30" fill="#8a6a2f" />
        </g>
        {/* 観葉植物 */}
        <rect x="36" y="214" width="16" height="16" rx="2" fill="#7a4a2f" />
        <g fill="#2f7f52" stroke="#1f5a3a" strokeWidth="0.5">
          <path d="M44 214 q-10 -14 -2 -24 q6 8 2 24z" />
          <path d="M44 214 q10 -12 2 -22 q-5 8 -2 22z" />
          <path d="M44 214 q-2 -18 2 -26 q3 12 -2 26z" />
        </g>
        {/* ボブルヘッド(サングラスの小さいDJ人形) */}
        <g transform="translate(58 206)">
          <rect x="-6" y="14" width="12" height="16" rx="3" fill="#20406e" />
          <circle cx="0" cy="9" r="8" fill="#e3ad7d" />
          <path d="M-8 6 q8 -9 16 0 z" fill="#182a4a" />
          <rect x="-7" y="6" width="14" height="4" rx="2" fill="#0a0d13" />
        </g>

        {/* ===== ON AIR サイン(卓上・右下・ネオン) ===== */}
        <g className="booth-onair">
          <rect x="384" y="196" width="90" height="34" rx="5" fill="#1a0508" stroke="rgba(255,77,94,0.6)" strokeWidth="2.5" filter="url(#glow)" />
          <circle className="booth-onair-dot" cx="399" cy="213" r="4" fill="#ff4d5e" filter="url(#glow)" />
          <text x="410" y="219" fontSize="15" fontWeight="800" letterSpacing="2" fill="#ff6b7a">ON AIR</text>
        </g>

        {/* ===== ブームマイク(局名フラッグ 99.7) ===== */}
        <line x1="470" y1="8" x2="316" y2="70" stroke="#2a3446" strokeWidth="5" strokeLinecap="round" />
        <circle cx="316" cy="70" r="5" fill="#39465f" />
        <line x1="316" y1="70" x2="300" y2="104" stroke="#2a3446" strokeWidth="5" strokeLinecap="round" />
        {/* ショックマウント + マイク本体 */}
        <ellipse cx="292" cy="128" rx="20" ry="30" fill="none" stroke="#3a465f" strokeWidth="2.5" opacity="0.85" transform="rotate(12 292 128)" />
        <g transform="rotate(12 292 128)">
          <rect x="280" y="104" width="24" height="52" rx="12" fill="url(#micG)" stroke="#3a465f" strokeWidth="1.5" />
          <rect x="280" y="104" width="24" height="22" rx="11" fill="#0d1424" />
          <line x1="283" y1="110" x2="301" y2="110" stroke="#39465f" strokeWidth="1" />
          <line x1="283" y1="114" x2="301" y2="114" stroke="#39465f" strokeWidth="1" />
          <line x1="283" y1="118" x2="301" y2="118" stroke="#39465f" strokeWidth="1" />
          {/* 局名フラッグ */}
          <rect x="286" y="130" width="20" height="12" rx="2" fill="#123a63" stroke="#2fd0ff" strokeWidth="1" />
          <text x="296" y="139" fontSize="6.5" fontWeight="700" fill="#8ae6ff" textAnchor="middle">99.7</text>
        </g>

        {/* 音波(再生中にアニメーション) */}
        <path className="wave" d="M262 96 A22 22 0 0 0 262 130" fill="none" stroke="#2fd0ff" strokeWidth="2.5" strokeLinecap="round" filter="url(#glow)" />
        <path className="wave" d="M252 86 A32 32 0 0 0 252 140" fill="none" stroke="#2fd0ff" strokeWidth="2.5" strokeLinecap="round" filter="url(#glow)" />
        <path className="wave" d="M242 78 A42 42 0 0 0 242 148" fill="none" stroke="#2fd0ff" strokeWidth="2.5" strokeLinecap="round" filter="url(#glow)" />
        {/* 浮かぶ音符 */}
        <text className="note" x="330" y="150" fontSize="18" fill="#8ae6ff">♪</text>
        <text className="note" x="350" y="168" fontSize="14" fill="#2fd0ff">♫</text>

        {/* ===== ボブ本体 ===== */}
        <g transform="rotate(-3 210 200)">
          {/* 胴体・GOOD VIBES Tシャツ */}
          <path d="M150 238 Q152 176 196 164 L236 164 Q286 174 288 238 Z" fill="url(#teeG)" />
          <path d="M196 164 Q206 182 216 184 Q226 182 236 164" fill="none" stroke="#0e1526" strokeWidth="3" />
          {/* 袖(左の二の腕) */}
          <path d="M150 238 Q146 196 168 176 L188 190 Q170 206 172 238 Z" fill="url(#teeG)" />
          {/* Tシャツのサンセット+ヤシのプリント */}
          <text x="224" y="204" fontSize="14" fontWeight="800" fill="#e7ddc9" textAnchor="middle" letterSpacing="0.5">GOOD VIBES</text>
          <circle cx="224" cy="221" r="12" fill="url(#sunsetG)" />
          <rect x="212" y="221" width="24" height="6" fill="#c56a52" opacity="0.6" />
          <g fill="#1c2233">
            <rect x="223.2" y="214" width="1.6" height="12" />
            <path d="M224 214 q-8 -3 -12 1 q7 -1 12 3z" />
            <path d="M224 214 q8 -3 12 1 q-7 -1 -12 3z" />
            <path d="M224 213 q-5 -6 -10 -6 q6 2 10 8z" />
            <path d="M224 213 q5 -6 10 -6 q-6 2 -10 8z" />
          </g>

          {/* 左腕(手ぶり: 開いた手のひらを前に) */}
          <path d="M172 200 Q150 194 134 200 Q120 206 126 216" fill="none" stroke="url(#skinG)" strokeWidth="14" strokeLinecap="round" />
          <g transform="rotate(-18 122 214)">
            <path d="M112 206 q-6 2 -8 9 q-1 8 5 10 q10 3 18 -1 q6 -3 6 -10 q0 -8 -7 -10 q-8 -2 -14 2z" fill="url(#skinG)" />
            {/* 指 */}
            <path d="M104 210 q-6 -1 -9 2" stroke="#c99672" strokeWidth="3.5" fill="none" strokeLinecap="round" />
            <path d="M104 214 q-7 0 -10 3" stroke="#c99672" strokeWidth="3.5" fill="none" strokeLinecap="round" />
            <path d="M105 218 q-6 1 -9 4" stroke="#c99672" strokeWidth="3.5" fill="none" strokeLinecap="round" />
            <path d="M112 205 q-3 -5 -8 -5" stroke="#c99672" strokeWidth="3.5" fill="none" strokeLinecap="round" />
          </g>

          {/* 首 */}
          <rect x="200" y="150" width="20" height="20" fill="#c99672" />
          <ellipse cx="210" cy="154" rx="12" ry="4" fill="#8a5f3e" opacity="0.5" />

          {/* 奥(左)のヘッドホンカップ: 顔の後ろ */}
          <ellipse cx="184" cy="120" rx="12" ry="18" fill="#141b2c" stroke="#39465f" strokeWidth="2.5" />
          <ellipse cx="184" cy="120" rx="7.5" ry="13" fill="#0a0e18" />

          {/* 顔(3/4・マイク側へ) */}
          <path d="M186 96 Q188 60 218 60 Q250 62 250 100 Q250 126 238 140 Q226 150 212 148 Q196 145 190 128 Q185 112 186 96 Z" fill="url(#skinG)" />
          {/* 頬の陰影 + ネオンのリムライト */}
          <path d="M244 88 Q249 108 238 128" fill="none" stroke="#2fd0ff" strokeWidth="2" opacity="0.3" strokeLinecap="round" />
          <ellipse cx="232" cy="120" rx="10" ry="7" fill="#b17e54" opacity="0.35" />
          {/* 無精ひげ(うっすら) */}
          <path d="M196 128 Q206 144 218 146 Q232 145 240 130" fill="none" stroke="#6b4a30" strokeWidth="7" opacity="0.18" strokeLinecap="round" />

          {/* 眉 */}
          <path d="M196 92 Q204 88 212 91" stroke="#3a2a1a" strokeWidth="3" fill="none" strokeLinecap="round" />
          <path d="M224 91 Q232 87 241 90" stroke="#3a2a1a" strokeWidth="3" fill="none" strokeLinecap="round" />
          {/* 目(笑って細め) */}
          <path d="M198 100 Q205 96 212 100" stroke="#241a12" strokeWidth="2.5" fill="none" strokeLinecap="round" />
          <path d="M224 100 Q231 96 240 100" stroke="#241a12" strokeWidth="2.5" fill="none" strokeLinecap="round" />
          {/* 鼻 */}
          <path d="M216 102 Q211 112 214 117 Q217 120 222 116" fill="none" stroke="#a2704e" strokeWidth="2.5" strokeLinecap="round" />
          {/* 口(大きめの笑顔で喋る・歯見え) */}
          <path d="M200 126 Q216 122 231 127 Q226 141 214 141 Q204 139 200 126 Z" fill="#5d2a24" />
          <path d="M204 126.5 Q216 124 228 128 L226 132 Q216 129 206 131 Z" fill="#f4efe8" />
          <ellipse cx="215" cy="136" rx="6" ry="3" fill="#a04a42" />

          {/* LAキャップ */}
          <path d="M184 92 Q182 54 218 52 Q252 54 250 90 Q246 70 232 66 Q214 58 198 66 Q188 72 184 92 Z" fill="url(#capG)" />
          <path d="M218 52 Q206 66 198 88" stroke="#0f1c33" strokeWidth="1.5" fill="none" />
          <path d="M218 52 Q230 66 236 86" stroke="#0f1c33" strokeWidth="1.5" fill="none" />
          <circle cx="218" cy="53" r="2.5" fill="#0f1c33" />
          {/* LA ロゴ */}
          <text x="216" y="82" fontSize="15" fontWeight="800" fill="#f2f4f8" textAnchor="middle" fontFamily="Georgia, serif">LA</text>
          {/* つば(マイク側=左手前へ) */}
          <path d="M186 90 Q160 84 146 92 Q142 98 149 101 Q168 102 190 98 Z" fill="#16264a" stroke="#0e1c38" strokeWidth="1" />

          {/* ヘッドホン: バンドはキャップの上、手前カップは耳に重ねる */}
          <path d="M182 92 A38 38 0 0 1 252 92" fill="none" stroke="#1c2334" strokeWidth="9" strokeLinecap="round" />
          <path d="M182 92 A38 38 0 0 1 252 92" fill="none" stroke="#46536e" strokeWidth="2.5" strokeLinecap="round" />
          <line x1="252" y1="92" x2="250" y2="100" stroke="#39465f" strokeWidth="3.5" />
          {/* 手前(右)のイヤーカップ */}
          <ellipse cx="250" cy="120" rx="13" ry="19" fill="#141b2c" stroke="#39465f" strokeWidth="2.5" />
          <ellipse cx="250" cy="120" rx="8" ry="14" fill="#0a0e18" />
          <circle cx="250" cy="134" r="1.8" fill="#2fd0ff" filter="url(#glow)" />
          {/* ケーブル */}
          <path d="M250 138 Q246 170 236 200" fill="none" stroke="#0c1120" strokeWidth="2.5" />
        </g>

        {/* ===== デスク ===== */}
        <rect x="0" y="234" width="480" height="6" fill="#233150" />
        <rect x="0" y="238" width="480" height="1.5" fill="#2fd0ff" opacity="0.25" />
        <rect x="0" y="240" width="480" height="40" fill="url(#deskG)" />

        {/* マグ「GOOD RADIO」 */}
        <g>
          <rect x="70" y="212" width="40" height="34" rx="4" fill="#e9e6df" stroke="#c7c3b8" strokeWidth="1.5" />
          <path d="M110 220 a9 9 0 0 1 0 18" fill="none" stroke="#c7c3b8" strokeWidth="4" />
          <text x="90" y="226" fontSize="6" fontWeight="700" fill="#2a3550" textAnchor="middle">COFFEE</text>
          <text x="90" y="233" fontSize="6" fontWeight="700" fill="#2a3550" textAnchor="middle">FUEL</text>
          <text x="90" y="240" fontSize="6" fontWeight="700" fill="#2a3550" textAnchor="middle">GOOD</text>
          <path d="M80 208 q3 -6 0 -11" stroke="#6c7d97" strokeWidth="1.5" fill="none" opacity="0.4" />
          <path d="M88 208 q-3 -6 0 -11" stroke="#6c7d97" strokeWidth="1.5" fill="none" opacity="0.4" />
        </g>

        {/* ミキサー卓(フェーダー+LED) */}
        <rect x="150" y="242" width="180" height="34" rx="4" fill="#131a2c" stroke="#232f4a" strokeWidth="1.5" />
        <g>
          {[160, 178, 196, 214, 232, 250, 268, 286, 304].map((x, i) => (
            <g key={x}>
              <line x1={x} y1="248" x2={x} y2="270" stroke="#232f4a" strokeWidth="2" />
              <rect x={x - 2} y={250 + ((i * 7) % 16)} width="4" height="6" rx="1" fill="#9fb2c8" />
            </g>
          ))}
          <circle cx="316" cy="248" r="2" fill="#58f0a8" />
          <circle cx="323" cy="248" r="2" fill="#2fd0ff" />
        </g>

        {/* 波形モニター(右・再生中に明滅) */}
        <rect x="396" y="238" width="72" height="42" rx="4" fill="#0a0f1c" stroke="#232f4a" strokeWidth="2" />
        <rect x="400" y="242" width="64" height="30" rx="2" fill="#0c1626" />
        <path
          className="scope"
          d="M403 258 L409 250 L415 264 L421 246 L427 266 L433 250 L439 262 L445 248 L451 262 L457 252 L461 258"
          fill="none"
          stroke="#2fd0ff"
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
          filter="url(#glow)"
        />
      </svg>
      <div className="booth-caption">
        <span>STUDIO LIVE</span>
        <span>99.7 まちかどラジオ</span>
      </div>
    </div>
  );
}
