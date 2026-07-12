// ============================================================
// /api/elevenlabs
// 役割: ElevenLabs Text-to-Speech API へのサーバーサイドプロキシ。
// ブラウザからElevenLabsへ直接キー付きリクエストを送らずに済むようにする
// (公開デプロイ時にキーがネットワークタブへ露出するのを避けるため)。
// キーはリクエストごとに転送するだけで、サーバー側に保存・ログ出力はしない。
//
// 声(voiceId)と話し方(voice_settings)はリクエストで受け取り、無指定なら
// サーバー側の既定値を使う。出力はmp3で返す。
// ============================================================

export const runtime = 'nodejs';

import { cleanApiKey } from '../../../lib/apiKey.js';

// 日本語の読み精度は turbo/flash より multilingual_v2 の方が高い。
// 連続再生のレイテンシはプリフェッチで吸収できるため、精度優先で multilingual_v2 を既定にする。
const DEFAULT_MODEL = 'eleven_multilingual_v2';

export async function POST(request) {
  let body;
  try {
    body = await request.json();
  } catch {
    return new Response('invalid JSON body', { status: 400 });
  }

  const { apiKey, voiceId, modelId, text, voiceSettings } = body ?? {};
  // クライアントがキーを送ってくればそれを、無ければサーバーの既定キーを使う
  const key = cleanApiKey(apiKey) || cleanApiKey(process.env.ELEVENLABS_API_KEY);
  if (!key) {
    return new Response('apiKey is required', { status: 400 });
  }
  if (!voiceId || typeof voiceId !== 'string') {
    return new Response('voiceId is required', { status: 400 });
  }
  if (!text || typeof text !== 'string') {
    return new Response('text is required', { status: 400 });
  }

  const url =
    `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}` +
    `?output_format=mp3_44100_128`;

  let upstream;
  try {
    upstream = await fetch(url, {
      method: 'POST',
      headers: {
        'xi-api-key': key,
        'Content-Type': 'application/json',
        Accept: 'audio/mpeg',
      },
      body: JSON.stringify({
        text,
        model_id: modelId || DEFAULT_MODEL,
        voice_settings: voiceSettings || {
          // stabilityが低いと発話が揺らぎ、不規則な間や途切れ感の原因になるため高めに。
          stability: 0.55,
          similarity_boost: 0.8,
          // styleは高いほど表情豊かだが語尾が不安定になりやすいので控えめに。
          style: 0.25,
          use_speaker_boost: true,
          // speedを上げると語尾が詰まって不自然になりやすいため等速にする。
          speed: 1.0,
        },
      }),
    });
  } catch {
    return new Response('failed to reach ElevenLabs', { status: 502 });
  }

  if (!upstream.ok || !upstream.body) {
    const detail = await upstream.text().catch(() => '');
    return new Response(detail || 'ElevenLabs request failed', { status: upstream.status || 502 });
  }

  // ストリームを素通しせず、全量をバッファしてから返す。
  // 途中でアップストリームが切れた場合、素通しだと「途切れたMP3」が正常応答として
  // クライアントに渡り、単語の途中で音が止まる原因になる。全量バッファなら
  // 転送失敗はエラー(502)になり、クライアント側で行スキップとして安全に処理される。
  let audio;
  try {
    audio = await upstream.arrayBuffer();
  } catch {
    return new Response('ElevenLabs stream aborted', { status: 502 });
  }
  if (!audio || audio.byteLength === 0) {
    return new Response('ElevenLabs returned empty audio', { status: 502 });
  }

  return new Response(audio, {
    status: 200,
    headers: {
      'Content-Type': 'audio/mpeg',
      'Content-Length': String(audio.byteLength),
    },
  });
}
