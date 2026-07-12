'use client';

// ============================================================
// BobBooth
// ------------------------------------------------------------
// 番組バナー: DJボブのイラスト(ラスター画像)を表示する。
// 画像は public/bob-dj.png を参照する。ファイルが未配置/読み込み失敗の
// ときは、壊れた画像アイコンではなく体裁の整ったプレースホルダを出す。
// 再生中(live)は右上に点滅する LIVE バッジを重ねる(画像内のON AIRとは
// 別に、稼働状態がひと目で分かるように)。
// ============================================================

import { useState } from 'react';

export default function BobBooth({ live }) {
  const [imgOk, setImgOk] = useState(true);

  return (
    <div className={`booth${live ? ' live' : ''}`}>
      <div className="booth-photo-wrap">
        {imgOk ? (
          <img
            className="booth-photo"
            src="/bob-dj.png"
            alt="DJボブがラジオブースでマイクに向かって話しているイラスト"
            onError={() => setImgOk(false)}
          />
        ) : (
          <div className="booth-placeholder">
            <div className="booth-placeholder-mark">📻</div>
            <div className="booth-placeholder-title">まちかどラジオ STUDIO</div>
            <div className="booth-placeholder-sub">99.7 THE WAVE — GOOD MUSIC, GOOD TIMES</div>
          </div>
        )}
        <div className="booth-live">
          <span className="dot" />
          LIVE
        </div>
      </div>
      <div className="booth-caption">
        <span>STUDIO LIVE</span>
        <span>99.7 まちかどラジオ</span>
      </div>
    </div>
  );
}
