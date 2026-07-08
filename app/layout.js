import './globals.css';

export const metadata = {
  title: 'お昼のラジオ - あなただけのローカルラジオ',
  description:
    '現在地周辺の天気・ランチ・カフェ・文化施設・豆知識を、2人のパーソナリティが掛け合いで届けるローカルラジオWebアプリ。',
};

export const viewport = {
  width: 'device-width',
  initialScale: 1,
};

export default function RootLayout({ children }) {
  return (
    <html lang="ja">
      <body>{children}</body>
    </html>
  );
}
