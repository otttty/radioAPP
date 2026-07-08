// ============================================================
// /api/tts
// 役割: OpenAI TTS (/v1/audio/speech) へのサーバーサイドプロキシ。
// ブラウザからOpenAIへ直接キー付きリクエストを送らずに済むようにする
// (公開デプロイ時にキーが第三者オリジンへの通信としてネットワークタブに
// 露出するのを避けるため)。キーはリクエストごとに転送するだけで、
// サーバー側にも保存・ログ出力はしない。
// ============================================================

export const runtime = 'nodejs';

export async function POST(request) {
  let body;
  try {
    body = await request.json();
  } catch {
    return new Response('invalid JSON body', { status: 400 });
  }

  const { apiKey, model, voice, input, instructions, speed } = body ?? {};
  if (!apiKey || typeof apiKey !== 'string') {
    return new Response('apiKey is required', { status: 400 });
  }
  if (!input || typeof input !== 'string') {
    return new Response('input is required', { status: 400 });
  }

  let upstream;
  try {
    upstream = await fetch('https://api.openai.com/v1/audio/speech', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: model || 'gpt-4o-mini-tts',
        voice: voice || 'shimmer',
        input,
        instructions,
        speed: typeof speed === 'number' ? speed : undefined,
        response_format: 'mp3',
      }),
    });
  } catch (e) {
    return new Response('failed to reach OpenAI', { status: 502 });
  }

  if (!upstream.ok || !upstream.body) {
    const detail = await upstream.text().catch(() => '');
    return new Response(detail || 'OpenAI TTS request failed', { status: upstream.status || 502 });
  }

  return new Response(upstream.body, {
    status: 200,
    headers: { 'Content-Type': 'audio/mpeg' },
  });
}
