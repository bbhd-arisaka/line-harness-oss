import { readFileSync } from 'node:fs';
import { URL } from 'node:url';
import { describe, expect, test } from 'vitest';
import { sqliteD1 } from '../test-support/sqlite-d1.js';
import { ImportError } from './lstep-import.js';
import { linkReviewItems, listReviewItems, replaceReviewItems, unlinkReviewItem, updateReviewItem, validateReviewItems } from './lstep-match-review.js';

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

const beyond = (friendId: string, name: string) => ({ side: 'beyond', friendId, name, reason: 'no_lstep', lineName: 'めい🦭' });
const lstep = (lstepId: string, name: string) => ({ side: 'lstep', lstepId, name, reason: 'no_beyond', detail: '登録日 2026-01-01', lineName: 'めい🦭', realName: '(大門店)松井芽依' });
const nameOnly = (friendId: string, name: string, lid: string, lname: string) => ({
  side: 'beyond', friendId, name, reason: 'name_only', partnerId: lid, partnerName: lname, partnerPictureUrl: 'https://cdn.example.com/p.jpg',
});
const find = async (db: D1Database, account: string, name: string) => (await listReviewItems(db, account)).find((r) => r.name === name)!;

describe('Lステップ照合の確認リスト', () => {
  test('入れ替えても、確認済み・判断済み・紐付け済みの人は残り、アカウントごとに分かれる', async () => {
    const db = setup();
    await replaceReviewItems(db, 'a', validateReviewItems([beyond('f1', 'めい'), lstep('L1', 'あっしゅ'), beyond('f3', 'はな')]));
    await replaceReviewItems(db, 'b', validateReviewItems([beyond('f9', '別の店')]));
    const mei = await find(db, 'a', 'めい');
    const done = await updateReviewItem(db, mei.id, { status: 'resolved', note: '本人に確認済み' }, '有坂');
    expect(done).toMatchObject({ status: 'resolved', note: '本人に確認済み', resolved_by: '有坂' });
    expect(done.resolved_at).toMatch(/\+09:00$/);

    const hana = await find(db, 'a', 'はな');
    await linkReviewItems(db, hana.id, (await find(db, 'a', 'あっしゅ')).id);

    // 再計算して入れ替え: めい(確認済み)とはな・あっしゅ(紐付け済み)は残り、新しい人だけ入る
    const res = await replaceReviewItems(db, 'a', validateReviewItems([beyond('f1', 'めい'), beyond('f2', 'Eri'), beyond('f3', 'はな'), lstep('L1', 'あっしゅ')]));
    expect(res).toEqual({ inserted: 1, kept: 3 });
    const second = await listReviewItems(db, 'a');
    expect(second.map((r) => `${r.name}:${r.status}:${r.decision ?? '-'}`).sort()).toEqual(['Eri:open:-', 'あっしゅ:open:link', 'はな:open:link', 'めい:resolved:-']);
    expect(await listReviewItems(db, 'b')).toHaveLength(1);

    const back = await updateReviewItem(db, mei.id, { status: 'open', note: '' }, '有坂');
    expect(back).toMatchObject({ status: 'open', note: null, resolved_by: null, resolved_at: null });
  });

  test('名前だけで結びつけた人に、「同じ人」「別の人」を判断できる。結びつけた相手も保存される', async () => {
    const db = setup();
    await replaceReviewItems(db, 'a', validateReviewItems([nameOnly('f1', '(大門店)佐藤', 'L9', '佐藤さん')]));
    const row = await find(db, 'a', '(大門店)佐藤');
    expect(row).toMatchObject({ partner_id: 'L9', partner_name: '佐藤さん', partner_picture_url: 'https://cdn.example.com/p.jpg', decision: null });
    const diff = await updateReviewItem(db, row.id, { decision: 'different', note: '別人でした' }, '有坂');
    expect(diff).toMatchObject({ decision: 'different', status: 'open' });
    const same = await updateReviewItem(db, row.id, { decision: 'same', status: 'resolved' }, '有坂');
    expect(same).toMatchObject({ decision: 'same', status: 'resolved', note: '別人でした' });
    await expect(updateReviewItem(db, row.id, { decision: 'link' }, 'x')).rejects.toThrow(/紐付け/);
    // 画像は、最新の画像(または初期アイコン=null)に直せる
    expect(row.partner_picture_url).toBe('https://cdn.example.com/p.jpg');
    expect((await updateReviewItem(db, row.id, { partnerPictureUrl: null }, 'x')).partner_picture_url).toBeNull();
    expect((await updateReviewItem(db, row.id, { partnerPictureUrl: 'https://cdn.example.com/new.jpg' }, 'x')).partner_picture_url).toBe('https://cdn.example.com/new.jpg');
    await expect(updateReviewItem(db, row.id, { partnerPictureUrl: 'http://x/y.jpg' }, 'x')).rejects.toThrow(/https/);
    await expect(updateReviewItem(db, row.id, { decision: 'nope' }, 'x')).rejects.toBeInstanceOf(ImportError);
  });

  test('手で紐付けると、両方の行に相手が記録され、解除すると両方戻る', async () => {
    const db = setup();
    await replaceReviewItems(db, 'a', validateReviewItems([beyond('f1', 'めい🦭'), lstep('L1', '松井芽依'), lstep('L2', '別の人')]));
    await replaceReviewItems(db, 'b', validateReviewItems([lstep('L7', '他店の人')]));
    const mei = await find(db, 'a', 'めい🦭');
    const matsui = await find(db, 'a', '松井芽依');
    const { a, b } = await linkReviewItems(db, mei.id, matsui.id);
    expect(a).toMatchObject({ partner_id: 'L1', partner_name: '松井芽依', partner_line_name: 'めい🦭', partner_real_name: '(大門店)松井芽依', decision: 'link' });
    expect(b).toMatchObject({ partner_id: 'f1', partner_name: 'めい🦭', partner_line_name: 'めい🦭', decision: 'link' });

    // すでに紐付け済み・同じ側どうし・別アカウントは拒否
    await expect(linkReviewItems(db, mei.id, (await find(db, 'a', '別の人')).id)).rejects.toThrow(/すでに紐付け/);
    await expect(linkReviewItems(db, (await find(db, 'a', '別の人')).id, 'x')).rejects.toMatchObject({ status: 404 });
    await expect(linkReviewItems(db, (await find(db, 'a', '別の人')).id, (await find(db, 'b', '他店の人')).id)).rejects.toThrow(/別のアカウント|1人ずつ/);

    const rows = await unlinkReviewItem(db, matsui.id);
    expect(rows).toHaveLength(2);
    for (const r of rows) expect(r).toMatchObject({ partner_id: null, partner_line_name: null, decision: null });
    await expect(unlinkReviewItem(db, mei.id)).rejects.toThrow(/紐付けされていません/);
  });

  test('不正な入力・存在しない相手は拒否する', async () => {
    const db = setup();
    expect(() => validateReviewItems('x')).toThrow(ImportError);
    expect(() => validateReviewItems([{ side: 'beyond', name: 'x', reason: 'no_lstep' }])).toThrow(/friendId/);
    expect(() => validateReviewItems([{ side: 'lstep', name: 'x', reason: 'no_beyond' }])).toThrow(/lstepId/);
    expect(() => validateReviewItems([{ ...beyond('f', 'x'), reason: 'nope' }])).toThrow(/reason/);
    expect(() => validateReviewItems([{ ...beyond('f', 'x'), pictureUrl: 'javascript:alert(1)' }])).toThrow(/https/);
    expect(() => validateReviewItems([{ ...beyond('f', 'x'), partnerPictureUrl: 'http://x/y.jpg' }])).toThrow(/https/);
    expect(() => validateReviewItems(Array.from({ length: 501 }, (_, i) => beyond(`f${i}`, 'x')))).toThrow(/500/);
    await expect(replaceReviewItems(db, 'zzz', [])).rejects.toMatchObject({ status: 404 });
    await expect(updateReviewItem(db, 'nope', { status: 'resolved' }, 'x')).rejects.toMatchObject({ status: 404 });
    await replaceReviewItems(db, 'a', validateReviewItems([beyond('f1', 'x')]));
    await expect(updateReviewItem(db, (await find(db, 'a', 'x')).id, { status: 'bad' }, 'x')).rejects.toBeInstanceOf(ImportError);
  });
});
