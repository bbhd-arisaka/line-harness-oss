import { readFileSync } from 'node:fs';
import { URL } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import { LineClient, type Message } from '@line-crm/line-sdk';
import { sqliteD1 } from '../test-support/sqlite-d1.js';
import { broadcasts } from './broadcasts.js';

const schema = readFileSync(new URL('../../../../packages/db/bootstrap.sql', import.meta.url), 'utf8');

describe('broadcast test-send tracking origin', () => {
  let fixture: ReturnType<typeof sqliteD1>;
  let app: Hono;
  let requests: Array<{ token: string; to: string; messages: Message[] }>;
  beforeEach(() => {
    fixture = sqliteD1();
    fixture.sqlite.exec(schema);
    fixture.sqlite.exec(`
      INSERT INTO line_accounts(id,channel_id,name,channel_access_token,channel_secret)
        VALUES('account-a','channel-a','Synthetic account','synthetic-token-a','synthetic-secret');
      INSERT INTO friends(id,line_user_id,line_account_id,display_name)
        VALUES('friend-a','line-friend-a','account-a','Synthetic friend');
      INSERT INTO account_settings(id,line_account_id,key,value)
        VALUES('recipients','account-a','test_recipients','["friend-a"]');
      INSERT INTO broadcasts(id,title,message_type,message_content,target_type,line_account_id,track_links)
        VALUES('broadcast-a','Synthetic draft','text','See https://example.test/join','all','account-a',1);
    `);
    requests = [];
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Real network is forbidden in this test'));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(LineClient.prototype, 'request').mockImplementation(async function (this: LineClient, method, path, body) {
      expect(method).toBe('POST');
      expect(path).toBe('/v2/bot/message/push');
      requests.push({ token: Reflect.get(this, 'channelAccessToken'), ...(body as { to: string; messages: Message[] }) });
      return { data: {}, headers: new Headers() };
    });
    app = new Hono();
    app.route('/', broadcasts);
  });
  afterEach(() => {
    expect(fetch).not.toHaveBeenCalled();
    fixture.sqlite.close();
    vi.restoreAllMocks();
  });

  function send(workerUrl?: string) {
    return app.request('https://request-worker.example/api/broadcasts/broadcast-a/test-send', {
      method: 'POST', headers: { Origin: 'https://untrusted-admin.example' },
    }, { DB: fixture.db, ...(workerUrl === undefined ? {} : { WORKER_URL: workerUrl }) });
  }

  async function expectTrackedSend(response: Response, base: string) {
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ success: true, sent: 1, failed: 0 });
    const link = fixture.sqlite.prepare('SELECT short_code,line_account_id FROM tracked_links').get() as { short_code: string; line_account_id: string };
    expect(link.line_account_id).toBe('account-a');
    const text = `【テスト配信】\nSee ${base}/t/${link.short_code}`;
    expect(requests).toEqual([{ token: 'synthetic-token-a', to: 'line-friend-a', messages: [{ type: 'text', text }], customAggregationUnits: undefined }]);
    expect(fixture.sqlite.prepare('SELECT message_type,content,delivery_type FROM messages_log').all())
      .toEqual([{ message_type: 'text', content: text, delivery_type: 'test' }]);
    expect(text).not.toContain('untrusted-admin');
  }

  it('falls back to the request URL, never the Origin header, when WORKER_URL is absent', async () => {
    await expectTrackedSend(await send(), 'https://request-worker.example');
  });

  it('keeps a configured Worker URL authoritative', async () => {
    await expectTrackedSend(await send('https://configured-worker.example/'), 'https://configured-worker.example');
  });

  it('still honors the configured branded tracking domain with no Worker URL binding', async () => {
    fixture.sqlite.prepare("INSERT INTO account_settings(id,line_account_id,key,value) VALUES('short-domain','__global__','tracked_link_base_url',?)")
      .run(JSON.stringify('https://go.example'));
    await expectTrackedSend(await send(), 'https://go.example');
  });

  function sendTo(friendIds: unknown) {
    return app.request('https://request-worker.example/api/broadcasts/broadcast-a/test-send', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ friendIds }),
    }, { DB: fixture.db, WORKER_URL: 'https://w.example' });
  }

  describe('その場で選んだ友だちへの送信', () => {
    beforeEach(() => {
      fixture.sqlite.exec(`
        INSERT INTO line_accounts(id,channel_id,name,channel_access_token,channel_secret)
          VALUES('account-b','channel-b','Other','token-b','secret-b');
        INSERT INTO friends(id,line_user_id,line_account_id,display_name,is_following)
          VALUES('friend-b','line-friend-b','account-a','Second',1),
                ('friend-x','line-friend-x','account-b','Other account',1),
                ('friend-blocked','line-friend-blocked','account-a','Blocked',0);
      `);
    });

    it('選んだ人だけに送り、履歴に新しい順で残す(設定済みの送信先には送らない)', async () => {
      const res = await sendTo(['friend-b']);
      expect(await res.json()).toMatchObject({ success: true, sent: 1, failed: 0 });
      expect(requests.map((r) => r.to)).toEqual(['line-friend-b']);
      await sendTo(['friend-a']);
      const hist = fixture.sqlite.prepare("SELECT value FROM account_settings WHERE key='test_send_history' AND line_account_id='account-a'").get() as { value: string };
      expect(JSON.parse(hist.value)).toEqual(['friend-a', 'friend-b']);
    });

    it('他のアカウントの人・ブロック中の人には送らない', async () => {
      const res = await sendTo(['friend-x', 'friend-blocked']);
      expect(res.status).toBe(400);
      expect(requests).toEqual([]);
      const mixed = await sendTo(['friend-x', 'friend-b']);
      expect(await mixed.json()).toMatchObject({ sent: 1 });
      expect(requests.map((r) => r.to)).toEqual(['line-friend-b']);
    });

    it('宛先が多すぎるときは送らない', async () => {
      const res = await sendTo(Array.from({ length: 11 }, (_, i) => `f${i}`));
      expect(res.status).toBe(400);
      expect(requests).toEqual([]);
    });

    it('履歴つきの候補は、前回の人→登録済みの人の順で返る', async () => {
      await sendTo(['friend-b']);
      const { accountSettings } = await import('./account-settings.js');
      const a = new Hono();
      a.route('/', accountSettings);
      const res = await a.request('/api/account-settings/test-recipients?accountId=account-a&history=1', {}, { DB: fixture.db });
      const body = await res.json() as { data: Array<{ id: string; recent: boolean }> };
      expect(body.data.map((f) => [f.id, f.recent])).toEqual([['friend-b', true], ['friend-a', false]]);
    });
  });

  it('keeps track_links=0 unchanged without creating tracked links', async () => {
    fixture.sqlite.exec("UPDATE broadcasts SET track_links=0 WHERE id='broadcast-a'");
    const response = await send();
    expect(response.status).toBe(200);
    expect(requests[0].messages).toEqual([{ type: 'text', text: '【テスト配信】\nSee https://example.test/join' }]);
    expect(fixture.sqlite.prepare('SELECT COUNT(*) AS count FROM tracked_links').get()).toEqual({ count: 0 });
  });
});
