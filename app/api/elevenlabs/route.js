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

const DEFAULT_MODEL = 'eleven_turbo_v2_5'; // 日本語対応・低レイテンシで連続再生向き

export async function POST(request) {
  let body;
  try {
    body = await request.json();
  } catch {
    return new Response('invalid JSON body', { status: 400 });
  }

  const { apiKey, voiceId, modelId, text, voiceSettings } = body ?? {};
  if (!apiKey || typeof apiKey !== 'string') {
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
        'xi-api-key': apiKey,
        'Content-Type': 'application/json',
        Accept: 'audio/mpeg',
      },
      body: JSON.stringify({
        text,
        model_id: modelId || DEFAULT_MODEL,
        voice_settings: voiceSettings || {
          stability: 0.4,
          similarity_boost: 0.85,
          style: 0.35,
          use_speaker_boost: true,
          speed: 1.05,
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

  return new Response(upstream.body, {
    status: 200,
    headers: { 'Content-Type': 'audio/mpeg' },
  });
}
