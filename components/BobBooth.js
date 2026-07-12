// ============================================================
// BobBooth
// ------------------------------------------------------------
// DJボブがラジオブースでマイクに向かって喋っているシーンのSVGイラスト。
// ボブ像: サングラスをかけたアメリカ人DJ風。マイクに向かって少し斜めに
// 構えた3/4アングル(体ごと軽くリーン)で、ひげ+短髪フェード+ワイド
// フレームのシェード。ネオンブルーの深夜スタジオ。
// live=true(再生中)のとき、ON AIRランプ・音波・音符・波形が動く。
// 外部画像を使わずインラインSVGで完結(ライセンス・ホスティング不要)。
// ============================================================

export default function BobBooth({ live }) {
  return (
    <div className={`booth${live ? ' live' : ''}`}>
      <svg
        viewBox="0 0 480 190"
        role="img"
        aria-label="サングラスをかけたDJボブが、深夜のラジオブースでマイクに向かって斜めに構えて話しているイラスト"
      >
        <defs>
          {/* 吸音材の壁パターン */}
          <pattern id="foamB" width="26" height="26" patternUnits="userSpaceOnUse">
            <rect width="26" height="26" fill="none" />
            <rect x="3" y="3" width="20" height="20" rx="6" fill="#0e1526" />
            <circle cx="13" cy="13" r="4" fill="#0a101d" />
          </pattern>
          <linearGradient id="wallG" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#0d1424" />
            <stop offset="100%" stopColor="#080c16" />
          </linearGradient>
          <linearGradient id="skinG" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#f0c19a" />
            <stop offset="55%" stopColor="#d9a074" />
            <stop offset="100%" stopColor="#b3805a" />
          </linearGradient>
          <linearGradient id="jacketG" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#26334f" />
            <stop offset="100%" stopColor="#131a2c" />
          </linearGradient>
          <linearGradient id="micG" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="#38445f" />
            <stop offset="45%" stopColor="#1a2338" />
            <stop offset="100%" stopColor="#0e1424" />
          </linearGradient>
          <linearGradient id="deskG" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#151d30" />
            <stop offset="100%" stopColor="#0a0e18" />
          </linearGradient>
          <filter id="glow" x="-60%" y="-60%" width="220%" height="220%">
            <feGaussianBlur stdDeviation="2.6" result="b" />
            <feMerge>
              <feMergeNode in="b" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        {/* ブースの壁 */}
        <rect x="0" y="0" width="480" height="152" fill="url(#wallG)" />
        <rect x="0" y="0" width="480" height="152" fill="url(#foamB)" opacity="0.8" />

        {/* ネオン管(壁の間接照明) */}
        <rect x="138" y="18" width="6" height="7" rx="1.5" fill="#232f4a" />
        <rect x="376" y="18" width="6" height="7" rx="1.5" fill="#232f4a" />
        <rect x="140" y="20" width="240" height="3" rx="1.5" fill="#2fd0ff" opacity="0.85" filter="url(#glow)" />

        {/* 壁掛け時計 */}
        <circle cx="432" cy="44" r="15" fill="#0c1220" stroke="#232f4a" strokeWidth="2" />
        <line x1="432" y1="44" x2="432" y2="34" stroke="#9fb2c8" strokeWidth="2" strokeLinecap="round" />
        <line x1="432" y1="44" x2="439" y2="47" stroke="#9fb2c8" strokeWidth="2" strokeLinecap="round" />
        <line x1="432" y1="44" x2="426" y2="37" stroke="#2fd0ff" strokeWidth="1" strokeLinecap="round" />
        <circle cx="432" cy="44" r="1.5" fill="#2fd0ff" />

        {/* ON AIR サイン(吊り下げ・ネオン) */}
        <line x1="32" y1="0" x2="32" y2="16" stroke="#232f4a" strokeWidth="2" />
        <line x1="98" y1="0" x2="98" y2="16" stroke="#232f4a" strokeWidth="2" />
        <g className="booth-onair">
          <rect x="18" y="16" width="94" height="30" rx="8" fill="rgba(255,77,94,0.06)" stroke="rgba(255,77,94,0.55)" strokeWidth="2" filter="url(#glow)" />
          <circle className="booth-onair-dot" cx="33" cy="31" r="4" fill="#ff4d5e" filter="url(#glow)" />
          <text x="44" y="36" fontSize="13" fontWeight="700" letterSpacing="2.5" fill="#ff6b7a">ON AIR</text>
        </g>

        {/* ブームアーム(スプリング付き) */}
        <rect x="140" y="144" width="22" height="8" rx="3" fill="#232f4a" />
        <line x1="150" y1="148" x2="205" y2="92" stroke="#2a3446" strokeWidth="5" strokeLinecap="round" />
        <line x1="153" y1="141" x2="196" y2="97" stroke="#39465f" strokeWidth="1.5" />
        <circle cx="205" cy="92" r="4" fill="#39465f" />
        <line x1="205" y1="92" x2="236" y2="88" stroke="#2a3446" strokeWidth="4" strokeLinecap="round" />

        {/* ショックマウント+コンデンサーマイク */}
        <ellipse cx="252" cy="98" rx="17" ry="27" fill="none" stroke="#39465f" strokeWidth="2" opacity="0.85" />
        <line x1="238" y1="82" x2="245" y2="87" stroke="#55627e" strokeWidth="1" />
        <line x1="266" y1="82" x2="259" y2="87" stroke="#55627e" strokeWidth="1" />
        <line x1="238" y1="114" x2="245" y2="109" stroke="#55627e" strokeWidth="1" />
        <line x1="266" y1="114" x2="259" y2="109" stroke="#55627e" strokeWidth="1" />
        <rect x="243" y="76" width="18" height="46" rx="9" fill="url(#micG)" stroke="#39465f" strokeWidth="1" />
        <rect x="243" y="76" width="18" height="17" rx="8" fill="#0d1424" />
        <line x1="245" y1="81" x2="259" y2="81" stroke="#39465f" strokeWidth="1" opacity="0.9" />
        <line x1="245" y1="85" x2="259" y2="85" stroke="#39465f" strokeWidth="1" opacity="0.9" />
        <line x1="245" y1="89" x2="259" y2="89" stroke="#39465f" strokeWidth="1" opacity="0.9" />
        <line x1="247" y1="96" x2="247" y2="118" stroke="#8ae6ff" strokeWidth="1" opacity="0.25" />
        <circle cx="252" cy="116" r="1.8" fill="#2fd0ff" filter="url(#glow)" />

        {/* 音波(再生中にアニメーション) */}
        <path className="wave" d="M228 80 A20 20 0 0 0 228 108" fill="none" stroke="#2fd0ff" strokeWidth="2.5" strokeLinecap="round" filter="url(#glow)" />
        <path className="wave" d="M218 72 A30 30 0 0 0 218 116" fill="none" stroke="#2fd0ff" strokeWidth="2.5" strokeLinecap="round" filter="url(#glow)" />
        <path className="wave" d="M208 64 A40 40 0 0 0 208 124" fill="none" stroke="#2fd0ff" strokeWidth="2.5" strokeLinecap="round" filter="url(#glow)" />

        {/* 浮かぶ音符(再生中にアニメーション) */}
        <text className="note" x="352" y="60" fontSize="17" fill="#8ae6ff">♪</text>
        <text className="note" x="370" y="76" fontSize="14" fill="#2fd0ff">♫</text>

        {/* ===== ボブ(マイクへ軽くリーンした3/4アングル) ===== */}
        <g transform="rotate(-5 312 132)">
          {/* 肩・ジャケット */}
          <path d="M258 156 Q260 124 286 116 L338 116 Q364 124 366 156 Z" fill="url(#jacketG)" />
          <path d="M262 150 Q265 126 288 118" fill="none" stroke="#2fd0ff" strokeWidth="2" opacity="0.35" />
          <path d="M362 150 Q359 126 336 118" fill="none" stroke="#2fd0ff" strokeWidth="2" opacity="0.45" />
          <path d="M296 116 L304 128 L300 142 L298 156 L292 156 Q290 132 296 116 Z" fill="#2c3a58" opacity="0.9" />
          <path d="M324 116 L316 128 L320 142 L322 156 L328 156 Q330 132 324 116 Z" fill="#2c3a58" opacity="0.9" />
          <path d="M304 116 L310 130 L316 116 Z" fill="#94a7bd" />
          <line x1="310" y1="130" x2="310" y2="156" stroke="#0c1120" strokeWidth="2" />

          {/* 首と顎下の影 */}
          <rect x="300" y="102" width="16" height="16" fill="#c99672" />
          <ellipse cx="308" cy="106" rx="10" ry="4" fill="#8a5f3e" opacity="0.5" />

          {/* 顔(マイク側へ向いた3/4・顎は左寄り) */}
          <path d="M288 78 Q290 54 314 54 Q340 56 340 82 Q340 100 330 110 Q320 117 308 116 Q296 114 290 104 Q287 92 288 78 Z" fill="url(#skinG)" />
          {/* ネオンのリムライト(右頬) */}
          <path d="M337 74 Q341 88 332 102" fill="none" stroke="#2fd0ff" strokeWidth="2" opacity="0.35" strokeLinecap="round" />

          {/* 髪(短髪フェード+ラインナップ) */}
          <path d="M286 74 Q288 50 314 50 Q342 52 340 78 Q336 62 326 60 Q312 54 300 62 Q290 66 286 74 Z" fill="#171009" />
          <path d="M296 58 Q310 52 326 58" fill="none" stroke="#332619" strokeWidth="2" opacity="0.8" strokeLinecap="round" />
          <rect x="334" y="78" width="4" height="12" rx="2" fill="#171009" />

          {/* サングラス(ワイドフレームのシェード・3/4で奥のレンズは細く) */}
          <rect x="288" y="73.5" width="36" height="3" rx="1.5" fill="#10141d" />
          <rect x="289" y="75" width="12" height="13" rx="3" fill="#0a0d13" stroke="#232a3a" strokeWidth="1.5" />
          <rect x="305" y="75" width="18" height="14" rx="4" fill="#0a0d13" stroke="#232a3a" strokeWidth="1.5" />
          <line x1="301" y1="80" x2="305" y2="80" stroke="#232a3a" strokeWidth="2" />
          <line x1="323" y1="80" x2="336" y2="77" stroke="#232a3a" strokeWidth="2" />
          <line x1="309" y1="77" x2="316" y2="86" stroke="#2fd0ff" strokeWidth="1.5" opacity="0.3" />
          <line x1="292" y1="77" x2="297" y2="84" stroke="#2fd0ff" strokeWidth="1.2" opacity="0.25" />

          {/* 鼻(3/4でマイク側へ) */}
          <path d="M302 86 Q297 93 299 97 Q302 100 306 97" fill="none" stroke="#a2704e" strokeWidth="2" strokeLinecap="round" />

          {/* ひげ(あごひげ+口ひげ+ジョーラインの剃り残し) */}
          <path d="M290 100 Q293 112 306 116 Q322 117 333 104" fill="none" stroke="#241a12" strokeWidth="5" opacity="0.25" strokeLinecap="round" />
          <path d="M295 101 Q303 97 313 101" fill="none" stroke="#241a12" strokeWidth="3" opacity="0.85" strokeLinecap="round" />

          {/* 口(マイクに向かって喋る・自信ありげなグリン) */}
          <path d="M293 104 Q304 101 316 104 Q312 114 302 114 Q295 110 293 104 Z" fill="#5d2a24" />
          <path d="M296 104 Q304 102 313 104 L312 107 Q304 105 297 107 Z" fill="#f4efe8" />
          <ellipse cx="304" cy="111" rx="4.5" ry="2.2" fill="#a04a42" />
          <path d="M299 114 Q304 116 309 114 Q308 118 304 118.5 Q300 118 299 114 Z" fill="#241a12" opacity="0.8" />

          {/* ヘッドホン(パッド付きバンド+メタルヨーク+イヤーカップ) */}
          <path d="M280 76 A34 34 0 0 1 344 76" fill="none" stroke="#222c42" strokeWidth="8" strokeLinecap="round" />
          <path d="M280 76 A34 34 0 0 1 344 76" fill="none" stroke="#46536e" strokeWidth="2.5" strokeLinecap="round" />
          <line x1="280" y1="76" x2="277" y2="88" stroke="#39465f" strokeWidth="3" />
          <line x1="344" y1="76" x2="347" y2="88" stroke="#39465f" strokeWidth="3" />
          <ellipse cx="276" cy="92" rx="8" ry="13" fill="#141b2c" stroke="#39465f" strokeWidth="2" />
          <ellipse cx="276" cy="92" rx="5" ry="10" fill="#0a0e18" />
          <circle cx="276" cy="102" r="1.5" fill="#2fd0ff" filter="url(#glow)" />
          <ellipse cx="348" cy="92" rx="8" ry="13" fill="#141b2c" stroke="#39465f" strokeWidth="2" />
          <ellipse cx="348" cy="92" rx="5" ry="10" fill="#0a0e18" />
          <circle cx="348" cy="102" r="1.5" fill="#2fd0ff" filter="url(#glow)" />
          <path d="M276 104 Q268 132 262 152" fill="none" stroke="#0c1120" strokeWidth="2" />
        </g>

        {/* デスク */}
        <rect x="0" y="148" width="480" height="8" fill="#1a2338" />
        <rect x="0" y="150" width="480" height="1.5" fill="#2fd0ff" opacity="0.25" />
        <rect x="0" y="156" width="480" height="34" fill="url(#deskG)" />
        <ellipse cx="252" cy="158" rx="26" ry="3" fill="#2fd0ff" opacity="0.05" />

        {/* ミキサー卓(フェーダー+LED) */}
        <rect x="36" y="128" width="96" height="22" rx="4" fill="#131a2c" stroke="#232f4a" strokeWidth="1.5" />
        <line x1="48" y1="132" x2="48" y2="146" stroke="#232f4a" strokeWidth="2" />
        <rect x="46" y="134" width="4" height="5" rx="1" fill="#9fb2c8" />
        <line x1="62" y1="132" x2="62" y2="146" stroke="#232f4a" strokeWidth="2" />
        <rect x="60" y="139" width="4" height="5" rx="1" fill="#9fb2c8" />
        <line x1="76" y1="132" x2="76" y2="146" stroke="#232f4a" strokeWidth="2" />
        <rect x="74" y="136" width="4" height="5" rx="1" fill="#9fb2c8" />
        <line x1="90" y1="132" x2="90" y2="146" stroke="#232f4a" strokeWidth="2" />
        <rect x="88" y="141" width="4" height="5" rx="1" fill="#9fb2c8" />
        <circle cx="112" cy="133" r="1.5" fill="#58f0a8" />
        <circle cx="119" cy="133" r="1.5" fill="#2fd0ff" />
        <circle cx="126" cy="133" r="1.5" fill="#ff4d5e" />

        {/* 波形モニター */}
        <rect x="386" y="96" width="76" height="48" rx="5" fill="#0a0f1c" stroke="#232f4a" strokeWidth="2" />
        <rect x="390" y="100" width="68" height="40" rx="3" fill="#0c1626" />
        <path
          className="scope"
          d="M394 120 L400 112 L406 126 L412 108 L418 130 L424 114 L430 124 L436 110 L442 126 L448 116 L454 120"
          fill="none"
          stroke="#2fd0ff"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          filter="url(#glow)"
        />
        <rect x="418" y="144" width="12" height="5" fill="#232f4a" />

        {/* マグカップ */}
        <rect x="358" y="132" width="20" height="18" rx="4" fill="#1b2438" stroke="#2c3a58" strokeWidth="1.5" />
        <path d="M378 137 a6 6 0 0 1 0 10" fill="none" stroke="#2c3a58" strokeWidth="3" />
        <path d="M364 126 q3 -6 0 -10" fill="none" stroke="#6c7d97" strokeWidth="2" opacity="0.4" />
        <path d="M371 126 q-3 -6 0 -10" fill="none" stroke="#6c7d97" strokeWidth="2" opacity="0.4" />
      </svg>
      <div className="booth-caption">
        <span>STUDIO LIVE</span>
        <span>FM 88.0 まちかどラジオ</span>
      </div>
    </div>
  );
}
