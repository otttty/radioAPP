// ============================================================
// moderation (サーバー専用)
// ------------------------------------------------------------
// 投稿されたお便りを「他のリスナーの端末で音声として流す」前の安全チェック。
// 自分だけが聴く分には不要だが、他人に配信する以上、誹謗中傷・性的表現・
// 個人情報などをそのまま読み上げてしまうのを防ぐ必要がある。
//
// 二段構え:
//  1) ローカルの簡易チェック(常に実行): 長さ、URL、連絡先らしき文字列など。
//     APIキーが無い環境でも最低限は弾ける。
//  2) OpenAI Moderation API(キーがある場合): 実際の有害表現の判定。
//     omni-moderation-latest は無料で使える。
// ============================================================

import { cleanApiKey } from './apiKey.js';

const MAX_LEN = 600;

// 個人情報・宣伝になりやすいパターン(読み上げ前に弾く)
const PATTERNS = [
  { re: /https?:\/\/|www\.[a-z0-9-]+\.[a-z]{2,}/i, reason: 'URLは投稿できません' },
  { re: /[\w.+-]+@[\w-]+\.[\w.]{2,}/, reason: 'メールアドレスは投稿できません' },
  { re: /0\d{1,4}-?\d{1,4}-?\d{3,4}/, reason: '電話番号らしき文字列は投稿できません' },
  { re: /@[A-Za-z0-9_]{3,}/, reason: 'SNSアカウントらしき文字列は投稿できません' },
];

/**
 * 投稿テキストを検査する。
 * @param {string} text
 * @returns {Promise<{ok: true} | {ok: false, reason: string}>}
 */
export async function moderateMail(text) {
  const body = (text ?? '').trim();
  if (!body) return { ok: false, reason: '本文が空です' };
  if (body.length > MAX_LEN) return { ok: false, reason: `本文は${MAX_LEN}文字までです` };

  for (const p of PATTERNS) {
    if (p.re.test(body)) return { ok: false, reason: p.reason };
  }

  const key = cleanApiKey(process.env.OPENAI_API_KEY);
  if (!key) return { ok: true }; // キーが無い環境ではローカルチェックのみ

  try {
    const res = await fetch('https://api.openai.com/v1/moderations', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'omni-moderation-latest', input: body }),
    });
    if (!res.ok) return { ok: true }; // 判定できない時は通す(番組を止めないため)
    const data = await res.json();
    const result = data?.results?.[0];
    if (result?.flagged) {
      const cats = Object.entries(result.categories || {})
        .filter(([, v]) => v)
        .map(([k]) => k);
      console.warn('[moderation] flagged:', cats.join(','));
      return { ok: false, reason: 'この内容は番組で読み上げできません' };
    }
    return { ok: true };
  } catch (e) {
    console.warn('[moderation] check failed, allowing:', e);
    return { ok: true };
  }
}
