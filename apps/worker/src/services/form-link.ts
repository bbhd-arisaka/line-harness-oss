import { getLineAccountById, resolveDefaultLineAccount } from '@line-crm/db';

/** フォームのタグコード: `{{form_url:フォームID}}`。管理画面では青い枠の「フォーム」として表示される。 */
const FORM_TAG_RE = /\{\{form_url:([^}\s]+)\}\}/g;

export function hasFormTag(content: string): boolean {
  return content.includes('{{form_url:');
}

/**
 * 本文中のフォームのタグコードを、送信アカウントの LIFF で組み立てた URL に置き換える。
 * LIFF ID はアカウントごとに違うため、必ず「実際に送るアカウント」のものを使う。
 * (別アカウントの LIFF で作ると、その友だちが開けない/別アカウントの友だちとして回答されてしまう)
 *
 * LIFF が未設定のときは置換しない(空文字にすると「リンクが消えたメッセージ」が届いて気づけないため)。
 */
export async function expandFormLinks(
  db: D1Database,
  content: string,
  lineAccountId: string | null,
): Promise<string> {
  if (!hasFormTag(content)) return content;
  let liffId: string | null = null;
  try {
    const account = lineAccountId
      ? await getLineAccountById(db, lineAccountId)
      : await resolveDefaultLineAccount(db);
    liffId = account?.liff_id ?? null;
  } catch {
    liffId = null;
  }
  if (!liffId) return content;
  return content.replace(FORM_TAG_RE, (_m, formId: string) => `https://liff.line.me/${liffId}?page=form&id=${formId.trim()}`);
}
