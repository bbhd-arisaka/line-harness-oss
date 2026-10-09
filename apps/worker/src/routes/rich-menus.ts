import { Hono } from 'hono';
import { LineClient } from '@line-crm/line-sdk';
import { getFriendById, getLineAccountById, resolveDefaultAccessToken } from '@line-crm/db';
import { isDemoLineUserId } from '../services/demo-friend.js';
import type { Env } from '../index.js';

const richMenus = new Hono<Env>();

/** Resolve LINE access token — uses accountId query param if provided, otherwise default */
async function resolveLineClient(c: { env: Env['Bindings']; req: { query(key: string): string | undefined } }): Promise<LineClient> {
  const accountId = c.req.query('accountId');
  if (accountId) {
    const account = await getLineAccountById(c.env.DB, accountId);
    if (account) return new LineClient(account.channel_access_token);
  }
  return new LineClient(await resolveDefaultAccessToken(c.env.DB, c.env.LINE_CHANNEL_ACCESS_TOKEN));
}

// GET /api/rich-menus — list all rich menus from LINE API
richMenus.get('/api/rich-menus', async (c) => {
  try {
    const lineClient = await resolveLineClient(c);
    const result = await lineClient.getRichMenuList();
    return c.json({ success: true, data: result.richmenus ?? [] });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('GET /api/rich-menus error:', message);
    return c.json({ success: false, error: `Failed to fetch rich menus: ${message}` }, 500);
  }
});

// POST /api/rich-menus — create a rich menu via LINE API
richMenus.post('/api/rich-menus', async (c) => {
  try {
    const body = await c.req.json();
    const lineClient = await resolveLineClient(c);
    const result = await lineClient.createRichMenu(body);
    return c.json({ success: true, data: result }, 201);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('POST /api/rich-menus error:', message);
    return c.json({ success: false, error: `Failed to create rich menu: ${message}` }, 500);
  }
});

// DELETE /api/rich-menus/:id — delete a rich menu
richMenus.delete('/api/rich-menus/:id', async (c) => {
  try {
    const richMenuId = c.req.param('id');
    const lineClient = await resolveLineClient(c);
    await lineClient.deleteRichMenu(richMenuId);
    return c.json({ success: true, data: null });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('DELETE /api/rich-menus/:id error:', message);
    return c.json({ success: false, error: `Failed to delete rich menu: ${message}` }, 500);
  }
});

// POST /api/rich-menus/:id/default — set rich menu as default for all users
richMenus.post('/api/rich-menus/:id/default', async (c) => {
  try {
    const richMenuId = c.req.param('id');
    const lineClient = await resolveLineClient(c);
    await lineClient.setDefaultRichMenu(richMenuId);
    return c.json({ success: true, data: null });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('POST /api/rich-menus/:id/default error:', message);
    return c.json({ success: false, error: `Failed to set default rich menu: ${message}` }, 500);
  }
});

// POST /api/friends/:friendId/rich-menu — link rich menu to a specific friend
richMenus.post('/api/friends/:friendId/rich-menu', async (c) => {
  try {
    const friendId = c.req.param('friendId');
    const body = await c.req.json<{ richMenuId: string }>();

    if (!body.richMenuId) {
      return c.json({ success: false, error: 'richMenuId is required' }, 400);
    }

    const db = c.env.DB;
    const friend = await getFriendById(db, friendId);
    if (!friend) {
      return c.json({ success: false, error: 'Friend not found' }, 404);
    }

    let accessToken = await resolveDefaultAccessToken(db, c.env.LINE_CHANNEL_ACCESS_TOKEN);
    const friendAccountId = (friend as unknown as Record<string, string | null>).line_account_id;
    if (friendAccountId) {
      const account = await getLineAccountById(db, friendAccountId);
      if (account) accessToken = account.channel_access_token;
    }
    const lineClient = new LineClient(accessToken);
    await lineClient.linkRichMenuToUser(friend.line_user_id, body.richMenuId);

    return c.json({ success: true, data: null });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('POST /api/friends/:friendId/rich-menu error:', message);
    return c.json({ success: false, error: `Failed to link rich menu to friend: ${message}` }, 500);
  }
});

// DELETE /api/friends/:friendId/rich-menu — unlink rich menu from a specific friend
richMenus.delete('/api/friends/:friendId/rich-menu', async (c) => {
  try {
    const friendId = c.req.param('friendId');
    const db = c.env.DB;

    const friend = await getFriendById(db, friendId);
    if (!friend) {
      return c.json({ success: false, error: 'Friend not found' }, 404);
    }

    let accessToken = await resolveDefaultAccessToken(db, c.env.LINE_CHANNEL_ACCESS_TOKEN);
    const friendAccId = (friend as unknown as Record<string, string | null>).line_account_id;
    if (friendAccId) {
      const account = await getLineAccountById(c.env.DB, friendAccId);
      if (account) accessToken = account.channel_access_token;
    }
    const lineClient = new LineClient(accessToken);
    await lineClient.unlinkRichMenuFromUser(friend.line_user_id);

    return c.json({ success: true, data: null });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('DELETE /api/friends/:friendId/rich-menu error:', message);
    return c.json({ success: false, error: `Failed to unlink rich menu from friend: ${message}` }, 500);
  }
});

// GET /api/friends/:friendId/rich-menu — get rich menu currently linked to a friend
richMenus.get('/api/friends/:friendId/rich-menu', async (c) => {
  try {
    const friendId = c.req.param('friendId');
    const db = c.env.DB;

    const friend = await getFriendById(db, friendId);
    if (!friend) {
      return c.json({ success: false, error: 'Friend not found' }, 404);
    }

    let accessToken = await resolveDefaultAccessToken(db, c.env.LINE_CHANNEL_ACCESS_TOKEN);
    const friendAccId = (friend as unknown as Record<string, string | null>).line_account_id;
    if (friendAccId) {
      const account = await getLineAccountById(db, friendAccId);
      if (account) accessToken = account.channel_access_token;
    }
    // App Store 審査用のデモの友だち: LINE には存在しないので、問い合わせずに「リッチメニューなし」を返す
    if (isDemoLineUserId(friend.line_user_id)) {
      return c.json({ success: true, data: { id: null, name: null, isDefault: false, chatBarText: null, groupName: null, pageName: null, accountId: friendAccId ?? null } });
    }
    const lineClient = new LineClient(accessToken);

    // 個別メニュー取得 — 404 (個別未設定) のみ null に正規化。トークン期限切れ
    // / 5xx 等の真のエラーは外側 catch に伝搬させて 500 を返す。null と「取得失敗」
    // を混同すると運用者にデフォルトメニューが偽表示される。
    // 403 "the richmenu is owned by another channel": Lステップや LINE公式アカウント管理画面など、
    // 別のツールが設定したメニュー。こちらの権限では中身を読めないが、「設定されている」ことは確かなので、
    // 取得失敗にはせず ownedByOtherChannel として返す。
    const isOwnedByOtherChannel = (err: unknown): boolean => {
      const msg = err instanceof Error ? err.message : String(err);
      return msg.includes('403') && /owned by another channel/i.test(msg);
    };
    let userMenuId: string | null = null;
    let userMenuOwnedByOther = false;
    try {
      const r = await lineClient.getRichMenuIdOfUser(friend.line_user_id);
      userMenuId = r.richMenuId;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('404')) {
        userMenuId = null;
      } else if (isOwnedByOtherChannel(err)) {
        userMenuOwnedByOther = true;
      } else {
        throw err;
      }
    }

    // 個別未設定ならデフォルトを fallback。getDefaultRichMenuId は client.ts 側で
    // 404 を null に変換済 (Task 1)、その他のエラーは throw され外側 catch に流れる。
    let isDefault = false;
    let defaultOwnedByOther = false;
    let effectiveId: string | null = userMenuId;
    if (!userMenuId && !userMenuOwnedByOther) {
      try {
        effectiveId = await lineClient.getDefaultRichMenuId();
        isDefault = !!effectiveId;
      } catch (err) {
        if (isOwnedByOtherChannel(err)) defaultOwnedByOther = true;
        else throw err;
      }
    }
    if (userMenuOwnedByOther || defaultOwnedByOther) {
      return c.json({
        success: true,
        data: { id: null, name: null, isDefault: defaultOwnedByOther, ownedByOtherChannel: true, chatBarText: null, groupName: null, pageName: null, accountId: friendAccId ?? null },
      });
    }

    // メニュー名は LINE API のリストから lookup (rich_menus DB テーブルは無い)
    let name: string | null = null;
    let chatBarText: string | null = null;
    if (effectiveId) {
      try {
        const list = await lineClient.getRichMenuList();
        const found = (list.richmenus ?? []).find((m) => m.richMenuId === effectiveId);
        name = found?.name ?? null;
        chatBarText = found?.chatBarText ?? null;
      } catch {
        // silent — 名前は出せないが id だけは返す
      }
    }

    // beyond line の「リッチメニュー」画面で作ったメニューなら、その名前(グループ・ページ)も返す。
    // Lステップ等、外で作られたメニューは見つからない(null)。
    let groupName: string | null = null;
    let pageName: string | null = null;
    if (effectiveId && friendAccId) {
      const row = await db
        .prepare(
          `SELECT g.name AS group_name, p.name AS page_name
             FROM rich_menu_pages p INNER JOIN rich_menu_groups g ON g.id = p.group_id
            WHERE p.line_richmenu_id = ? AND g.account_id = ? LIMIT 1`,
        )
        .bind(effectiveId, friendAccId)
        .first<{ group_name: string; page_name: string }>();
      groupName = row?.group_name ?? null;
      pageName = row?.page_name ?? null;
    }

    return c.json({
      success: true,
      data: { id: effectiveId, name, isDefault, chatBarText, groupName, pageName, accountId: friendAccId ?? null },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('GET /api/friends/:friendId/rich-menu error:', message);
    return c.json({ success: false, error: `Failed to fetch friend rich menu: ${message}` }, 500);
  }
});

export { richMenus };

// POST /api/rich-menus/:id/image — upload rich menu image (accepts base64 body or binary)
richMenus.post('/api/rich-menus/:id/image', async (c) => {
  try {
    const richMenuId = c.req.param('id');
    const contentType = c.req.header('content-type') ?? '';

    let imageData: ArrayBuffer;
    let imageContentType: 'image/png' | 'image/jpeg' = 'image/png';

    if (contentType.includes('application/json')) {
      // Accept base64 encoded image in JSON body
      const body = await c.req.json<{ image?: string; imageData?: string; contentType?: string }>();
      const imageBase64 = body.image ?? body.imageData;
      if (!imageBase64) {
        return c.json({ success: false, error: 'image (base64) is required' }, 400);
      }
      // Strip data URI prefix if present
      const base64 = imageBase64.replace(/^data:image\/\w+;base64,/, '');
      const binaryString = atob(base64);
      const bytes = new Uint8Array(binaryString.length);
      for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }
      imageData = bytes.buffer;
      if (body.contentType === 'image/jpeg') imageContentType = 'image/jpeg';
    } else if (contentType.includes('image/')) {
      // Accept raw binary upload
      imageData = await c.req.arrayBuffer();
      imageContentType = contentType.includes('jpeg') || contentType.includes('jpg') ? 'image/jpeg' : 'image/png';
    } else {
      return c.json({ success: false, error: 'Content-Type must be application/json (with base64) or image/png or image/jpeg' }, 400);
    }

    const lineClient = await resolveLineClient(c);
    await lineClient.uploadRichMenuImage(richMenuId, imageData, imageContentType);

    return c.json({ success: true, data: null });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('POST /api/rich-menus/:id/image error:', message);
    return c.json({ success: false, error: `Failed to upload rich menu image: ${message}` }, 500);
  }
});
