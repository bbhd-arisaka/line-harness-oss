import { readFileSync } from 'node:fs';
import { URL } from 'node:url';
import { beforeEach, describe, expect, it } from 'vitest';
import { sqliteD1 } from '../test-support/sqlite-d1.js';
import { loadFormAnalytics } from './form-analytics.js';

const NOW = Date.parse('2026-10-18T12:00:00+09:00');

describe('フォーム分析', () => {
  const schema = readFileSync(new URL('../../../../packages/db/bootstrap.sql', import.meta.url), 'utf8');
  let fixture: ReturnType<typeof sqliteD1>;
  beforeEach(() => {
    fixture = sqliteD1();
    const db = fixture.sqlite;
    db.exec(schema);
    for (const id of ['a1', 'a2']) db.prepare('INSERT INTO line_accounts(id,channel_id,name,channel_access_token,channel_secret) VALUES(?,?,?,?,?)').run(id, `c-${id}`, id, 'tok', 'sec');
    db.prepare('INSERT INTO friends(id,line_user_id,line_account_id) VALUES(?,?,?)').run('f1', 'u1', 'a1');
    db.prepare('INSERT INTO friends(id,line_user_id,line_account_id) VALUES(?,?,?)').run('f2', 'u2', 'a2');
    db.prepare('INSERT INTO form_folders(id,name,display_order,created_at,updated_at) VALUES(?,?,0,?,?)').run('fo1', '面談', 'x', 'x');
    db.prepare('INSERT INTO forms(id,name,folder_id) VALUES(?,?,?)').run('F1', '面談予約', 'fo1');
    db.prepare('INSERT INTO forms(id,name) VALUES(?,?)').run('F2', 'アンケート');
    db.prepare('INSERT INTO forms(id,name) VALUES(?,?)').run('F3', '回答なし');
    const sub = db.prepare('INSERT INTO form_submissions(id,form_id,friend_id,data,created_at) VALUES(?,?,?,?,?)');
    sub.run('s1', 'F1', 'f1', '{}', '2026-10-02T10:00:00.000+09:00');
    sub.run('s2', 'F1', 'f1', '{}', '2026-10-17T10:00:00.000+09:00');
    sub.run('s3', 'F1', 'f1', '{}', '2026-09-30T23:59:00.000+09:00');
    sub.run('s4', 'F2', 'f1', '{}', '2026-10-05T10:00:00.000+09:00');
    sub.run('s5', 'F2', 'f2', '{}', '2026-10-05T10:00:00.000+09:00'); // 別のアカウント
    sub.run('s6', 'F2', null, '{}', '2026-10-05T10:00:00.000+09:00'); // 友だち不明は数えない
  });

  it('フォーム×月(日本時間)の回答数。別のアカウント・友だち不明・回答のないフォームは入らない', async () => {
    const r = await loadFormAnalytics(fixture.db, 'a1', NOW);
    expect(r.currentMonth).toBe('2026-10');
    expect(r.forms).toEqual([
      { id: 'F1', name: '面談予約', folder: '面談', counts: { '2026-10': 2, '2026-09': 1 } },
      { id: 'F2', name: 'アンケート', folder: null, counts: { '2026-10': 1 } },
    ]);
  });

  it('お気に入りの項目: 選択肢ごとの人数(月別)。選択肢に無い回答は「その他」・未回答は数えない・別アカウントは入らない', async () => {
    const db = fixture.sqlite;
    const fields = [
      { name: 'q1', label: 'きっかけ', type: 'checkbox', options: ['紹介', 'SNS', '通りがかり'], favorite: true },
      { name: 'q2', label: 'メモ', type: 'textarea', favorite: true },
      { name: 'q3', label: '年代', type: 'radio', options: ['20代', '30代'] },
    ];
    db.prepare('UPDATE forms SET fields = ? WHERE id = ?').run(JSON.stringify(fields), 'F2');
    const upd = db.prepare('UPDATE form_submissions SET data = ? WHERE id = ?');
    upd.run(JSON.stringify({ q1: ['紹介', 'SNS'], q2: 'x' }), 's4');
    upd.run(JSON.stringify({ q1: ['紹介'] }), 's5'); // 別のアカウント
    db.prepare('INSERT INTO form_submissions(id,form_id,friend_id,data,created_at) VALUES(?,?,?,?,?)').run(
      's7', 'F2', 'f1', JSON.stringify({ q1: ['その他(友人)', '知らない選択肢'] }), '2026-09-10T10:00:00.000+09:00',
    );
    db.prepare('INSERT INTO form_submissions(id,form_id,friend_id,data,created_at) VALUES(?,?,?,?,?)').run(
      's8', 'F2', 'f1', JSON.stringify({ q1: [] }), '2026-10-06T10:00:00.000+09:00',
    );

    const r = await loadFormAnalytics(fixture.db, 'a1', NOW);
    expect(r.favorites).toEqual([
      {
        formId: 'F2',
        formName: 'アンケート',
        fieldName: 'q1',
        label: 'きっかけ',
        answered: { '2026-10': 1, '2026-09': 1 },
        options: [
          { value: '紹介', counts: { '2026-10': 1 } },
          { value: 'SNS', counts: { '2026-10': 1 } },
          { value: '通りがかり', counts: {} },
          { value: 'その他', counts: { '2026-09': 1 } },
        ],
      },
    ]);
  });

  it('お気に入りが無ければ、空', async () => {
    const r = await loadFormAnalytics(fixture.db, 'a1', NOW);
    expect(r.favorites).toEqual([]);
  });

  it('回答がまったく無いアカウントは、空の一覧', async () => {
    const r = await loadFormAnalytics(fixture.db, 'none', NOW);
    expect(r.forms).toEqual([]);
  });
});
