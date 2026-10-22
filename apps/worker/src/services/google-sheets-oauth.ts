import { refreshGoogleOAuthAccessToken } from './google-oauth.js';

const SHEETS_API = 'https://sheets.googleapis.com/v4/spreadsheets';
const DRIVE_API = 'https://www.googleapis.com/drive/v3/files';
const USERINFO_API = 'https://www.googleapis.com/oauth2/v2/userinfo';

export interface SheetsConnectionRow {
  id: string;
  google_email: string;
  access_token: string | null;
  access_token_expires_at: string | null;
  refresh_token: string;
  status: string;
  last_error: string | null;
}

export interface SheetsOAuthEnv {
  DB: D1Database;
  GOOGLE_OAUTH_CLIENT_ID?: string;
  GOOGLE_OAUTH_CLIENT_SECRET?: string;
}

export interface SheetLinkRow {
  form_id: string;
  connection_id: string;
  spreadsheet_id: string;
  spreadsheet_title: string | null;
  sheet_title: string;
}

/** 有効なアクセストークンを返す(期限が近ければ更新して保存)。更新に失敗したら接続を「要再連携」にする。 */
export async function getSheetsAccessToken(
  env: SheetsOAuthEnv,
  connection: SheetsConnectionRow,
  now: Date = new Date(),
): Promise<string> {
  const expiresAt = connection.access_token_expires_at ? Date.parse(connection.access_token_expires_at) : 0;
  if (connection.access_token && expiresAt - now.getTime() > 60_000) return connection.access_token;
  if (!env.GOOGLE_OAUTH_CLIENT_ID || !env.GOOGLE_OAUTH_CLIENT_SECRET) {
    throw new Error('google_oauth_not_configured');
  }
  try {
    const token = await refreshGoogleOAuthAccessToken({
      refreshToken: connection.refresh_token,
      clientId: env.GOOGLE_OAUTH_CLIENT_ID,
      clientSecret: env.GOOGLE_OAUTH_CLIENT_SECRET,
    });
    const nowIso = now.toISOString();
    await env.DB
      .prepare(
        `UPDATE google_sheets_connections
            SET access_token = ?, access_token_expires_at = ?, status = 'active', last_error = NULL, updated_at = ?
          WHERE id = ?`,
      )
      .bind(token, new Date(now.getTime() + 55 * 60_000).toISOString(), nowIso, connection.id)
      .run();
    connection.access_token = token;
    return token;
  } catch (error) {
    const message = String(error instanceof Error ? error.message : error).slice(0, 300);
    // invalid_grant = 連携の取り消し・失効。管理画面で「再連携」を促す。
    if (message.includes('invalid_grant')) {
      await env.DB
        .prepare(`UPDATE google_sheets_connections SET status = 'error', last_error = ?, updated_at = ? WHERE id = ?`)
        .bind(message, now.toISOString(), connection.id)
        .run();
    }
    throw error;
  }
}

async function googleGet<T>(url: string, token: string): Promise<T> {
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`google_api_failed:${res.status}:${detail.slice(0, 300)}`);
  }
  return (await res.json()) as T;
}

export async function fetchGoogleEmail(token: string): Promise<string> {
  const data = await googleGet<{ email?: string }>(USERINFO_API, token);
  if (!data.email) throw new Error('google_email_missing');
  return data.email;
}

export interface SpreadsheetSummary {
  id: string;
  name: string;
  modifiedTime: string | null;
}

/** 連携したアカウントから見えるスプレッドシートを、更新が新しい順に返す。 */
export async function listSpreadsheets(token: string, query: string): Promise<SpreadsheetSummary[]> {
  const q = ["mimeType='application/vnd.google-apps.spreadsheet'", 'trashed=false'];
  const term = query.trim().replace(/\\/g, '\\\\').replace(/'/g, "\\'");
  if (term) q.push(`name contains '${term}'`);
  const params = new URLSearchParams({
    q: q.join(' and '),
    orderBy: 'modifiedTime desc',
    pageSize: '50',
    fields: 'files(id,name,modifiedTime)',
    supportsAllDrives: 'true',
    includeItemsFromAllDrives: 'true',
  });
  const data = await googleGet<{ files?: Array<{ id: string; name: string; modifiedTime?: string }> }>(
    `${DRIVE_API}?${params.toString()}`,
    token,
  );
  return (data.files ?? []).map((f) => ({ id: f.id, name: f.name, modifiedTime: f.modifiedTime ?? null }));
}

export interface SheetTab {
  sheetId: number;
  title: string;
}

export async function listSheetTabs(token: string, spreadsheetId: string): Promise<{ title: string; sheets: SheetTab[] }> {
  const params = new URLSearchParams({ fields: 'properties.title,sheets.properties(sheetId,title,index)' });
  const data = await googleGet<{
    properties?: { title?: string };
    sheets?: Array<{ properties: { sheetId: number; title: string } }>;
  }>(`${SHEETS_API}/${encodeURIComponent(spreadsheetId)}?${params.toString()}`, token);
  return {
    title: data.properties?.title ?? '',
    sheets: (data.sheets ?? []).map((s) => ({ sheetId: s.properties.sheetId, title: s.properties.title })),
  };
}

function a1Sheet(title: string): string {
  return `'${title.replace(/'/g, "''")}'`;
}

interface FormFieldDef {
  name: string;
  label?: string;
  type?: string;
}

function formatCellValue(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (Array.isArray(value)) return value.join(', ');
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

/** 回答の列(見出し名と値の取り出し元)。システム用の項目(_始まり)・見出しだけの項目は含めない。 */
export function answerColumns(fieldsJson: string): FormFieldDef[] {
  let fields: FormFieldDef[] = [];
  try { fields = JSON.parse(fieldsJson || '[]') as FormFieldDef[]; } catch { fields = []; }
  return fields.filter((f) => f.name && !f.name.startsWith('_') && f.type !== 'heading' && f.type !== 'paragraph');
}

export function buildHeaderRow(fieldsJson: string): string[] {
  return ['回答日時', '友だち名', ...answerColumns(fieldsJson).map((f) => f.label || f.name)];
}

export function buildAnswerRow(
  fieldsJson: string,
  data: Record<string, unknown>,
  context: { friendName: string | null; submittedAt: string },
): string[] {
  return [context.submittedAt, context.friendName ?? '', ...answerColumns(fieldsJson).map((f) => formatCellValue(data[f.name]))];
}

/** 選んだシートの末尾に回答1件を追記する。シートが空なら先頭に見出し行を入れる。 */
export async function appendAnswerRow(
  token: string,
  link: Pick<SheetLinkRow, 'spreadsheet_id' | 'sheet_title'>,
  fieldsJson: string,
  data: Record<string, unknown>,
  context: { friendName: string | null; submittedAt: string },
): Promise<void> {
  const sheet = a1Sheet(link.sheet_title);
  const base = `${SHEETS_API}/${encodeURIComponent(link.spreadsheet_id)}/values`;
  const head = await googleGet<{ values?: string[][] }>(
    `${base}/${encodeURIComponent(`${sheet}!A1:A1`)}`,
    token,
  );
  const rows: string[][] = [];
  if (!head.values || head.values.length === 0) rows.push(buildHeaderRow(fieldsJson));
  rows.push(buildAnswerRow(fieldsJson, data, context));

  const res = await fetch(
    `${base}/${encodeURIComponent(`${sheet}!A1`)}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ values: rows }),
    },
  );
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`google_sheets_append_failed:${res.status}:${detail.slice(0, 300)}`);
  }
}

/**
 * フォーム回答1件を、OAuthで紐づけたスプレッドシートへ書き出す。
 * 連携がなければ false(従来のサービスアカウント経路へ回す)。失敗時は状態を記録して投げ直す。
 */
export async function exportSubmissionViaOAuth(
  env: SheetsOAuthEnv,
  formId: string,
  fieldsJson: string,
  data: Record<string, unknown>,
  context: { friendName: string | null; submittedAt: string },
): Promise<boolean> {
  const link = await env.DB
    .prepare(`SELECT * FROM form_google_sheet_links WHERE form_id = ?`)
    .bind(formId)
    .first<SheetLinkRow>();
  if (!link) return false;
  const nowIso = () => new Date().toISOString();
  try {
    const connection = await env.DB
      .prepare(`SELECT * FROM google_sheets_connections WHERE id = ?`)
      .bind(link.connection_id)
      .first<SheetsConnectionRow>();
    if (!connection) throw new Error('google_connection_missing');
    const token = await getSheetsAccessToken(env, connection);
    await appendAnswerRow(token, link, fieldsJson, data, context);
    await env.DB
      .prepare(`UPDATE form_google_sheet_links SET last_exported_at = ?, last_error = NULL WHERE form_id = ?`)
      .bind(nowIso(), formId)
      .run();
    return true;
  } catch (error) {
    const message = String(error instanceof Error ? error.message : error).slice(0, 300);
    await env.DB
      .prepare(`UPDATE form_google_sheet_links SET last_error = ?, updated_at = ? WHERE form_id = ?`)
      .bind(message, nowIso(), formId)
      .run()
      .catch(() => undefined);
    throw error;
  }
}
