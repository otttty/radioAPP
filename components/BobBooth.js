// ============================================================
// BobBooth
// ------------------------------------------------------------
// DJボブがラジオブースでマイクに向かって喋っているシーンのSVGイラスト。
// ペルソナ(明るく陽気な音楽好きDJ・ヘッドホン・ビーニー帽・笑顔)を
// ビジュアルに落とし込んだ番組バナー。live=true(再生中)のとき、
// マイクからの音波・浮かぶ音符・ON AIRランプがアニメーションする。
// 外部画像を使わずインラインSVGで完結(ライセンス・ホスティング不要)。
// ============================================================

export default function BobBooth({ live }) {
  return (
    <div className={`booth${live ? ' live' : ''}`}>
      <svg
        viewBox="0 0 480 190"
        role="img"
        aria-label="DJボブがラジオブースでマイクに向かって話しているイラスト"
      >
        <defs>
          {/* 吸音材(アコースティックフォーム)の壁パターン */}
          <pattern id="foam" width="24" height="24" patternUnits="userSpaceOnUse">
            <rect width="24" height="24" fill="#171209" />
            <rect x="3" y="3" width="18" height="18" rx="5" fill="#211a10" />
            <circle cx="12" cy="12" r="3.5" fill="#191307" />
          </pattern>
        </defs>

        {/* ブースの壁 */}
        <rect x="0" y="0" width="480" height="152" fill="url(#foam)" />

        {/* 壁掛け時計 */}
        <circle cx="432" cy="42" r="16" fill="#12100c" stroke="#3a2c1a" strokeWidth="2" />
        <line x1="432" y1="42" x2="432" y2="32" stroke="#6f6353" strokeWidth="2" strokeLinecap="round" />
        <line x1="432" y1="42" x2="440" y2="46" stroke="#6f6353" strokeWidth="2" strokeLinecap="round" />

        {/* ON AIR サイン(吊り下げ) */}
        <line x1="34" y1="0" x2="34" y2="16" stroke="#3a2c1a" strokeWidth="2" />
        <line x1="96" y1="0" x2="96" y2="16" stroke="#3a2c1a" strokeWidth="2" />
        <g className="booth-onair">
          <rect x="18" y="16" width="94" height="30" rx="8" fill="rgba(255,77,77,0.07)" stroke="rgba(255,77,77,0.45)" strokeWidth="1.5" />
          <circle className="booth-onair-dot" cx="34" cy="31" r="4" fill="#ff4d4d" />
          <text x="45" y="36" fontSize="13" fontWeight="700" letterSpacing="2.5" fill="#ff6b6b">ON AIR</text>
        </g>

        {/* 音波(再生中にアニメーション) */}
        <path className="wave" d="M232 82 A22 22 0 0 0 232 110" fill="none" stroke="#ff9f43" strokeWidth="3" strokeLinecap="round" />
        <path className="wave" d="M222 74 A32 32 0 0 0 222 118" fill="none" stroke="#ff9f43" strokeWidth="3" strokeLinecap="round" />
        <path className="wave" d="M212 66 A42 42 0 0 0 212 126" fill="none" stroke="#ff9f43" strokeWidth="3" strokeLinecap="round" />

        {/* 浮かぶ音符(再生中にアニメーション) */}
        <text className="note" x="380" y="74" fontSize="20" fill="#ffb968">♪</text>
        <text className="note" x="404" y="96" fontSize="16" fill="#ff9f43">♫</text>

        {/* ボブ: 腕(左のヘッドホンに手を添えるDJポーズ) */}
        <path d="M258 132 Q252 104 262 90" fill="none" stroke="#6b4a26" strokeWidth="13" strokeLinecap="round" />
        <circle cx="262" cy="86" r="9" fill="#e8b98a" />

        {/* ボブ: 胴体(ジャケット+シャツ) */}
        <rect x="246" y="112" width="112" height="44" rx="20" fill="#6b4a26" />
        <path d="M292 112 L303 132 L314 112 Z" fill="#f3e9da" />
        <rect x="295" y="104" width="16" height="12" fill="#d9a878" />

        {/* ボブ: 頭 */}
        <circle cx="303" cy="82" r="30" fill="#e8b98a" />

        {/* ビーニー帽 */}
        <path d="M271 76 A32 32 0 0 1 335 76 L335 84 L271 84 Z" fill="#4a3320" />
        <rect x="271" y="77" width="64" height="8" rx="4" fill="#3a281a" />

        {/* ヘッドホン(バンド+両耳カップ) */}
        <path d="M267 80 A38 38 0 0 1 339 80" fill="none" stroke="#ff9f43" strokeWidth="7" strokeLinecap="round" />
        <rect x="252" y="72" width="15" height="26" rx="7" fill="#ff9f43" />
        <rect x="255.5" y="76" width="8" height="18" rx="4" fill="#7a4a1a" />
        <rect x="337" y="72" width="15" height="26" rx="7" fill="#ff9f43" />
        <rect x="340.5" y="76" width="8" height="18" rx="4" fill="#7a4a1a" />
        <path d="M260 98 Q252 128 246 150" fill="none" stroke="#241b12" strokeWidth="2.5" />

        {/* 丸メガネ(アンバーのティント) */}
        <circle cx="290" cy="88" r="8.5" fill="rgba(255,159,67,0.22)" stroke="#241b12" strokeWidth="2.5" />
        <circle cx="316" cy="88" r="8.5" fill="rgba(255,159,67,0.22)" stroke="#241b12" strokeWidth="2.5" />
        <line x1="298.5" y1="88" x2="307.5" y2="88" stroke="#241b12" strokeWidth="2.5" />

        {/* 鼻と、楽しそうに開いた口 */}
        <path d="M302 93 q4 5 0 8" fill="none" stroke="#d9a878" strokeWidth="2" strokeLinecap="round" />
        <path d="M290 104 Q303 118 316 104 Q303 111 290 104 Z" fill="#6e332a" />
        <rect x="296" y="103.5" width="14" height="4" rx="2" fill="#fff8ec" opacity="0.9" />

        {/* デスク */}
        <rect x="0" y="148" width="480" height="6" rx="2" fill="#57422a" />
        <rect x="0" y="152" width="480" height="38" fill="#3b2b18" />
        <text x="240" y="177" textAnchor="middle" fontSize="11" letterSpacing="4" fill="#6f6353">まちかどラジオ STUDIO</text>

        {/* ミキサー卓 */}
        <rect x="40" y="134" width="78" height="16" rx="4" fill="#221a12" stroke="#3a2c1a" strokeWidth="1.5" />
        <circle cx="54" cy="142" r="3.5" fill="#ff9f43" fillOpacity="0.8" />
        <circle cx="70" cy="142" r="3.5" fill="#ff9f43" fillOpacity="0.55" />
        <circle cx="86" cy="142" r="3.5" fill="#ff9f43" fillOpacity="0.8" />
        <circle cx="102" cy="142" r="3.5" fill="#ff9f43" fillOpacity="0.55" />

        {/* ブームマイク */}
        <rect x="142" y="144" width="20" height="8" rx="3" fill="#55402a" />
        <line x1="150" y1="148" x2="228" y2="106" stroke="#6f6353" strokeWidth="5" strokeLinecap="round" />
        <line x1="228" y1="106" x2="243" y2="99" stroke="#262019" strokeWidth="12" strokeLinecap="round" />
        <circle cx="250" cy="96" r="14" fill="#3a3026" stroke="#55402a" strokeWidth="2" />

        {/* マグカップ */}
        <rect x="398" y="130" width="24" height="22" rx="5" fill="#a33d2f" />
        <path d="M422 136 a7 7 0 0 1 0 12" fill="none" stroke="#a33d2f" strokeWidth="4" />
        <path d="M406 124 q3 -6 0 -10" fill="none" stroke="#6f6353" strokeWidth="2" opacity="0.5" />
        <path d="M414 124 q-3 -6 0 -10" fill="none" stroke="#6f6353" strokeWidth="2" opacity="0.5" />
      </svg>
      <div className="booth-caption">
        <span>STUDIO LIVE</span>
        <span>FM 88.0 まちかどラジオ</span>
      </div>
    </div>
  );
}
