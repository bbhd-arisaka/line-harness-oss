import { readFileSync } from 'node:fs';
import { URL } from 'node:url';
import { describe, expect, test } from 'vitest';
import { sqliteD1 } from '../test-support/sqlite-d1.js';
import { buildFriendFilterPieces, FilterError, parseFriendFilter } from './friend-filter.js';

const schema = readFileSync(new URL('../../../../packages/db/bootstrap.sql', import.meta.url), 'utf8');

function setup() {
  const { sqlite } = sqliteD1();
  sqlite.exec(schema);
  sqlite.exec(`INSERT INTO line_accounts(id,channel_id,name,channel_secret,channel_access_token) VALUES('acc','ch','A店','s','t')`);
  const ins = sqlite.prepare('INSERT INTO friends(id,line_user_id,line_account_id,display_name,real_name,system_display_name,memo,status_message,is_following,metadata,created_at,ref_code) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)');
  ins.run('f1', 'U1', 'acc', 'yuina', '四ノ宮 結菜', null, '常連さん', 'よろしく', 1, '{"score":"3","visit":"2026-08-10","area":"東京"}', '2026-08-10T14:39:00.000+09:00', 'insta');
  ins.run('f2', 'U2', 'acc', 'HARUNA', null, '中村(tameike)', null, null, 1, '{"score":"20","visit":"2026-09-01"}', '2025-10-20T13:51:00.000+09:00', null);
  ins.run('f3', 'U3', 'acc', 'ブロック済み', null, null, null, null, 0, '{}', '2026-01-01T00:00:00.000+09:00', null);
  sqlite.exec(`INSERT INTO tags(id,name) VALUES('t1','大門浜松町店'),('t2','VIP'),('t3','来店済み')`);
  sqlite.exec(`INSERT INTO friend_tags(friend_id,tag_id) VALUES('f1','t1'),('f1','t2'),('f2','t1')`);
  sqlite.exec(`INSERT INTO chats(id,friend_id,status,created_at,updated_at) VALUES('c1','f1','unread','2026-10-01','2026-10-01'),('c2','f2','resolved','2026-10-01','2026-10-01')`);
  sqlite.exec(`INSERT INTO scenarios(id,name,trigger_type) VALUES('s1','追加時','friend_add')`);
  sqlite.exec(`INSERT INTO friend_scenarios(id,friend_id,scenario_id,status) VALUES('fs1','f1','s1','active')`);
  sqlite.exec(`INSERT INTO forms(id,name,fields) VALUES('form1','カウンセリング','[]')`);
  sqlite.exec(`INSERT INTO form_submissions(id,form_id,friend_id,data) VALUES('sub1','form1','f2','{}')`);
  sqlite.exec(`INSERT INTO messages_log(id,friend_id,direction,message_type,content,created_at) VALUES('m1','f1','incoming','text','こんにちは','2026-10-03T11:33:00.000+09:00'),('m2','f2','incoming','text','やあ','2026-09-01T10:00:00.000+09:00')`);
  sqlite.exec(`INSERT INTO reserve_calendars(id,line_account_id,name) VALUES('cal1','acc','面談')`);
  sqlite.exec(`INSERT INTO reserve_slots(id,calendar_id,name) VALUES('sl1','cal1','S1')`);
  sqlite.exec(`INSERT INTO reserve_courses(id,calendar_id,name,duration_minutes) VALUES('co1','cal1','C1',30)`);
  sqlite.exec(`INSERT INTO reserve_bookings(id,calendar_id,line_account_id,friend_id,slot_id,course_id,starts_at,ends_at,status,visited) VALUES
    ('b1','cal1','acc','f1','sl1','co1','2999-01-01T10:00','2999-01-01T10:30','confirmed',0),
    ('b2','cal1','acc','f2',NULL,NULL,'2020-01-01T10:00','2020-01-01T10:30','confirmed',1)`);
  const run = (filter: unknown): string[] => {
    const pieces = buildFriendFilterPieces(parseFriendFilter(filter));
    const where = pieces.length ? `WHERE ${pieces.map((p) => p.sql).join(' AND ')}` : '';
    const rows = sqlite.prepare(`SELECT f.id FROM friends f ${where} ORDER BY f.id`).all(...pieces.flatMap((p) => p.binds)) as { id: string }[];
    return rows.map((r) => r.id);
  };
  return { run };
}

describe('友だちの詳細検索(条件→SQL)', () => {
  test('既定は、ブロックしていない友だちだけ。表示設定で切り替えられる', () => {
    const { run } = setup();
    expect(run({})).toEqual(['f1', 'f2']);
    expect(run({ showFollowing: false, showBlocked: true })).toEqual(['f3']);
    expect(run({ showFollowing: true, showBlocked: true })).toEqual(['f1', 'f2', 'f3']);
    expect(run({ showFollowing: false, showBlocked: false })).toEqual([]);
  });

  test('名前: LINE名・本名・システム表示名から。半角スペース区切りはいずれか', () => {
    const { run } = setup();
    expect(run({ and: [{ type: 'name', value: '四ノ宮', targets: ['real'] }] })).toEqual(['f1']);
    expect(run({ and: [{ type: 'name', value: '四ノ宮', targets: ['display'] }] })).toEqual([]);
    expect(run({ and: [{ type: 'name', value: 'tameike', targets: ['display', 'real', 'system'] }] })).toEqual(['f2']);
    expect(run({ and: [{ type: 'name', value: '四ノ宮 tameike', targets: ['real', 'system'] }] })).toEqual(['f1', 'f2']);
    // LIKE のワイルドカードは、ただの文字として扱う
    expect(run({ and: [{ type: 'name', value: '%', targets: ['display', 'real', 'system'] }] })).toEqual([]);
  });

  test('個別メモ・ステータスメッセージ・友だち登録日・流入経路', () => {
    const { run } = setup();
    expect(run({ and: [{ type: 'memo', op: 'contains', value: '常連' }] })).toEqual(['f1']);
    expect(run({ and: [{ type: 'memo', op: 'missing', value: '' }] })).toEqual(['f2']);
    expect(run({ and: [{ type: 'statusMessage', value: 'よろしく' }] })).toEqual(['f1']);
    expect(run({ and: [{ type: 'addedDate', from: '2026-01-01', to: null }] })).toEqual(['f1']);
    expect(run({ and: [{ type: 'addedDate', from: '2025-10-01', to: '2025-10-31' }] })).toEqual(['f2']);
    expect(run({ and: [{ type: 'inflow', value: 'insta' }] })).toEqual(['f1']);
  });

  test('カレンダー予約: 予約している人・来店済みの人・予約枠やコースの指定', () => {
    const { run } = setup();
    expect(run({ and: [{ type: 'reserve', calendarId: 'cal1', state: 'booked', slotId: null, courseId: null }] })).toEqual(['f1']);
    expect(run({ and: [{ type: 'reserve', calendarId: 'cal1', state: 'ever', slotId: null, courseId: null }] })).toEqual(['f1', 'f2']);
    expect(run({ and: [{ type: 'reserve', calendarId: 'cal1', state: 'visited', slotId: null, courseId: null }] })).toEqual(['f2']);
    expect(run({ and: [{ type: 'reserve', calendarId: 'cal1', state: 'none', slotId: null, courseId: null }] })).toEqual([]);
    expect(run({ and: [{ type: 'reserve', calendarId: 'cal1', state: 'booked', slotId: 'sl1', courseId: 'co1' }] })).toEqual(['f1']);
    expect(run({ and: [{ type: 'reserve', calendarId: 'cal1', state: 'booked', slotId: 'other', courseId: null }] })).toEqual([]);
    expect(() => parseFriendFilter({ and: [{ type: 'reserve', calendarId: 'cal1', state: 'x' }] })).toThrow(FilterError);
  });

  test('対応マーク・シナリオ・回答フォーム・最終反応日', () => {
    const { run } = setup();
    expect(run({ and: [{ type: 'chatStatus', statuses: ['unread'] }] })).toEqual(['f1']);
    expect(run({ and: [{ type: 'chatStatus', statuses: ['resolved', 'in_progress'] }] })).toEqual(['f2']);
    expect(run({ and: [{ type: 'scenario', scenarioId: 's1', state: 'active' }] })).toEqual(['f1']);
    expect(run({ and: [{ type: 'scenario', scenarioId: 's1', state: 'none' }] })).toEqual(['f2']);
    expect(run({ and: [{ type: 'form', formId: 'form1', answered: true }] })).toEqual(['f2']);
    expect(run({ and: [{ type: 'form', formId: 'form1', answered: false }] })).toEqual(['f1']);
    expect(run({ and: [{ type: 'lastReaction', from: '2026-10-01', to: null }] })).toEqual(['f1']);
    expect(run({ and: [{ type: 'lastReaction', from: null, to: '2026-09-30' }] })).toEqual(['f2']);
  });

  test('タグ: いずれか/すべて/除外(いずれか)/除外(すべて)', () => {
    const { run } = setup();
    const tag = (mode: string, tagIds: string[]) => run({ and: [{ type: 'tag', mode, tagIds }] });
    expect(tag('any', ['t2', 't3'])).toEqual(['f1']);
    expect(tag('all', ['t1', 't2'])).toEqual(['f1']);
    expect(tag('all', ['t1', 't3'])).toEqual([]);
    expect(tag('none_any', ['t2'])).toEqual(['f2']);
    expect(tag('none_all', ['t1', 't2'])).toEqual(['f2']);
  });

  test('友だち情報: 完全一致/部分一致/登録あり・なし/除外/数値・日付の大小', () => {
    const { run } = setup();
    const field = (op: string, value = '') => run({ and: [{ type: 'field', fieldKey: 'score', op, value }] });
    expect(field('eq', '3')).toEqual(['f1']);
    expect(field('neq', '3')).toEqual(['f2']);
    expect(field('contains', '2')).toEqual(['f2']);
    expect(field('ncontains', '2')).toEqual(['f1']);
    expect(field('exists')).toEqual(['f1', 'f2']);
    expect(run({ and: [{ type: 'field', fieldKey: 'area', op: 'missing', value: '' }] })).toEqual(['f2']);
    // 数字は数値で比べる(文字なら "3" > "20" になってしまう)
    expect(field('gt', '10')).toEqual(['f2']);
    expect(field('lte', '3')).toEqual(['f1']);
    // 日付(YYYY-MM-DD)は文字で比べる
    expect(run({ and: [{ type: 'field', fieldKey: 'visit', op: 'gte', value: '2026-09-01' }] })).toEqual(['f2']);
    expect(run({ and: [{ type: 'field', fieldKey: 'visit', op: 'lt', value: '2026-09-01' }] })).toEqual(['f1']);
  });

  test('and と or の組み合わせ: andは全部、orグループは「どれか」', () => {
    const { run } = setup();
    const t1 = { type: 'tag', mode: 'any', tagIds: ['t1'] };
    expect(run({ and: [t1], or: [[{ type: 'tag', mode: 'any', tagIds: ['t2'] }, { type: 'memo', op: 'missing', value: '' }]] })).toEqual(['f1', 'f2']);
    expect(run({ and: [t1, { type: 'chatStatus', statuses: ['unread'] }], or: [[{ type: 'memo', op: 'contains', value: '常連' }]] })).toEqual(['f1']);
    // orグループが複数あるときは、すべてのグループを満たす必要がある(各グループの中ではどれか1つ)
    expect(run({ or: [[{ type: 'memo', op: 'contains', value: '常連' }, { type: 'memo', op: 'missing', value: '' }], [{ type: 'tag', mode: 'any', tagIds: ['t1'] }]] })).toEqual(['f1', 'f2']);
    expect(run({ or: [[{ type: 'memo', op: 'contains', value: 'なし' }], [{ type: 'tag', mode: 'any', tagIds: ['t1'] }]] })).toEqual([]);
  });

  test('不正な条件は拒否する(友だち情報のキーは英数字のみ・日付形式・条件数)', () => {
    expect(() => parseFriendFilter({ and: [{ type: 'field', fieldKey: "a') OR 1=1 --", op: 'eq', value: 'x' }] })).toThrow(FilterError);
    expect(() => parseFriendFilter({ and: [{ type: 'addedDate', from: '2026/01/01', to: null }] })).toThrow(/YYYY-MM-DD/);
    expect(() => parseFriendFilter({ and: [{ type: 'name', value: 'x', targets: [] }] })).toThrow(/対象/);
    expect(() => parseFriendFilter({ and: [{ type: 'tag', mode: 'any', tagIds: [] }] })).toThrow(/タグ/);
    expect(() => parseFriendFilter({ and: [{ type: 'unknown' }] })).toThrow(/未対応/);
    expect(() => parseFriendFilter({ and: Array.from({ length: 41 }, () => ({ type: 'memo', op: 'exists', value: '' })) })).toThrow(/40個/);
  });
});
