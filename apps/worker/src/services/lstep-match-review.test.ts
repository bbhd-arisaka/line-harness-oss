import { readFileSync } from 'node:fs';
import { URL } from 'node:url';
import { describe, expect, test } from 'vitest';
import { sqliteD1 } from '../test-support/sqlite-d1.js';
import { ImportError } from './lstep-import.js';
import { listReviewItems, replaceReviewItems, updateReviewItem, validateReviewItems } from './lstep-match-review.js';

const schema = readFileSync(new URL('../../../../packages/db/bootstrap.sql', import.meta.url), 'utf8');

function setup() {
  const { db, sqlite } = sqliteD1();
  sqlite.exec(schema);
  // テスト用の D1 には batch が無いので、順番どおり1件ずつ実行して代用する
  db.batch = async <T>(statements: D1PreparedStatement[]) => {
    const out: D1Result<T>[] = [];
    for (const st of statements) out.push(await st.run<T>());
    return out;
  };
  sqlite.exec(`INSERT INTO line_accounts(id,channel_id,name,channel_secret,channel_access_token) VALUES('a','ch-a','A店','s','t'),('b','ch-b','B店','s','t')`);
  return db;
}

const beyond = (friendId: string, name: string) => ({ side: 'beyond', friendId, name, reason: 'no_lstep' });
const lstep = (lstepId: string, name: string) => ({ side: 'lstep', lstepId, name, reason: 'no_beyond', detail: '登録日 2026-01-01' });

describe('Lステップ照合の確認リスト', () => {
  test('入れ替えても、確認済みにした人は残り、アカウントごとに分かれる', async () => {
    const db = setup();
    await replaceReviewItems(db, 'a', validateReviewItems([beyond('f1', 'めい'), lstep('L1', 'あっしゅ')]));
    await replaceReviewItems(db, 'b', validateReviewItems([beyond('f9', '別の店')]));
    const first = await listReviewItems(db, 'a');
    expect(first.map((r) => r.name).sort()).toEqual(['あっしゅ', 'めい']);
    const mei = first.find((r) => r.name === 'めい')!;
    const done = await updateReviewItem(db, mei.id, 'resolved', '本人に確認済み', '有坂');
    expect(done).toMatchObject({ status: 'resolved', note: '本人に確認済み', resolved_by: '有坂' });
    expect(done.resolved_at).toMatch(/\+09:00$/);

    // 再計算して入れ替え: めいは残り(確認済みのまま)、あっしゅは消え、新しい人が入る
    const res = await replaceReviewItems(db, 'a', validateReviewItems([beyond('f1', 'めい'), beyond('f2', 'Eri')]));
    expect(res).toEqual({ inserted: 1, keptResolved: 1 });
    const second = await listReviewItems(db, 'a');
    expect(second.map((r) => `${r.name}:${r.status}`).sort()).toEqual(['Eri:open', 'めい:resolved']);
    expect(await listReviewItems(db, 'b')).toHaveLength(1);

    const back = await updateReviewItem(db, mei.id, 'open', '', '有坂');
    expect(back).toMatchObject({ status: 'open', note: null, resolved_by: null, resolved_at: null });
  });

  test('不正な入力・存在しない相手は拒否する', async () => {
    const db = setup();
    expect(() => validateReviewItems('x')).toThrow(ImportError);
    expect(() => validateReviewItems([{ side: 'beyond', name: 'x', reason: 'no_lstep' }])).toThrow(/friendId/);
    expect(() => validateReviewItems([{ side: 'lstep', name: 'x', reason: 'no_beyond' }])).toThrow(/lstepId/);
    expect(() => validateReviewItems([{ ...beyond('f', 'x'), reason: 'nope' }])).toThrow(/reason/);
    expect(() => validateReviewItems([{ ...beyond('f', 'x'), pictureUrl: 'javascript:alert(1)' }])).toThrow(/https/);
    expect(() => validateReviewItems(Array.from({ length: 501 }, (_, i) => beyond(`f${i}`, 'x')))).toThrow(/500/);
    await expect(replaceReviewItems(db, 'zzz', [])).rejects.toMatchObject({ status: 404 });
    await expect(updateReviewItem(db, 'nope', 'resolved', null, 'x')).rejects.toMatchObject({ status: 404 });
    await expect(updateReviewItem(db, 'nope', 'bad', null, 'x')).rejects.toBeInstanceOf(ImportError);
  });
});
