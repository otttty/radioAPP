// ============================================================
// /api/config
// 役割: どのプロバイダにサーバー側の既定APIキーが設定されているかを、
// 真偽値だけでクライアントに知らせる(キーそのものは絶対に返さない)。
// クライアントはこれを見て「キー未入力でも開始できる」と判断する。
// ============================================================

export const runtime = 'nodejs';

export async function GET() {
  return Response.json({
    elevenlabs: !!process.env.ELEVENLABS_API_KEY,
    openai: !!process.env.OPENAI_API_KEY,
    google: !!process.env.GOOGLE_PLACES_API_KEY,
  });
}
