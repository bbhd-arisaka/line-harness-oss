import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  answerColumns,
  appendAnswerRow,
  buildAnswerRow,
  buildHeaderRow,
  createSpreadsheetInFolder,
  listFolders,
  getSheetsAccessToken,
  listSpreadsheets,
  type SheetsConnectionRow,
} from './google-sheets-oauth.js';

const FIELDS = JSON.stringify([
  { name: 'name', label: 'お名前', type: 'text' },
  { name: 'intro', label: '説明', type: 'heading' },
  { name: '_internal', label: '内部', type: 'text' },
  { name: 'menu', label: 'メニュー', type: 'checkbox' },
]);

afterEach(() => vi.unstubAllGlobals());

describe('回答の列', () => {
  it('見出し・内部項目を除き、見出し行と回答行の列が一致する', () => {
    expect(answerColumns(FIELDS).map((f) => f.name)).toEqual(['name', 'menu']);
    expect(buildHeaderRow(FIELDS)).toEqual(['回答日時', '友だち名', 'お名前', 'メニュー']);
    expect(
      buildAnswerRow(FIELDS, { name: '有坂', menu: ['A', 'B'] }, { friendName: '将希', submittedAt: '2026-10-23T00:00:00' }),
    ).toEqual(['2026-10-23T00:00:00', '将希', '有坂', 'A, B']);
  });
});

describe('appendAnswerRow', () => {
  it('シートが空なら見出し行も一緒に追記し、シート名は引用符で囲む', async () => {
    const calls: Array<{ url: string; body?: string }> = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, body: init?.body as string | undefined });
      if (!init?.method) return new Response(JSON.stringify({}), { status: 200 });
      return new Response('{}', { status: 200 });
    }));
    await appendAnswerRow('tok', { spreadsheet_id: 'S1', sheet_title: "it's シート" }, FIELDS, { name: 'a', menu: 'x' }, { friendName: null, submittedAt: 't' });
    expect(calls).toHaveLength(2);
    expect(decodeURIComponent(calls[0].url)).toContain("'it''s シート'!A1:A1");
    const sent = JSON.parse(calls[1].body!) as { values: string[][] };
    expect(sent.values).toHaveLength(2);
    expect(sent.values[0]).toEqual(['回答日時', '友だち名', 'お名前', 'メニュー']);
    expect(sent.values[1]).toEqual(['t', '', 'a', 'x']);
  });

  it('見出しがすでにあれば回答行だけを追記する', async () => {
    let body = '';
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => {
      if (!init?.method) return new Response(JSON.stringify({ values: [['回答日時']] }), { status: 200 });
      body = init.body as string;
      return new Response('{}', { status: 200 });
    }));
    await appendAnswerRow('tok', { spreadsheet_id: 'S1', sheet_title: 'シート1' }, FIELDS, { name: 'a' }, { friendName: 'f', submittedAt: 't' });
    expect((JSON.parse(body) as { values: string[][] }).values).toHaveLength(1);
  });

  it('Google がエラーを返したら例外にする', async () => {
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => {
      if (!init?.method) return new Response(JSON.stringify({ values: [['x']] }), { status: 200 });
      return new Response('forbidden', { status: 403 });
    }));
    await expect(
      appendAnswerRow('tok', { spreadsheet_id: 'S1', sheet_title: 'シート1' }, FIELDS, {}, { friendName: null, submittedAt: 't' }),
    ).rejects.toThrow('google_sheets_append_failed:403');
  });
});

describe('listSpreadsheets', () => {
  it('検索語の引用符をエスケープする', async () => {
    let url = '';
    vi.stubGlobal('fetch', vi.fn(async (u: string) => {
      url = u;
      return new Response(JSON.stringify({ files: [{ id: 'a', name: 'A', modifiedTime: 'm' }] }), { status: 200 });
    }));
    const files = await listSpreadsheets('tok', "x'y");
    expect(files).toEqual([{ id: 'a', name: 'A', modifiedTime: 'm' }]);
    expect(decodeURIComponent(url.replace(/\+/g, ' '))).toContain("name contains 'x\\'y'");
  });
});

describe('getSheetsAccessToken', () => {
  const conn = (over: Partial<SheetsConnectionRow>): SheetsConnectionRow => ({
    id: 'c1', google_email: 'a@b.c', access_token: 'old', access_token_expires_at: null, refresh_token: 'r', status: 'active', last_error: null, ...over,
  });
  const env = () => {
    const run = vi.fn(async () => ({}));
    const bind = vi.fn(() => ({ run }));
    return { run, bind, env: { DB: { prepare: vi.fn(() => ({ bind })) } as unknown as D1Database, GOOGLE_OAUTH_CLIENT_ID: 'id', GOOGLE_OAUTH_CLIENT_SECRET: 'sec' } };
  };

  it('期限内ならそのまま返す', async () => {
    const e = env();
    const future = new Date(Date.now() + 30 * 60_000).toISOString();
    await expect(getSheetsAccessToken(e.env, conn({ access_token_expires_at: future }))).resolves.toBe('old');
    expect(e.run).not.toHaveBeenCalled();
  });

  it('期限切れなら更新して保存する', async () => {
    const e = env();
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ access_token: 'new', expires_in: 3600 }), { status: 200 })));
    await expect(getSheetsAccessToken(e.env, conn({}))).resolves.toBe('new');
    expect(e.run).toHaveBeenCalledOnce();
  });

  it('連携が取り消されていたら「要再連携」にして投げ直す', async () => {
    const e = env();
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: 'invalid_grant' }), { status: 400 })));
    await expect(getSheetsAccessToken(e.env, conn({}))).rejects.toThrow('invalid_grant');
    expect(e.run).toHaveBeenCalledOnce();
  });
});

describe('フォルダと新規作成', () => {
  it('フォルダ検索はフォルダだけを対象にし、引用符をエスケープする', async () => {
    let url = '';
    vi.stubGlobal('fetch', vi.fn(async (u: string) => {
      url = u;
      return new Response(JSON.stringify({ files: [{ id: 'f1', name: '回答' }] }), { status: 200 });
    }));
    expect(await listFolders('tok', "a'b")).toEqual([{ id: 'f1', name: '回答' }]);
    const q = decodeURIComponent(url.replace(/\+/g, ' '));
    expect(q).toContain("mimeType='application/vnd.google-apps.folder'");
    expect(q).toContain("name contains 'a\\'b'");
  });

  it('フォルダを指定して作ると parents が付く。指定なしなら付かない', async () => {
    const bodies: Array<Record<string, unknown>> = [];
    vi.stubGlobal('fetch', vi.fn(async (_u: string, init?: RequestInit) => {
      bodies.push(JSON.parse(init?.body as string) as Record<string, unknown>);
      return new Response(JSON.stringify({ id: 'S9', name: 'N' }), { status: 200 });
    }));
    expect(await createSpreadsheetInFolder('tok', 'N', 'F1')).toEqual({ id: 'S9', name: 'N' });
    await createSpreadsheetInFolder('tok', 'N', null);
    expect(bodies[0].parents).toEqual(['F1']);
    expect(bodies[0].mimeType).toBe('application/vnd.google-apps.spreadsheet');
    expect('parents' in bodies[1]).toBe(false);
  });

  it('作成に失敗したら例外にする', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('no', { status: 403 })));
    await expect(createSpreadsheetInFolder('tok', 'N', null)).rejects.toThrow('google_api_failed:403');
  });
});
