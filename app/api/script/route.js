// ============================================================
// /api/script
// 役割: 台本生成LLM(OpenAI Chat Completions)へのサーバーサイドプロキシ。
// ブラウザからOpenAIへ直接キー付きリクエストを送らずに済むようにする。
// キーはリクエストごとに転送するだけで、サーバー側に保存・ログ出力はしない。
//
// クライアント(ScriptGenerator)が組み立てた messages をそのまま渡し、
// JSONで台本の行(lines)を返させる。事実だけを使う/出典に触れないといった
// 制約は messages 側(system/user プロンプト)で強制している。
// ============================================================

export const runtime = 'nodejs';

export async function POST(request) {
  let body;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: 'invalid JSON body' }, { status: 400 });
  }

  const { apiKey, model, messages, temperature } = body ?? {};
  // クライアントがキーを送ってくればそれを、無ければサーバーの既定キーを使う
  const key = (typeof apiKey === 'string' && apiKey.trim()) || process.env.OPENAI_API_KEY;
  if (!key) {
    return Response.json({ error: 'apiKey is required' }, { status: 400 });
  }
  if (!Array.isArray(messages) || messages.length === 0) {
    return Response.json({ error: 'messages is required' }, { status: 400 });
  }

  let upstream;
  try {
    upstream = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: model || 'gpt-4.1-mini',
        messages,
        temperature: typeof temperature === 'number' ? temperature : 0.9,
        response_format: { type: 'json_object' },
        max_tokens: 700,
      }),
    });
  } catch {
    return Response.json({ error: 'failed to reach OpenAI' }, { status: 502 });
  }

  if (!upstream.ok) {
    const detail = await upstream.text().catch(() => '');
    return Response.json({ error: detail?.slice(0, 300) || 'OpenAI request failed' }, { status: upstream.status || 502 });
  }

  const data = await upstream.json().catch(() => ({}));
  const content = data?.choices?.[0]?.message?.content ?? '';
  return Response.json({ content });
}
