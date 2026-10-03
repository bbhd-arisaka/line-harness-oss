import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { Hono } from 'hono';
import type { Env } from '../index.js';

const mocks = vi.hoisted(() => ({
  getFormById: vi.fn(),
  getFriendByLineUserId: vi.fn(),
  createFormSubmission: vi.fn(),
  verifyCallerLineUserId: vi.fn(),
  getFormSubmissions: vi.fn(),
  updateFriendRegistrationFields: vi.fn(),
  removeTagFromFriend: vi.fn(),
  enrollFriendInScenario: vi.fn(),
  enrollFriendInReminder: vi.fn(),
  attachTag: vi.fn(),
}));

vi.mock('@line-crm/db', () => ({
  getForms: vi.fn(),
  getFormsWithStats: vi.fn(),
  getFormById: mocks.getFormById,
  createForm: vi.fn(),
  updateForm: vi.fn(),
  deleteForm: vi.fn(),
  getFormSubmissions: mocks.getFormSubmissions,
  createFormSubmission: mocks.createFormSubmission,
  getFriendByLineUserId: mocks.getFriendByLineUserId,
  getFriendById: vi.fn(),
  getLatestSubmissionForFriend: vi.fn(),
  countFormSubmissions: vi.fn(async () => 0),
  getTrackedLinkById: vi.fn(),
  getMessageTemplateById: vi.fn(),
  getLineAccountById: vi.fn(),
  resolveDefaultLineAccount: vi.fn(async () => null),
  stopAllFriendScenarios: vi.fn(),
  updateFriendRegistrationFields: mocks.updateFriendRegistrationFields,
  removeTagFromFriend: mocks.removeTagFromFriend,
  changedMetadataKeys: vi.fn(() => []),
  recordFriendInfoChanged: vi.fn(),
  enrollFriendInScenario: mocks.enrollFriendInScenario,
  enrollFriendInReminder: mocks.enrollFriendInReminder,
  applyMileageRulesForEvent: vi.fn(),
  jstNow: vi.fn(() => '2026-09-29T12:00:00.000+09:00'),
}));
vi.mock('../services/liff-auth.js', () => ({ verifyCallerLineUserId: mocks.verifyCallerLineUserId }));
vi.mock('../services/friend-tag-attach.js', () => ({ attachTagAndFireSideEffects: mocks.attachTag }));
vi.mock('../services/local-line-proxy.js', () => ({ dispatchLineProxyLocally: vi.fn() }));

import { forms } from './forms.js';

const FORM_ID = '11111111-1111-4111-8111-111111111111';

function formWith(fields: unknown[]) {
  return {
    id: FORM_ID,
    name: 'テスト',
    description: null,
    fields: JSON.stringify(fields),
    on_submit_tag_id: null,
    on_submit_scenario_id: null,
    on_submit_message_type: null,
    on_submit_message_content: null,
    on_submit_webhook_url: null,
    on_submit_webhook_headers: null,
    on_submit_webhook_fail_message: null,
    on_submit_stop_scenarios: 0,
    answer_limit_per_friend: 'unlimited',
    google_sheets_enabled: 0,
    save_to_metadata: 0,
    is_active: 1,
    submit_count: 0,
    og_title: null,
    og_description: null,
    og_image_url: null,
    created_at: '2026-01-01T00:00:00+09:00',
    updated_at: '2026-01-01T00:00:00+09:00',
  };
}

function submit(data: Record<string, unknown>) {
  const bindings = {
    DB: { prepare: vi.fn(() => ({ bind: vi.fn(() => ({ run: vi.fn(), first: vi.fn(async () => null) })) })) } as unknown as D1Database,
    LINE_CHANNEL_ACCESS_TOKEN: 't',
    LINE_LOGIN_CHANNEL_ID: 'c',
    WORKER_URL: 'https://api.example.test',
  } as Env['Bindings'];
  const app = new Hono<Env>();
  app.route('/', forms);
  return app.request(
    `/api/forms/${FORM_ID}/submit`,
    { method: 'POST', headers: { Authorization: 'Bearer x', 'Content-Type': 'application/json' }, body: JSON.stringify({ data }) },
    bindings,
    { waitUntil: (p: Promise<unknown>) => void p.catch(() => undefined), passThroughOnException: () => undefined } as unknown as ExecutionContext,
  );
}

beforeEach(() => {
  mocks.verifyCallerLineUserId.mockResolvedValue('line-1');
  mocks.getFriendByLineUserId.mockResolvedValue({ id: 'friend-1', line_user_id: null, display_name: 'A', metadata: '{}' });
  mocks.getFormSubmissions.mockResolvedValue([]);
  mocks.createFormSubmission.mockImplementation(async (_db, input) => ({
    id: 's1', form_id: input.formId, friend_id: input.friendId, data: input.data, created_at: '2026-09-29T12:00:00+09:00',
  }));
});
afterEach(() => vi.clearAllMocks());

describe('日付ブロックの入力制限', () => {
  const field = {
    name: 'visit',
    label: '来店希望日',
    type: 'date',
    dateRule: { start: { mode: 'relative', days: 1 }, weekdays: [1, 2, 3, 4, 5], holiday: 'deny' },
  };

  test('制限に合わない日付は400(過去日・祝日)', async () => {
    mocks.getFormById.mockResolvedValue(formWith([field]));
    expect((await submit({ visit: '2026-09-29' })).status).toBe(400); // 当日は不可(翌日以降)
    expect((await submit({ visit: '2026-10-12' })).status).toBe(400); // スポーツの日
    expect((await submit({ visit: '2026-10-10' })).status).toBe(400); // 土曜
    expect(mocks.createFormSubmission).not.toHaveBeenCalled();
  });

  test('制限に合う日付は受け付け、リマインダへ登録する', async () => {
    mocks.getFormById.mockResolvedValue(
      formWith([{ ...field, reminderId: 'rem-1', reminderTime: '09:30' }]),
    );
    const res = await submit({ visit: '2026-10-13' }); // 火曜・平日
    expect(res.status).toBe(201);
    expect(mocks.enrollFriendInReminder).toHaveBeenCalledWith(expect.anything(), {
      friendId: 'friend-1',
      reminderId: 'rem-1',
      targetDate: '2026-10-13T09:30:00.000+09:00',
    });
  });
});

describe('ファイルブロック', () => {
  test('このフォームのアップロードAPIで保存したURL以外は受け付けない', async () => {
    mocks.getFormById.mockResolvedValue(formWith([{ name: 'photo', label: '写真', type: 'file' }]));
    expect((await submit({ photo: 'https://evil.example/x.png' })).status).toBe(400);
    expect((await submit({ photo: `https://api.example.test/api/form-uploads/other-form/${'a'.repeat(36)}.png` })).status).toBe(400);
    const ok = await submit({ photo: `https://api.example.test/api/form-uploads/${FORM_ID}/${'a'.repeat(36)}.png` });
    expect(ok.status).toBe(201);
  });
});

describe('選択時の動作', () => {
  test('友だち情報へ登録する値が空欄なら、選択肢の文言をそのまま入れる', async () => {
    mocks.getFormById.mockResolvedValue(
      formWith([
        {
          name: 'kikkake', label: 'きっかけ', type: 'select', options: ['SNS', '紹介'],
          friendFieldKey: 'ff_kikkake', optionFriendFieldValues: { 紹介: 'ご紹介' },
        },
      ]),
    );
    await submit({ kikkake: 'SNS' });
    expect(mocks.updateFriendRegistrationFields).toHaveBeenCalledWith(expect.anything(), 'friend-1', {
      metadataPatch: { ff_kikkake: 'SNS' },
    }, { actor: 'フォーム' });
    mocks.updateFriendRegistrationFields.mockClear();
    await submit({ kikkake: '紹介' });
    expect(mocks.updateFriendRegistrationFields).toHaveBeenCalledWith(expect.anything(), 'friend-1', {
      metadataPatch: { ff_kikkake: 'ご紹介' },
    }, { actor: 'フォーム' });
  });

  test('チェックボックスの複数選択は、友だち情報へまとめて登録する', async () => {
    mocks.getFormById.mockResolvedValue(
      formWith([{ name: 'menu', label: 'メニュー', type: 'checkbox', options: ['A', 'B', 'C'], friendFieldKey: 'ff_menu' }]),
    );
    await submit({ menu: ['A', 'C'] });
    expect(mocks.updateFriendRegistrationFields).toHaveBeenCalledWith(expect.anything(), 'friend-1', {
      metadataPatch: { ff_menu: 'A, C' },
    }, { actor: 'フォーム' });
  });

  test('「その他(自由入力)」も選択肢「その他」のタグ設定が効く', async () => {
    mocks.getFormById.mockResolvedValue(
      formWith([{ name: 'k', label: 'k', type: 'radio', options: ['SNS'], allowOther: true, optionTags: { その他: ['tag-other'] } }]),
    );
    await submit({ k: 'その他(友人の紹介)' });
    expect(mocks.attachTag).toHaveBeenCalledWith(expect.anything(), 'friend-1', 'tag-other', expect.anything(), { actor: 'フォーム' });
  });

  test('アクション: タグ追加・削除・シナリオ開始', async () => {
    mocks.getFormById.mockResolvedValue(
      formWith([
        {
          name: 'k', label: 'k', type: 'radio', options: ['A'],
          optionActions: { A: { addTagIds: ['t-add'], removeTagIds: ['t-del'], scenarioId: 'sc-1' } },
        },
      ]),
    );
    await submit({ k: 'A' });
    expect(mocks.attachTag).toHaveBeenCalledWith(expect.anything(), 'friend-1', 't-add', expect.anything(), { actor: 'フォーム' });
    expect(mocks.removeTagFromFriend).toHaveBeenCalledWith(expect.anything(), 'friend-1', 't-del', { actor: 'フォーム' });
    expect(mocks.enrollFriendInScenario).toHaveBeenCalledWith(expect.anything(), 'friend-1', 'sc-1');
  });
});

describe('定員数', () => {
  test('満員の選択肢を選んだ回答は受け付けない', async () => {
    mocks.getFormById.mockResolvedValue(
      formWith([{ name: 'slot', label: '枠', type: 'radio', options: ['10時', '11時'], optionCapacity: { '10時': 1 } }]),
    );
    mocks.getFormSubmissions.mockResolvedValue([{ data: JSON.stringify({ slot: '10時' }) }]);
    const res = await submit({ slot: '10時' });
    expect(res.status).toBe(400);
    expect(mocks.createFormSubmission).not.toHaveBeenCalled();
    expect((await submit({ slot: '11時' })).status).toBe(201);
  });
});
