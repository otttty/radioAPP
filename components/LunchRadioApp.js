'use client';

import { useEffect, useRef, useState } from 'react';
import { LocationManager } from '@/lib/locationManager';
import { getRatedPlaces } from '@/lib/googlePlacesProvider';
import { geocodePlaceName } from '@/lib/geocodeFallback';
import { getCurrentWeather } from '@/lib/weatherProvider';
import { reverseGeocodeArea } from '@/lib/reverseGeocode';
import { ScriptGenerator } from '@/lib/scriptGenerator';
import { BrowserTTSEngine } from '@/lib/ttsEngine';
import { OpenAITTSEngine } from '@/lib/openaiTtsEngine';
import { ElevenLabsTTSEngine } from '@/lib/elevenLabsTtsEngine';
import { AudioPipeline } from '@/lib/audioPipeline';
import BobBooth from './BobBooth';

// ============================================================
// LunchRadioApp
// 元の index.html + src/app.js を1つのクライアントコンポーネントに移植したもの。
// データフロー:
//   位置取得(LocationManager) -> 周辺情報収集(*Provider, 並列+キャッシュ)
//   -> 台本生成(ScriptGenerator) -> TTS(TTSEngine) -> 連続再生(AudioPipeline)
//   -> UI更新(React state)
// ============================================================

const TOPIC_LABEL = {
  opening: '📻 オープニング',
  lunch: '🍚 グルメ',
  cafe: '☕ カフェ',
  park: '🌳 公園・自然',
  culture: '🖼️ 文化施設・名所',
  shop: '🛍️ お店',
  spot: '📍 スポット',
  filler: '🎙️ フリートーク',
  mail: '📮 あなたのお便り',
};

const PERM_LABEL = {
  granted: '許可済み',
  denied: '拒否されています',
  prompt: '未確認(開始時に確認します)',
  unavailable: 'この端末では利用不可',
  unknown: '未確認',
};

const FALLBACK_FIX = { lat: 35.681, lon: 139.767, accuracy: Infinity, timestamp: Date.now(), status: 'unavailable' };

export default function LunchRadioApp() {
  const [permState, setPermState] = useState('未確認');
  // ElevenLabsの無料枠が尽きているため、当面はOpenAI TTSを既定にする
  // (枠回復後はドロップダウンでElevenLabsに切り替え可能)
  const [ttsProvider, setTtsProvider] = useState('openai');
  const [ttsStatus, setTtsStatus] = useState('');
  const [locStatus, setLocStatus] = useState('');
  const [manualBusy, setManualBusy] = useState(false);
  const [started, setStarted] = useState(false);
  const [startBusy, setStartBusy] = useState(false);
  const [topicLabel, setTopicLabel] = useState('📻 準備中');
  const [factBadge, setFactBadge] = useState('-');
  const [transcript, setTranscript] = useState([]);
  const [isPlaying, setIsPlaying] = useState(false);
  const [volume, setVolume] = useState(0.9);
  const [locLabel, setLocLabel] = useState('現在地: -');
  const [currentPlace, setCurrentPlace] = useState(null); // いま流れているお便りのスポット(地図表示用)
  const [mailBody, setMailBody] = useState(''); // 投稿フォームの本文
  const [mailName, setMailName] = useState(''); // 投稿フォームのラジオネーム(任意)
  const [pendingMailCount, setPendingMailCount] = useState(0); // 未読み上げの投稿数
  const [mailNotice, setMailNotice] = useState(''); // 投稿後の案内メッセージ
  const [mailSending, setMailSending] = useState(false); // 投稿の送信中フラグ
  const [mailPersistent, setMailPersistent] = useState(true); // 共有ストアが有効か
  const [currentMailId, setCurrentMailId] = useState(null); // いま読まれている他リスナーの投稿(通報用)
  const [reportDone, setReportDone] = useState(false);
  const [serverDefaults, setServerDefaults] = useState({ elevenlabs: false, openai: false, google: false });

  const manualInputRef = useRef(null);
  const openaiKeyInputRef = useRef(null);
  const elevenKeyInputRef = useRef(null);
  const elevenMainVoiceRef = useRef(null);
  const elevenSubVoiceRef = useRef(null);
  const transcriptRef = useRef(null);

  const locationManagerRef = useRef(null);
  const scriptGeneratorRef = useRef(null);
  const audioPipelineRef = useRef(null);
  const currentFixRef = useRef(null);
  const locationReadyRef = useRef(false); // 位置情報が確定したか(未確定の間はフリートークでつなぐ)
  const areaNameRef = useRef(null); // 逆ジオコーディング等で得た地名(番組冒頭で言及)
  const serverDefaultsRef = useRef({ elevenlabs: false, openai: false, google: false });
  const userMailsRef = useRef([]); // 自分が投稿した未読み上げのお便り(先入れ先出し)
  const communityMailsRef = useRef([]); // この街に届いている他のリスナーのお便り
  const readMailIdsRef = useRef(new Set()); // 読み上げ済み/自分の投稿(重複を避ける)

  useEffect(() => {
    if (transcriptRef.current) {
      transcriptRef.current.scrollTop = transcriptRef.current.scrollHeight;
    }
  }, [transcript]);

  // サーバー側に既定APIキーが設定されているか(真偽値のみ)を取得。
  // 設定済みなら、ユーザーはキー未入力のまま開始できる。
  useEffect(() => {
    fetch('/api/config')
      .then((r) => r.json())
      .then((cfg) => {
        const d = {
          elevenlabs: !!cfg.elevenlabs,
          openai: !!cfg.openai,
          google: !!cfg.google,
        };
        serverDefaultsRef.current = d;
        setServerDefaults(d);
      })
      .catch(() => {});
  }, []);

  // トピックの素材(Google Placesのスポット)を返すFactBundle。
  // lite:true、または位置情報が未確定(取得中)の場合はネットワーク呼び出しをせず
  // warmup を返す(台本側はその間ボブのフリートークでつなぐ)。
  // 自分が投稿したお便りを1通取り出す(取り出したらキューから消える)。
  // 台本生成側がこれを呼び、あればそのお便りの回として台本を作る。
  function takeUserMail() {
    const mail = userMailsRef.current.shift() ?? null;
    if (mail) setPendingMailCount(userMailsRef.current.length);
    return mail;
  }

  // この街に届いている「他のリスナーのお便り」を1通取り出す。
  // 自分の投稿・読み上げ済みは飛ばす。
  function takeCommunityMail() {
    while (communityMailsRef.current.length > 0) {
      const mail = communityMailsRef.current.shift();
      if (!mail?.id || readMailIdsRef.current.has(mail.id)) continue;
      readMailIdsRef.current.add(mail.id);
      setCurrentMailId(mail.id);
      return mail;
    }
    return null;
  }

  // 周辺に届いているお便りを取得して補充する(失敗しても番組は続行)。
  async function refreshCommunityMails(lat, lon) {
    try {
      const res = await fetch(`/api/mails?lat=${lat}&lon=${lon}`);
      const data = await res.json();
      const fresh = (data.mails || []).filter((m) => !readMailIdsRef.current.has(m.id));
      // 既にキューにあるものと重複させない
      const queued = new Set(communityMailsRef.current.map((m) => m.id));
      for (const m of fresh) if (!queued.has(m.id)) communityMailsRef.current.push(m);
      setMailPersistent(!!data.persistent);
    } catch (e) {
      console.warn('[mails] 取得に失敗:', e);
    }
  }

  // トピックの素材(Google Placesのスポット)を返すFactBundle。
  // lite:true、または位置情報が未確定(取得中)の場合はネットワーク呼び出しをせず
  // warmup を返す(台本側はその間ボブのフリートークでつなぐ)。
  async function buildFacts({ lite = false } = {}) {
    const baseFix = currentFixRef.current ?? FALLBACK_FIX;
    // 地名は逆ジオコーディング等で別途解決したものを location に添える(冒頭の土地紹介用)
    const fix = { ...baseFix, areaName: areaNameRef.current };
    if (lite || !locationReadyRef.current) {
      return { places: [], location: fix, warmup: !locationReadyRef.current, takeUserMail, takeCommunityMail };
    }
    // スポットと天気(気温)を並行取得。天気は季節感・気温に合った話題づくりに使う
    // (取れなくても番組は続行する)。
    const [places, weather] = await Promise.all([
      fetchPlaces(fix.lat, fix.lon),
      getCurrentWeather(fix.lat, fix.lon).catch(() => null),
    ]);
    // この街に届いているお便りが尽きたら、裏で補充しておく(待たない)
    if (communityMailsRef.current.length === 0) refreshCommunityMails(fix.lat, fix.lon);
    return { places, location: fix, weather, takeUserMail, takeCommunityMail };
  }

  // 投稿フォームの送信。
  // 1) サーバーに保存(モデレーション通過後。同じ場所に来た他のリスナーにも届く)
  // 2) 自分の番組では即座に割り込みで読み上げる
  async function handleMailSubmit(e) {
    e.preventDefault();
    const body = mailBody.trim();
    if (!body || mailSending) return;
    setMailSending(true);
    setMailNotice('');

    const fix = currentFixRef.current ?? FALLBACK_FIX;
    const radioName = mailName.trim().slice(0, 30) || null;
    let savedId = null;
    try {
      const res = await fetch('/api/mails', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body, radioName, lat: fix.lat, lon: fix.lon, areaName: areaNameRef.current }),
      });
      const data = await res.json();
      if (!res.ok) {
        // モデレーションやレート制限で弾かれた場合は理由を出して中断する
        setMailNotice(data.error || '送信できませんでした。');
        setMailSending(false);
        return;
      }
      savedId = data.id ?? null;
      setMailPersistent(!!data.persistent);
      if (savedId) readMailIdsRef.current.add(savedId); // 自分の投稿を二重に読まない
    } catch (err) {
      console.warn('[mail] 保存に失敗、この端末だけで読み上げます:', err);
    }

    userMailsRef.current.push({
      id: savedId,
      body: body.slice(0, 600), // 長すぎる投稿は読み上げが冗長になるため制限
      radioName,
      submittedAt: Date.now(),
    });
    setPendingMailCount(userMailsRef.current.length);
    setMailBody('');
    setMailNotice('お便りを送りました。いまの話題が終わったらボブが読み上げます。');
    setTimeout(() => setMailNotice(''), 8000);
    setMailSending(false);
    // 先読み済みのトピックより先に読ませるため、割り込みで先頭に差し込む
    audioPipelineRef.current?.insertPrioritySegment().catch((err) => {
      console.warn('[mail] 割り込み生成に失敗:', err);
    });
  }

  // いま読まれている他リスナーのお便りを通報する
  async function handleReport() {
    if (!currentMailId || reportDone) return;
    try {
      await fetch('/api/mails/report', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: currentMailId }),
      });
      setReportDone(true);
    } catch (err) {
      console.warn('[mail] 通報に失敗:', err);
    }
  }

  // トピックはGoogle Placesのスポット(レビュー付き)のみ。取得失敗/空なら空配列。
  // キーは常にサーバー側の既定キー(連携済み)を使う。
  async function fetchPlaces(lat, lon) {
    if (!serverDefaultsRef.current.google) return [];
    try {
      return await getRatedPlaces(lat, lon, ''); // 空keyならサーバー既定キー
    } catch (e) {
      console.warn('[places] Google Places failed:', e);
      return [];
    }
  }

  // 位置が実在座標なら市区町村名を解決して番組冒頭で言及できるようにする。
  // 取れなくても番組は汎用的な言い回しで続行する(必須ではない)。
  async function ensureAreaName(fix) {
    if (areaNameRef.current) return;
    if (!fix || fix.status === 'denied' || fix.status === 'unavailable') return;
    try {
      const name = await reverseGeocodeArea(fix.lat, fix.lon);
      if (name) areaNameRef.current = name;
    } catch {
      /* 失敗は無視 */
    }
  }

  useEffect(() => {
    const locationManager = new LocationManager();
    locationManagerRef.current = locationManager;
    scriptGeneratorRef.current = new ScriptGenerator({});
    audioPipelineRef.current = new AudioPipeline({
      ttsEngine: new BrowserTTSEngine(),
      scriptGenerator: scriptGeneratorRef.current,
      getFacts: () => buildFacts(),
      getLiteFacts: () => buildFacts({ lite: true }),
      onTopicChange: (segment) => {
        setTopicLabel(TOPIC_LABEL[segment.topic] ?? segment.topic);
        setFactBadge(segment.factGrounded ? '実データに基づく話題' : 'つなぎのフリートーク');
        setTranscript([]);
        // お便りのスポットなら地図を出す(座標が無い/つなぎ回は消す)
        setCurrentPlace(segment.place && typeof segment.place.lat === 'number' ? segment.place : null);
        // 他リスナーの投稿以外の回になったら通報ボタンを引っ込める
        if (segment.topic !== 'mail') setCurrentMailId(null);
        setReportDone(false);
      },
      onLine: (line) => {
        setTranscript((prev) => [...prev, { speaker: line.speaker, text: line.text }]);
      },
    });

    locationManager.checkPermission().then((state) => {
      setPermState(PERM_LABEL[state] ?? state);
    });

    return () => {
      locationManagerRef.current?.stop();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleManualLocate() {
    const q = manualInputRef.current?.value.trim();
    if (!q) return;
    setManualBusy(true);
    setLocStatus('地名から位置を検索中…(最大5秒)');
    try {
      const fix = await geocodePlaceName(q);
      if (fix) {
        currentFixRef.current = fix;
        areaNameRef.current = q; // 手入力した地名をそのまま冒頭紹介に使う
        locationReadyRef.current = true; // 位置確定
        setLocStatus(`「${q}」周辺として進行します(概算位置)`);
        setLocLabel(`${fix.lat.toFixed(3)}, ${fix.lon.toFixed(3)}(手入力・概算)`);
      } else {
        setLocStatus('見つかりませんでした。別の表記(市区町村名など)で試してください。');
      }
    } finally {
      setManualBusy(false);
    }
  }

  /** 選択されたTTSプロバイダに応じてエンジンを組み立てる。未入力ならfalseを返す */
  function setupTtsEngine() {
    const pipeline = audioPipelineRef.current;
    const defaults = serverDefaultsRef.current;
    if (ttsProvider === 'elevenlabs') {
      const key = elevenKeyInputRef.current?.value.trim() || '';
      if (!key && !defaults.elevenlabs) {
        setTtsStatus('ElevenLabsのAPIキーを入力してください(このブラウザ内だけで使い、保存はしません)。');
        return false;
      }
      pipeline.ttsEngine = new ElevenLabsTTSEngine({
        apiKey: key, // 空ならサーバー側の既定キーが使われる
        mainVoiceId: elevenMainVoiceRef.current?.value.trim() || undefined,
        subVoiceId: elevenSubVoiceRef.current?.value.trim() || undefined,
      });
      setTtsStatus(`ElevenLabsで読み上げます${key ? '' : '(連携済みのキーを使用)'}。`);
    } else if (ttsProvider === 'openai') {
      const key = openaiKeyInputRef.current?.value.trim() || '';
      if (!key && !defaults.openai) {
        setTtsStatus('OpenAIのAPIキーを入力してください(このブラウザ内だけで使い、保存はしません)。');
        return false;
      }
      pipeline.ttsEngine = new OpenAITTSEngine({ apiKey: key });
      setTtsStatus(`OpenAI TTSで読み上げます${key ? '' : '(連携済みのキーを使用)'}。`);
    } else {
      pipeline.ttsEngine = new BrowserTTSEngine();
      setTtsStatus('ブラウザ内蔵音声で読み上げます。');
    }
    return true;
  }

  async function handleStart() {
    if (!setupTtsEngine()) return;

    // 台本のLLM生成: サーバーの既定キー(連携済み)を使う。音声用にユーザーが
    // OpenAIキーを入れていた場合だけ、それを流用する。
    const scriptKey = ttsProvider === 'openai' ? (openaiKeyInputRef.current?.value.trim() || '') : '';
    scriptGeneratorRef.current.configureLLM(scriptKey, { serverDefault: serverDefaultsRef.current.openai });

    // 位置取得を待たずに番組(ボブのフリートーク)を先に始める。
    // 位置が確定するまでは buildFacts が warmup を返し、台本はフリートークでつなぐ。
    setStarted(true);
    audioPipelineRef.current.start().then(() => setIsPlaying(true));

    // 位置情報の取得はバックグラウンドで進める(取れ次第、周辺トピックへ移行)
    acquireLocationInBackground();
  }

  // 位置情報をバックグラウンドで取得し、確定したら locationReadyRef を立てる。
  async function acquireLocationInBackground() {
    // 手入力(この場所で)で既に確定済みなら何もしない
    if (locationReadyRef.current) return;

    const locationManager = locationManagerRef.current;
    const fix = await locationManager.requestOnce();
    setPermState(PERM_LABEL[locationManager.permissionState] ?? locationManager.permissionState);

    if (fix.status === 'denied' || fix.status === 'unavailable') {
      setLocStatus('位置情報が使えなかったため、地名を手入力するか、一般的な話題中心で進行します。');
      currentFixRef.current = FALLBACK_FIX;
    } else {
      currentFixRef.current = fix;
      setLocStatus('現在地の周辺情報を使って番組を進行します。');
      setLocLabel(`${fix.lat.toFixed(3)}, ${fix.lon.toFixed(3)}(約100m格子に丸め済み)`);
      // 冒頭で土地に触れるため地名を解決(最大3秒)
      await ensureAreaName(fix);
      // 移動検知: 意味のある移動があった時だけ fix を更新
      locationManager.watch((newFix) => {
        currentFixRef.current = newFix;
        setLocLabel(`${newFix.lat.toFixed(3)}, ${newFix.lon.toFixed(3)}(移動を検知し更新)`);
      });
    }
    // ここで周辺トピックへ移行してよい(拒否時も FALLBACK_FIX で進行)
    locationReadyRef.current = true;
  }

  function handlePlayPause() {
    const pipeline = audioPipelineRef.current;
    if (pipeline.isPlaying) {
      pipeline.pause();
      setIsPlaying(false);
    } else {
      pipeline.resumePlayback();
      setIsPlaying(true);
    }
  }

  function handleSkip() {
    audioPipelineRef.current?.skip();
  }

  function handleVolumeChange(e) {
    const v = Number(e.target.value);
    setVolume(v);
    audioPipelineRef.current?.setVolume(v);
  }

  return (
    <div className="app">
      <header className="brand">
        <div className="brand-freq">
          <span className="brand-dial" />
          99.7 FM
        </div>
        <h1>まちかどラジオ</h1>
        <p className="tagline">今いる場所のまわりのお店や名所を、そこを訪れたリスナーのお便りと一緒にDJボブが届け続けます。</p>
      </header>

      <BobBooth live={isPlaying} place={currentPlace} />

      <div id="panel-setup" className={`card${started ? ' hidden' : ''}`}>
        <div className="perm-row">
          <span>位置情報の許可状態</span>
          <strong id="permState">{permState}</strong>
        </div>
        <div className="perm-purpose">
          「開始」を押すと位置情報の利用許可を確認します。取得した位置は
          <strong>周辺のお店・公園・名所などのスポットを探す目的だけ</strong>
          に使い、約100mの粒度に丸めてから利用します(正確な座標を必要以上に外部へ送りません)。拒否した場合は一般的な話題中心で進行します。
        </div>

        <div className="manual-locate">
          <input type="text" ref={manualInputRef} placeholder="位置情報が使えない場合: 地名を入力(例: 渋谷)" />
          <button className="secondary" onClick={handleManualLocate} disabled={manualBusy}>
            {manualBusy ? '検索中…' : 'この場所で'}
          </button>
        </div>

        <div className="tts-select">
          <label>🎙️ 読み上げ音声</label>
          <select value={ttsProvider} onChange={(e) => setTtsProvider(e.target.value)}>
            <option value="openai">OpenAI TTS(自然な声・要APIキー・従量課金)</option>
            <option value="elevenlabs">ElevenLabs(自然な声・要APIキー・従量課金)</option>
            <option value="browser">ブラウザ内蔵(キー不要・機械音寄り)</option>
          </select>
          <div className={ttsProvider !== 'elevenlabs' ? 'hidden' : ''}>
            <input
              type="password"
              ref={elevenKeyInputRef}
              placeholder={serverDefaults.elevenlabs ? 'ElevenLabs APIキー(連携済み・空欄でOK)' : 'ElevenLabs APIキー(保存はされません)'}
            />
            <input type="text" ref={elevenMainVoiceRef} placeholder="パーソナリティの声のVoice ID(任意・空欄で既定)" />
            <input type="text" ref={elevenSubVoiceRef} placeholder="お便り朗読の声のVoice ID(任意・空欄で既定)" />
          </div>
          <div className={ttsProvider !== 'openai' ? 'hidden' : ''}>
            <input
              type="password"
              ref={openaiKeyInputRef}
              placeholder={serverDefaults.openai ? 'OpenAI APIキー(連携済み・空欄でOK)' : 'sk-... (OpenAI APIキー。保存はされません)'}
            />
          </div>
          <div id="ttsStatus" className="hint">{ttsStatus}</div>
        </div>

        <button className="primary" onClick={handleStart} disabled={startBusy}>
          {startBusy ? '準備中…' : '▶ 番組を開始する'}
        </button>
        <div id="locStatus">{locStatus}</div>
      </div>

      <div id="panel-player" className={`card${started ? '' : ' hidden'}`}>
        <div className="now-playing">
          <div className={`onair${isPlaying ? ' live' : ''}`}>
            <span className="dot" />
            ON AIR
          </div>
          <div id="topicLabel">{topicLabel}</div>
          <div id="factBadge">{factBadge}</div>
          <div className={`equalizer${isPlaying ? ' live' : ''}`}>
            <span /><span /><span /><span /><span /><span /><span />
          </div>
        </div>
        <div className="controls">
          <button className="secondary" onClick={handlePlayPause}>
            {isPlaying ? '⏸ 一時停止' : '▶ 再生'}
          </button>
          <button className="secondary" onClick={handleSkip}>⏭ 話題をスキップ</button>
        </div>
        <div className="volume-row">
          🔈 <input type="range" min="0" max="1" step="0.05" value={volume} onChange={handleVolumeChange} /> 🔊
        </div>
        <div id="locLabel">{locLabel}</div>
        <div id="transcript" ref={transcriptRef}>
          {/* 字幕はトピックごとにリセットされる追記専用リストなので、
              並び替えは起きずインデックスをkeyにして安全(重複しない) */}
          {transcript.map((line, i) => (
            <div key={i} className={`line ${line.speaker}`}>
              {line.speaker === 'main' ? 'ボブ' : '📩 お便り'}: {line.text}
            </div>
          ))}
        </div>

        <form className="mail-form" onSubmit={handleMailSubmit}>
          <label htmlFor="mailBody">📮 番組にお便りを送る</label>
          <div className="mail-form-row">
            <input
              type="text"
              value={mailName}
              onChange={(e) => setMailName(e.target.value)}
              placeholder="ラジオネーム(任意)"
              maxLength={30}
            />
            <button type="submit" className="mail-send" disabled={!mailBody.trim() || mailSending}>
              {mailSending ? '送信中…' : '送信'}
            </button>
          </div>
          <textarea
            id="mailBody"
            value={mailBody}
            onChange={(e) => setMailBody(e.target.value)}
            placeholder="今いる場所のこと、聞きたいこと、なんでもどうぞ(ボブが読んで答えます)"
            rows={3}
            maxLength={600}
          />
          {(mailNotice || pendingMailCount > 0) && (
            <div className="hint">
              {mailNotice}
              {pendingMailCount > 0 && `(読み上げ待ち: ${pendingMailCount}通)`}
            </div>
          )}
          <div className="hint mail-share-note">
            {mailPersistent
              ? '送ったお便りはこの場所に残り、あとで同じ場所に来た人の番組でも読まれます。URLや連絡先は投稿できません。'
              : '⚠ 共有ストア未設定のため、いまは自分の番組でだけ読まれます(他の人には届きません)。'}
          </div>
          {currentMailId && (
            <button type="button" className="secondary mail-report" onClick={handleReport} disabled={reportDone}>
              {reportDone ? '通報しました' : '⚑ いま読まれているお便りを通報'}
            </button>
          )}
        </form>
      </div>

      <footer className="note">
        スポット: Google Places / 地名: BigDataCloud / 音声: OpenAI TTS(またはElevenLabs・ブラウザ内蔵)。
      </footer>
    </div>
  );
}
