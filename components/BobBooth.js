'use client';

// ============================================================
// BobBooth
// ------------------------------------------------------------
// 番組バナー領域。ふだんはDJボブのイラスト(public/bob-dj.png)を表示し、
// お便り(スポット)のトピック中だけ、その場所のGoogleマップに切り替える。
// トピックが終わると place が null になり、自動でイラストへ戻る。
//
// 地図は操作できる(ドラッグ/ズーム可)。別タブでGoogleマップを開きたい
// 場合はキャプション右の「Googleマップで開く」リンクを使う。
// 画像が未配置/読み込み失敗のときは体裁の整ったプレースホルダを出す。
// ============================================================

import { useState } from 'react';

export default function BobBooth({ live, place }) {
  const [imgOk, setImgOk] = useState(true);
  const showMap = !!place && typeof place.lat === 'number' && typeof place.lon === 'number';

  return (
    <div className={`booth${live ? ' live' : ''}`}>
      <div className="booth-photo-wrap">
        {showMap ? (
          <iframe
            className="booth-map"
            title={`${place.name}の地図`}
            src={`https://maps.google.com/maps?q=${place.lat},${place.lon}&z=16&hl=ja&output=embed`}
            loading="lazy"
            referrerPolicy="no-referrer-when-downgrade"
          />
        ) : imgOk ? (
          <img
            className="booth-photo"
            src="/bob-dj.png"
            alt="DJボブがラジオブースでマイクに向かって話しているイラスト"
            onError={() => setImgOk(false)}
          />
        ) : (
          <div className="booth-placeholder">
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
        {showMap ? (
          <>
            <span className="booth-caption-place">📍 {place.name}</span>
            <a
              className="booth-map-open"
              href={`https://www.google.com/maps/search/?api=1&query=${place.lat},${place.lon}`}
              target="_blank"
              rel="noreferrer"
            >
              Googleマップで開く
            </a>
          </>
        ) : (
          <>
            <span>STUDIO LIVE</span>
            <span>99.7 まちかどラジオ</span>
          </>
        )}
      </div>
    </div>
  );
}
