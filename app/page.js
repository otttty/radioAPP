'use client';

import dynamic from 'next/dynamic';

// LunchRadioApp は Geolocation / Web Speech / Web Audio といったブラウザ専用APIに
// 依存しているため、サーバーサイドレンダリングを無効化してクライアントのみで読み込む。
const LunchRadioApp = dynamic(() => import('@/components/LunchRadioApp'), {
  ssr: false,
});

export default function Page() {
  return <LunchRadioApp />;
}
