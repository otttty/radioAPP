'use client';

import { useEffect, useRef, useState } from 'react';
import { LocationManager } from '@/lib/locationManager';
import { getCurrentWeather } from '@/lib/weatherProvider';
import { getNearbyPlaces } from '@/lib/placesProvider';
import { getRatedPlaces } from '@/lib/googlePlacesProvider';
import { getNearbyTrivia } from '@/lib/triviaProvider';
import { geocodePlaceName } from '@/lib/geocodeFallback';
import { reverseGeocodeArea } from '@/lib/reverseGeocode';
import { ScriptGenerator } from '@/lib/scriptGenerator';
import { BrowserTTSEngine } from '@/lib/ttsEngine';
import { OpenAITTSEngine } from '@/lib/openaiTtsEngine';
import { AudioPipeline } from '@/lib/audioPipeline';

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
  weather: '☀️ お天気',
  lunch: '🍚 ランチ',
  cafe: '☕ カフェ',
  culture: '🖼️ 文化スポット',
  trivia: '💡 豆知識',
  filler: '🎙️ フリートーク',
};

const PERM_LABEL = {
  granted: '許可済み',
  denied: '拒否されています',
  prompt: '未確認(開始時に確認します)',
  unavailable: 'この端末では利用不可',
  unknown: '未確認',
};

const FALLBACK_FIX = { lat: 35.681, lon: 139.767, accuracy: Infinity, timestamp: Date.now(), status: 'unavailable' };

const DEFAULT_PREFS = { weather: true, lunch: true, cafe: true, culture: true, trivia: true };

export default function LunchRadioApp() {
  const [permState, setPermState] = useState('未確認');
  const [prefs, setPrefs] = useState(DEFAULT_PREFS);
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

  const manualInputRef = useRef(null);
  const openaiKeyInputRef = useRef(null);
  const googleKeyInputRef = useRef(null);
  const transcriptRef = useRef(null);

  const locationManagerRef = useRef(null);
  const scriptGeneratorRef = useRef(null);
  const audioPipelineRef = useRef(null);
  const currentFixRef = useRef(null);
  const areaNameRef = useRef(null); // 逆ジオコーディング等で得た地名(番組冒頭で言及)
  const googleKeyRef = useRef(''); // Google Places APIキー(あれば高評価店を使う)
  const prefsRef = useRef(DEFAULT_PREFS);
  const lineKeyRef = useRef(0);

  useEffect(() => {
    prefsRef.current = prefs;
  }, [prefs]);

  useEffect(() => {
    if (transcriptRef.current) {
      transcriptRef.current.scrollTop = transcriptRef.current.scrollHeight;
    }
  }, [transcript]);

  // 周辺情報を並列取得し、ジャンル設定でフィルタしたFactBundleを返す。
  // lite:true の場合はネットワーク呼び出しを一切せず、位置情報だけを即座に返す
  // (オープニング生成用。体感待ち時間の短縮が目的)。
  async function buildFacts({ lite = false } = {}) {
    const baseFix = currentFixRef.current ?? FALLBACK_FIX;
    // 地名は逆ジオコーディング等で別途解決したものを location に添える(冒頭の土地紹介用)
    const fix = { ...baseFix, areaName: areaNameRef.current };
    if (lite) {
      return { weather: null, places: [], trivia: [], location: fix };
    }
    const p = prefsRef.current;
    const needPlaces = p.lunch || p.cafe || p.culture;

    const [weather, places, trivia] = await Promise.all([
      p.weather ? getCurrentWeather(fix.lat, fix.lon) : Promise.resolve(null),
      needPlaces ? fetchPlaces(fix.lat, fix.lon) : Promise.resolve([]),
      p.trivia ? getNearbyTrivia(fix.lat, fix.lon) : Promise.resolve([]),
    ]);

    const filteredPlaces = places.filter((pl) => p[pl.category]);
    return { weather, places: filteredPlaces, trivia, location: fix };
  }

  // お店の取得: Google Placesキーがあれば高評価店を優先し、失敗/空なら
  // キー不要のOSM(Overpass)へフォールバックする。
  async function fetchPlaces(lat, lon) {
    const key = googleKeyRef.current;
    if (key) {
      try {
        const rated = await getRatedPlaces(lat, lon, key);
        if (rated.length > 0) return rated;
      } catch (e) {
        console.warn('[places] Google Places failed, falling back to OSM:', e);
      }
    }
    return getNearbyPlaces(lat, lon);
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
      },
      onLine: (line) => {
        lineKeyRef.current += 1;
        setTranscript((prev) => [...prev, { key: lineKeyRef.current, speaker: line.speaker, text: line.text }]);
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
    if (ttsProvider === 'openai') {
      const key = openaiKeyInputRef.current?.value.trim();
      if (!key) {
        setTtsStatus('OpenAIのAPIキーを入力してください(このブラウザ内だけで使い、保存はしません)。');
        return false;
      }
      pipeline.ttsEngine = new OpenAITTSEngine({ apiKey: key });
      setTtsStatus('OpenAI TTSで読み上げます(音声生成のたびにAPI利用料がかかります)。');
    } else {
      pipeline.ttsEngine = new BrowserTTSEngine();
      setTtsStatus('ブラウザ内蔵音声で読み上げます。');
    }
    return true;
  }

  async function handleStart() {
    if (!setupTtsEngine()) return;

    // Google Places APIキー(任意)を控える。あれば高評価店の取得に使う。
    googleKeyRef.current = googleKeyInputRef.current?.value.trim() ?? '';

    setStartBusy(true);

    const locationManager = locationManagerRef.current;
    if (!currentFixRef.current) {
      const fix = await locationManager.requestOnce();
      setPermState(PERM_LABEL[locationManager.permissionState] ?? locationManager.permissionState);
      if (fix.status === 'denied' || fix.status === 'unavailable') {
        setLocStatus('位置情報が使えなかったため、地名を手入力するか、一般的な話題中心で進行します。');
        currentFixRef.current = FALLBACK_FIX;
      } else {
        currentFixRef.current = fix;
        setLocStatus('現在地の周辺情報を使って番組を進行します。');
        setLocLabel(`${fix.lat.toFixed(3)}, ${fix.lon.toFixed(3)}(約100m格子に丸め済み)`);
        // 冒頭で土地に触れるため、番組を始める前に地名を解決しておく(最大3秒)
        await ensureAreaName(fix);
        // 移動検知: 意味のある移動があった時だけ fix を更新(無駄な再取得はしない)
        locationManager.watch((newFix) => {
          currentFixRef.current = newFix;
          setLocLabel(`${newFix.lat.toFixed(3)}, ${newFix.lon.toFixed(3)}(移動を検知し更新)`);
        });
      }
    }

    setStarted(true);
    await audioPipelineRef.current.start();
    setIsPlaying(true);
    setStartBusy(false);
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

  function togglePref(key) {
    setPrefs((prev) => ({ ...prev, [key]: !prev[key] }));
  }

  return (
    <div className="app">
      <h1>📻 まちかどラジオ</h1>
      <p className="tagline">今いる場所のまわりの情報を、2人のパーソナリティがテンポよく話し続けます。</p>

      <div id="panel-setup" className={`card${started ? ' hidden' : ''}`}>
        <div className="perm-row">
          <span>位置情報の許可状態</span>
          <strong id="permState">{permState}</strong>
        </div>
        <div className="perm-purpose">
          「開始」を押すと位置情報の利用許可を確認します。取得した位置は
          <strong>周辺のランチ・カフェ・文化施設・天気・豆知識を探す目的だけ</strong>
          に使い、約100mの粒度に丸めてから利用します(正確な座標を必要以上に外部へ送りません)。拒否した場合は一般的な話題中心で進行します。
        </div>

        <div className="prefs">
          <label>
            <input type="checkbox" checked={prefs.weather} onChange={() => togglePref('weather')} /> ☀️ 天気
          </label>
          <label>
            <input type="checkbox" checked={prefs.lunch} onChange={() => togglePref('lunch')} /> 🍚 ランチ
          </label>
          <label>
            <input type="checkbox" checked={prefs.cafe} onChange={() => togglePref('cafe')} /> ☕ カフェ
          </label>
          <label>
            <input type="checkbox" checked={prefs.culture} onChange={() => togglePref('culture')} /> 🖼️ 文化施設
          </label>
          <label>
            <input type="checkbox" checked={prefs.trivia} onChange={() => togglePref('trivia')} /> 💡 豆知識
          </label>
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
            <option value="browser">ブラウザ内蔵(キー不要・機械音寄り)</option>
            <option value="openai">OpenAI TTS(自然な声・要APIキー・従量課金)</option>
          </select>
          <div id="openaiKeyRow" className={ttsProvider !== 'openai' ? 'hidden' : ''}>
            <input type="password" ref={openaiKeyInputRef} placeholder="sk-... (OpenAI APIキー。保存はされません)" />
          </div>
          <div id="ttsStatus" className="hint">{ttsStatus}</div>
        </div>

        <div className="tts-select">
          <label>🍽️ お店の評価(任意・Google Places APIキー)</label>
          <input type="password" ref={googleKeyInputRef} placeholder="AIza... (未入力なら評価なしのOSMを使用)" />
          <div className="hint">
            入力すると、Googleの高評価店を評価順に紹介します。キーはこのブラウザ内だけで使い、
            サーバー経由でGoogleへ渡すだけで保存はしません(位置情報がGoogleへ送られます)。
          </div>
        </div>

        <button className="primary" onClick={handleStart} disabled={startBusy}>
          {startBusy ? '準備中…' : '▶ 番組を開始する'}
        </button>
        <div id="locStatus">{locStatus}</div>
      </div>

      <div id="panel-player" className={`card${started ? '' : ' hidden'}`}>
        <div className="now-playing">
          <div id="topicLabel">{topicLabel}</div>
          <div id="factBadge">{factBadge}</div>
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
          {transcript.map((line) => (
            <div key={line.key} className={`line ${line.speaker}`}>
              {line.speaker === 'main' ? 'ひかり' : 'そら'}: {line.text}
            </div>
          ))}
        </div>
      </div>

      <footer className="note">
        天気: Open-Meteo / スポット: OpenStreetMap(Overpass) / 豆知識: Wikipedia / 音声: ブラウザ内蔵TTSまたはOpenAI TTS。
      </footer>
    </div>
  );
}
