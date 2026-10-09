import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { URL } from 'node:url';
import { sqliteD1 } from '../test-support/sqlite-d1.js';
import { handleFormAnswered } from './form-answered.js';

const schema = readFileSync(new URL('../../../../packages/db/bootstrap.sql', import.meta.url), 'utf8');

function setup() {
  const { db, sqlite } = sqliteD1();
  sqlite.exec(schema);
  sqlite.exec(`INSERT INTO line_accounts(id,channel_id,name,channel_access_token,channel_secret) VALUES('A','ca','A','t','s')`);
  sqlite.exec(`INSERT INTO friends(id,line_user_id,line_account_id,display_name) VALUES('fr1','u1','A','taro')`);
  return { db, sqlite };
}

describe('handleFormAnswered(フォーム回答 = お客様からの連絡と同じ扱い)', () => {
  it('対応済みのトークは、一番上(最終時刻が現在)・未対応に戻る', async () => {
    const { db, sqlite } = setup();
    sqlite.exec(`INSERT INTO chats(id,friend_id,status,last_message_at) VALUES('c1','fr1','resolved','2020-01-01T00:00:00.000+09:00')`);
    await handleFormAnswered({}, db, undefined, { friendId: 'fr1', accountId: 'A', formName: 'F' });
    const row = sqlite.prepare("SELECT status, last_message_at FROM chats WHERE id = 'c1'").get() as { status: string; last_message_at: string };
    expect(row.status).toBe('unread');
    expect(row.last_message_at > '2025-01-01').toBe(true);
  });
  it('対応中のトークは、対応中のまま(メッセージを受けたときと同じ)。時刻だけ新しくなる', async () => {
    const { db, sqlite } = setup();
    sqlite.exec(`INSERT INTO chats(id,friend_id,status,last_message_at) VALUES('c1','fr1','in_progress','2020-01-01T00:00:00.000+09:00')`);
    await handleFormAnswered({}, db, undefined, { friendId: 'fr1', accountId: 'A', formName: 'F' });
    const row = sqlite.prepare("SELECT status, last_message_at FROM chats WHERE id = 'c1'").get() as { status: string; last_message_at: string };
    expect(row.status).toBe('in_progress');
    expect(row.last_message_at > '2025-01-01').toBe(true);
  });
  it('トークがまだ無い友だちは、トークが作られる', async () => {
    const { db, sqlite } = setup();
    await handleFormAnswered({}, db, undefined, { friendId: 'fr1', accountId: 'A', formName: 'F' });
    const row = sqlite.prepare("SELECT status FROM chats WHERE friend_id = 'fr1'").get() as { status: string } | undefined;
    expect(row).toBeDefined();
  });
  it('ExecutionContext があれば、通知は waitUntil に渡す。例外は投げない', async () => {
    const { db } = setup();
    const waitUntil = vi.fn();
    await expect(handleFormAnswered({}, db, { waitUntil }, { friendId: 'fr1', accountId: 'A', formName: 'F' })).resolves.toBeUndefined();
    expect(waitUntil).toHaveBeenCalledTimes(1);
  });
});

describe('回答結果を見るカード(フォームの設定でオンのとき)', () => {
  const base = { friendId: 'fr1', accountId: 'A', formName: 'ご予約アンケート', formId: 'F1', submissionId: 'S1', friendName: '山田' };
  const cards = (sqlite: ReturnType<typeof setup>['sqlite']) =>
    sqlite.prepare("SELECT direction, message_type, content, source, line_account_id FROM messages_log WHERE friend_id = 'fr1'").all() as {
      direction: string; message_type: string; content: string; source: string; line_account_id: string;
    }[];

  it('オンなら、お客様から届いたメッセージとして、文言を決めたカードが残る(お客様には何も送らない)', async () => {
    const { db, sqlite } = setup();
    const lstepOptions = JSON.stringify({ answerCard: { enabled: true, title: '{{name}}さんが回答', body: '{{form}}', buttonLabel: '開く' } });
    await handleFormAnswered({}, db, undefined, { ...base, lstepOptions });
    const rows = cards(sqlite);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ direction: 'incoming', message_type: 'form_answer', source: 'form', line_account_id: 'A' });
    expect(JSON.parse(rows[0].content)).toEqual({ formId: 'F1', formName: 'ご予約アンケート', submissionId: 'S1', title: '山田さんが回答', body: 'ご予約アンケート', buttonLabel: '開く' });
  });
  it('オフ・未設定なら、カードは残さない(トークは上に来る)', async () => {
    const { db, sqlite } = setup();
    await handleFormAnswered({}, db, undefined, { ...base, lstepOptions: JSON.stringify({ answerCard: { enabled: false } }) });
    await handleFormAnswered({}, db, undefined, { ...base, lstepOptions: null });
    expect(cards(sqlite)).toHaveLength(0);
    expect(sqlite.prepare("SELECT status FROM chats WHERE friend_id = 'fr1'").get()).toBeDefined();
  });
  it('カードの保存に失敗しても、トークの更新は行う', async () => {
    const { db, sqlite } = setup();
    sqlite.exec('DROP TABLE messages_log');
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    await handleFormAnswered({}, db, undefined, { ...base, lstepOptions: JSON.stringify({ answerCard: { enabled: true } }) });
    err.mockRestore();
    expect(sqlite.prepare("SELECT status FROM chats WHERE friend_id = 'fr1'").get()).toBeDefined();
  });
});
