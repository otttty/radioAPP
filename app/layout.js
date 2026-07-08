import './globals.css';

export const metadata = {
  title: 'まちかどラジオ - あなただけのローカルラジオ',
  description:
    '現在地周辺の天気・グルメ・カフェ・文化施設・豆知識を、2人のパーソナリティが時間帯に合わせた掛け合いで届けるローカルラジオWebアプリ。',
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
