import { Hono, type Context } from 'hono';
import type { Env } from '../index.js';
import { requireRole } from '../middleware/role-guard.js';
import { resolveCorsOrigin } from '../middleware/admin-auth-config.js';
import {
  GOOGLE_SHEETS_OAUTH_SCOPE,
  buildGoogleOAuthAuthorizationUrl,
  exchangeGoogleOAuthCode,
  googleOAuthConfigured,
  revokeGoogleOAuthToken,
  signGoogleOAuthState,
  type GoogleOAuthStatePayload,
} from '../services/google-oauth.js';
import {
  fetchGoogleEmail,
  getSheetsAccessToken,
  listSheetTabs,
  listSpreadsheets,
  type SheetsConnectionRow,
} from '../services/google-sheets-oauth.js';

// コールバックは予約(Googleカレンダー)と共通のURL。Google側に登録済みのリダイレクトURIをそのまま使える。
export const GOOGLE_OAUTH_CALLBACK_PATH = '/api/booking/google-calendar/oauth/callback';
const STATE_TTL_MS = 10 * 60_000;

const googleSheets = new Hono<Env>();

function clientCredentials(env: Env['Bindings']) {
  return { oauthClientId: env.GOOGLE_OAUTH_CLIENT_ID, oauthClientSecret: env.GOOGLE_OAUTH_CLIENT_SECRET };
}

function safeOrigin(value: string | undefined): string | null {
  if (!value) return null;
  try { return new URL(value).origin; } catch { return null; }
}

/** 連携ウィンドウ(別窓)を閉じて、管理画面に結果を知らせる。 */
function popupResultPage(result: 'connected' | 'denied' | 'error', adminOrigin: string | undefined): Response {
  const target = safeOrigin(adminOrigin);
  const script = `
try { if (window.opener) window.opener.postMessage({ type: 'google-sheets-oauth', result: ${JSON.stringify(result)} }, ${JSON.stringify(target ?? '*')}); } catch (e) {}
setTimeout(function () { window.close(); }, 400);`;
  const mark = result === 'connected' ? '✓' : '!';
  const color = result === 'connected' ? '#06c755' : '#e53935';
  const html = `<!doctype html><html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Google連携</title><style>body{font-family:system-ui,sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;background:#f5f5f5}div{font-size:64px;font-weight:700;color:${color}}</style></head><body><div>${mark}</div><script>${script}</script></body></html>`;
  return new Response(html, { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } });
}

/** booking.ts の共通コールバックから、state の purpose が 'sheets' のときに呼ばれる。 */
export async function handleSheetsOAuthCallback(
  c: Context<Env>,
  payload: GoogleOAuthStatePayload,
): Promise<Response> {
  const adminOrigin = payload.adminOrigin;
  try {
    if (c.req.query('error')) return popupResultPage('denied', adminOrigin);
    const code = c.req.query('code');
    const credentials = clientCredentials(c.env);
    if (!code || !googleOAuthConfigured(credentials)) throw new Error('google_oauth_callback_invalid');
    const token = await exchangeGoogleOAuthCode({
      code,
      clientId: credentials.oauthClientId!,
      clientSecret: credentials.oauthClientSecret!,
      redirectUri: new URL(GOOGLE_OAUTH_CALLBACK_PATH, c.req.url).toString(),
    });
    const email = await fetchGoogleEmail(token.accessToken);
    const nowIso = new Date().toISOString();
    const expires = new Date(Date.now() + Math.max(60, token.expiresIn - 60) * 1000).toISOString();
    const existing = await c.env.DB
      .prepare(`SELECT id FROM google_sheets_connections WHERE google_email = ?`)
      .bind(email)
      .first<{ id: string }>();
    if (existing) {
      await c.env.DB
        .prepare(
          `UPDATE google_sheets_connections
              SET access_token = ?, access_token_expires_at = ?, refresh_token = ?, status = 'active',
                  last_error = NULL, connected_by = ?, updated_at = ?
            WHERE id = ?`,
        )
        .bind(token.accessToken, expires, token.refreshToken, payload.staffId, nowIso, existing.id)
        .run();
    } else {
      await c.env.DB
        .prepare(
          `INSERT INTO google_sheets_connections
             (id, google_email, access_token, access_token_expires_at, refresh_token, status, connected_by, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, 'active', ?, ?, ?)`,
        )
        .bind(crypto.randomUUID(), email, token.accessToken, expires, token.refreshToken, payload.staffId, nowIso, nowIso)
        .run();
    }
    return popupResultPage('connected', adminOrigin);
  } catch (error) {
    console.error('Google Sheets OAuth callback failed:', error);
    return popupResultPage('error', adminOrigin);
  }
}

// 連携の開始。承認画面のURLを返す(管理画面が別窓で開く)。
googleSheets.post('/api/integrations/google-sheets/oauth/start', requireRole('owner', 'admin'), async (c) => {
  const credentials = clientCredentials(c.env);
  if (!googleOAuthConfigured(credentials)) {
    return c.json({ success: false, error: 'Google連携の設定(OAuthクライアント)がまだ入っていません' }, 503);
  }
  const origin = c.req.header('Origin');
  const state = await signGoogleOAuthState(
    {
      accountId: 'google-sheets',
      staffId: c.get('staff')?.id ?? 'admin',
      expiresAt: Date.now() + STATE_TTL_MS,
      adminOrigin: resolveCorsOrigin(c.env, origin, c.req.url) === origin ? origin : undefined,
      purpose: 'sheets',
    },
    c.env.API_KEY,
  );
  const authorizationUrl = buildGoogleOAuthAuthorizationUrl({
    clientId: credentials.oauthClientId!,
    redirectUri: new URL(GOOGLE_OAUTH_CALLBACK_PATH, c.req.url).toString(),
    state,
    scope: GOOGLE_SHEETS_OAUTH_SCOPE,
  });
  return c.json({ success: true, data: { authorizationUrl } });
});

googleSheets.get('/api/integrations/google-sheets/connections', requireRole('owner', 'admin'), async (c) => {
  const { results } = await c.env.DB
    .prepare(`SELECT id, google_email, status, last_error, created_at FROM google_sheets_connections ORDER BY created_at`)
    .all<{ id: string; google_email: string; status: string; last_error: string | null; created_at: string }>();
  return c.json({
    success: true,
    data: {
      configured: googleOAuthConfigured(clientCredentials(c.env)),
      connections: results.map((r) => ({
        id: r.id,
        email: r.google_email,
        status: r.status,
        lastError: r.last_error,
      })),
    },
  });
});

googleSheets.delete('/api/integrations/google-sheets/connections/:id', requireRole('owner', 'admin'), async (c) => {
  const id = c.req.param('id')!;
  const connection = await c.env.DB
    .prepare(`SELECT * FROM google_sheets_connections WHERE id = ?`)
    .bind(id)
    .first<SheetsConnectionRow>();
  if (!connection) return c.json({ success: false, error: '連携が見つかりません' }, 404);
  await revokeGoogleOAuthToken(connection.refresh_token).catch((e) => console.error('revoke failed:', e));
  await c.env.DB.batch([
    c.env.DB.prepare(`DELETE FROM form_google_sheet_links WHERE connection_id = ?`).bind(id),
    c.env.DB.prepare(`DELETE FROM google_sheets_connections WHERE id = ?`).bind(id),
  ]);
  return c.json({ success: true, data: null });
});

async function tokenFor(c: Context<Env>, id: string): Promise<{ token: string } | Response> {
  const connection = await c.env.DB
    .prepare(`SELECT * FROM google_sheets_connections WHERE id = ?`)
    .bind(id)
    .first<SheetsConnectionRow>();
  if (!connection) return c.json({ success: false, error: '連携が見つかりません' }, 404);
  try {
    return { token: await getSheetsAccessToken(c.env, connection) };
  } catch {
    return c.json({ success: false, error: 'Googleアカウントの連携が切れています。連携し直してください' }, 409);
  }
}

googleSheets.get('/api/integrations/google-sheets/connections/:id/spreadsheets', requireRole('owner', 'admin'), async (c) => {
  const t = await tokenFor(c, c.req.param('id')!);
  if (t instanceof Response) return t;
  try {
    const files = await listSpreadsheets(t.token, c.req.query('q') ?? '');
    return c.json({ success: true, data: files });
  } catch (error) {
    console.error('listSpreadsheets failed:', error);
    return c.json({ success: false, error: 'スプレッドシートの一覧を取得できませんでした' }, 502);
  }
});

googleSheets.get('/api/integrations/google-sheets/connections/:id/spreadsheets/:sid/sheets', requireRole('owner', 'admin'), async (c) => {
  const t = await tokenFor(c, c.req.param('id')!);
  if (t instanceof Response) return t;
  try {
    return c.json({ success: true, data: await listSheetTabs(t.token, c.req.param('sid')!) });
  } catch (error) {
    console.error('listSheetTabs failed:', error);
    return c.json({ success: false, error: 'シートの一覧を取得できませんでした' }, 502);
  }
});

// フォームごとの書き出し先
function serializeLink(row: Record<string, unknown> | null) {
  if (!row) return null;
  return {
    connectionId: row.connection_id as string,
    email: (row.google_email as string | null) ?? null,
    connectionStatus: (row.status as string | null) ?? null,
    spreadsheetId: row.spreadsheet_id as string,
    spreadsheetTitle: (row.spreadsheet_title as string | null) ?? null,
    sheetTitle: row.sheet_title as string,
    lastExportedAt: (row.last_exported_at as string | null) ?? null,
    lastError: (row.last_error as string | null) ?? null,
  };
}

googleSheets.get('/api/forms/:id/google-sheet', requireRole('owner', 'admin'), async (c) => {
  const row = await c.env.DB
    .prepare(
      `SELECT l.*, c.google_email, c.status
         FROM form_google_sheet_links l JOIN google_sheets_connections c ON c.id = l.connection_id
        WHERE l.form_id = ?`,
    )
    .bind(c.req.param('id')!)
    .first<Record<string, unknown>>();
  return c.json({ success: true, data: serializeLink(row) });
});

googleSheets.put('/api/forms/:id/google-sheet', requireRole('owner', 'admin'), async (c) => {
  const formId = c.req.param('id')!;
  const body = await c.req
    .json<{ connectionId?: unknown; spreadsheetId?: unknown; spreadsheetTitle?: unknown; sheetTitle?: unknown }>()
    .catch(() => ({}) as Record<string, unknown>);
  const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
  const connectionId = str(body.connectionId);
  const spreadsheetId = str(body.spreadsheetId);
  const sheetTitle = str(body.sheetTitle);
  if (!connectionId || !spreadsheetId || !sheetTitle) {
    return c.json({ success: false, error: 'アカウント・スプレッドシート・シートを選んでください' }, 400);
  }
  const form = await c.env.DB.prepare(`SELECT id FROM forms WHERE id = ?`).bind(formId).first();
  if (!form) return c.json({ success: false, error: 'フォームが見つかりません' }, 404);
  const connection = await c.env.DB
    .prepare(`SELECT id FROM google_sheets_connections WHERE id = ?`)
    .bind(connectionId)
    .first();
  if (!connection) return c.json({ success: false, error: '連携が見つかりません' }, 404);
  const nowIso = new Date().toISOString();
  await c.env.DB
    .prepare(
      `INSERT INTO form_google_sheet_links
         (form_id, connection_id, spreadsheet_id, spreadsheet_title, sheet_title, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(form_id) DO UPDATE SET
         connection_id = excluded.connection_id, spreadsheet_id = excluded.spreadsheet_id,
         spreadsheet_title = excluded.spreadsheet_title, sheet_title = excluded.sheet_title,
         last_error = NULL, updated_at = excluded.updated_at`,
    )
    .bind(formId, connectionId, spreadsheetId, str(body.spreadsheetTitle) || null, sheetTitle, nowIso, nowIso)
    .run();
  return c.json({ success: true, data: null });
});

googleSheets.delete('/api/forms/:id/google-sheet', requireRole('owner', 'admin'), async (c) => {
  await c.env.DB.prepare(`DELETE FROM form_google_sheet_links WHERE form_id = ?`).bind(c.req.param('id')!).run();
  return c.json({ success: true, data: null });
});

export { googleSheets };
