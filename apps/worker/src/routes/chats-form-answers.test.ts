import { describe, expect, test, vi } from 'vitest';
import { Hono } from 'hono';
import { readFileSync } from 'node:fs';
import { URL } from 'node:url';
import { sqliteD1 } from '../test-support/sqlite-d1.js';

vi.mock('@line-crm/db', () => ({
  getOperators: vi.fn(),
  getOperatorById: vi.fn(),
  createOperator: vi.fn(),
  updateOperator: vi.fn(),
  deleteOperator: vi.fn(),
  getChats: vi.fn(),
  getChatById: vi.fn(),
  createChat: vi.fn(),
  getFriendById: vi.fn(),
  getLineAccountById: vi.fn(),
  updateChat: vi.fn(),
  jstNow: vi.fn(() => '2026-08-12T21:00:00.000+09:00'),
}));

import { chats } from './chats.js';

const schema = readFileSync(new URL('../../../../packages/db/bootstrap.sql', import.meta.url), 'utf8');

function setup() {
  const { db, sqlite } = sqliteD1();
  sqlite.exec(schema);
  sqlite.exec(`INSERT INTO line_accounts(id,channel_id,name,channel_access_token,channel_secret) VALUES('A','ca','A','t','s')`);
  sqlite.exec(`INSERT INTO friends(id,line_user_id,line_account_id,display_name,real_name) VALUES('f1','u1','A','one','山田'),('f2','u2','A','two',NULL)`);
  sqlite.exec(`INSERT INTO chats(id,friend_id,status) VALUES('c1','f1','unread')`);
  sqlite.exec(`INSERT INTO forms(id,name,fields) VALUES('F','アンケート','[{"name":"q1","label":"ご希望","type":"text"},{"name":"q2","label":"メニュー","type":"checkbox"}]')`);
  sqlite.exec(`INSERT INTO form_submissions(id,form_id,friend_id,data,created_at) VALUES('S1','F','f1','{"q2":["カット","カラー"],"q1":"早め"}','2026-08-12T10:00:00.000+09:00')`);
  const app = new Hono();
  app.route('/', chats);
  const get = async (path: string) => {
    const res = await app.request(new Request(`http://worker.test${path}`), {}, { DB: db } as never);
    return { status: res.status, json: (await res.json()) as { success: boolean; data?: Record<string, unknown> } };
  };
  return { get };
}

describe('GET /api/chats/:id/form-answers/:submissionId(回答結果を見る)', () => {
  test('友だちID・チャットIDのどちらでも、その友だちの回答結果が見られる', async () => {
    const { get } = setup();
    for (const id of ['f1', 'c1']) {
      const r = await get(`/api/chats/${id}/form-answers/S1`);
      expect(r.status).toBe(200);
      expect(r.json.data).toMatchObject({
        submissionId: 'S1',
        formName: 'アンケート',
        friendName: '山田',
        answeredAt: '2026-08-12T10:00:00.000+09:00',
        items: [
          { label: 'ご希望', value: '早め' },
          { label: 'メニュー', value: 'カット, カラー' },
        ],
      });
    }
  });
  test('別の友だちの回答は見せない(404)。存在しない回答も 404', async () => {
    const { get } = setup();
    expect((await get('/api/chats/f2/form-answers/S1')).status).toBe(404);
    expect((await get('/api/chats/f1/form-answers/nope')).status).toBe(404);
  });
});
