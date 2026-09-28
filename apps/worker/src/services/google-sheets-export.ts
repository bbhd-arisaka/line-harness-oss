import { getGoogleServiceAccountToken, SHEETS_SCOPE } from './google-service-account.js';
import type { Form as DbForm } from '@line-crm/db';

const SHEETS_API = 'https://sheets.googleapis.com/v4/spreadsheets';

/** `https://docs.google.com/spreadsheets/d/<ID>/edit#gid=0` からスプレッドシートIDを取り出す。 */
export function extractSpreadsheetId(url: string): string | null {
  const match = url.match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/);
  if (match) return match[1];
  // URL でなく ID をそのまま貼った場合もそのまま使えるようにする
  if (/^[a-zA-Z0-9_-]{20,}$/.test(url.trim())) return url.trim();
  return null;
}

interface FormFieldDef {
  name: string;
  label: string;
}

function formatCellValue(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (Array.isArray(value)) return value.join(', ');
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

export interface GoogleServiceAccountEnv {
  GOOGLE_SERVICE_ACCOUNT_EMAIL?: string;
  GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY?: string;
}

/**
 * Lステップの「Googleスプレッドシート連携 β版」相当。回答1件を1行として
 * 対象スプレッドシートに追記する(ベストエフォート — 失敗しても回答自体は保存済み)。
 * 事前にスプレッドシートをサービスアカウントのメールアドレスに編集者共有しておく必要がある。
 */
export async function exportSubmissionToGoogleSheet(
  env: GoogleServiceAccountEnv,
  form: Pick<DbForm, 'google_sheet_url' | 'google_sheet_name' | 'fields'>,
  submissionData: Record<string, unknown>,
  context: { friendName: string | null; submittedAt: string },
): Promise<void> {
  if (!form.google_sheet_url) return;
  const spreadsheetId = extractSpreadsheetId(form.google_sheet_url);
  if (!spreadsheetId) throw new Error('invalid_spreadsheet_url');

  const fields = JSON.parse(form.fields || '[]') as FormFieldDef[];
  const answerFields = fields.filter((f) => f.name && !f.name.startsWith('_'));

  const token = await getGoogleServiceAccountToken(
    { email: env.GOOGLE_SERVICE_ACCOUNT_EMAIL, privateKey: env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY },
    SHEETS_SCOPE,
  );

  const row = [
    context.submittedAt,
    context.friendName ?? '',
    ...answerFields.map((f) => formatCellValue(submissionData[f.name])),
  ];

  const sheetName = form.google_sheet_name?.trim() || 'シート1';
  const range = `${sheetName}!A1`;
  const res = await fetch(
    `${SHEETS_API}/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(range)}:append?valueInputOption=USER_ENTERED`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ values: [row] }),
    },
  );
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`google_sheets_append_failed:${res.status}:${detail.slice(0, 300)}`);
  }
}
