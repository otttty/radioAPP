// ============================================================
// middleware (アクセス制限ゲート)
// ------------------------------------------------------------
// 役割: サイト全体(ページ + /api/* )に Basic 認証をかけ、パスワードを
// 知っている人だけがアクセスできるようにする。公開URLで既定APIキーが
// 誰でも使える状態(=課金の悪用)を防ぐのが目的。
//
// - 合言葉は環境変数 SITE_PASSWORD で設定する。
// - SITE_PASSWORD が未設定なら素通し(ローカル開発やゲート無効化用)。
// - ユーザー名は任意(空でも可)。パスワードだけを照合する。
// - APIルートも保護対象なので、UIを回避して直接叩かれても弾ける。
//   ブラウザは一度認証すると同一オリジンのfetchにも資格情報を自動付与するため、
//   アプリ内の /api/* 呼び出しは認証後そのまま通る。
// ============================================================

import { NextResponse } from 'next/server';

export const config = {
  // 静的アセットは保護対象から除外(ページと /api/* を保護)
  matcher: ['/((?!_next/static|_next/image|favicon.ico|robots.txt).*)'],
};

export function middleware(request) {
  const password = process.env.SITE_PASSWORD;
  // パスワード未設定ならゲート無効(素通し)
  if (!password) return NextResponse.next();

  const auth = request.headers.get('authorization') || '';
  if (auth.startsWith('Basic ')) {
    try {
      const decoded = atob(auth.slice(6)); // "username:password"
      const idx = decoded.indexOf(':');
      const pass = idx >= 0 ? decoded.slice(idx + 1) : decoded;
      if (pass === password) return NextResponse.next();
    } catch {
      /* 不正なヘッダは未認証扱い */
    }
  }

  return new NextResponse('このサイトは合言葉で保護されています。', {
    status: 401,
    headers: { 'WWW-Authenticate': 'Basic realm="machikado-radio", charset="UTF-8"' },
  });
}
