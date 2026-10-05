import { readFileSync } from 'node:fs';
import { URL } from 'node:url';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { Hono } from 'hono';
import { richMenus } from './rich-menus.js';
import { sqliteD1 } from '../test-support/sqlite-d1.js';

const uploadRichMenuImage = vi.fn();
const getRichMenuIdOfUser = vi.fn();
const getDefaultRichMenuId = vi.fn();
const getRichMenuList = vi.fn();

vi.mock('@line-crm/line-sdk', () => ({
  LineClient: vi.fn().mockImplementation(() => ({
    uploadRichMenuImage,
    getRichMenuIdOfUser,
    getDefaultRichMenuId,
    getRichMenuList,
  })),
}));

const bootstrap = readFileSync(new URL('../../../../packages/db/bootstrap.sql', import.meta.url), 'utf8');

describe('POST /api/rich-menus/:id/image', () => {
  function setupApp() {
    const app = new Hono<{
      Bindings: {
        DB: D1Database;
        LINE_CHANNEL_ACCESS_TOKEN: string;
      };
    }>();
    app.route('/', richMenus);
    return app;
  }

  beforeEach(() => {
    uploadRichMenuImage.mockReset();
    uploadRichMenuImage.mockResolvedValue(undefined);
  });

  test('accepts SDK imageData JSON field for base64 uploads', async () => {
    const app = setupApp();
    const res = await app.request('/api/rich-menus/richmenu-1/image', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        imageData: 'aGVsbG8=',
        contentType: 'image/png',
      }),
    }, {
      LINE_CHANNEL_ACCESS_TOKEN: 'token',
      DB: {} as D1Database,
    });

    expect(res.status).toBe(200);
    expect(uploadRichMenuImage).toHaveBeenCalledTimes(1);
    const [richMenuId, imageData, contentType] = uploadRichMenuImage.mock.calls[0];
    expect(richMenuId).toBe('richmenu-1');
    expect(contentType).toBe('image/png');
    expect(new TextDecoder().decode(imageData as ArrayBuffer)).toBe('hello');
  });

  test('keeps accepting legacy image JSON field', async () => {
    const app = setupApp();
    const res = await app.request('/api/rich-menus/richmenu-2/image', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        image: 'data:image/jpeg;base64,aGVsbG8=',
        contentType: 'image/jpeg',
      }),
    }, {
      LINE_CHANNEL_ACCESS_TOKEN: 'token',
      DB: {} as D1Database,
    });

    expect(res.status).toBe(200);
    expect(uploadRichMenuImage).toHaveBeenCalledTimes(1);
    const [richMenuId, imageData, contentType] = uploadRichMenuImage.mock.calls[0];
    expect(richMenuId).toBe('richmenu-2');
    expect(contentType).toBe('image/jpeg');
    expect(new TextDecoder().decode(imageData as ArrayBuffer)).toBe('hello');
  });
});

describe('GET /api/friends/:friendId/rich-menu(いま設定されているリッチメニュー)', () => {
  function setup() {
    const { db, sqlite } = sqliteD1();
    sqlite.exec(bootstrap);
    sqlite.exec("INSERT INTO line_accounts(id,channel_id,name,channel_secret,channel_access_token) VALUES('acc-a','ch-a','A店','s','tok-a')");
    sqlite.prepare("INSERT INTO friends(id,line_user_id,line_account_id,display_name) VALUES('f1','U1','acc-a','たろう')").run();
    const app = new Hono<{ Bindings: { DB: D1Database; LINE_CHANNEL_ACCESS_TOKEN: string } }>();
    app.route('/', richMenus);
    const get = async (id = 'f1') => {
      const res = await app.request(`/api/friends/${id}/rich-menu`, {}, { DB: db, LINE_CHANNEL_ACCESS_TOKEN: 'tok' });
      return { status: res.status, body: await res.json() as { success: boolean; data?: Record<string, unknown> } };
    };
    return { sqlite, get };
  }
  beforeEach(() => {
    getRichMenuIdOfUser.mockReset(); getDefaultRichMenuId.mockReset(); getRichMenuList.mockReset();
    getRichMenuList.mockResolvedValue({ richmenus: [{ richMenuId: 'rm-1', name: 'メイン', chatBarText: 'メニュー' }, { richMenuId: 'rm-def', name: 'デフォルト用' }] });
  });

  test('個別に設定されているメニューの名前を返す(beyond line で作ったメニューならグループ・ページ名も)', async () => {
    const { sqlite, get } = setup();
    getRichMenuIdOfUser.mockResolvedValue({ richMenuId: 'rm-1' });
    sqlite.exec("INSERT INTO rich_menu_groups(id,account_id,name,chat_bar_text,size) VALUES('g1','acc-a','予約メニュー','メニュー','large')");
    sqlite.exec("INSERT INTO rich_menu_pages(id,group_id,order_index,name,alias_id,line_richmenu_id) VALUES('p1','g1',0,'1ページ目','al','rm-1')");
    const { status, body } = await get();
    expect(status).toBe(200);
    expect(body.data).toEqual({ id: 'rm-1', name: 'メイン', isDefault: false, chatBarText: 'メニュー', groupName: '予約メニュー', pageName: '1ページ目', accountId: 'acc-a' });
  });

  test('個別に設定が無いときは、デフォルトのメニューを「デフォルト」として返す', async () => {
    const { get } = setup();
    getRichMenuIdOfUser.mockRejectedValue(new Error('LINE API error: 404'));
    getDefaultRichMenuId.mockResolvedValue('rm-def');
    const { body } = await get();
    expect(body.data).toMatchObject({ id: 'rm-def', name: 'デフォルト用', isDefault: true, groupName: null, pageName: null });
  });

  test('別のツール(Lステップ・LINE公式アカウント管理画面など)が設定したメニューは、取得失敗にせず「別のツールで設定」として返す', async () => {
    const { get } = setup();
    const other = new Error('LINE API error: 403 Forbidden — {"message":"the richmenu is owned by another channel","details":[]}');
    // 個別メニューが別のチャンネルのもの
    getRichMenuIdOfUser.mockRejectedValue(other);
    expect((await get()).body.data).toMatchObject({ id: null, isDefault: false, ownedByOtherChannel: true });
    expect(getDefaultRichMenuId).not.toHaveBeenCalled();
    // デフォルトのメニューが別のチャンネルのもの
    getRichMenuIdOfUser.mockRejectedValue(new Error('LINE API error: 404'));
    getDefaultRichMenuId.mockRejectedValue(other);
    expect((await get()).body.data).toMatchObject({ id: null, isDefault: true, ownedByOtherChannel: true });
    // 権限のない別の理由の403は、これまでどおり取得失敗
    getDefaultRichMenuId.mockRejectedValue(new Error('LINE API error: 403 Forbidden — invalid token'));
    expect((await get()).status).toBe(500);
  });

  test('どちらも無ければ id は null(未設定)。LINE 側の本当のエラーは取得失敗(500)', async () => {
    const { get } = setup();
    getRichMenuIdOfUser.mockRejectedValue(new Error('LINE API error: 404'));
    getDefaultRichMenuId.mockResolvedValue(null);
    expect((await get()).body.data).toMatchObject({ id: null, name: null, isDefault: false });
    getRichMenuIdOfUser.mockRejectedValue(new Error('LINE API error: 500'));
    expect((await get()).status).toBe(500);
    expect((await get('nope')).status).toBe(404);
  });
});
